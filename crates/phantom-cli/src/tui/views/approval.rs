//! HITL approval queue view (V3 Phase D).
//!
//! Rendered automatically when one or more actions are paused below the
//! confidence gate. The operator resolves each (approve / reject) with the
//! keyboard; resolving unblocks the agent awaiting a verdict on the other
//! side of the shared queue.

use crate::tui::widgets::summarize_params;
use phantom_core::PendingApproval;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};

/// Render the approval queue. `selected` is the highlighted request.
pub fn render_approval(
    f: &mut ratatui::Frame,
    area: Rect,
    pending: &[PendingApproval],
    selected: usize,
) {
    let mut lines: Vec<Line> = Vec::new();
    lines.push(Line::from(Span::styled(
        "Approval Queue — ↑/↓ select · Enter approve · r reject · a approve all · x reject all · Esc later",
        Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
    )));

    if pending.is_empty() {
        lines.push(Line::from(Span::styled(
            "(queue drained — returning to chat)",
            Style::default().fg(Color::DarkGray),
        )));
    }

    for (i, p) in pending.iter().enumerate() {
        let is_sel = i == selected;
        let marker = if is_sel { "▶ " } else { "  " };
        let pct = (p.action.confidence * 100.0) as i32;
        // Confidence bar: 10 cells filled to the percentage.
        let filled = (p.action.confidence * 10.0).round().clamp(0.0, 10.0) as usize;
        let bar: String = format!(
            "[{}{}]",
            "█".repeat(filled),
            "·".repeat(10 - filled)
        );
        // Color the row by whether it is selected (cyan) — confidence is shown
        // numerically + bar so the operator can judge each action.
        let head_style = if is_sel {
            Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(Color::White)
        };
        lines.push(Line::from(vec![
            Span::raw(marker),
            Span::styled(
                format!("{} {} {}", p.action.action_type, p.action.action, bar),
                head_style,
            ),
            Span::styled(format!(" {pct}%"), Style::default().fg(Color::Magenta)),
        ]));
        // Params + reasoning on an indented sub-line.
        let params = summarize_params(&p.action.params);
        let mut sub = format!("    {params}");
        if !p.action.reasoning.is_empty() {
            sub.push_str(&format!(" — {}", p.action.reasoning));
        }
        lines.push(Line::from(Span::styled(
            sub,
            Style::default().fg(if is_sel { Color::Gray } else { Color::DarkGray }),
        )));
    }

    let p = Paragraph::new(lines)
        .block(Block::default().borders(Borders::ALL).title(" Approval "))
        .style(Style::default().fg(Color::Gray))
        .wrap(Wrap { trim: false });
    f.render_widget(p, area);
}
