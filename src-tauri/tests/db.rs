// Os testes do backend moram em src/ e rodam aqui, num binário que não liga o Tauri.
// No Windows (toolchain GNU), o binário de teste da lib, que liga o Tauri, aborta com STATUS_ENTRYPOINT_NOT_FOUND.
#[allow(dead_code)]
#[path = "../src/db.rs"]
mod db;

#[allow(dead_code)]
#[path = "../src/library.rs"]
mod library;

#[allow(dead_code)]
#[path = "../src/pages.rs"]
mod pages;

#[allow(dead_code)]
#[path = "../src/export.rs"]
mod export;

#[allow(dead_code)]
#[path = "../src/backup.rs"]
mod backup;

#[allow(dead_code)]
#[path = "../src/imgcheck.rs"]
mod imgcheck;

#[allow(dead_code)]
#[path = "../src/site.rs"]
mod site;

#[allow(dead_code)]
#[path = "../src/publish.rs"]
mod publish;

#[allow(dead_code)]
#[path = "../src/serve.rs"]
mod serve;

#[allow(dead_code)]
#[path = "../src/aiconf.rs"]
mod aiconf;
