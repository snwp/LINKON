//! Geração de imagens para o editor, por dois caminhos:
//! - Codex CLI logado no ChatGPT (padrão): usa a assinatura, sem chave. Roda `codex exec` numa pasta vazia,
//!   só leitura, e pega o arquivo que o Codex grava em `~/.codex/generated_images/<id da conversa>/`.
//! - API de imagens da OpenAI: com a chave do usuário, guardada no Gerenciador de Credenciais do Windows.
//!
//! As duas funções devolvem o caminho de um arquivo pronto; quem chama copia para a biblioteca.

use base64::Engine;
use serde::Serialize;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use crate::imgcheck::{file_name_for, shape_info, valid_key, valid_thread_id};

/// Uma imagem do Codex leva de 30 a 70 s; passou disso, algo travou.
const TIMEOUT: Duration = Duration::from_secs(300);
pub const API_MODELS: &[&str] = &["gpt-image-2.6-flare", "gpt-image-2.6-sunburst"];
const KEYRING_SERVICE: &str = "Linkon";
const KEYRING_USER: &str = "openai-api-key";

/// O processo do Codex em andamento (um por vez), para poder cancelar.
#[derive(Default)]
pub struct ImageRun {
    child: Mutex<Option<(u64, Child)>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageStatus {
    /// Linha de status do `codex login status`, ou vazia quando o Codex não foi encontrado.
    codex: String,
    has_key: bool,
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

/// O `codex.cmd` abre um node por baixo; no Windows só o `taskkill /T` derruba os dois.
fn kill_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        let _ = command(Path::new("taskkill"))
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
}

fn find_codex() -> Option<PathBuf> {
    let mut v: Vec<PathBuf> = ["codex.cmd", "codex.exe", "codex"].iter().map(PathBuf::from).collect();
    if let Ok(appdata) = std::env::var("APPDATA") {
        v.push(Path::new(&appdata).join("npm").join("codex.cmd"));
    }
    v.into_iter().find(|p| command(p).arg("--version").stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok_and(|s| s.success()))
}

fn codex_home() -> Option<PathBuf> {
    if let Ok(h) = std::env::var("CODEX_HOME") {
        return Some(PathBuf::from(h));
    }
    std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).ok().map(|h| Path::new(&h).join(".codex"))
}

fn newest_image(dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| {
            p.extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| matches!(e.to_ascii_lowercase().as_str(), "png" | "jpg" | "jpeg" | "webp"))
        })
        .max_by_key(|p| p.metadata().and_then(|m| m.modified()).ok())
}

pub fn status() -> ImageStatus {
    let codex = find_codex()
        .and_then(|bin| command(&bin).args(["login", "status"]).stdin(Stdio::null()).output().ok())
        .map(|o| {
            let text = format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr));
            text.lines().map(str::trim).rfind(|l| !l.is_empty()).unwrap_or("").chars().take(120).collect()
        })
        .unwrap_or_default();
    ImageStatus { codex, has_key: read_key().is_some() }
}

/// Gera pelo Codex. `work` é uma pasta vazia só deste pedido.
pub fn generate_codex(app: &AppHandle, work: &Path, prompt: &str, shape: &str) -> Result<PathBuf, String> {
    let run = app.state::<ImageRun>();
    let (_, aspect) = shape_info(shape)?;
    let bin = find_codex().ok_or("O Codex não foi encontrado neste computador. Instale com `npm i -g @openai/codex` e entre com `codex login`.")?;
    let request = format!(
        "$imagegen Gere exatamente uma imagem e pare. Não rode comandos e não crie nem edite arquivos.\n\
         Formato: {aspect}. Sem texto escrito na imagem, a menos que a descrição peça.\n\
         Descrição: {prompt}\n"
    );

    // O pedido vai pela entrada padrão (`-`): o texto do usuário nunca vira argumento de linha de comando.
    let mut child = command(&bin)
        .current_dir(work)
        .args(["exec", "--json", "--skip-git-repo-check", "-s", "read-only", "-C"])
        .arg(work)
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Não foi possível iniciar o Codex ({e})."))?;
    let mut stdin = child.stdin.take().ok_or("Sem entrada para o Codex.")?;
    let stdout = child.stdout.take().ok_or("Sem saída do Codex.")?;
    let _ = stdin.write_all(request.as_bytes());
    drop(stdin);

    let ticket = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0);
    *run.child.lock().map_err(|e| e.to_string())? = Some((ticket, child));

    // Vigia: depois do limite de tempo, derruba o processo se ainda for este pedido.
    let watch_app = app.clone();
    let timed_out = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let flag = timed_out.clone();
    std::thread::spawn(move || {
        std::thread::sleep(TIMEOUT);
        if let Ok(mut slot) = watch_app.state::<ImageRun>().child.lock() {
            if let Some((t, c)) = slot.as_mut() {
                if *t == ticket {
                    flag.store(true, std::sync::atomic::Ordering::SeqCst);
                    kill_tree(c);
                }
            }
        }
    });

    let mut thread_id = String::new();
    let mut error = String::new();
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
        match v.get("type").and_then(|t| t.as_str()) {
            Some("thread.started") => {
                thread_id = v.get("thread_id").and_then(|t| t.as_str()).unwrap_or("").to_string();
            }
            Some("turn.failed") | Some("error") => {
                let m = v.pointer("/error/message").or_else(|| v.get("message")).and_then(|m| m.as_str()).unwrap_or("");
                if !m.is_empty() {
                    error = m.chars().take(400).collect();
                }
            }
            _ => {}
        }
    }

    let finished = run.child.lock().ok().and_then(|mut s| s.take());
    let status = finished.and_then(|(_, mut c)| c.wait().ok());
    if timed_out.load(std::sync::atomic::Ordering::SeqCst) {
        return Err("O Codex demorou demais e foi interrompido. Tente de novo.".into());
    }
    if status.is_none() {
        return Err("cancelado".into());
    }

    let found = valid_thread_id(&thread_id)
        .then(|| codex_home().map(|h| h.join("generated_images").join(&thread_id)))
        .flatten()
        .and_then(|d| newest_image(&d));
    match found {
        Some(p) => Ok(p),
        None if !error.is_empty() => Err(format!("O Codex não gerou a imagem: {error}")),
        None => Err("O Codex terminou sem gerar a imagem. Confira se você entrou com `codex login` usando uma conta do ChatGPT com geração de imagem.".into()),
    }
}

pub fn cancel(run: &ImageRun) {
    if let Ok(mut slot) = run.child.lock() {
        if let Some((_, c)) = slot.as_mut() {
            kill_tree(c);
        }
        // Tirar do lugar faz o pedido em andamento entender que foi cancelado.
        if let Some((_, mut c)) = slot.take() {
            let _ = c.wait();
        }
    }
}

// ---------- API da OpenAI ----------

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| format!("O cofre de senhas do Windows não respondeu ({e})."))
}

fn read_key() -> Option<String> {
    entry().ok()?.get_password().ok().filter(|k| !k.is_empty())
}

/// Grava a chave no Gerenciador de Credenciais do Windows; vazia apaga.
pub fn set_key(key: &str) -> Result<(), String> {
    let key = key.trim();
    let e = entry()?;
    if key.is_empty() {
        return match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(format!("Não foi possível apagar a chave ({err}).")),
        };
    }
    if !valid_key(key) {
        return Err("Isso não parece uma chave da OpenAI (começa com sk-).".into());
    }
    e.set_password(key).map_err(|err| format!("Não foi possível guardar a chave ({err})."))
}

/// Gera pela API e grava o PNG em `work`. Devolve o caminho.
pub fn generate_api(work: &Path, prompt: &str, shape: &str, model: &str) -> Result<PathBuf, String> {
    let (size, _) = shape_info(shape)?;
    if !API_MODELS.contains(&model) {
        return Err("Modelo de imagem desconhecido.".into());
    }
    let key = read_key().ok_or("Cole uma chave da OpenAI em Configurações para usar a API.")?;
    let body = serde_json::json!({ "model": model, "prompt": prompt, "size": size, "n": 1, "output_format": "png" });
    let resp = ureq::post("https://api.openai.com/v1/images/generations")
        .set("Authorization", &format!("Bearer {key}"))
        .timeout(TIMEOUT)
        .send_json(body);
    let json: serde_json::Value = match resp {
        Ok(r) => r.into_json().map_err(|e| format!("A resposta da OpenAI veio incompleta ({e})."))?,
        Err(ureq::Error::Status(code, r)) => {
            let detail = r
                .into_json::<serde_json::Value>()
                .ok()
                .and_then(|v| v.pointer("/error/message").and_then(|m| m.as_str()).map(|m| m.chars().take(300).collect::<String>()))
                .unwrap_or_default();
            return Err(match code {
                401 => "A OpenAI recusou a chave. Confira a chave em Configurações.".into(),
                429 => format!("A OpenAI recusou por limite ou falta de créditos. {detail}"),
                _ => format!("A OpenAI recusou o pedido ({code}). {detail}"),
            });
        }
        Err(e) => return Err(format!("Sem conexão com a OpenAI ({e}).")),
    };
    let b64 = json.pointer("/data/0/b64_json").and_then(|v| v.as_str()).ok_or("A OpenAI não devolveu a imagem.")?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|_| "A imagem veio corrompida.")?;
    if !bytes.starts_with(b"\x89PNG") {
        return Err("A OpenAI devolveu algo que não é uma imagem PNG.".into());
    }
    let path = work.join(file_name_for(prompt, "png"));
    std::fs::write(&path, &bytes).map_err(|e| format!("Não foi possível gravar a imagem ({e})."))?;
    Ok(path)
}
