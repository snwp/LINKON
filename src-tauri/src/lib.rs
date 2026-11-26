mod ai;
mod backup;
mod db;
mod export;
mod image;
mod imgcheck;
mod library;
mod pages;
mod publish;
mod serve;
mod site;

use db::{Idea, Project};
use library::FileItem;
use pages::Page;
use rusqlite::Connection;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

/// Uma única conexão, protegida por Mutex. O SQLite em WAL aceita um escritor por vez.
struct AppDb {
    conn: Mutex<Connection>,
    dir: PathBuf,
    library: PathBuf,
}

impl AppDb {
    fn with<T>(&self, f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| "O banco ficou indisponível. Reinicie o Linkon.".to_string())?;
        f(&conn)
    }

    fn with_mut<T>(&self, f: impl FnOnce(&mut Connection) -> Result<T, String>) -> Result<T, String> {
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| "O banco ficou indisponível. Reinicie o Linkon.".to_string())?;
        f(&mut conn)
    }
}

// ---------- ideias e projetos ----------

#[tauri::command]
fn list_ideas(state: State<AppDb>, query: Option<String>) -> Result<Vec<Idea>, String> {
    state.with(|c| db::list_ideas(c, query.as_deref()))
}

#[tauri::command]
fn get_idea(state: State<AppDb>, id: i64) -> Result<Idea, String> {
    state.with(|c| db::get_idea(c, id))
}

#[tauri::command]
fn create_idea(state: State<AppDb>, title: String, body: String, project_id: Option<i64>) -> Result<Idea, String> {
    state.with(|c| db::create_idea(c, &title, &body, project_id))
}

#[tauri::command]
fn update_idea(
    state: State<AppDb>,
    id: i64,
    title: String,
    body: String,
    project_id: Option<i64>,
) -> Result<Idea, String> {
    state.with(|c| db::update_idea(c, id, &title, &body, project_id))
}

#[tauri::command]
fn delete_idea(state: State<AppDb>, id: i64) -> Result<(), String> {
    state.with(|c| db::delete_idea(c, id))
}

#[tauri::command]
fn list_projects(state: State<AppDb>) -> Result<Vec<Project>, String> {
    state.with(db::list_projects)
}

#[tauri::command]
fn create_project(state: State<AppDb>, name: String) -> Result<i64, String> {
    state.with(|c| db::create_project(c, &name))
}

#[tauri::command]
fn rename_project(state: State<AppDb>, id: i64, name: String) -> Result<(), String> {
    state.with(|c| db::rename_project(c, id, &name))
}

#[tauri::command]
fn delete_project(state: State<AppDb>, id: i64) -> Result<(), String> {
    state.with(|c| db::delete_project(c, id))
}

#[tauri::command]
fn data_dir(state: State<AppDb>) -> String {
    state.dir.display().to_string()
}

#[tauri::command]
fn open_data_dir(app: AppHandle, state: State<AppDb>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_path(state.dir.display().to_string(), None::<&str>).map_err(|e| format!("Não foi possível abrir a pasta ({e})."))
}

// ---------- biblioteca ----------

#[derive(Serialize, Default)]
struct ImportFailure {
    name: String,
    reason: String,
}

#[derive(Serialize, Default)]
struct ImportReport {
    imported: Vec<FileItem>,
    failed: Vec<ImportFailure>,
}

/// Copia os arquivos para a biblioteca fora da thread principal, para a janela não travar.
#[tauri::command]
async fn import_files(
    app: AppHandle,
    paths: Vec<String>,
    project_id: Option<i64>,
    idea_id: Option<i64>,
) -> Result<ImportReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppDb>();
        let mut report = ImportReport::default();
        for p in paths {
            let src = PathBuf::from(&p);
            let display = src
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or(p);
            // A cópia acontece sem segurar o banco; só o registro usa a conexão.
            let result = library::copy_into(&state.library, &src).and_then(|copied| {
                state
                    .with(|c| library::insert_file(c, &state.library, &copied, project_id, idea_id))
                    .inspect_err(|_| {
                        let _ = std::fs::remove_file(state.library.join(&copied.stored_name));
                    })
            });
            match result {
                Ok(item) => report.imported.push(item),
                Err(reason) => report.failed.push(ImportFailure { name: display, reason }),
            }
        }
        report
    })
    .await
    .map_err(|e| format!("A importação foi interrompida ({e})."))
}

// ---------- sites (Documentos/Linkon), navegador e Vercel ----------

fn sites_root(app: &AppHandle) -> Result<PathBuf, String> {
    let docs = app.path().document_dir().map_err(|e| format!("A pasta Documentos não foi encontrada ({e})."))?;
    let root = docs.join("Linkon");
    std::fs::create_dir_all(&root).map_err(|e| format!("Não foi possível criar {} ({e}).", root.display()))?;
    Ok(root)
}

/// Grava o site da interface (chamado depois de cada salvamento). Devolve o caminho relativo.
#[tauri::command]
async fn sync_site(app: AppHandle, page_id: i64, html: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = sites_root(&app)?;
        let state = app.state::<AppDb>();
        state.with(|c| site::write_site(c, &state.library, &root, page_id, &html)).map(|(rel, _)| rel)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn open_in_browser(app: AppHandle, page_id: i64, html: String) -> Result<String, String> {
    use tauri_plugin_opener::OpenerExt;
    let rel = sync_site(app.clone(), page_id, html).await?;
    let port = app.state::<serve::LocalServer>().port(sites_root(&app)?)?;
    let url = format!("http://127.0.0.1:{port}/{rel}/");
    app.opener().open_url(&url, None::<&str>).map_err(|e| format!("Não foi possível abrir o navegador ({e})."))?;
    Ok(url)
}

#[tauri::command]
fn open_sites_folder(app: AppHandle) -> Result<String, String> {
    use tauri_plugin_opener::OpenerExt;
    let root = sites_root(&app)?;
    app.opener().open_path(root.display().to_string(), None::<&str>).map_err(|e| format!("Não foi possível abrir a pasta ({e})."))?;
    Ok(root.display().to_string())
}

#[tauri::command]
fn sites_folder(app: AppHandle) -> Result<String, String> {
    sites_root(&app).map(|r| r.display().to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublishCheck {
    name: String,
    findings: Vec<site::Finding>,
    vercel: publish::VercelStatus,
}

fn site_rel(state: &AppDb, page_id: i64) -> Result<String, String> {
    use rusqlite::OptionalExtension;
    state
        .with(|c| {
            c.query_row("SELECT rel FROM site_dirs WHERE page_id = ?1", [page_id], |r| r.get::<_, String>(0))
                .optional()
                .map_err(|e| e.to_string())
        })?
        .ok_or_else(|| "Salve a interface antes de publicar.".to_string())
}

/// Grava o site e faz a revisão de segurança; o resultado vai para a confirmação antes de publicar.
#[tauri::command]
async fn prepare_publish(app: AppHandle, page_id: i64, html: String) -> Result<PublishCheck, String> {
    let rel = sync_site(app.clone(), page_id, html).await?;
    let root = sites_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let index = std::fs::read_to_string(root.join(&rel).join("index.html")).map_err(|e| e.to_string())?;
        Ok(PublishCheck { name: publish::project_name(&rel), findings: site::audit(&index), vercel: publish::status() })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Publica a pasta já gravada. Revisa de novo o que está no disco: nada com erro sai daqui.
#[tauri::command]
async fn publish_site(app: AppHandle, page_id: i64) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppDb>();
        let rel = site_rel(&state, page_id)?;
        let dir = rel.split('/').fold(sites_root(&app)?, |p, s| p.join(s));
        let index = std::fs::read_to_string(dir.join("index.html")).map_err(|e| e.to_string())?;
        if let Some(f) = site::audit(&index).into_iter().find(|f| f.level == "erro") {
            return Err(format!("Publicação bloqueada pela revisão de segurança: {}", f.text));
        }
        publish::deploy(&state.dir, &dir, &publish::project_name(&rel))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Só abre endereços publicados na Vercel.
#[tauri::command]
fn open_published(app: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let host = url.strip_prefix("https://").and_then(|r| r.split('/').next()).unwrap_or("");
    if !host.ends_with(".vercel.app") || !host.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.') {
        return Err("Endereço inválido.".into());
    }
    app.opener().open_url(&url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
async fn vercel_status() -> Result<publish::VercelStatus, String> {
    tauri::async_runtime::spawn_blocking(publish::status).await.map_err(|e| e.to_string())
}

// ---------- imagens geradas ----------

/// Gera uma imagem (Codex pela assinatura ou API da OpenAI) e a guarda na biblioteca, já na pasta.
#[tauri::command]
async fn generate_image(
    app: AppHandle,
    prompt: String,
    shape: String,
    provider: String,
    model: String,
    project_id: Option<i64>,
) -> Result<FileItem, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let prompt = imgcheck::check_prompt(&prompt)?;
        let state = app.state::<AppDb>();
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        // Pasta vazia só deste pedido: o Codex roda nela e a API grava nela; some no fim.
        let work = state.dir.join("imagens-geradas").join(stamp.to_string());
        std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
        let result = (|| {
            let (src, origin) = match provider.as_str() {
                "codex" => (image::generate_codex(&app, &work, &prompt, &shape)?, "Gerada pelo Codex"),
                "openai" => (image::generate_api(&work, &prompt, &shape, &model)?, "Gerada pela API da OpenAI"),
                _ => return Err("Gerador de imagem desconhecido.".to_string()),
            };
            let mut copied = library::copy_into(&state.library, &src)?;
            copied.name = imgcheck::file_name_for(&prompt, &copied.ext);
            copied.source_path = origin.to_string();
            state
                .with(|c| library::insert_file(c, &state.library, &copied, project_id, None))
                .inspect_err(|_| {
                    let _ = std::fs::remove_file(state.library.join(&copied.stored_name));
                })
        })();
        let _ = std::fs::remove_dir_all(&work);
        result
    })
    .await
    .map_err(|e| format!("A geração foi interrompida ({e})."))?
}

#[tauri::command]
fn cancel_image(app: AppHandle) {
    image::cancel(&app.state::<image::ImageRun>());
}

#[tauri::command]
async fn image_status() -> Result<image::ImageStatus, String> {
    tauri::async_runtime::spawn_blocking(image::status).await.map_err(|e| e.to_string())
}

#[tauri::command]
fn set_image_key(key: String) -> Result<(), String> {
    image::set_key(&key)
}

#[tauri::command]
fn list_files(state: State<AppDb>) -> Result<Vec<FileItem>, String> {
    state.with(|c| library::list_files(c, &state.library))
}

#[tauri::command]
fn delete_file(state: State<AppDb>, id: i64) -> Result<(), String> {
    state.with(|c| library::delete_file(c, &state.library, id))
}

#[tauri::command]
fn set_file_link(state: State<AppDb>, file_id: i64, target: String, target_id: i64, linked: bool) -> Result<(), String> {
    state.with(|c| library::set_link(c, file_id, &target, target_id, linked))
}

#[tauri::command]
fn text_preview(state: State<AppDb>, id: i64) -> Result<String, String> {
    state.with(|c| library::text_preview(c, &state.library, id))
}

// ---------- conexões (etapa 3) ----------

#[tauri::command]
fn link_ideas(state: State<AppDb>, a: i64, b: i64, linked: bool) -> Result<(), String> {
    state.with(|c| db::link_ideas(c, a, b, linked))
}

#[tauri::command]
fn list_idea_links(state: State<AppDb>) -> Result<Vec<(i64, i64)>, String> {
    state.with(db::list_idea_links)
}

// ---------- páginas (etapa 4) ----------

#[tauri::command]
fn list_pages(state: State<AppDb>) -> Result<Vec<Page>, String> {
    state.with(pages::list_pages)
}

#[tauri::command]
fn create_page(state: State<AppDb>, title: String, project_id: Option<i64>, doc: Option<String>) -> Result<Page, String> {
    state.with(|c| pages::create_page(c, &title, project_id, doc.as_deref()))
}

#[tauri::command]
fn update_page(state: State<AppDb>, id: i64, title: String, project_id: Option<i64>, doc: String) -> Result<Page, String> {
    state.with(|c| pages::update_page(c, id, &title, project_id, &doc))
}

#[tauri::command]
fn delete_page(state: State<AppDb>, id: i64) -> Result<(), String> {
    state.with(|c| pages::delete_page(c, id))
}

// ---------- exportação (etapa 5) e cópias de segurança ----------

#[tauri::command]
async fn export_page_html(app: AppHandle, path: String, html: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppDb>();
        state.with(|c| export::export_html(c, &state.library, Path::new(&path), &html))
    })
    .await
    .map_err(|e| format!("A exportação foi interrompida ({e})."))?
}

#[tauri::command]
async fn create_backup(app: AppHandle, parent: String, name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppDb>();
        state
            .with(|c| backup::create_backup(c, &state.library, Path::new(&parent), &name))
            .map(|p| p.display().to_string())
    })
    .await
    .map_err(|e| format!("A cópia foi interrompida ({e})."))?
}

/// Restaura a partir de uma pasta de cópia. O estado atual vai antes para `<dados>/backups/<safety_name>`.
#[tauri::command]
async fn restore_backup(app: AppHandle, source: String, safety_name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppDb>();
        let safety_parent = state.dir.join("backups");
        std::fs::create_dir_all(&safety_parent).map_err(|e| e.to_string())?;
        state
            .with_mut(|c| backup::restore_backup(c, &state.library, Path::new(&source), &safety_parent, &safety_name))
            .map(|p| p.display().to_string())
    })
    .await
    .map_err(|e| format!("A restauração foi interrompida ({e})."))?
}

fn open_db(dir: &Path) -> Result<AppDb, Box<dyn std::error::Error>> {
    std::fs::create_dir_all(dir)?;
    let library = dir.join("library");
    std::fs::create_dir_all(&library)?;
    Ok(AppDb {
        conn: Mutex::new(db::open(&dir.join("linkon.db"))?),
        dir: dir.to_path_buf(),
        library,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let state = open_db(&app.path().app_data_dir()?)?;
            app.manage(state);
            app.manage(ai::AiRuns::default());
            app.manage(image::ImageRun::default());
            app.manage(serve::LocalServer::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_ideas,
            get_idea,
            create_idea,
            update_idea,
            delete_idea,
            list_projects,
            create_project,
            rename_project,
            delete_project,
            data_dir,
            open_data_dir,
            import_files,
            sync_site,
            open_in_browser,
            open_sites_folder,
            sites_folder,
            prepare_publish,
            publish_site,
            open_published,
            vercel_status,
            generate_image,
            cancel_image,
            image_status,
            set_image_key,
            list_files,
            delete_file,
            set_file_link,
            text_preview,
            link_ideas,
            list_idea_links,
            list_pages,
            create_page,
            update_page,
            delete_page,
            export_page_html,
            create_backup,
            restore_backup,
            ai::ai_check,
            ai::ai_run,
            ai::ai_cancel
        ])
        .run(tauri::generate_context!())
        .expect("falha ao iniciar o Linkon");
}
