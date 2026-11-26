//! Exportação de uma página como um único arquivo HTML, com as imagens da biblioteca embutidas.
//! O HTML vem pronto do frontend (src/lib/editor/render.ts); aqui só trocamos as referências
//! `linkon-file://<id>` pelos bytes do arquivo em base64 e gravamos onde o usuário escolheu.

use crate::library::get_file;
use rusqlite::Connection;
use std::fs;
use std::path::Path;

pub const FILE_SCHEME: &str = "linkon-file://";

fn mime_of(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

pub fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = match chunk.len() {
            3 => (chunk[0] as u32) << 16 | (chunk[1] as u32) << 8 | chunk[2] as u32,
            2 => (chunk[0] as u32) << 16 | (chunk[1] as u32) << 8,
            _ => (chunk[0] as u32) << 16,
        };
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

/// Troca cada `linkon-file://<id>` por um data URI. Arquivo ausente vira imagem vazia, sem quebrar a exportação.
pub fn embed_files(conn: &Connection, library: &Path, html: &str) -> Result<String, String> {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(pos) = rest.find(FILE_SCHEME) {
        out.push_str(&rest[..pos]);
        let after = &rest[pos + FILE_SCHEME.len()..];
        let digits = after.chars().take_while(|c| c.is_ascii_digit()).count();
        let id: Option<i64> = after[..digits].parse().ok();
        let uri = id
            .and_then(|id| get_file(conn, library, id).ok())
            .and_then(|f| fs::read(&f.path).ok().map(|b| (f.ext, b)))
            .map(|(ext, b)| format!("data:{};base64,{}", mime_of(&ext), base64(&b)))
            .unwrap_or_else(|| "data:,".into());
        out.push_str(&uri);
        rest = &after[digits..];
    }
    out.push_str(rest);
    Ok(out)
}

pub fn export_html(conn: &Connection, library: &Path, dest: &Path, html: &str) -> Result<(), String> {
    let ext = dest.extension().and_then(|e| e.to_str()).unwrap_or_default().to_lowercase();
    if ext != "html" && ext != "htm" {
        return Err("Escolha um nome de arquivo terminado em .html.".into());
    }
    let full = embed_files(conn, library, html)?;
    fs::write(dest, full).map_err(|e| format!("Não foi possível gravar o arquivo ({e})."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_conn;
    use crate::library::{copy_into, insert_file};

    #[test]
    fn base64_matches_known_values() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64(&[0xff, 0xfe, 0x00]), "//4A");
    }

    #[test]
    fn embeds_library_images_and_writes_file() {
        let c = test_conn();
        let dir = std::env::temp_dir().join(format!("linkon-exp-{}", crate::db::now_ms()));
        fs::create_dir_all(&dir).unwrap();
        let src = dir.join("p.png");
        fs::write(&src, b"foo").unwrap();
        let f = insert_file(&c, &dir, &copy_into(&dir, &src).unwrap(), None, None).unwrap();

        let html = format!(r#"<img src="linkon-file://{}"><img src="linkon-file://999">fim"#, f.id);
        let out = embed_files(&c, &dir, &html).unwrap();
        assert_eq!(out, r#"<img src="data:image/png;base64,Zm9v"><img src="data:,">fim"#);

        assert!(export_html(&c, &dir, &dir.join("x.txt"), &html).is_err());
        let dest = dir.join("pagina.html");
        export_html(&c, &dir, &dest, &html).unwrap();
        assert!(fs::read_to_string(&dest).unwrap().contains("base64,Zm9v"));
        let _ = fs::remove_dir_all(&dir);
    }
}
