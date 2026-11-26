//! Servidor local de "Ver no navegador": entrega só a pasta Documentos/Linkon, só em 127.0.0.1, com a mesma
//! política de segurança do site publicado. Sobe na primeira vez que é pedido e fica até o app fechar.

use crate::site::{CSP, content_type, safe_path};
use std::path::PathBuf;
use std::sync::Mutex;
use tiny_http::{Header, Method, Response, Server};

#[derive(Default)]
pub struct LocalServer {
    port: Mutex<Option<u16>>,
}

fn header(k: &str, v: &str) -> Header {
    Header::from_bytes(k.as_bytes(), v.as_bytes()).expect("cabeçalho fixo e válido")
}

impl LocalServer {
    /// Porta do servidor, subindo-o se ainda não estiver no ar.
    pub fn port(&self, root: PathBuf) -> Result<u16, String> {
        let mut slot = self.port.lock().map_err(|e| e.to_string())?;
        if let Some(p) = *slot {
            return Ok(p);
        }
        let server = Server::http("127.0.0.1:0").map_err(|e| format!("Não foi possível abrir o servidor local ({e})."))?;
        let port = server.server_addr().to_ip().map(|a| a.port()).ok_or("O servidor local não abriu uma porta.")?;
        std::thread::spawn(move || {
            for req in server.incoming_requests() {
                // Só aceita o próprio endereço como Host: outra página da internet não consegue apontar um
                // nome dela para 127.0.0.1 e ler os sites por aqui (DNS rebinding).
                let host_ok = req.headers().iter().any(|h| {
                    h.field.equiv("Host") && {
                        let v = h.value.as_str();
                        v == format!("127.0.0.1:{port}") || v == format!("localhost:{port}")
                    }
                });
                let path = (host_ok && matches!(req.method(), Method::Get | Method::Head))
                    .then(|| safe_path(&root, req.url()))
                    .flatten();
                let resp = match path.and_then(|p| std::fs::read(&p).ok().map(|b| (p, b))) {
                    Some((p, bytes)) => Response::from_data(bytes)
                        .with_header(header("Content-Type", content_type(&p)))
                        .with_header(header("Content-Security-Policy", CSP))
                        .with_header(header("X-Content-Type-Options", "nosniff"))
                        .with_header(header("Cache-Control", "no-store")),
                    None => Response::from_string("Não encontrado.").with_status_code(404),
                };
                let _ = req.respond(resp);
            }
        });
        *slot = Some(port);
        Ok(port)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;

    fn get(port: u16, host: &str, path: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(s, "GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n").unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        out
    }

    #[test]
    fn serves_only_the_sites_folder_to_its_own_host() {
        let base = std::env::temp_dir().join(format!("linkon-serve-{}", std::process::id()));
        let root = base.join("Linkon");
        std::fs::create_dir_all(root.join("loja").join("inicio")).unwrap();
        std::fs::write(root.join("loja").join("inicio").join("index.html"), "<p>oi</p>").unwrap();
        std::fs::write(root.join("loja").join("inicio").join(".linkon"), "x").unwrap();
        std::fs::write(base.join("segredo.txt"), "nao").unwrap();

        let port = LocalServer::default().port(root.clone()).unwrap();
        let me = format!("127.0.0.1:{port}");
        let ok = get(port, &me, "/loja/inicio/");
        assert!(ok.starts_with("HTTP/1.1 200") && ok.contains("<p>oi</p>"));
        assert!(ok.contains("Content-Security-Policy: default-src 'none'"));
        assert!(get(port, &format!("localhost:{port}"), "/loja/inicio/index.html").starts_with("HTTP/1.1 200"));
        assert!(get(port, &format!("evil.example:{port}"), "/loja/inicio/").starts_with("HTTP/1.1 404"));
        assert!(get(port, &me, "/../segredo.txt").starts_with("HTTP/1.1 404"));
        assert!(get(port, &me, "/loja/%2e%2e/%2e%2e/segredo.txt").starts_with("HTTP/1.1 404"));
        assert!(get(port, &me, "/loja/inicio/.linkon").starts_with("HTTP/1.1 404"));
        let _ = std::fs::remove_dir_all(&base);
    }
}
