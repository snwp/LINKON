//! Assistente do editor via Claude Code instalado na máquina.
//! O Linkon não guarda chave nem faz login: usa a conta com que o próprio usuário entrou no Claude Code
//! (`claude auth login`). Cada pedido roda `claude -p` sem ferramentas, numa pasta vazia, e o stdout em
//! stream-json é repassado linha a linha para a interface pelo evento `ai-event`.

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

const MAX_PROMPT_BYTES: usize = 512 * 1024;
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
) -> Result<(), String> {
    if run_id.is_empty() || run_id.len() > 32 || !run_id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Pedido inválido.".into());
    }
    if !MODELS.contains(&model.as_str()) {
        return Err("Modelo desconhecido.".into());
    }
    if prompt.len() > MAX_PROMPT_BYTES || system_prompt.len() > MAX_PROMPT_BYTES {
        return Err("A página é grande demais para enviar ao assistente.".into());
    }

    // Pasta vazia e própria: o Claude Code roda sem ferramentas, mas nem assim deve partir de uma pasta do usuário.
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("ai");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let system_file = dir.join(format!("system-{run_id}.md"));
    std::fs::write(&system_file, &system_prompt).map_err(|e| e.to_string())?;

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
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Não foi possível iniciar o Claude Code ({e})."))?;
    let mut stdin = child.stdin.take().ok_or("Sem entrada para o Claude Code.")?;
    let stdout = child.stdout.take().ok_or("Sem saída do Claude Code.")?;
    let mut stderr = child.stderr.take().ok_or("Sem saída de erro do Claude Code.")?;
    app.state::<AiRuns>().children.lock().map_err(|e| e.to_string())?.insert(run_id.clone(), child);

    // O pedido vai pela entrada padrão para não esbarrar no limite de tamanho da linha de comando.
    std::thread::spawn(move || {
        let _ = stdin.write_all(prompt.as_bytes());
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
    if let Some(child) = runs.children.lock().map_err(|e| e.to_string())?.get_mut(&run_id) {
        runs.cancelled.lock().map_err(|e| e.to_string())?.insert(run_id);
        let _ = child.kill();
    }
    Ok(())
}
