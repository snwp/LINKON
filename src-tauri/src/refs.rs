//! Imagens de referência para o Linke. O Linke roda sem ferramentas e sem internet; quando ele pede referências
//! (operação `refs`), o app busca algumas fotos no Openverse (acervo aberto que inclui o Wikimedia Commons, sem
//! chave) e as mostra a ele no pedido seguinte. As fotos só servem para olhar: não vão para a página nem para o disco.

use base64::Engine;
use serde::Serialize;
use std::io::Read;
use std::time::Duration;

const MAX_QUERY: usize = 80;
const MAX_IMAGES: usize = 3;
/// Miniaturas: bastam para o Linke ver forma e cor, e mantêm o pedido pequeno.
const MAX_IMAGE_BYTES: u64 = 1_500_000;
const MAX_JSON_BYTES: u64 = 1_000_000;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct RefImage {
    pub media_type: String,
    /// Base64, pronto para o bloco de imagem do Claude.
    pub data: String,
    pub title: String,
}

/// Termo de busca: letras (com acento), números, espaço e hífen; nada que mude o endereço da busca.
pub fn clean_query(raw: &str) -> Result<String, String> {
    let q: String = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if q.is_empty() || q.chars().count() > MAX_QUERY || !q.chars().all(|c| c.is_alphanumeric() || c == ' ' || c == '-') {
        return Err("Termo de busca inválido.".into());
    }
    Ok(q)
}

fn encode(q: &str) -> String {
    let mut out = String::new();
    for b in q.bytes() {
        match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' => out.push(b as char),
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Tipo pela assinatura dos bytes, não pelo que o servidor diz.
pub fn sniff(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\xFF\xD8\xFF") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

fn agent() -> ureq::Agent {
    // Mesmo resolvedor das bases: nenhuma resposta (nem redirecionamento) leva a busca à rede local.
    ureq::AgentBuilder::new().resolver(crate::bases::public_resolver).redirects(3).timeout(Duration::from_secs(15)).build()
}

fn read_limited(resp: ureq::Response, max: u64) -> Option<Vec<u8>> {
    let mut bytes = Vec::new();
    resp.into_reader().take(max + 1).read_to_end(&mut bytes).ok()?;
    (bytes.len() as u64 <= max).then_some(bytes)
}

/// Busca e baixa até três imagens. Falhas de imagens isoladas são puladas; sem nenhuma, devolve lista vazia.
pub fn search(query: &str) -> Result<Vec<RefImage>, String> {
    let q = clean_query(query)?;
    let url = format!("https://api.openverse.org/v1/images/?q={}&page_size=8&mature=false", encode(&q));
    let agent = agent();
    let resp = agent.get(&url).set("Accept", "application/json").call().map_err(|e| format!("Não foi possível buscar referências ({e})."))?;
    let body = read_limited(resp, MAX_JSON_BYTES).ok_or("A busca de referências respondeu demais.")?;
    let json: serde_json::Value = serde_json::from_slice(&body).map_err(|_| "A busca de referências veio incompleta.")?;
    let mut out = Vec::new();
    for item in json["results"].as_array().into_iter().flatten() {
        if out.len() >= MAX_IMAGES {
            break;
        }
        let Some(thumb) = item["thumbnail"].as_str().or_else(|| item["url"].as_str()) else { continue };
        if !thumb.starts_with("https://") {
            continue;
        }
        let Ok(r) = agent.get(thumb).call() else { continue };
        let Some(bytes) = read_limited(r, MAX_IMAGE_BYTES) else { continue };
        let Some(media_type) = sniff(&bytes) else { continue };
        let title: String = item["title"].as_str().unwrap_or("").chars().filter(|c| !c.is_control()).take(120).collect();
        out.push(RefImage { media_type: media_type.into(), data: base64::engine::general_purpose::STANDARD.encode(&bytes), title });
    }
    Ok(out)
}

#[tauri::command]
pub async fn find_references(query: String) -> Result<Vec<RefImage>, String> {
    tauri::async_runtime::spawn_blocking(move || search(&query)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queries_cannot_change_the_url() {
        assert_eq!(clean_query("  bolo   de morango ").unwrap(), "bolo de morango");
        assert_eq!(encode("pão de queijo"), "p%C3%A3o+de+queijo");
        for bad in ["", "a&b=c", "x/../y", "q?x", "a#b", &"a".repeat(81)] {
            assert!(clean_query(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn only_real_images_pass() {
        assert_eq!(sniff(b"\xFF\xD8\xFF\xE0rest"), Some("image/jpeg"));
        assert_eq!(sniff(b"\x89PNG\r\n\x1a\nrest"), Some("image/png"));
        assert_eq!(sniff(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(sniff(b"<html>"), None);
        assert_eq!(sniff(b"<svg xmlns"), None);
    }
}
