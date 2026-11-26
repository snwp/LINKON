//! Cada interface vira um site de verdade em `Documentos/Linkon/<pasta>/<interface>/`:
//! `index.html`, `assets/` (as imagens), `fit.js` (ajuste a telas estreitas) e `vercel.json` (cabeçalhos de
//! segurança). O HTML vem pronto do frontend (src/lib/editor/render.ts); aqui só trocamos `linkon-file://<id>`
//! pelo caminho da imagem copiada. Sem Tauri, para rodar nos testes (tests/db.rs).

use crate::export::FILE_SCHEME;
use crate::library::get_file;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

/// Marca as pastas que o Linkon criou. Pasta sem ela (feita pelo usuário) nunca é sobrescrita.
const MARKER: &str = ".linkon";

/// O mesmo script de render.ts (FIT), em arquivo próprio para a CSP poder proibir script embutido.
pub const FIT_JS: &str = "(function(){var ps=document.querySelectorAll('.page');function f(){for(var i=0;i<ps.length;i++){var p=ps[i];if(!p.offsetWidth)continue;var s=Math.min(1,document.documentElement.clientWidth/p.offsetWidth);p.style.transform='scale('+s+')';p.style.marginLeft=s<1?'0':'auto';document.body.style.height=(p.offsetHeight*s)+'px'}}addEventListener('resize',f);f()})()\n";
pub const FIT_TAG: &str = r#"<script src="fit.js"></script>"#;

/// O site é estático e não carrega nada de fora (fontes e imagens vão junto): tudo o mais fica proibido.
pub const CSP: &str = "default-src 'none'; img-src 'self' data:; font-src 'self' data:; style-src 'unsafe-inline'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

pub fn vercel_json() -> String {
    let headers = serde_json::json!({
        "headers": [{
            "source": "/(.*)",
            "headers": [
                { "key": "Content-Security-Policy", "value": CSP },
                { "key": "X-Content-Type-Options", "value": "nosniff" },
                { "key": "X-Frame-Options", "value": "DENY" },
                { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
                { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(), payment=()" },
                { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains" }
            ]
        }]
    });
    serde_json::to_string_pretty(&headers).unwrap_or_default()
}

/// Nome de pasta e de projeto na Vercel: minúsculas, sem acento, só letras, números e hífen.
pub fn slug(s: &str) -> String {
    let mut out = String::new();
    for c in s.to_lowercase().chars() {
        let c = match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            c => c,
        };
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let out: String = out.trim_end_matches('-').chars().take(48).collect();
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() { "pagina".into() } else { out }
}

fn err(e: impl std::fmt::Display) -> String {
    format!("Não foi possível gravar o site ({e}).")
}

fn join_rel(root: &Path, rel: &str) -> PathBuf {
    rel.split('/').fold(root.to_path_buf(), |p, s| p.join(s))
}

/// Pasta existe e não foi o Linkon que criou: não é nossa para escrever.
fn foreign(dir: &Path) -> bool {
    dir.exists() && !dir.join(MARKER).exists()
}

/// Escolhe (e guarda) a pasta da interface. Renomear a interface ou a pasta move a pasta antiga.
fn site_dir(conn: &Connection, root: &Path, page_id: i64) -> Result<(String, PathBuf), String> {
    let (title, folder): (String, Option<String>) = conn
        .query_row(
            "SELECT p.title, pr.name FROM pages p LEFT JOIN projects pr ON pr.id = p.project_id WHERE p.id = ?1",
            [page_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| "Esta interface não existe mais.".to_string())?;
    let folder_slug = folder.as_deref().map(slug).unwrap_or_else(|| "sem-pasta".into());
    let base = format!("{folder_slug}/{}", slug(&title));
    let old: Option<String> = conn
        .query_row("SELECT rel FROM site_dirs WHERE page_id = ?1", [page_id], |r| r.get(0))
        .optional()
        .map_err(err)?;
    let taken = |rel: &str| -> Result<bool, String> {
        let other = conn
            .query_row("SELECT 1 FROM site_dirs WHERE rel = ?1 AND page_id <> ?2", params![rel, page_id], |_| Ok(()))
            .optional()
            .map_err(err)?
            .is_some();
        Ok(other || (old.as_deref() != Some(rel) && foreign(&join_rel(root, rel))))
    };
    let rel = if taken(&base)? { format!("{base}-{page_id}") } else { base };
    let dir = join_rel(root, &rel);
    if let Some(old) = old.filter(|o| *o != rel) {
        let from = join_rel(root, &old);
        if from.join(MARKER).exists() && !dir.exists() {
            if let Some(parent) = dir.parent() {
                fs::create_dir_all(parent).map_err(err)?;
            }
            let _ = fs::rename(&from, &dir);
        }
    }
    conn.execute(
        "INSERT INTO site_dirs (page_id, rel) VALUES (?1, ?2) ON CONFLICT(page_id) DO UPDATE SET rel = excluded.rel",
        params![page_id, rel],
    )
    .map_err(err)?;
    Ok((rel, dir))
}

/// Grava o site da interface e devolve (caminho relativo com '/', pasta).
pub fn write_site(conn: &Connection, library: &Path, root: &Path, page_id: i64, html: &str) -> Result<(String, PathBuf), String> {
    write_site_pages(conn, library, root, page_id, html, &[])
}

/// Nome aceito para a página de um quadro extra: `[a-z0-9-]{1,60}.html`, nunca `index.html`.
/// O nome vem do app, mas a pasta é escrita aqui: nada de barra, ponto ou `..` passa.
pub fn valid_page_name(name: &str) -> bool {
    name.strip_suffix(".html").is_some_and(|stem| {
        !stem.is_empty()
            && stem.len() <= 60
            && stem != "index"
            && stem.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    })
}

/// Como `write_site`, mais uma página por quadro extra (`sobre.html`, ...). Páginas de quadros apagados saem da pasta.
pub fn write_site_pages(
    conn: &Connection,
    library: &Path,
    root: &Path,
    page_id: i64,
    html: &str,
    extra: &[(String, String)],
) -> Result<(String, PathBuf), String> {
    if let Some((bad, _)) = extra.iter().find(|(n, _)| !valid_page_name(n)) {
        return Err(format!("Nome de página inválido: {bad}"));
    }
    let (rel, dir) = site_dir(conn, root, page_id)?;
    let assets = dir.join("assets");
    fs::create_dir_all(&assets).map_err(err)?;
    fs::write(dir.join(MARKER), "Pasta criada pelo Linkon. Ela é refeita sempre que a interface é salva.\n").map_err(err)?;

    let mut used = HashSet::new();
    let mut keep = HashSet::from(["index.html".to_string()]);
    fs::write(dir.join("index.html"), localize(conn, library, &assets, html, &mut used)).map_err(err)?;
    for (name, page) in extra {
        fs::write(dir.join(name), localize(conn, library, &assets, page, &mut used)).map_err(err)?;
        keep.insert(name.clone());
    }

    // Imagens e páginas que saíram da interface saem da pasta também (a pasta é do Linkon, ver MARKER).
    if let Ok(list) = fs::read_dir(&assets) {
        for e in list.flatten() {
            if !used.contains(e.file_name().to_string_lossy().as_ref()) {
                let _ = fs::remove_file(e.path());
            }
        }
    }
    if let Ok(list) = fs::read_dir(&dir) {
        for e in list.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.ends_with(".html") && !keep.contains(&name) && e.path().is_file() {
                let _ = fs::remove_file(e.path());
            }
        }
    }
    fs::write(dir.join("fit.js"), FIT_JS).map_err(err)?;
    fs::write(dir.join("vercel.json"), vercel_json()).map_err(err)?;
    Ok((rel, dir))
}

/// Troca cada `linkon-file://<id>` pela imagem copiada para assets/ e anota em `used` o que foi usado.
fn localize(conn: &Connection, library: &Path, assets: &Path, html: &str, used: &mut HashSet<String>) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(pos) = rest.find(FILE_SCHEME) {
        out.push_str(&rest[..pos]);
        let after = &rest[pos + FILE_SCHEME.len()..];
        let digits = after.chars().take_while(|c| c.is_ascii_digit()).count();
        let file = after[..digits].parse().ok().and_then(|id| get_file(conn, library, id).ok());
        let name = file.as_ref().and_then(|f| {
            let src = PathBuf::from(&f.path);
            let name = src.file_name()?.to_str()?.to_string();
            let dest = assets.join(&name);
            let same = dest.metadata().ok().map(|m| m.len()) == src.metadata().ok().map(|m| m.len());
            (same || fs::copy(&src, &dest).is_ok()).then_some(name)
        });
        match name {
            Some(n) => {
                out.push_str("assets/");
                out.push_str(&n);
                used.insert(n);
            }
            None => out.push_str("data:,"),
        }
        rest = &after[digits..];
    }
    out.push_str(rest);
    out
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Finding {
    /// "erro" impede a publicação; "aviso" só aparece na confirmação.
    pub level: &'static str,
    pub text: String,
}

/// Revisão de segurança do HTML antes de publicar. O renderizador já escapa tudo; isto confere que nada
/// além do que ele gera chegou ao arquivo (um HTML mexido à mão, por exemplo).
pub fn audit(html: &str) -> Vec<Finding> {
    let mut v = Vec::new();
    let mut add = |level, text: &str| v.push(Finding { level, text: text.into() });
    let lower = html.to_lowercase();
    let without_fit = lower.replace(FIT_TAG, "");
    if without_fit.contains("<script") {
        add("erro", "A página tem um script que não foi o Linkon que colocou.");
    }
    for tag in ["<iframe", "<object", "<embed", "<form", "<base", "<meta http-equiv"] {
        if lower.contains(tag) {
            add("erro", &format!("A página tem um elemento proibido ({}).", tag.trim_start_matches('<')));
        }
    }
    // Só dentro das tags: o texto da página vem escapado e nunca tem '<'.
    let mut handler = false;
    let mut js_url = false;
    for tag in lower.split('<').skip(1).map(|t| t.split('>').next().unwrap_or("")) {
        let bytes = tag.as_bytes();
        for (i, _) in tag.match_indices(" on") {
            let name: String = tag[i + 3..].chars().take_while(|c| c.is_ascii_alphabetic()).collect();
            if !name.is_empty() && bytes.get(i + 3 + name.len()) == Some(&b'=') {
                handler = true;
            }
        }
        if tag.contains("javascript:") || tag.contains("vbscript:") {
            js_url = true;
        }
    }
    if handler {
        add("erro", "A página tem código preso a um elemento (atributo on…).");
    }
    if js_url {
        add("erro", "A página tem um link que roda código (javascript:).");
    }
    let empty_links = lower.matches(r#"href="https://""#).count();
    if empty_links > 0 {
        add("aviso", &format!("{empty_links} botão(ões) ou link(s) ainda sem endereço (https:// vazio)."));
    }
    if lower.contains(r#"href="http://"#) {
        add("aviso", "Há links sem HTTPS (http://).");
    }
    if lower.contains(r#"src="data:,""#) {
        add("aviso", "Alguma imagem da página não existe mais na pasta e vai aparecer vazia.");
    }
    v
}

/// Caminho de arquivo pedido ao servidor local, sempre dentro de `root`. Recusa `..`, `\`, `:`, nomes
/// escondidos (como `.linkon` e `.vercel`) e qualquer coisa que, resolvida, saia da pasta.
pub fn safe_path(root: &Path, url_path: &str) -> Option<PathBuf> {
    let path = url_path.split(['?', '#']).next()?;
    let decoded = percent_decode(path)?;
    let mut p = root.to_path_buf();
    for seg in decoded.split('/').filter(|s| !s.is_empty()) {
        if seg.starts_with('.') || seg.contains(['\\', ':', '\0']) {
            return None;
        }
        p.push(seg);
    }
    if p.is_dir() {
        p.push("index.html");
    }
    let real = p.canonicalize().ok()?;
    let root = root.canonicalize().ok()?;
    (real.starts_with(&root) && real.is_file()).then_some(real)
}

fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

pub fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "json" => "application/json",
        "css" => "text/css; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_conn;
    use crate::library::{copy_into, insert_file};

    fn temp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("linkon-site-{tag}-{}", crate::db::now_ms()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn slugs_are_url_and_vercel_safe() {
        assert_eq!(slug("Café Aurora — Landing"), "cafe-aurora-landing");
        assert_eq!(slug("  ../../Windows  "), "windows");
        assert_eq!(slug("???"), "pagina");
        assert!(slug(&"a".repeat(200)).len() <= 48);
    }

    #[test]
    fn writes_site_with_assets_and_moves_on_rename() {
        let c = test_conn();
        let lib = temp("lib");
        let root = temp("root");
        let src = lib.join("foto.png");
        fs::write(&src, b"png").unwrap();
        let f = insert_file(&c, &lib, &copy_into(&lib, &src).unwrap(), None, None).unwrap();
        c.execute("INSERT INTO projects (name, created_at, updated_at) VALUES ('Café Aurora', 0, 0)", []).unwrap();
        let pid: i64 = c.last_insert_rowid();
        c.execute("INSERT INTO pages (title, project_id, doc, created_at, updated_at) VALUES ('Início', ?1, '{}', 0, 0)", [pid]).unwrap();
        let page: i64 = c.last_insert_rowid();

        let html = format!(r#"<img src="linkon-file://{}"><img src="linkon-file://999">{FIT_TAG}"#, f.id);
        let (rel, dir) = write_site(&c, &lib, &root, page, &html).unwrap();
        assert_eq!(rel, "cafe-aurora/inicio");
        let index = fs::read_to_string(dir.join("index.html")).unwrap();
        assert!(index.contains(r#"src="assets/"#) && index.contains(r#"src="data:,""#));
        assert_eq!(fs::read_dir(dir.join("assets")).unwrap().count(), 1);
        assert!(dir.join("vercel.json").exists() && dir.join("fit.js").exists());

        // Renomear move a pasta; a imagem que saiu da página sai de assets/.
        c.execute("UPDATE pages SET title = 'Home' WHERE id = ?1", [page]).unwrap();
        let (rel2, dir2) = write_site(&c, &lib, &root, page, "<p>sem imagem</p>").unwrap();
        assert_eq!(rel2, "cafe-aurora/home");
        assert!(!dir.exists() && dir2.join(MARKER).exists());
        assert_eq!(fs::read_dir(dir2.join("assets")).unwrap().count(), 0);

        // Pasta com o mesmo nome feita pelo usuário não é tocada: o Linkon usa outro nome.
        fs::create_dir_all(root.join("cafe-aurora").join("contato")).unwrap();
        c.execute("INSERT INTO pages (title, project_id, doc, created_at, updated_at) VALUES ('Contato', ?1, '{}', 0, 0)", [pid]).unwrap();
        let other = c.last_insert_rowid();
        let (rel3, _) = write_site(&c, &lib, &root, other, "<p>x</p>").unwrap();
        assert_eq!(rel3, format!("cafe-aurora/contato-{other}"));
        assert!(!root.join("cafe-aurora").join("contato").join("index.html").exists());

        let _ = fs::remove_dir_all(&lib);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn page_names_cannot_escape_the_folder() {
        assert!(valid_page_name("sobre.html"));
        assert!(valid_page_name("fale-conosco-2.html"));
        for bad in ["index.html", "../x.html", "a/b.html", "Sobre.html", ".html", "x.htm", "a.b.html"] {
            assert!(!valid_page_name(bad), "{bad}");
        }
    }

    #[test]
    fn audit_blocks_code_and_warns_on_loose_ends() {
        let ok = format!(r#"<main><div class="el" style="color:#000">onclick=texto &lt;b&gt;</div><a href="https://x.com">x</a></main>{FIT_TAG}"#);
        assert!(audit(&ok).is_empty());
        let levels = |h: &str| audit(h).into_iter().map(|f| f.level).collect::<Vec<_>>();
        assert_eq!(levels("<script>alert(1)</script>"), ["erro"]);
        assert_eq!(levels(r#"<img src="x" onerror="alert(1)">"#), ["erro"]);
        assert_eq!(levels(r#"<a href="javascript:alert(1)">x</a>"#), ["erro"]);
        assert_eq!(levels("<iframe src=x></iframe>"), ["erro"]);
        assert_eq!(levels(r#"<a href="https://">Comprar</a>"#), ["aviso"]);
    }

    #[test]
    fn server_paths_stay_inside_the_root() {
        let root = temp("srv");
        fs::create_dir_all(root.join("a").join("b")).unwrap();
        fs::write(root.join("a").join("b").join("index.html"), "ok").unwrap();
        fs::write(root.join("a").join(MARKER), "x").unwrap();
        fs::write(root.join("fora.txt"), "x").unwrap();
        assert!(safe_path(&root, "/a/b/").unwrap().ends_with("index.html"));
        assert!(safe_path(&root, "/a/b/index.html?x=1").is_some());
        assert!(safe_path(&root, "/a/%62/").is_some());
        assert!(safe_path(&root, "/a/../fora.txt").is_none());
        assert!(safe_path(&root, "/a/%2e%2e/fora.txt").is_none());
        assert!(safe_path(&root, "/a/.linkon").is_none());
        assert!(safe_path(&root, "/C:/Windows/win.ini").is_none());
        assert!(safe_path(&root, "/a/..%5c..%5cfora.txt").is_none());
        assert!(safe_path(&root, "/nada/").is_none());
        let _ = fs::remove_dir_all(&root);
    }
}
