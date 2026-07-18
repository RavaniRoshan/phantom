//! Single-line input widget with a visible cursor.

use crate::tui::app::View;
use ratatui::layout::Rect;
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};

pub fn render_input(f: &mut ratatui::Frame, area: Rect, input: &str, cursor: usize, view: View) {
    let prompt = match view {
        View::Chat => "❯ ",
        View::Settings => "/settings ",
        View::Help => "/help ",
        View::Approval => "/approve ",
    };

    let chars: Vec<char> = input.chars().collect();
    let mut spans = vec![Span::raw(prompt)];
    for (i, ch) in chars.iter().enumerate() {
        if i == cursor {
            spans.push(Span::styled(
                ch.to_string(),
                Style::default().bg(Color::White).fg(Color::Black),
            ));
        } else {
            spans.push(Span::raw(ch.to_string()));
        }
    }
    if cursor >= chars.len() {
        spans.push(Span::styled(
            " ",
            Style::default().bg(Color::White).fg(Color::Black),
        ));
    }

    let p = Paragraph::new(Line::from(spans)).block(Block::default().borders(Borders::ALL));
    f.render_widget(p, area);
}
