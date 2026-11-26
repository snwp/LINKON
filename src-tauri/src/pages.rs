//! Páginas do editor visual. O documento é JSON opaco para o backend, validado só no formato geral.

use crate::db::{err, now_ms};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

const MAX_DOC_BYTES: usize = 4 * 1024 * 1024;
const MAX_TITLE_CHARS: usize = 200;
const DEFAULT_DOC: &str =
    r##"{"version":1,"width":1280,"height":1600,"background":"#ffffff","elements":[]}"##;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Page {
    pub id: i64,
    pub title: String,
    pub project_id: Option<i64>,
    pub doc: String,
    pub created_at: i64,
    pub updated_at: i64,
}

fn clean_title(t: &str) -> Result<String, String> {
    let t = t.trim();
    if t.is_empty() {
        return Err("A página precisa de um título.".into());
    }
    if t.chars().count() > MAX_TITLE_CHARS {
        return Err(format!("O título pode ter até {MAX_TITLE_CHARS} caracteres."));
    }
    Ok(t.to_string())
}

/// O documento precisa ser um objeto JSON com uma lista `elements`.
fn check_doc(doc: &str) -> Result<(), String> {
    if doc.len() > MAX_DOC_BYTES {
        return Err("A página ficou grande demais para salvar.".into());
    }
    let v: serde_json::Value =
        serde_json::from_str(doc).map_err(|_| "O conteúdo da página está corrompido.".to_string())?;
    if !v.get("elements").is_some_and(|e| e.is_array()) {
        return Err("O conteúdo da página está corrompido.".into());
    }
    Ok(())
}

fn fk(e: rusqlite::Error) -> String {
    match e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation => {
            "O projeto escolhido não existe mais.".into()
        }
        e => err(e),
    }
}

const COLS: &str = "id, title, project_id, doc, created_at, updated_at";

fn map(r: &rusqlite::Row) -> rusqlite::Result<Page> {
    Ok(Page {
        id: r.get(0)?,
        title: r.get(1)?,
        project_id: r.get(2)?,
        doc: r.get(3)?,
        created_at: r.get(4)?,
        updated_at: r.get(5)?,
    })
}

pub fn get_page(conn: &Connection, id: i64) -> Result<Page, String> {
    conn.query_row(&format!("SELECT {COLS} FROM pages WHERE id = ?1"), params![id], map)
        .optional()
        .map_err(err)?
        .ok_or_else(|| "Página não encontrada.".to_string())
}

pub fn list_pages(conn: &Connection) -> Result<Vec<Page>, String> {
    let mut stmt = conn
        .prepare(&format!("SELECT {COLS} FROM pages ORDER BY updated_at DESC"))
        .map_err(err)?;
    let rows = stmt.query_map([], map).map_err(err)?;
    rows.map(|r| r.map_err(err)).collect()
}

pub fn create_page(conn: &Connection, title: &str, project_id: Option<i64>, doc: Option<&str>) -> Result<Page, String> {
    let title = clean_title(title)?;
    let doc = doc.unwrap_or(DEFAULT_DOC);
    check_doc(doc)?;
    let now = now_ms();
    conn.execute(
        "INSERT INTO pages (title, project_id, doc, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        params![title, project_id, doc, now],
    )
    .map_err(fk)?;
    get_page(conn, conn.last_insert_rowid())
}

pub fn update_page(conn: &Connection, id: i64, title: &str, project_id: Option<i64>, doc: &str) -> Result<Page, String> {
    let title = clean_title(title)?;
    check_doc(doc)?;
    let changed = conn
        .execute(
            "UPDATE pages SET title = ?2, project_id = ?3, doc = ?4, updated_at = ?5 WHERE id = ?1",
            params![id, title, project_id, doc, now_ms()],
        )
        .map_err(fk)?;
    if changed == 0 {
        return Err("Página não encontrada.".into());
    }
    get_page(conn, id)
}

pub fn delete_page(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM pages WHERE id = ?1", params![id]).map_err(err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{create_project, delete_project, test_conn};

    #[test]
    fn create_update_and_validate() {
        let c = test_conn();
        let p = create_page(&c, " Capa ", None, None).unwrap();
        assert_eq!(p.title, "Capa");
        assert!(p.doc.contains("\"elements\":[]"));
        let doc = r#"{"version":1,"elements":[{"id":"a","type":"texto"}]}"#;
        let u = update_page(&c, p.id, "Capa 2", None, doc).unwrap();
        assert_eq!(u.doc, doc);
        assert!(update_page(&c, p.id, "x", None, "{oops").is_err());
        assert!(update_page(&c, p.id, "x", None, r#"{"elements":3}"#).is_err());
        assert!(update_page(&c, p.id, " ", None, doc).is_err());
        assert!(update_page(&c, 999, "x", None, doc).is_err());
    }

    #[test]
    fn project_delete_keeps_page() {
        let c = test_conn();
        let proj = create_project(&c, "P").unwrap();
        let p = create_page(&c, "Pág", Some(proj), None).unwrap();
        delete_project(&c, proj).unwrap();
        assert_eq!(get_page(&c, p.id).unwrap().project_id, None);
        assert!(create_page(&c, "x", Some(proj), None).is_err());
    }
}
