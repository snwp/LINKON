use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_TITLE_CHARS: usize = 300;
const MAX_BODY_BYTES: usize = 200_000;
const MAX_PROJECT_CHARS: usize = 120;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Idea {
    pub id: i64,
    pub title: String,
    pub body: String,
    pub project_id: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub idea_count: i64,
}

pub(crate) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Abre o banco em modo WAL, liga as chaves estrangeiras e aplica as migrações.
pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrate(&conn)?;
    Ok(conn)
}

/// Migrações numeradas por `user_version`. Uma nova versão entra como mais um `if`.
pub(crate) fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < 1 {
        conn.execute_batch(
            "BEGIN;
             CREATE TABLE projects (
                 id INTEGER PRIMARY KEY,
                 name TEXT NOT NULL,
                 created_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL
             );
             CREATE TABLE ideas (
                 id INTEGER PRIMARY KEY,
                 title TEXT NOT NULL,
                 body TEXT NOT NULL DEFAULT '',
                 project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
                 created_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL
             );
             CREATE INDEX ideas_updated ON ideas(updated_at DESC);
             CREATE INDEX ideas_project ON ideas(project_id);
             PRAGMA user_version = 1;
             COMMIT;",
        )?;
    }
    if version < 2 {
        // Etapa 2: biblioteca. O arquivo fica copiado em <dados>/library/<stored_name>; o banco guarda só metadados.
        conn.execute_batch(
            "BEGIN;
             CREATE TABLE files (
                 id INTEGER PRIMARY KEY,
                 name TEXT NOT NULL,
                 ext TEXT NOT NULL,
                 kind TEXT NOT NULL,
                 size INTEGER NOT NULL,
                 stored_name TEXT NOT NULL UNIQUE,
                 source_path TEXT NOT NULL,
                 imported_at INTEGER NOT NULL
             );
             CREATE INDEX files_imported ON files(imported_at DESC);
             CREATE TABLE file_projects (
                 file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
                 project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                 PRIMARY KEY (file_id, project_id)
             );
             CREATE INDEX file_projects_project ON file_projects(project_id);
             CREATE TABLE file_ideas (
                 file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
                 idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
                 PRIMARY KEY (file_id, idea_id)
             );
             CREATE INDEX file_ideas_idea ON file_ideas(idea_id);
             PRAGMA user_version = 2;
             COMMIT;",
        )?;
    }
    if version < 3 {
        // Etapa 3: conexões entre ideias (sem direção; a < b evita par duplicado).
        // Etapa 4: páginas do editor; `doc` é o documento em JSON (ver src/lib/editor/doc.ts).
        conn.execute_batch(
            "BEGIN;
             CREATE TABLE idea_links (
                 a INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
                 b INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
                 created_at INTEGER NOT NULL,
                 PRIMARY KEY (a, b),
                 CHECK (a < b)
             );
             CREATE INDEX idea_links_b ON idea_links(b);
             CREATE TABLE pages (
                 id INTEGER PRIMARY KEY,
                 title TEXT NOT NULL,
                 project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
                 doc TEXT NOT NULL,
                 created_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL
             );
             CREATE INDEX pages_updated ON pages(updated_at DESC);
             PRAGMA user_version = 3;
             COMMIT;",
        )?;
    }
    if version < 4 {
        // Pasta de cada interface em Documentos/Linkon (ver site.rs). `rel` usa '/' e é única.
        conn.execute_batch(
            "BEGIN;
             CREATE TABLE site_dirs (
                 page_id INTEGER PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
                 rel TEXT NOT NULL UNIQUE
             );
             PRAGMA user_version = 4;
             COMMIT;",
        )?;
    }
    Ok(())
}

/// Conecta (ou desconecta) duas ideias. A conexão não tem direção.
pub fn link_ideas(conn: &Connection, a: i64, b: i64, linked: bool) -> Result<(), String> {
    if a == b {
        return Err("Uma ideia não pode se conectar a ela mesma.".into());
    }
    let (a, b) = (a.min(b), a.max(b));
    let res = if linked {
        conn.execute(
            "INSERT OR IGNORE INTO idea_links (a, b, created_at) VALUES (?1, ?2, ?3)",
            params![a, b, now_ms()],
        )
    } else {
        conn.execute("DELETE FROM idea_links WHERE a = ?1 AND b = ?2", params![a, b])
    };
    res.map_err(|e| match e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation => {
            "Uma das ideias não existe mais.".to_string()
        }
        e => err(e),
    })?;
    Ok(())
}

pub fn list_idea_links(conn: &Connection) -> Result<Vec<(i64, i64)>, String> {
    let mut stmt = conn.prepare("SELECT a, b FROM idea_links").map_err(err)?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(err)?;
    rows.map(|r| r.map_err(err)).collect()
}

/// Só para testes de outros módulos: banco em memória já migrado.
#[cfg(test)]
pub(crate) fn test_conn() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    migrate(&conn).unwrap();
    conn
}

fn clean_title(title: &str) -> Result<String, String> {
    let t = title.trim();
    if t.is_empty() {
        return Err("O título não pode ficar vazio.".into());
    }
    if t.chars().count() > MAX_TITLE_CHARS {
        return Err(format!("O título pode ter até {MAX_TITLE_CHARS} caracteres."));
    }
    Ok(t.to_string())
}

fn clean_body(body: &str) -> Result<String, String> {
    if body.len() > MAX_BODY_BYTES {
        return Err("O texto da ideia é grande demais.".into());
    }
    Ok(body.to_string())
}

fn clean_project_name(name: &str) -> Result<String, String> {
    let t = name.trim();
    if t.is_empty() {
        return Err("O nome do projeto não pode ficar vazio.".into());
    }
    if t.chars().count() > MAX_PROJECT_CHARS {
        return Err(format!("O nome do projeto pode ter até {MAX_PROJECT_CHARS} caracteres."));
    }
    Ok(t.to_string())
}

fn escape_like(q: &str) -> String {
    q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

pub(crate) fn err(e: rusqlite::Error) -> String {
    match e {
        rusqlite::Error::SqliteFailure(f, _)
            if f.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            "O projeto escolhido não existe mais.".into()
        }
        e => format!("Falha ao acessar o banco: {e}"),
    }
}

const IDEA_COLS: &str = "id, title, body, project_id, created_at, updated_at";

fn map_idea(r: &rusqlite::Row) -> rusqlite::Result<Idea> {
    Ok(Idea {
        id: r.get(0)?,
        title: r.get(1)?,
        body: r.get(2)?,
        project_id: r.get(3)?,
        created_at: r.get(4)?,
        updated_at: r.get(5)?,
    })
}

pub fn get_idea(conn: &Connection, id: i64) -> Result<Idea, String> {
    conn.query_row(
        &format!("SELECT {IDEA_COLS} FROM ideas WHERE id = ?1"),
        params![id],
        map_idea,
    )
    .optional()
    .map_err(err)?
    .ok_or_else(|| "Ideia não encontrada.".to_string())
}

/// Ideias mais recentes primeiro. Com `query`, filtra pelo título (sem diferenciar maiúsculas em ASCII).
pub fn list_ideas(conn: &Connection, query: Option<&str>) -> Result<Vec<Idea>, String> {
    // shortcut: LIKE não ignora acentos ("ideia" não acha "idéia"); trocar por FTS5 com unicode61 na etapa da busca global.
    let pattern = match query.map(str::trim).filter(|s| !s.is_empty()) {
        Some(q) => format!("%{}%", escape_like(q)),
        None => "%".into(),
    };
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {IDEA_COLS} FROM ideas WHERE title LIKE ?1 ESCAPE '\\'
             ORDER BY updated_at DESC LIMIT 500"
        ))
        .map_err(err)?;
    let rows = stmt.query_map(params![pattern], map_idea).map_err(err)?;
    rows.map(|r| r.map_err(err)).collect()
}

pub fn create_idea(
    conn: &Connection,
    title: &str,
    body: &str,
    project_id: Option<i64>,
) -> Result<Idea, String> {
    let title = clean_title(title)?;
    let body = clean_body(body)?;
    let now = now_ms();
    conn.execute(
        "INSERT INTO ideas (title, body, project_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)",
        params![title, body, project_id, now],
    )
    .map_err(err)?;
    touch_project(conn, project_id, now)?;
    get_idea(conn, conn.last_insert_rowid())
}

pub fn update_idea(
    conn: &Connection,
    id: i64,
    title: &str,
    body: &str,
    project_id: Option<i64>,
) -> Result<Idea, String> {
    let title = clean_title(title)?;
    let body = clean_body(body)?;
    let now = now_ms();
    let changed = conn
        .execute(
            "UPDATE ideas SET title = ?2, body = ?3, project_id = ?4, updated_at = ?5 WHERE id = ?1",
            params![id, title, body, project_id, now],
        )
        .map_err(err)?;
    if changed == 0 {
        return Err("Ideia não encontrada.".into());
    }
    touch_project(conn, project_id, now)?;
    get_idea(conn, id)
}

/// Um projeto sobe na lista de recentes quando uma ideia dele muda.
fn touch_project(conn: &Connection, project_id: Option<i64>, now: i64) -> Result<(), String> {
    if let Some(p) = project_id {
        conn.execute(
            "UPDATE projects SET updated_at = ?2 WHERE id = ?1",
            params![p, now],
        )
        .map_err(err)?;
    }
    Ok(())
}

pub fn delete_idea(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM ideas WHERE id = ?1", params![id])
        .map_err(err)?;
    Ok(())
}

pub fn list_projects(conn: &Connection) -> Result<Vec<Project>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.name, p.created_at, p.updated_at,
                    (SELECT COUNT(*) FROM ideas i WHERE i.project_id = p.id)
             FROM projects p ORDER BY p.updated_at DESC",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Project {
                id: r.get(0)?,
                name: r.get(1)?,
                created_at: r.get(2)?,
                updated_at: r.get(3)?,
                idea_count: r.get(4)?,
            })
        })
        .map_err(err)?;
    rows.map(|r| r.map_err(err)).collect()
}

pub fn create_project(conn: &Connection, name: &str) -> Result<i64, String> {
    let name = clean_project_name(name)?;
    let now = now_ms();
    conn.execute(
        "INSERT INTO projects (name, created_at, updated_at) VALUES (?1, ?2, ?2)",
        params![name, now],
    )
    .map_err(err)?;
    Ok(conn.last_insert_rowid())
}

pub fn rename_project(conn: &Connection, id: i64, name: &str) -> Result<(), String> {
    let name = clean_project_name(name)?;
    let changed = conn
        .execute(
            "UPDATE projects SET name = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, name, now_ms()],
        )
        .map_err(err)?;
    if changed == 0 {
        return Err("Projeto não encontrado.".into());
    }
    Ok(())
}

/// Apagar um projeto solta as ideias dele (project_id vira NULL); nenhuma ideia é apagada.
pub fn delete_project(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])
        .map_err(err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn creates_and_reads_an_idea() {
        let c = mem();
        let i = create_idea(&c, "  Ideia de capa  ", "rascunho", None).unwrap();
        assert_eq!(i.title, "Ideia de capa");
        assert_eq!(get_idea(&c, i.id).unwrap(), i);
    }

    #[test]
    fn rejects_empty_title() {
        let c = mem();
        assert!(create_idea(&c, "   ", "", None).is_err());
    }

    #[test]
    fn search_is_case_insensitive_and_literal() {
        let c = mem();
        create_idea(&c, "Lista 100% pronta", "", None).unwrap();
        create_idea(&c, "outra coisa", "", None).unwrap();
        assert_eq!(list_ideas(&c, Some("LISTA")).unwrap().len(), 1);
        assert_eq!(list_ideas(&c, Some("100%")).unwrap().len(), 1);
        assert_eq!(list_ideas(&c, Some("_")).unwrap().len(), 0);
        assert_eq!(list_ideas(&c, Some("  ")).unwrap().len(), 2);
    }

    #[test]
    fn update_changes_fields_and_missing_id_fails() {
        let c = mem();
        let i = create_idea(&c, "a", "", None).unwrap();
        let u = update_idea(&c, i.id, "b", "corpo", None).unwrap();
        assert_eq!((u.title.as_str(), u.body.as_str()), ("b", "corpo"));
        assert!(update_idea(&c, 999, "x", "", None).is_err());
    }

    #[test]
    fn deleting_project_keeps_its_ideas() {
        let c = mem();
        let p = create_project(&c, "Verão").unwrap();
        let i = create_idea(&c, "ideia", "", Some(p)).unwrap();
        assert_eq!(list_projects(&c).unwrap()[0].idea_count, 1);
        delete_project(&c, p).unwrap();
        assert_eq!(get_idea(&c, i.id).unwrap().project_id, None);
    }

    #[test]
    fn idea_cannot_point_to_missing_project() {
        let c = mem();
        assert_eq!(
            create_idea(&c, "x", "", Some(42)).unwrap_err(),
            "O projeto escolhido não existe mais."
        );
    }

    #[test]
    fn idea_links_are_undirected_and_cascade() {
        let c = mem();
        let a = create_idea(&c, "a", "", None).unwrap();
        let b = create_idea(&c, "b", "", None).unwrap();
        link_ideas(&c, b.id, a.id, true).unwrap();
        link_ideas(&c, a.id, b.id, true).unwrap(); // repetido não duplica
        assert_eq!(list_idea_links(&c).unwrap(), vec![(a.id, b.id)]);
        assert!(link_ideas(&c, a.id, a.id, true).is_err());
        assert!(link_ideas(&c, a.id, 999, true).is_err());
        delete_idea(&c, b.id).unwrap();
        assert!(list_idea_links(&c).unwrap().is_empty());
    }

    #[test]
    fn reopening_a_file_keeps_data_and_wal() {
        let dir = std::env::temp_dir().join(format!("linkon-test-{}", now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.db");
        {
            let c = open(&path).unwrap();
            create_idea(&c, "persistente", "", None).unwrap();
        }
        let c = open(&path).unwrap();
        let mode: String = c.query_row("PRAGMA journal_mode", [], |r| r.get(0)).unwrap();
        assert_eq!(mode, "wal");
        assert_eq!(list_ideas(&c, None).unwrap()[0].title, "persistente");
        drop(c);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
