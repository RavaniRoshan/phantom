//! W2.5 — semantic selector candidates exposed in observations.
//!
//! Prefer stable semantic hooks (aria-label, placeholder, name, id) over raw
//! coordinates so grounding survives layout changes.

/// Extract candidate CSS selectors from an HTML fragment, most stable first.
pub fn candidate_selectors(html: &str, limit: usize) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for attr in ["aria-label", "data-testid", "placeholder", "name", "id"] {
        let needle = format!("{attr}=\"");
        let mut rest = html;
        while let Some(pos) = rest.find(&needle) {
            let value_start = pos + needle.len();
            if let Some(end) = rest[value_start..].find('"') {
                let value = &rest[value_start..value_start + end];
                if !value.is_empty() {
                    let selector = format!("[{attr}=\"{value}\"]");
                    if !out.contains(&selector) {
                        out.push(selector);
                    }
                }
                rest = &rest[value_start + end + 1..];
            } else {
                break;
            }
        }
    }
    out.truncate(limit);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_semantic_attributes_and_dedupes() {
        let html = r#"<input id="q" name="q" placeholder="Search" aria-label="Search box"><button data-testid="go">Go</button>"#;
        let s = candidate_selectors(html, 10);
        assert_eq!(s[0], "[aria-label=\"Search box\"]");
        assert!(s.contains(&"[placeholder=\"Search\"]".to_string()));
        assert!(s.contains(&"[data-testid=\"go\"]".to_string()));
        let dedup_count = s.iter().filter(|x| *x == "[id=\"q\"]").count();
        assert_eq!(dedup_count, 1);
    }
}
