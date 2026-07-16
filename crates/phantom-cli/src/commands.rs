//! Slash-command parsing for the TUI.

#[derive(Debug, Clone, PartialEq)]
pub enum Command {
    Help,
    Settings,
    Safe,
    Hero,
    Clear,
    Quit,
    Provider(String),
    Mode(String),
    /// Unknown/unhandled command with its raw text (surfaced to the user).
    Unknown(String),
}

/// Parse a `/...` input line into a [`Command`].
pub fn parse_command(raw: &str) -> Command {
    let trimmed = raw.trim();
    if !trimmed.starts_with('/') {
        return Command::Unknown(trimmed.to_string());
    }
    let body = &trimmed[1..];
    let mut parts = body.splitn(2, ' ');
    let name = parts.next().unwrap_or("").to_ascii_lowercase();
    let arg = parts.next().map(|s| s.trim().to_string()).unwrap_or_default();

    match name.as_str() {
        "help" => Command::Help,
        "settings" => Command::Settings,
        "safe" => Command::Safe,
        "hero" => Command::Hero,
        "clear" => Command::Clear,
        "quit" | "exit" => Command::Quit,
        "provider" if !arg.is_empty() => Command::Provider(arg),
        "mode" if !arg.is_empty() => Command::Mode(arg),
        _ => Command::Unknown(trimmed.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_known_commands() {
        assert_eq!(parse_command("/help"), Command::Help);
        assert_eq!(parse_command("/safe"), Command::Safe);
        assert_eq!(parse_command("/hero"), Command::Hero);
        assert_eq!(parse_command("/clear"), Command::Clear);
        assert_eq!(parse_command("/quit"), Command::Quit);
        assert_eq!(parse_command("/provider openai"), Command::Provider("openai".into()));
        assert_eq!(parse_command("/mode hero"), Command::Mode("hero".into()));
    }

    #[test]
    fn non_slash_is_unknown() {
        assert!(matches!(parse_command("do a thing"), Command::Unknown(_)));
    }
}
