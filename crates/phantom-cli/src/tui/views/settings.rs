//! Editable settings form.

use phantom_core::Config;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};

/// Settings form fields, in display order. Indices must match the field
/// handling in `app.rs` (`settings_field_value` / `commit_settings_field`).
pub const SETTINGS_FIELDS: &[(&str, &str)] = &[
    ("provider", "LLM provider (claude|openai|gemini|ollama|mock)"),
    ("mode", "Operating mode (safe|hero)"),
    ("llm_endpoint", "LLM base URL (Ollama / self-hosted)"),
    ("api_key", "API key (or set env PHANTOM_API_KEY)"),
    ("grpc_endpoint", "gRPC LLM service address"),
    ("max_iterations", "Max DecideAction iterations per task"),
    ("allowed_folders", "Safe-mode folders (;-separated)"),
];
pub const SETTINGS_FIELD_COUNT: usize = SETTINGS_FIELDS.len();

pub fn render_settings(
    f: &mut ratatui::Frame,
    area: Rect,
    config: &Config,
    selected: usize,
    edit: Option<&str>,
    edit_cursor: usize,
) {
    let key_hint = if config.resolved_api_key().is_empty() {
        "(not set)"
    } else {
        "(set)"
    };
    let masked = "****";

    // Resolve each field's display value.
    let values: Vec<String> = vec![
        config.provider.clone(),
        config.mode.to_string(),
        config.llm_endpoint.clone(),
        if config.api_key.is_empty() {
            key_hint.to_string()
        } else {
            masked.to_string()
        },
        config.grpc_endpoint.clone(),
        config.max_iterations.to_string(),
        config
            .allowed_folders
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join("; "),
    ];

    let mut lines: Vec<Line> = Vec::new();
    lines.push(Line::from(Span::styled(
        "Settings — ↑/↓ select · Enter edit · s save · Esc back",
        Style::default().fg(Color::Green).add_modifier(Modifier::BOLD),
    )));

    for (i, (name, desc)) in SETTINGS_FIELDS.iter().enumerate() {
        let is_sel = i == selected;
        let marker = if is_sel { "▶ " } else { "  " };
        let name_style = if is_sel {
            Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(Color::Cyan)
        };
        lines.push(Line::from(vec![
            Span::raw(marker),
            Span::styled(format!("{name}"), name_style),
            Span::styled(format!(" — {desc}"), Style::default().fg(Color::DarkGray)),
        ]));

        // Value line: show the live edit buffer (with cursor) when editing.
        let value_line = if is_sel {
            if let Some(buf) = edit {
                render_edit_buffer(buf, edit_cursor)
            } else {
                format!("    {}", values[i])
            }
        } else {
            format!("    {}", values[i])
        };
        lines.push(Line::from(Span::styled(
            value_line,
            Style::default().fg(if is_sel { Color::White } else { Color::Gray }),
        )));
    }

    let p = Paragraph::new(lines)
        .block(Block::default().borders(Borders::ALL).title(" Settings "))
        .style(Style::default().fg(Color::Gray))
        .wrap(Wrap { trim: false });
    f.render_widget(p, area);
}

/// Render the edit buffer with a block cursor at `cursor`.
fn render_edit_buffer(buf: &str, cursor: usize) -> String {
    let chars: Vec<char> = buf.chars().collect();
    let mut out = String::from("    ");
    for (i, ch) in chars.iter().enumerate() {
        if i == cursor {
            out.push('█'); // block cursor
        }
        out.push(*ch);
    }
    if cursor >= chars.len() {
        out.push('█');
    }
    out
}
