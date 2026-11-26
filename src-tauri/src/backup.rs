//! Cópia de segurança e restauração (briefing, seção 10).
//! Uma cópia é uma pasta com `linkon.db` (consistente, via VACUUM INTO) e a pasta `library`.

use crate::db::err;
use rusqlite::{backup::Backup, Connection};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

fn copy_dir_files(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| format!("Não foi possível criar a pasta ({e})."))?;
    let entries = match fs::read_dir(from) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("Não foi possível ler a biblioteca ({e}).")),
    };
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            fs::copy(entry.path(), to.join(entry.file_name()))
                .map_err(|e| format!("Falha ao copiar {} ({e}).", entry.file_name().to_string_lossy()))?;
        }
    }
    Ok(())
}

/// Cria `<parent>/<name>/` com o banco e a biblioteca. `name` vem da interface e não pode ser um caminho.
pub fn create_backup(conn: &Connection, library: &Path, parent: &Path, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || name.contains(['/', '\\', ':']) || name.starts_with('.') {
        return Err("Nome de cópia inválido.".into());
    }
    let dest = parent.join(name);
    if dest.exists() {
        return Err("Já existe uma pasta com esse nome no destino.".into());
    }
    fs::create_dir_all(&dest).map_err(|e| format!("Não foi possível criar a pasta da cópia ({e})."))?;
    let result = (|| {
        let db = dest.join("linkon.db");
        conn.execute("VACUUM INTO ?1", [db.to_string_lossy()]).map_err(err)?;
        copy_dir_files(library, &dest.join("library"))
    })();
    if let Err(e) = result {
        let _ = fs::remove_dir_all(&dest);
        return Err(e);
    }
    Ok(dest)
}

/// Substitui os dados atuais pelos da cópia em `src`. Antes, guarda o estado atual em `safety_parent`.
/// Devolve o caminho da cópia automática feita antes de restaurar.
pub fn restore_backup(
    conn: &mut Connection,
    library: &Path,
    src: &Path,
    safety_parent: &Path,
    safety_name: &str,
) -> Result<PathBuf, String> {
    let src_db = src.join("linkon.db");
    if !src_db.is_file() {
        return Err("Esta pasta não é uma cópia do Linkon: falta o arquivo linkon.db.".into());
    }
    let backup_conn = Connection::open(&src_db).map_err(err)?;
    let version: i64 = backup_conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(err)?;
    let has_ideas: bool = backup_conn
        .query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = 'ideas')", [], |r| r.get(0))
        .map_err(err)?;
    if version < 1 || !has_ideas {
        return Err("Esta pasta não é uma cópia do Linkon.".into());
    }
    // Nomes de arquivo fora do formato do Linkon apontariam para fora da biblioteca: recusa a cópia inteira.
    let has_files: bool = backup_conn
        .query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = 'files')", [], |r| r.get(0))
        .map_err(err)?;
    if has_files {
        let mut stmt = backup_conn.prepare("SELECT stored_name FROM files").map_err(err)?;
        let names = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        for name in names {
            if !crate::library::valid_stored_name(&name.map_err(err)?) {
                return Err("Esta cópia tem arquivos com nomes inválidos e não foi restaurada.".into());
            }
        }
    }

    let safety = create_backup(conn, library, safety_parent, safety_name)?;

    {
        let b = Backup::new(&backup_conn, conn).map_err(err)?;
        b.run_to_completion(256, Duration::ZERO, None).map_err(err)?;
    }
    // A cópia pode ser de uma versão anterior do Linkon.
    crate::db::migrate(conn).map_err(err)?;

    // Biblioteca: copia os arquivos da cópia e apaga os que o banco restaurado não conhece.
    copy_dir_files(&src.join("library"), library)?;
    let known: std::collections::HashSet<String> = {
        let mut stmt = conn.prepare("SELECT stored_name FROM files").map_err(err)?;
        let rows = stmt.query_map([], |r| r.get(0)).map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)?
    };
    if let Ok(entries) = fs::read_dir(library) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !known.contains(&name) {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    Ok(safety)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{create_idea, list_ideas, now_ms, open};
    use crate::library::{copy_into, insert_file, list_files};

    #[test]
    fn backup_then_restore_round_trip() {
        let root = std::env::temp_dir().join(format!("linkon-bk-{}", now_ms()));
        let data = root.join("data");
        let lib = data.join("library");
        fs::create_dir_all(&lib).unwrap();
        let mut c = open(&data.join("linkon.db")).unwrap();

        create_idea(&c, "antes", "", None).unwrap();
        let src = root.join("foto.png");
        fs::write(&src, b"img").unwrap();
        insert_file(&c, &lib, &copy_into(&lib, &src).unwrap(), None, None).unwrap();

        let bk = create_backup(&c, &lib, &root, "copia 1").unwrap();
        assert!(bk.join("linkon.db").is_file());
        assert_eq!(fs::read_dir(bk.join("library")).unwrap().count(), 1);
        assert!(create_backup(&c, &lib, &root, "copia 1").is_err(), "não sobrescreve");
        assert!(create_backup(&c, &lib, &root, "../fora").is_err());

        // Depois da cópia: muda os dados e importa outro arquivo.
        create_idea(&c, "depois", "", None).unwrap();
        let src2 = root.join("outro.png");
        fs::write(&src2, b"x").unwrap();
        insert_file(&c, &lib, &copy_into(&lib, &src2).unwrap(), None, None).unwrap();

        let safety = restore_backup(&mut c, &lib, &bk, &root, "antes de restaurar").unwrap();
        let titles: Vec<_> = list_ideas(&c, None).unwrap().into_iter().map(|i| i.title).collect();
        assert_eq!(titles, vec!["antes"]);
        assert_eq!(list_files(&c, &lib).unwrap().len(), 1);
        assert_eq!(fs::read_dir(&lib).unwrap().count(), 1, "arquivo órfão removido");
        assert!(safety.join("linkon.db").is_file(), "estado anterior guardado");

        assert!(restore_backup(&mut c, &lib, &root, &root, "x").is_err(), "pasta sem linkon.db");

        // Cópia adulterada: um nome de arquivo aponta para fora da biblioteca. É recusada antes de mudar algo.
        let bad = create_backup(&c, &lib, &root, "adulterada").unwrap();
        Connection::open(bad.join("linkon.db"))
            .unwrap()
            .execute("UPDATE files SET stored_name = 'C:\\Users\\x\\tese.docx'", [])
            .unwrap();
        assert!(restore_backup(&mut c, &lib, &bad, &root, "y").is_err(), "nome inválido recusado");
        assert!(!root.join("y").exists(), "nem a cópia de segurança foi feita");
        assert_eq!(list_ideas(&c, None).unwrap().len(), 1, "dados intactos");
        drop(c);
        let _ = fs::remove_dir_all(&root);
    }
}
