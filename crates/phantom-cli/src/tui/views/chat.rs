//! Chat transcript + help views.

use crate::tui::app::{action_line, Msg};
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};

/// Render the scrollable chat transcript.
pub fn render_chat(f: &mut ratatui::Frame, area: Rect, messages: &[Msg], scroll: u16) {
    let lines: Vec<Line> = messages.iter().flat_map(msg_to_lines).collect();
    let p = Paragraph::new(lines)
        .block(Block::default().borders(Borders::ALL).title(" Chat "))
        .style(Style::default().fg(Color::Gray))
        .wrap(Wrap { trim: false })
        .scroll((scroll, 0));
    f.render_widget(p, area);
}

fn msg_to_lines(msg: &Msg) -> Vec<Line<'static>> {
    match msg {
        Msg::User(s) => vec![Line::from(Span::styled(
            format!("❯ {s}"),
            Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD),
        ))],
        Msg::Agent(s) => wrap(s, Color::White),
        Msg::System(s) => wrap(&format!("· {s}"), Color::Yellow),
        Msg::Error(s) => vec![Line::from(Span::styled(
            format!("✗ ERROR: {s}"),
            Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
        ))],
        Msg::Thinking(text, phase) => wrap(&format!("[{}] {}", phase, text), Color::Magenta),
        Msg::Plan(steps) => {
            let mut out = vec![Line::from(
                Span::styled("Plan:", Style::default().fg(Color::Green).add_modifier(Modifier::BOLD)),
            )];
            for s in steps {
                out.push(Line::from(Span::styled(
                    format!("  {}. [{}] {}", s.order, s.backend, s.description),
                    Style::default().fg(Color::Green),
                )));
            }
            out
        }
        Msg::Action(a) => vec![action_line(a)],
    }
}

/// Render the help screen.
pub fn render_help(f: &mut ratatui::Frame, area: Rect) {
    let text = "\
Phantom commands
─────────────────────────────────────────────
/help            show this help
/settings        open the settings page
/safe            switch to Safe mode (restricted)
/hero            switch to Hero mode (full access)
/provider <name> set LLM provider (claude|openai|gemini|ollama|mock|nvidia)
/mode <safe|hero> switch mode
/clear           clear the transcript
/quit            exit Phantom
─────────────────────────────────────────────
Type a task in plain language and Phantom will
plan and (in later phases) execute it for you.";
    let lines: Vec<Line> = text.lines().map(|l| Line::from(l.to_string())).collect();
    let p = Paragraph::new(lines)
        .block(Block::default().borders(Borders::ALL).title(" Help "))
        .wrap(Wrap { trim: false });
    f.render_widget(p, area);
}

/// Wrap a single block of text into one styled line (Paragraph handles wrapping).
fn wrap(text: &str, color: Color) -> Vec<Line<'static>> {
    vec![Line::from(Span::styled(text.to_string(), Style::default().fg(color)))]
}
