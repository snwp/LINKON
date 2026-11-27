//! Assistente do editor via Claude Code instalado na máquina.
//! O Linkon não guarda chave nem faz login: usa a conta com que o próprio usuário entrou no Claude Code
//! (`claude auth login`). Cada pedido roda `claude -p` sem ferramentas, numa pasta vazia, e o stdout em
//! stream-json é repassado linha a linha para a interface pelo evento `ai-event`.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use crate::aiconf;

const MAX_PROMPT_BYTES: usize = 512 * 1024;
/// Imagens de referência (ver refs.rs) que vão junto do pedido: poucas e pequenas.
const MAX_IMAGES: usize = 3;
const MAX_IMAGE_B64: usize = 2_100_000;

#[derive(Deserialize)]
pub struct AiImage {
    media_type: String,
    data: String,
}

/// A mensagem do pedido em stream-json: as imagens primeiro, depois o texto. Recusa tipo ou dado fora do esperado.
fn image_message(prompt: &str, images: &[AiImage]) -> Result<String, String> {
    if images.len() > MAX_IMAGES {
        return Err("Imagens de referência demais.".into());
    }
    let mut content = Vec::new();
    for img in images {
        let ok_type = matches!(img.media_type.as_str(), "image/jpeg" | "image/png" | "image/gif" | "image/webp");
        let ok_data = img.data.len() <= MAX_IMAGE_B64 && img.data.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'='));
        if !ok_type || !ok_data {
            return Err("Imagem de referência inválida.".into());
        }
        content.push(serde_json::json!({ "type": "image", "source": { "type": "base64", "media_type": img.media_type, "data": img.data } }));
    }
    content.push(serde_json::json!({ "type": "text", "text": prompt }));
    let msg = serde_json::json!({ "type": "user", "message": { "role": "user", "content": content } });
    Ok(format!("{msg}\n"))
}
/// Modelos que o app pode pedir ao Claude Code (nomes completos; os apelidos antigos seguem valendo).
const MODELS: &[&str] = &[
    "",
    "opus",
    "sonnet",
    "haiku",
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "claude-haiku-5-5",
    "claude-fable-5-2",
];

#[derive(Default)]
pub struct AiRuns {
    children: Mutex<HashMap<String, Child>>,
    /// Pedidos em andamento por um provedor HTTP (sem processo para derrubar).
    http: Mutex<HashSet<String>>,
    cancelled: Mutex<HashSet<String>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiEvent {
    run_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    line: Option<String>,
    done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    version: String,
    logged_in: bool,
    auth_method: String,
}

fn command(program: &Path) -> Command {
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

/// Onde o Claude Code costuma estar. O app aberto pelo menu Iniciar nem sempre herda o PATH do terminal.
fn candidates() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = ["claude.cmd", "claude.exe", "claude"].iter().map(PathBuf::from).collect();
    if let Ok(appdata) = std::env::var("APPDATA") {
        v.push(Path::new(&appdata).join("npm").join("claude.cmd"));
    }
    if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        v.push(Path::new(&home).join(".local").join("bin").join("claude.exe"));
        v.push(Path::new(&home).join(".local").join("bin").join("claude"));
    }
    v
}

fn find_claude() -> Result<(PathBuf, String), String> {
    for p in candidates() {
        if let Ok(out) = command(&p).arg("--version").output() {
            if out.status.success() {
                return Ok((p, String::from_utf8_lossy(&out.stdout).trim().to_string()));
            }
        }
    }
    Err("O Claude Code não foi encontrado neste computador.".into())
}

#[tauri::command]
pub async fn ai_check() -> Result<AiStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let (bin, version) = find_claude()?;
        // `auth status` responde JSON mesmo deslogado (e sai com código 1 nesse caso).
        let out = command(&bin)
            .args(["auth", "status"])
            .output()
            .map_err(|e| format!("Não foi possível consultar o login do Claude Code ({e})."))?;
        let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap_or_default();
        Ok(AiStatus {
            version,
            logged_in: v.get("loggedIn").and_then(|x| x.as_bool()).unwrap_or(false),
            auth_method: v.get("authMethod").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn emit(app: &AppHandle, ev: AiEvent) {
    let _ = app.emit("ai-event", ev);
}

#[tauri::command]
pub fn ai_run(
    app: AppHandle,
    run_id: String,
    prompt: String,
    system_prompt: String,
    model: String,
    images: Option<Vec<AiImage>>,
) -> Result<(), String> {
    if run_id.is_empty() || run_id.len() > 32 || !run_id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Pedido inválido.".into());
    }
    if prompt.len() > MAX_PROMPT_BYTES || system_prompt.len() > MAX_PROMPT_BYTES {
        return Err("A página é grande demais para enviar ao assistente.".into());
    }
    let config = aiconf::load(&config_path(&app)?);
    // "p:<id>" = provedor compatível com a OpenAI cadastrado nas Configurações.
    if let Some(id) = model.strip_prefix("p:") {
        let p = config.providers.into_iter().find(|p| p.id == id).ok_or("Esse provedor de IA não está mais cadastrado. Escolha outro modelo.")?;
        return run_provider(app, run_id, p, prompt, system_prompt);
    }
    if !MODELS.contains(&model.as_str()) {
        return Err("Modelo desconhecido.".into());
    }

    // Pasta vazia e própria: o Claude Code roda sem ferramentas, mas nem assim deve partir de uma pasta do usuário.
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("ai");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let system_file = dir.join(format!("system-{run_id}.md"));
    std::fs::write(&system_file, &system_prompt).map_err(|e| e.to_string())?;
    let mcp_file = dir.join(format!("mcp-{run_id}.json"));
    if !config.mcp.is_empty() {
        aiconf::validate(&config)?;
        std::fs::write(&mcp_file, aiconf::mcp_json(&config.mcp).to_string()).map_err(|e| e.to_string())?;
    }

    // Com imagens, o pedido vai como mensagem stream-json (texto puro não leva imagem).
    let images = images.unwrap_or_default();
    let input = if images.is_empty() { prompt } else { image_message(&prompt, &images)? };

    let (bin, _) = find_claude()?;
    let mut cmd = command(&bin);
    cmd.current_dir(&dir)
        .args([
            "-p",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--tools",
            "",
            "--no-session-persistence",
            "--strict-mcp-config",
            // Sem as configurações do usuário (hooks, plugins, CLAUDE.md global): o pedido é só do editor.
            "--setting-sources",
            "local",
            "--system-prompt-file",
        ])
        .arg(&system_file);
    if !model.is_empty() {
        cmd.args(["--model", &model]);
    }
    // MCPs cadastrados: só eles (--strict-mcp-config acima) e com as ferramentas liberadas, porque no -p não há
    // quem aprove. As ferramentas embutidas (arquivos, terminal) seguem desligadas por --tools "".
    if !config.mcp.is_empty() {
        cmd.arg("--mcp-config").arg(&mcp_file).arg("--allowedTools");
        cmd.args(config.mcp.iter().map(|m| format!("mcp__{}", m.name)));
    }
    if !images.is_empty() {
        cmd.args(["--input-format", "stream-json"]);
    }
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Não foi possível iniciar o Claude Code ({e})."))?;
    let mut stdin = child.stdin.take().ok_or("Sem entrada para o Claude Code.")?;
    let stdout = child.stdout.take().ok_or("Sem saída do Claude Code.")?;
    let mut stderr = child.stderr.take().ok_or("Sem saída de erro do Claude Code.")?;
    app.state::<AiRuns>().children.lock().map_err(|e| e.to_string())?.insert(run_id.clone(), child);

    // O pedido vai pela entrada padrão para não esbarrar no limite de tamanho da linha de comando.
    std::thread::spawn(move || {
        let _ = stdin.write_all(input.as_bytes());
    });

    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            emit(&app, AiEvent { run_id: run_id.clone(), line: Some(line), done: false, error: None });
        }
        let mut err_text = String::new();
        let _ = stderr.read_to_string(&mut err_text);

        let runs = app.state::<AiRuns>();
        let status = runs
            .children
            .lock()
            .ok()
            .and_then(|mut m| m.remove(&run_id))
            .and_then(|mut c| c.wait().ok());
        let cancelled = runs.cancelled.lock().map(|mut s| s.remove(&run_id)).unwrap_or(false);
        let _ = std::fs::remove_file(&system_file);
        let _ = std::fs::remove_file(&mcp_file);

        let error = if cancelled {
            Some("cancelado".to_string())
        } else {
            match status {
                Some(s) if s.success() => None,
                // Erros de conta e limite chegam pelo evento "result"; aqui fica o que o processo disse.
                Some(s) => {
                    let msg = err_text.trim();
                    Some(if msg.is_empty() { format!("O Claude Code terminou com erro (código {}).", s.code().unwrap_or(-1)) } else { msg.chars().take(600).collect() })
                }
                None => Some("O Claude Code parou de responder.".into()),
            }
        };
        emit(&app, AiEvent { run_id, line: None, done: true, error });
    });
    Ok(())
}

#[tauri::command]
pub fn ai_cancel(app: AppHandle, run_id: String) -> Result<(), String> {
    let runs = app.state::<AiRuns>();
    if runs.http.lock().map_err(|e| e.to_string())?.contains(&run_id) {
        runs.cancelled.lock().map_err(|e| e.to_string())?.insert(run_id);
        return Ok(());
    }
    if let Some(child) = runs.children.lock().map_err(|e| e.to_string())?.get_mut(&run_id) {
        runs.cancelled.lock().map_err(|e| e.to_string())?.insert(run_id);
        let _ = child.kill();
    }
    Ok(())
}

// ---------- provedores compatíveis com a OpenAI ----------

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("ai-config.json"))
}

fn key_entry(id: &str) -> Result<keyring::Entry, String> {
    if !aiconf::valid_slug(id) {
        return Err("Provedor inválido.".into());
    }
    keyring::Entry::new("Linkon", &format!("ai-provider-{id}")).map_err(|e| format!("O cofre de senhas do Windows não respondeu ({e})."))
}

fn read_key(id: &str) -> Option<String> {
    key_entry(id).ok()?.get_password().ok().filter(|k| !k.is_empty())
}

fn delete_key(id: &str) -> Result<(), String> {
    match key_entry(id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Não foi possível apagar a chave ({e}).")),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderView {
    #[serde(flatten)]
    provider: aiconf::Provider,
    has_key: bool,
}

#[derive(Serialize)]
pub struct ConfigView {
    providers: Vec<ProviderView>,
    mcp: Vec<aiconf::McpServer>,
}

/// Provedores (com a indicação de chave guardada, nunca a chave) e MCPs.
#[tauri::command]
pub fn ai_config(app: AppHandle) -> Result<ConfigView, String> {
    let c = aiconf::load(&config_path(&app)?);
    let providers = c.providers.into_iter().map(|p| ProviderView { has_key: read_key(&p.id).is_some(), provider: p }).collect();
    Ok(ConfigView { providers, mcp: c.mcp })
}

/// Grava a lista inteira. A chave de um provedor que saiu da lista sai também do cofre.
#[tauri::command]
pub fn ai_save_config(app: AppHandle, config: aiconf::AiConfig) -> Result<(), String> {
    let path = config_path(&app)?;
    let old = aiconf::load(&path);
    aiconf::save(&path, &config)?;
    for p in old.providers.iter().filter(|o| !config.providers.iter().any(|n| n.id == o.id)) {
        delete_key(&p.id)?;
    }
    Ok(())
}

/// Guarda a chave do provedor no cofre do Windows; vazia apaga. A chave nunca volta para a interface.
#[tauri::command]
pub fn ai_set_key(id: String, key: String) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return delete_key(&id);
    }
    if !aiconf::valid_key(key) {
        return Err("Isso não parece uma chave de API (sem espaços, de 8 a 512 caracteres).".into());
    }
    key_entry(&id)?.set_password(key).map_err(|e| format!("Não foi possível guardar a chave ({e})."))
}

/// Chat completions com streaming. Cada pedaço de texto sai como linha stream-json (ver aiconf::text_event).
fn run_provider(app: AppHandle, run_id: String, p: aiconf::Provider, prompt: String, system_prompt: String) -> Result<(), String> {
    // Revalida na hora de mandar: a chave só vai para a URL cadastrada, e só por HTTPS (ou para esta máquina).
    if !aiconf::valid_url(&p.base_url) {
        return Err("A URL do provedor precisa começar com https://.".into());
    }
    let key = read_key(&p.id).ok_or_else(|| format!("Guarde a chave de “{}” em Configurações, na seção Assistente de IA.", p.name))?;
    app.state::<AiRuns>().http.lock().map_err(|e| e.to_string())?.insert(run_id.clone());

    std::thread::spawn(move || {
        let started = std::time::Instant::now();
        let runs = app.state::<AiRuns>();
        let is_cancelled = || runs.cancelled.lock().map(|s| s.contains(&run_id)).unwrap_or(false);
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(std::time::Duration::from_secs(20))
            // Entre um pedaço e outro; um modelo que raciocina pode ficar um tempo calado antes de escrever.
            .timeout_read(std::time::Duration::from_secs(240))
            .build();
        let resp = agent
            .post(&aiconf::chat_url(&p.base_url))
            .set("Authorization", &format!("Bearer {key}"))
            .set("Accept", "text/event-stream")
            .send_json(aiconf::chat_body(&p.model, &system_prompt, &prompt));

        let mut text = String::new();
        let mut usage = (0, 0);
        let mut error: Option<String> = None;
        match resp {
            Ok(r) => {
                for line in BufReader::new(r.into_reader()).lines() {
                    if is_cancelled() {
                        break;
                    }
                    let line = match line {
                        Ok(l) => l,
                        Err(e) => {
                            error = Some(format!("A conexão com {} caiu ({e}).", p.name));
                            break;
                        }
                    };
                    let Some(c) = aiconf::parse_sse(&line) else { continue };
                    if let Some(e) = c.error {
                        error = Some(e);
                        break;
                    }
                    if !c.text.is_empty() {
                        text.push_str(&c.text);
                        emit(&app, AiEvent { run_id: run_id.clone(), line: Some(aiconf::text_event(&c.text)), done: false, error: None });
                    }
                    if let Some(u) = c.usage {
                        usage = u;
                    }
                    if c.done {
                        break;
                    }
                }
            }
            Err(ureq::Error::Status(code, r)) => {
                let body = r.into_string().unwrap_or_default();
                let detail: String = serde_json::from_str::<serde_json::Value>(&body)
                    .ok()
                    .and_then(|v| {
                        v.pointer("/error/message").or_else(|| v.get("detail")).or_else(|| v.get("message")).and_then(|m| m.as_str()).map(str::to_string)
                    })
                    .unwrap_or(body)
                    .chars()
                    .take(300)
                    .collect();
                error = Some(match code {
                    401 | 403 => format!("{} recusou a chave. Confira a chave em Configurações. {detail}", p.name),
                    404 => format!("{} não achou o modelo “{}” nesse endereço. {detail}", p.name, p.model),
                    429 => format!("{} recusou por limite de uso (rate limit). {detail}", p.name),
                    _ => format!("{} recusou o pedido ({code}). {detail}", p.name),
                });
            }
            Err(e) => error = Some(format!("Sem conexão com {} ({e}).", p.name)),
        }

        let cancelled = runs.cancelled.lock().map(|mut s| s.remove(&run_id)).unwrap_or(false);
        let _ = runs.http.lock().map(|mut s| s.remove(&run_id));
        if !cancelled {
            let ok = error.is_none();
            let shown = error.clone().unwrap_or(text);
            let ms = started.elapsed().as_millis() as u64;
            emit(&app, AiEvent { run_id: run_id.clone(), line: Some(aiconf::result_event(ok, &shown, usage, ms)), done: false, error: None });
        }
        let error = if cancelled { Some("cancelado".to_string()) } else { error };
        emit(&app, AiEvent { run_id, line: None, done: true, error });
    });
    Ok(())
}

#[cfg(test)]
mod image_tests {
    use super::*;

    #[test]
    fn image_message_checks_type_and_data() {
        let ok = AiImage { media_type: "image/png".into(), data: "iVBORw0KGgo=".into() };
        let line = image_message("oi", &[ok]).unwrap();
        let v: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(v["message"]["content"][0]["type"], "image");
        assert_eq!(v["message"]["content"][1]["text"], "oi");
        let svg = AiImage { media_type: "image/svg+xml".into(), data: "PHN2Zz4=".into() };
        assert!(image_message("x", &[svg]).is_err());
        let bad = AiImage { media_type: "image/png".into(), data: "a\"}b".into() };
        assert!(image_message("x", &[bad]).is_err());
    }
}
