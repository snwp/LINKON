//! Biblioteca: cópia dos arquivos importados, metadados no SQLite e associações com projetos e ideias.
//! O original do usuário nunca é alterado: o Linkon trabalha sempre sobre a cópia em `<dados>/library`.

use crate::db::{err, now_ms};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::fs;
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

const TEXT_PREVIEW_BYTES: u64 = 64 * 1024;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct FileItem {
    pub id: i64,
    pub name: String,
    pub ext: String,
    /// imagem | pdf | documento | texto | outro
    pub kind: String,
    pub size: i64,
    /// Caminho absoluto da cópia na biblioteca (para prévia e para abrir no app padrão).
    pub path: String,
    pub source_path: String,
    pub imported_at: i64,
    pub project_ids: Vec<i64>,
    pub idea_ids: Vec<i64>,
}

/// Arquivo já copiado para a biblioteca, ainda sem linha no banco.
#[derive(Debug)]
pub struct Copied {
    pub name: String,
    pub ext: String,
    pub kind: &'static str,
    pub size: i64,
    pub stored_name: String,
    pub source_path: String,
}

pub fn kind_of(ext: &str) -> &'static str {
    match ext {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "avif" | "ico" => "imagem",
        "pdf" => "pdf",
        "doc" | "docx" | "odt" | "rtf" | "xls" | "xlsx" | "ods" | "ppt" | "pptx" | "odp"
        | "pages" | "numbers" | "key" | "epub" => "documento",
        "txt" | "md" | "markdown" | "csv" | "tsv" | "json" | "xml" | "html" | "htm" | "css"
        | "js" | "ts" | "log" | "yaml" | "yml" | "toml" | "ini" | "srt" => "texto",
        _ => "outro",
    }
}

fn clean_ext(path: &Path) -> String {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_lowercase();
    // A extensão vira parte do nome no disco: só letras e números, curta.
    if ext.len() <= 10 && ext.chars().all(|c| c.is_ascii_alphanumeric()) {
        ext
    } else {
        String::new()
    }
}

fn unique_stored_name(ext: &str) -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let base = format!("{:x}-{:x}", now_ms(), n);
    if ext.is_empty() { base } else { format!("{base}.{ext}") }
}

/// Nome no disco exatamente como `unique_stored_name` gera: `<hex>-<hex>` e, opcional, `.<ext>` (letras e números).
/// O nome vem do banco, e um backup de terceiros pode trazer qualquer coisa nele (barras, `..`, caminho absoluto):
/// sem esta conferência, apagar, exportar ou ler um "arquivo da biblioteca" alcançaria qualquer arquivo do computador.
pub(crate) fn valid_stored_name(s: &str) -> bool {
    let (base, ext) = match s.split_once('.') {
        Some((b, e)) => (b, Some(e)),
        None => (s, None),
    };
    let hex = |p: Option<&str>| p.is_some_and(|p| !p.is_empty() && p.len() <= 16 && p.chars().all(|c| c.is_ascii_hexdigit()));
    let mut parts = base.split('-');
    hex(parts.next())
        && hex(parts.next())
        && parts.next().is_none()
        && ext.is_none_or(|e| !e.is_empty() && e.len() <= 10 && e.chars().all(|c| c.is_ascii_alphanumeric()))
}

/// Copia `src` para a biblioteca. Não toca no banco; chame `insert_file` em seguida.
pub fn copy_into(library: &Path, src: &Path) -> Result<Copied, String> {
    let meta = fs::metadata(src).map_err(|e| format!("Não foi possível ler o arquivo ({e})."))?;
    if meta.is_dir() {
        return Err("Pastas ainda não podem ser importadas. Selecione os arquivos.".into());
    }
    if !meta.is_file() {
        return Err("Isto não é um arquivo comum.".into());
    }
    let name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("O nome do arquivo não é válido.")?
        .to_string();
    let ext = clean_ext(src);
    let stored_name = unique_stored_name(&ext);
    let dest = library.join(&stored_name);
    if let Err(e) = fs::copy(src, &dest) {
        let _ = fs::remove_file(&dest);
        return Err(format!("A cópia falhou ({e})."));
    }
    Ok(Copied {
        kind: kind_of(&ext),
        name,
        ext,
        size: meta.len() as i64,
        stored_name,
        source_path: src.display().to_string(),
    })
}

fn link_err(e: rusqlite::Error) -> String {
    match &e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation => {
            "O projeto ou a ideia escolhida não existe mais.".into()
        }
        _ => err(e),
    }
}

/// Registra um arquivo copiado e, se pedido, já o associa a um projeto e/ou ideia. Tudo ou nada.
pub fn insert_file(
    conn: &Connection,
    library: &Path,
    c: &Copied,
    project_id: Option<i64>,
    idea_id: Option<i64>,
) -> Result<FileItem, String> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    tx.execute(
        "INSERT INTO files (name, ext, kind, size, stored_name, source_path, imported_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![c.name, c.ext, c.kind, c.size, c.stored_name, c.source_path, now_ms()],
    )
    .map_err(err)?;
    let id = tx.last_insert_rowid();
    if let Some(p) = project_id {
        tx.execute("INSERT INTO file_projects (file_id, project_id) VALUES (?1, ?2)", params![id, p])
            .map_err(link_err)?;
    }
    if let Some(i) = idea_id {
        tx.execute("INSERT INTO file_ideas (file_id, idea_id) VALUES (?1, ?2)", params![id, i])
            .map_err(link_err)?;
    }
    tx.commit().map_err(err)?;
    get_file(conn, library, id)
}

const FILE_SELECT: &str = "SELECT f.id, f.name, f.ext, f.kind, f.size, f.stored_name, f.source_path, f.imported_at,
        (SELECT group_concat(project_id) FROM file_projects WHERE file_id = f.id),
        (SELECT group_concat(idea_id) FROM file_ideas WHERE file_id = f.id)
     FROM files f";

fn ids(s: Option<String>) -> Vec<i64> {
    s.map(|s| s.split(',').filter_map(|x| x.parse().ok()).collect())
        .unwrap_or_default()
}

fn map_file(library: &Path) -> impl Fn(&rusqlite::Row) -> rusqlite::Result<FileItem> + '_ {
    move |r| {
        let stored: String = r.get(5)?;
        Ok(FileItem {
            id: r.get(0)?,
            name: r.get(1)?,
            ext: r.get(2)?,
            kind: r.get(3)?,
            size: r.get(4)?,
            // Nome inválido: caminho vazio, que não abre, não lê e não exporta nada.
            path: if valid_stored_name(&stored) { library.join(stored).display().to_string() } else { String::new() },
            source_path: r.get(6)?,
            imported_at: r.get(7)?,
            project_ids: ids(r.get(8)?),
            idea_ids: ids(r.get(9)?),
        })
    }
}

pub fn get_file(conn: &Connection, library: &Path, id: i64) -> Result<FileItem, String> {
    conn.query_row(&format!("{FILE_SELECT} WHERE f.id = ?1"), params![id], map_file(library))
        .optional()
        .map_err(err)?
        .ok_or_else(|| "Arquivo não encontrado.".to_string())
}

/// Todos os arquivos, mais recentes primeiro. Filtros e ordenação são feitos na interface.
// shortcut: carrega todos os metadados de uma vez; paginar se a biblioteca passar de alguns milhares de itens.
pub fn list_files(conn: &Connection, library: &Path) -> Result<Vec<FileItem>, String> {
    let mut stmt = conn
        .prepare(&format!("{FILE_SELECT} ORDER BY f.imported_at DESC, f.id DESC"))
        .map_err(err)?;
    let rows = stmt.query_map([], map_file(library)).map_err(err)?;
    rows.map(|r| r.map_err(err)).collect()
}

/// Associa (`linked = true`) ou desassocia um arquivo de um projeto (`target = "project"`) ou ideia (`"idea"`).
pub fn set_link(conn: &Connection, file_id: i64, target: &str, target_id: i64, linked: bool) -> Result<(), String> {
    let (table, col) = match target {
        "project" => ("file_projects", "project_id"),
        "idea" => ("file_ideas", "idea_id"),
        _ => return Err("Tipo de associação desconhecido.".into()),
    };
    let sql = if linked {
        format!("INSERT OR IGNORE INTO {table} (file_id, {col}) VALUES (?1, ?2)")
    } else {
        format!("DELETE FROM {table} WHERE file_id = ?1 AND {col} = ?2")
    };
    conn.execute(&sql, params![file_id, target_id]).map_err(link_err)?;
    Ok(())
}

/// Apaga a cópia da biblioteca e o registro. O arquivo original do usuário não é tocado.
pub fn delete_file(conn: &Connection, library: &Path, id: i64) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    let stored: Option<String> = tx
        .query_row("SELECT stored_name FROM files WHERE id = ?1", params![id], |r| r.get(0))
        .optional()
        .map_err(err)?;
    let Some(stored) = stored else { return Ok(()) };
    tx.execute("DELETE FROM files WHERE id = ?1", params![id]).map_err(err)?;
    // Nome fora do formato da biblioteca: tira só o registro, nunca apaga nada no disco.
    if !valid_stored_name(&stored) {
        return tx.commit().map_err(err);
    }
    match fs::remove_file(library.join(&stored)) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        // Sem apagar o disco, desfaz a exclusão no banco para não deixar cópia órfã.
        Err(e) => return Err(format!("Não foi possível apagar a cópia do arquivo ({e}).")),
    }
    tx.commit().map_err(err)
}

/// Primeiros 64 KB de um arquivo de texto, para a prévia.
pub fn text_preview(conn: &Connection, library: &Path, id: i64) -> Result<String, String> {
    let f = get_file(conn, library, id)?;
    if f.kind != "texto" {
        return Err("Este arquivo não é de texto.".into());
    }
    let mut buf = Vec::new();
    fs::File::open(&f.path)
        .and_then(|file| file.take(TEXT_PREVIEW_BYTES).read_to_end(&mut buf))
        .map_err(|e| format!("Não foi possível ler o arquivo ({e})."))?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{create_idea, create_project, delete_project, test_conn};

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("linkon-{tag}-{}", unique_stored_name("")));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn kinds_follow_the_briefing_categories() {
        assert_eq!(kind_of("jpg"), "imagem");
        assert_eq!(kind_of("pdf"), "pdf");
        assert_eq!(kind_of("docx"), "documento");
        assert_eq!(kind_of("md"), "texto");
        assert_eq!(kind_of("zip"), "outro");
        assert_eq!(kind_of(""), "outro");
    }

    #[test]
    fn import_copies_links_and_delete_keeps_original() {
        let c = test_conn();
        let lib = temp_dir("lib");
        let src_dir = temp_dir("src");
        let src = src_dir.join("Notas da Viagem.MD");
        fs::write(&src, "linha um\nlinha dois").unwrap();

        let p = create_project(&c, "Viagem").unwrap();
        let idea = create_idea(&c, "Roteiro", "", None).unwrap();
        let copied = copy_into(&lib, &src).unwrap();
        assert_eq!((copied.ext.as_str(), copied.kind), ("md", "texto"));
        let f = insert_file(&c, &lib, &copied, Some(p), Some(idea.id)).unwrap();
        assert_eq!(f.name, "Notas da Viagem.MD");
        assert_eq!((f.project_ids.clone(), f.idea_ids.clone()), (vec![p], vec![idea.id]));
        assert_eq!(text_preview(&c, &lib, f.id).unwrap(), "linha um\nlinha dois");

        set_link(&c, f.id, "project", p, false).unwrap();
        assert!(list_files(&c, &lib).unwrap()[0].project_ids.is_empty());

        delete_file(&c, &lib, f.id).unwrap();
        assert!(list_files(&c, &lib).unwrap().is_empty());
        assert!(!Path::new(&f.path).exists(), "a cópia some");
        assert!(src.exists(), "o original fica");
        let _ = fs::remove_dir_all(&lib);
        let _ = fs::remove_dir_all(&src_dir);
    }

    #[test]
    fn link_to_missing_target_rolls_back_the_insert() {
        let c = test_conn();
        let lib = temp_dir("lib2");
        let src = lib.join("a.png");
        fs::write(&src, [0u8; 4]).unwrap();
        let copied = copy_into(&lib, &src).unwrap();
        assert!(insert_file(&c, &lib, &copied, Some(99), None).is_err());
        assert!(list_files(&c, &lib).unwrap().is_empty());
        let _ = fs::remove_dir_all(&lib);
    }

    #[test]
    fn deleting_a_project_drops_links_not_files() {
        let c = test_conn();
        let lib = temp_dir("lib3");
        let src = lib.join("b.pdf");
        fs::write(&src, b"%PDF").unwrap();
        let p = create_project(&c, "X").unwrap();
        let f = insert_file(&c, &lib, &copy_into(&lib, &src).unwrap(), Some(p), None).unwrap();
        delete_project(&c, p).unwrap();
        let again = get_file(&c, &lib, f.id).unwrap();
        assert!(again.project_ids.is_empty());
        let _ = fs::remove_dir_all(&lib);
    }

    #[test]
    fn folders_are_rejected() {
        let lib = temp_dir("lib4");
        assert!(copy_into(&lib, &lib).is_err());
        let _ = fs::remove_dir_all(&lib);
    }

    #[test]
    fn odd_extensions_are_not_used_in_the_stored_name() {
        assert_eq!(clean_ext(Path::new("x.tar.gz")), "gz");
        assert_eq!(clean_ext(Path::new("x.a b")), "");
        assert_eq!(clean_ext(Path::new("semextensao")), "");
    }

    #[test]
    fn only_generated_stored_names_are_valid() {
        assert!(valid_stored_name(&unique_stored_name("png")));
        assert!(valid_stored_name(&unique_stored_name("")));
        for bad in ["", "..", "../x.png", "a/b", "a\\b", "C:\\Users\\x.docx", "/etc/passwd", "19a-2b.p.ng", "19a-2b.", "x-y.png", "19a.png", "19a-2b-3c"] {
            assert!(!valid_stored_name(bad), "{bad:?} deveria ser recusado");
        }
    }

    #[test]
    fn delete_with_a_hostile_stored_name_never_touches_outside_files() {
        // Um backup de terceiros pode gravar um caminho absoluto em stored_name.
        let c = test_conn();
        let lib = temp_dir("lib5");
        let outside = temp_dir("fora").join("importante.docx");
        fs::write(&outside, b"nao apagar").unwrap();
        c.execute(
            "INSERT INTO files (name, ext, kind, size, stored_name, source_path, imported_at) VALUES ('foto.png', 'png', 'imagem', 1, ?1, '', 0)",
            params![outside.display().to_string()],
        )
        .unwrap();
        let f = &list_files(&c, &lib).unwrap()[0];
        assert_eq!(f.path, "", "nome inválido não vira caminho");
        delete_file(&c, &lib, f.id).unwrap();
        assert!(outside.exists(), "o arquivo de fora continua lá");
        assert!(list_files(&c, &lib).unwrap().is_empty(), "o registro sai");
        let _ = fs::remove_file(&outside);
        let _ = fs::remove_dir_all(&lib);
    }
}
