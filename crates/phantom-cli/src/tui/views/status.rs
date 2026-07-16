//! Top status bar.

use phantom_core::Mode;
use ratatui::style::{Color, Style};

pub fn status_line(mode: Mode, provider: &str, tasks: u32) -> String {
    format!(
        " Phantom v0.1.0  │  Mode: {}  │  LLM: {}  │  Tasks: {}  │  /help /settings /quit ",
        mode,
        provider.to_uppercase(),
        tasks
    )
}

pub fn status_style(mode: Mode) -> Style {
    match mode {
        Mode::Safe => Style::default().bg(Color::Green).fg(Color::Black),
        Mode::Hero => Style::default().bg(Color::Red).fg(Color::White),
    }
}
