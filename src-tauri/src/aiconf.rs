//! Provedores de IA compatíveis com a API da OpenAI e servidores MCP do Linke. Sem Tauri: testado em tests/db.rs.
//!
//! A lista mora em `ai-config.json` na pasta de dados; as chaves ficam no cofre do Windows, uma por provedor.
//! O pedido de um provedor sai em chat completions com streaming, e cada pedaço vira uma linha no mesmo
//! stream-json do Claude Code, para o editor e a tela Uso lerem as duas fontes do mesmo jeito.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Clone, Default, Serialize, Deserialize, PartialEq, Debug)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub model: String,
}

/// Servidor MCP local (`command` + `args` + `env`) ou remoto (`url`). Só um dos dois.
#[derive(Clone, Default, Serialize, Deserialize, PartialEq, Debug)]
pub struct McpServer {
    pub name: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub url: String,
}

#[derive(Clone, Default, Serialize, Deserialize, PartialEq, Debug)]
pub struct AiConfig {
    #[serde(default)]
    pub providers: Vec<Provider>,
    #[serde(default)]
    pub mcp: Vec<McpServer>,
}

const MAX_ITEMS: usize = 20;

fn short(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && !s.chars().any(char::is_control)
}

/// id de provedor e nome de MCP: viram nome de credencial e de ferramenta (`mcp__<nome>`).
pub fn valid_slug(s: &str) -> bool {
    !s.is_empty() && s.len() <= 40 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// A chave só viaja por HTTPS; `http` só vale para a própria máquina (servidor de modelos local).
pub fn valid_url(u: &str) -> bool {
    let local = ["http://localhost", "http://127.0.0.1", "http://[::1]"]
        .iter()
        .any(|p| u.strip_prefix(p).is_some_and(|rest| rest.is_empty() || rest.starts_with(':') || rest.starts_with('/')));
    (u.starts_with("https://") && u.len() > 8 || local) && short(u, 300) && !u.contains(char::is_whitespace) && !u.contains('@')
}

/// Chave de API: texto visível, sem espaço. Não confere o prefixo, porque cada provedor tem o seu.
pub fn valid_key(k: &str) -> bool {
    (8..=512).contains(&k.len()) && k.bytes().all(|b| b.is_ascii_graphic())
}

pub fn validate(c: &AiConfig) -> Result<(), String> {
    if c.providers.len() > MAX_ITEMS || c.mcp.len() > MAX_ITEMS {
        return Err("Itens demais na lista.".into());
    }
    let mut seen = std::collections::HashSet::new();
    for p in &c.providers {
        if !valid_slug(&p.id) || !seen.insert(format!("p:{}", p.id)) {
            return Err("Identificador de provedor inválido ou repetido.".into());
        }
        if !short(&p.name, 60) {
            return Err("Dê um nome ao provedor (até 60 letras).".into());
        }
        if !valid_url(&p.base_url) {
            return Err(format!("A URL de “{}” precisa começar com https://.", p.name));
        }
        if !short(&p.model, 120) || p.model.contains(char::is_whitespace) {
            return Err(format!("Informe o modelo de “{}”, sem espaços.", p.name));
        }
    }
    for m in &c.mcp {
        if !valid_slug(&m.name) || !seen.insert(format!("m:{}", m.name)) {
            return Err("O nome do MCP só aceita letras, números, - e _, sem repetir.".into());
        }
        match (m.command.is_empty(), m.url.is_empty()) {
            (false, true) => {
                if !short(&m.command, 300) || m.args.len() > 40 || !m.args.iter().all(|a| a.len() <= 1000 && !a.contains(char::is_control)) {
                    return Err(format!("Comando ou argumentos inválidos em “{}”.", m.name));
                }
                for (k, v) in &m.env {
                    let ok_key = !k.is_empty() && k.len() <= 100 && k.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_');
                    if !ok_key || v.len() > 4000 || v.contains(char::is_control) {
                        return Err(format!("Variável de ambiente inválida em “{}”.", m.name));
                    }
                }
            }
            (true, false) if valid_url(&m.url) && m.args.is_empty() && m.env.is_empty() => {}
            _ => return Err(format!("“{}” precisa de um comando ou de uma URL https://, não dos dois.", m.name)),
        }
    }
    Ok(())
}

pub fn load(path: &Path) -> AiConfig {
    std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub fn save(path: &Path, c: &AiConfig) -> Result<(), String> {
    validate(c)?;
    let text = serde_json::to_string_pretty(c).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| format!("Não foi possível gravar as configurações da IA ({e})."))
}

/// O arquivo de `--mcp-config` do Claude Code.
pub fn mcp_json(servers: &[McpServer]) -> Value {
    let map: serde_json::Map<String, Value> = servers
        .iter()
        .map(|m| {
            let v = if m.url.is_empty() {
                json!({ "type": "stdio", "command": m.command, "args": m.args, "env": m.env })
            } else {
                json!({ "type": "http", "url": m.url })
            };
            (m.name.clone(), v)
        })
        .collect();
    json!({ "mcpServers": map })
}

/// Corpo do chat completions. shortcut: sem imagens de referência (a maioria dos modelos gratuitos só lê texto);
/// mandar como `image_url` quando o provedor declarar visão.
pub fn chat_body(model: &str, system: &str, prompt: &str) -> Value {
    json!({
        "model": model,
        "stream": true,
        "stream_options": { "include_usage": true },
        "temperature": 0.3,
        "max_tokens": 16384,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": prompt },
        ],
    })
}

/// URL do chat completions a partir da URL base, com ou sem a barra no fim.
pub fn chat_url(base: &str) -> String {
    format!("{}/chat/completions", base.trim_end_matches('/'))
}

/// O que uma linha do SSE trouxe.
#[derive(Debug, PartialEq, Default)]
pub struct Chunk {
    pub text: String,
    pub usage: Option<(u64, u64)>,
    pub done: bool,
    pub error: Option<String>,
}

/// Lê uma linha `data: …` do streaming. Ignora o raciocínio (`reasoning_content`): só o texto vira operação.
pub fn parse_sse(line: &str) -> Option<Chunk> {
    let data = line.strip_prefix("data:")?.trim();
    if data == "[DONE]" {
        return Some(Chunk { done: true, ..Default::default() });
    }
    let v: Value = serde_json::from_str(data).ok()?;
    let mut c = Chunk::default();
    if let Some(m) = v.pointer("/error/message").and_then(Value::as_str) {
        c.error = Some(m.chars().take(400).collect());
    }
    if let Some(t) = v.pointer("/choices/0/delta/content").and_then(Value::as_str) {
        c.text = t.to_string();
    }
    if let Some(u) = v.get("usage").filter(|u| u.is_object()) {
        let n = |k: &str| u.get(k).and_then(Value::as_u64).unwrap_or(0);
        c.usage = Some((n("prompt_tokens"), n("completion_tokens")));
    }
    Some(c)
}

/// Linha de texto no formato do Claude Code (`readStreamLine` em assistant.ts).
pub fn text_event(text: &str) -> String {
    json!({ "type": "stream_event", "event": { "type": "content_block_delta", "delta": { "type": "text_delta", "text": text } } }).to_string()
}

pub fn result_event(ok: bool, text: &str, usage: (u64, u64), ms: u64) -> String {
    json!({
        "type": "result",
        "subtype": if ok { "success" } else { "error" },
        "is_error": !ok,
        "result": text,
        "duration_ms": ms,
        "usage": { "input_tokens": usage.0, "output_tokens": usage.1 },
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn provider() -> Provider {
        Provider { id: "nvidia".into(), name: "NVIDIA".into(), base_url: "https://integrate.api.nvidia.com/v1".into(), model: "x/y".into() }
    }

    #[test]
    fn urls_only_https_or_local() {
        assert!(valid_url("https://integrate.api.nvidia.com/v1"));
        assert!(valid_url("http://localhost:11434/v1"));
        assert!(valid_url("http://127.0.0.1/v1"));
        assert!(!valid_url("http://example.com/v1"));
        assert!(!valid_url("http://localhost.evil.com/v1"));
        assert!(!valid_url("https://user@evil.com"));
        assert!(!valid_url("https://"));
        assert!(!valid_url("file:///c:/x"));
    }

    #[test]
    fn validate_checks_providers_and_mcp() {
        let mut c = AiConfig { providers: vec![provider()], mcp: vec![] };
        assert!(validate(&c).is_ok());
        c.providers.push(provider());
        assert!(validate(&c).is_err(), "id repetido");
        c.providers.pop();
        c.providers[0].model = "tem espaço".into();
        assert!(validate(&c).is_err());
        c.providers[0] = provider();

        let local = McpServer { name: "fs".into(), command: "npx".into(), args: vec!["-y".into(), "pkg".into()], env: BTreeMap::from([("TOKEN".into(), "abc".into())]), url: String::new() };
        c.mcp.push(local.clone());
        assert!(validate(&c).is_ok());
        c.mcp[0].url = "https://mcp.example.com".into();
        assert!(validate(&c).is_err(), "comando e URL juntos");
        c.mcp[0] = McpServer { name: "remoto".into(), url: "https://mcp.example.com/mcp".into(), ..Default::default() };
        assert!(validate(&c).is_ok());
        c.mcp[0].name = "com espaço".into();
        assert!(validate(&c).is_err());
        c.mcp[0] = McpServer { env: BTreeMap::from([("A-B".into(), "x".into())]), ..local };
        assert!(validate(&c).is_err(), "nome de variável inválido");
    }

    #[test]
    fn mcp_json_shape() {
        let v = mcp_json(&[
            McpServer { name: "fs".into(), command: "npx".into(), args: vec!["-y".into()], ..Default::default() },
            McpServer { name: "web".into(), url: "https://x.dev/mcp".into(), ..Default::default() },
        ]);
        assert_eq!(v["mcpServers"]["fs"]["command"], "npx");
        assert_eq!(v["mcpServers"]["fs"]["type"], "stdio");
        assert_eq!(v["mcpServers"]["web"]["type"], "http");
    }

    #[test]
    fn sse_lines() {
        let c = parse_sse(r#"data: {"choices":[{"delta":{"content":"{\"op\":"}}]}"#).unwrap();
        assert_eq!(c.text, "{\"op\":");
        let r = parse_sse(r#"data: {"choices":[{"delta":{"reasoning_content":"pensando"}}]}"#).unwrap();
        assert_eq!(r.text, "");
        let u = parse_sse(r#"data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5}}"#).unwrap();
        assert_eq!(u.usage, Some((10, 5)));
        assert!(parse_sse("data: [DONE]").unwrap().done);
        assert!(parse_sse(": keep-alive").is_none());
        assert_eq!(parse_sse(r#"data: {"error":{"message":"ruim"}}"#).unwrap().error.as_deref(), Some("ruim"));
        assert_eq!(chat_url("https://a.b/v1/"), "https://a.b/v1/chat/completions");
    }

    #[test]
    fn events_match_claude_stream_json() {
        let t: Value = serde_json::from_str(&text_event("oi")).unwrap();
        assert_eq!(t["event"]["delta"]["text"], "oi");
        let r: Value = serde_json::from_str(&result_event(true, "x", (3, 4), 9)).unwrap();
        assert_eq!(r["subtype"], "success");
        assert_eq!(r["usage"]["output_tokens"], 4);
    }

    #[test]
    fn save_and_load_round_trip() {
        let dir = std::env::temp_dir().join(format!("linkon-aiconf-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("ai-config.json");
        let c = AiConfig { providers: vec![provider()], mcp: vec![] };
        save(&path, &c).unwrap();
        assert_eq!(load(&path), c);
        assert!(save(&path, &AiConfig { providers: vec![Provider { base_url: "http://x.com".into(), ..provider() }], mcp: vec![] }).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
