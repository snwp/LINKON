//! Validações da geração de imagens, sem Tauri, para rodarem nos testes (tests/db.rs).

const MAX_PROMPT_CHARS: usize = 4000;

pub fn check_prompt(prompt: &str) -> Result<String, String> {
    let p = prompt.trim();
    if p.is_empty() {
        return Err("Descreva a imagem que você quer.".into());
    }
    if p.chars().count() > MAX_PROMPT_CHARS {
        return Err("A descrição está longa demais.".into());
    }
    Ok(p.to_string())
}

/// Formato pedido na interface (quadrada, larga ou alta): tamanho da API e descrição para o Codex.
pub fn shape_info(shape: &str) -> Result<(&'static str, &'static str), String> {
    match shape {
        "square" => Ok(("1024x1024", "quadrada (1:1)")),
        "wide" => Ok(("1536x1024", "horizontal (3:2)")),
        "tall" => Ok(("1024x1536", "vertical (2:3)")),
        _ => Err("Formato de imagem desconhecido.".into()),
    }
}

/// Nome legível para a biblioteca, tirado do começo da descrição.
pub fn file_name_for(prompt: &str, ext: &str) -> String {
    let base: String = prompt
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(48)
        .collect();
    let base = base.trim();
    format!("{}.{ext}", if base.is_empty() { "imagem gerada" } else { base })
}

/// O id da conversa do Codex vira nome de pasta: só letras, números e hífen.
pub fn valid_thread_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

pub fn valid_key(key: &str) -> bool {
    key.starts_with("sk-") && (20..=300).contains(&key.len()) && key.chars().all(|c| c.is_ascii_graphic())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_come_from_the_prompt_and_stay_safe() {
        assert_eq!(file_name_for("Uma xícara de café, luz da manhã!", "png"), "Uma xícara de café luz da manhã.png");
        assert_eq!(file_name_for("../../etc/passwd", "png"), "etc passwd.png");
        assert_eq!(file_name_for("???", "png"), "imagem gerada.png");
        assert!(file_name_for(&"a".repeat(500), "png").chars().count() <= 52);
    }

    #[test]
    fn thread_ids_cannot_escape_the_folder() {
        assert!(valid_thread_id("01a21328-c1d3-72f3-ad0f-1079d080fbcf"));
        assert!(!valid_thread_id("../x"));
        assert!(!valid_thread_id(""));
        assert!(!valid_thread_id("a\\b"));
    }

    #[test]
    fn keys_and_inputs_are_checked() {
        assert!(valid_key("sk-proj-abcdefghijklmnopqrstuvwxyz"));
        assert!(!valid_key("sk-short"));
        assert!(!valid_key("chave sk-abcdefghijklmnopqrst"));
        assert!(check_prompt("   ").is_err());
        assert!(check_prompt(&"x".repeat(4001)).is_err());
        assert!(shape_info("banner").is_err());
    }
}
