//! Publicação na Vercel pela CLI instalada e logada pelo usuário (`npm i -g vercel`, `vercel login`).
//! Nada de token no Linkon: a conta é a da CLI. Cada interface vira um projeto da Vercel com o nome
//! `linkon-<pasta>-<interface>`, publicado a partir de uma cópia do site em `<dados do app>/deploy/<nome>/`
//! (a pasta `.vercel` que liga ao projeto fica lá, fora dos Documentos do usuário).

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

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

fn find_vercel() -> Option<PathBuf> {
    let mut v: Vec<PathBuf> = ["vercel.cmd", "vercel.exe", "vercel"].iter().map(PathBuf::from).collect();
    if let Ok(appdata) = std::env::var("APPDATA") {
        v.push(Path::new(&appdata).join("npm").join("vercel.cmd"));
    }
    v.into_iter()
        .find(|p| command(p).arg("--version").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok_and(|s| s.success()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VercelStatus {
    installed: bool,
    /// Conta logada na CLI, ou vazio.
    user: String,
}

pub fn status() -> VercelStatus {
    let Some(bin) = find_vercel() else { return VercelStatus { installed: false, user: String::new() } };
    let user = command(&bin)
        .arg("whoami")
        .stdin(Stdio::null())
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).lines().map(str::trim).rfind(|l| !l.is_empty()).unwrap_or("").chars().take(80).collect())
        .unwrap_or_default();
    VercelStatus { installed: true, user }
}

/// Nome do projeto na Vercel: até 100 caracteres, minúsculas, números e hífen (as partes já vêm em slug).
pub fn project_name(rel: &str) -> String {
    let name: String = format!("linkon-{}", rel.replace('/', "-")).chars().take(100).collect();
    name.trim_end_matches('-').to_string()
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for e in fs::read_dir(from)?.flatten() {
        let name = e.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let (src, dest) = (e.path(), to.join(&name));
        if src.is_dir() { copy_dir(&src, &dest)? } else { fs::copy(&src, &dest).map(|_| ())? }
    }
    Ok(())
}

/// Publica a pasta do site em produção e devolve o endereço.
pub fn deploy(app_data: &Path, site: &Path, name: &str) -> Result<String, String> {
    let bin = find_vercel().ok_or("A CLI da Vercel não foi encontrada. Instale com `npm i -g vercel` e entre com `vercel login`.")?;
    let stage = app_data.join("deploy").join(name);
    // Recria a cópia, mantendo só a ligação com o projeto (.vercel).
    if let Ok(list) = fs::read_dir(&stage) {
        for e in list.flatten() {
            if e.file_name() != ".vercel" {
                let p = e.path();
                let _ = if p.is_dir() { fs::remove_dir_all(&p) } else { fs::remove_file(&p) };
            }
        }
    }
    copy_dir(site, &stage).map_err(|e| format!("Não foi possível preparar a publicação ({e})."))?;

    // Nenhum texto do usuário vai na linha de comando: o nome é a pasta (já em slug).
    let out = command(&bin)
        .current_dir(&stage)
        .args(["deploy", "--prod", "--yes"])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Não foi possível iniciar a CLI da Vercel ({e})."))?;
    read_output(out.status.success(), &String::from_utf8_lossy(&out.stdout), &String::from_utf8_lossy(&out.stderr))
}

fn url_in(line: &str) -> Option<String> {
    let i = line.find("https://")?;
    Some(line[i..].chars().take_while(|c| c.is_ascii_alphanumeric() || "-./:".contains(*c)).collect())
}

fn refused(login: bool, msg: &str) -> String {
    let msg: String = msg.trim().trim_start_matches("Error:").trim().chars().take(400).collect();
    if login || msg.contains("credentials") || msg.contains("vercel login") {
        "A CLI da Vercel está sem conta. Rode `vercel login` num terminal e tente de novo.".into()
    } else if msg.is_empty() {
        "A Vercel não confirmou a publicação.".into()
    } else {
        format!("A Vercel recusou a publicação: {msg}")
    }
}

/// Lê a resposta da CLI. Com um agente de IA no ambiente ela responde em JSON na saída padrão; sem, em texto,
/// com a URL da implantação (fechada pela proteção da Vercel) na saída padrão e o endereço público na linha
/// "Aliased" da saída de erro. O app devolve sempre o endereço público.
fn read_output(ok: bool, stdout: &str, stderr: &str) -> Result<String, String> {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(stdout.trim()) {
        let d = &v["deployment"];
        return match d["productionUrl"].as_str().or(d["url"].as_str()) {
            Some(u) if v["status"] == "ok" => Ok(u.to_string()),
            _ => Err(refused(v["reason"] == "login_required", v["message"].as_str().unwrap_or(""))),
        };
    }
    if ok {
        let alias = stderr.lines().find(|l| l.contains("Aliased")).and_then(url_in);
        if let Some(u) = alias.or_else(|| stdout.lines().rev().find_map(url_in)) {
            return Ok(u);
        }
    }
    let lines: Vec<&str> = stderr.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    Err(refused(false, lines.iter().find(|l| l.starts_with("Error:")).or(lines.last()).unwrap_or(&"")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_names_follow_vercel_rules() {
        assert_eq!(project_name("cafe-aurora/inicio"), "linkon-cafe-aurora-inicio");
        assert!(project_name(&"a/".repeat(80)).len() <= 100);
    }

    // Saídas reais da CLI 67.
    #[test]
    fn reads_public_url_from_cli_output() {
        let json = r#"{"status":"ok","deployment":{"url":"https://x-ab12-team.vercel.app","productionUrl":"https://x.vercel.app"}}"#;
        assert_eq!(read_output(true, json, ""), Ok("https://x.vercel.app".into()));
        let err = "Deploying x\n  Production      https://x-ab12-team.vercel.app\n\u{1b}[2K\u{25b2} Aliased         https://x.vercel.app\n\n\u{2713} Ready in 4s";
        assert_eq!(read_output(true, "https://x-ab12-team.vercel.app\n", err), Ok("https://x.vercel.app".into()));
        assert_eq!(read_output(true, "https://x-ab12-team.vercel.app\n", "Vercel CLI 67.0.0"), Ok("https://x-ab12-team.vercel.app".into()));
    }

    #[test]
    fn explains_cli_errors() {
        let login = r#"{"status":"error","reason":"login_required","message":"The token passed with --token is not valid."}"#;
        assert!(read_output(false, login, "").unwrap_err().contains("vercel login"));
        assert!(read_output(false, "", "Vercel CLI 67.0.0\nError: No existing credentials found. Please run `vercel login`.").unwrap_err().contains("sem conta"));
        assert_eq!(read_output(false, "", "Vercel CLI 67.0.0\nError: Project limit reached.\nLearn more: https://vercel.com/docs").unwrap_err(), "A Vercel recusou a publicação: Project limit reached.");
        assert_eq!(read_output(false, "", ""), Err("A Vercel não confirmou a publicação.".into()));
    }
}
