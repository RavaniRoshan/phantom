//! Helpers for rendering action/stream items.

use std::collections::HashMap;

/// Compact one-line summary of an action's parameters.
pub fn summarize_params(params: &HashMap<String, String>) -> String {
    if params.is_empty() {
        return String::new();
    }
    params
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join(" ")
}
