//! W2.1 — bounded HTML → Markdown-ish text extraction.
//!
//! Page context must be capped (≤ 8k tokens by default) and carry an explicit
//! truncation marker so the model never thinks it saw the whole page.

/// Default token cap for page context.
pub const DEFAULT_MAX_TOKENS: usize = 8_000;
/// Marker appended whenever content was truncated.
pub const TRUNCATION_MARKER: &str = "\n[… truncated by Phantom context budget]";

/// Approximate token count (4 characters per token) — deliberately cheap.
pub fn approx_tokens(text: &str) -> usize {
    (text.chars().count() + 3) / 4
}

fn strip_block(html: &str, tag: &str, out: &mut String) {
    let mut rest = html;
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    while let Some(start) = rest.to_ascii_lowercase().find(&open) {
        out.push_str(&rest[..start]);
        if let Some(end_rel) = rest[start..].to_ascii_lowercase().find(&close) {
            let end = start + end_rel + close.len();
            rest = &rest[end..];
        } else {
            rest = "";
            break;
        }
    }
    out.push_str(rest);
}

fn decode_entities(s: &str) -> String {
    s.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

/// Convert a page's HTML into compact, bounded text suitable for model context.
pub fn html_to_context(html: &str, max_tokens: usize) -> String {
    let mut cleaned = String::with_capacity(html.len());
    strip_block(html, "script", &mut cleaned);
    let mut without_style = String::with_capacity(cleaned.len());
    strip_block(&cleaned, "style", &mut without_style);

    let mut text = String::with_capacity(without_style.len());
    let mut in_tag = false;
    let mut pending_break = false;
    for ch in without_style.chars() {
        match ch {
            '<' => {
                in_tag = true;
                pending_break = true;
            }
            '>' => {
                in_tag = false;
                if pending_break {
                    text.push('\n');
                    pending_break = false;
                }
            }
            _ if in_tag => {}
            '\n' | '\r' => {
                if !text.ends_with('\n') {
                    text.push('\n');
                }
            }
            _ => {
                text.push(ch);
                pending_break = false;
            }
        }
    }
    let text = decode_entities(&text);
    let mut lines: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    lines.dedup();
    let joined = lines.join("\n");

    if approx_tokens(&joined) <= max_tokens {
        return joined;
    }
    let char_cap = max_tokens * 4;
    let mut cut = 0usize;
    let mut byte_end = 0usize;
    for (idx, ch) in joined.char_indices() {
        if cut >= char_cap {
            break;
        }
        cut += 1;
        byte_end = idx + ch.len_utf8();
    }
    let mut out = joined[..byte_end].to_string();
    out.push_str(TRUNCATION_MARKER);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_scripts_styles_and_tags() {
        let html = "<html><script>alert('x')</script><style>p{}</style><body><h1>Hello</h1><p>World &amp; more</p></body></html>";
        let out = html_to_context(html, DEFAULT_MAX_TOKENS);
        assert!(out.contains("Hello"));
        assert!(out.contains("World & more"));
        assert!(!out.contains("alert"));
        assert!(!out.contains("<h1>"));
    }

    #[test]
    fn caps_context_and_marks_truncation() {
        let html = format!("<p>{}</p>", "word ".repeat(40_000));
        let out = html_to_context(&html, 100);
        assert!(out.contains(TRUNCATION_MARKER));
        assert!(approx_tokens(&out) <= 100 + 16);
    }
}
