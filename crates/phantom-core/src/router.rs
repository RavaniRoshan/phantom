//! Maps an action's backend to the Rust crate that implements it.

/// The crate responsible for a given backend label.
pub fn route_for(action_type: &str) -> &'static str {
    match action_type {
        "browser" => "phantom-browser",
        "file" | "cli" => "phantom-fs",
        "desktop" => "phantom-desktop",
        _ => "unknown",
    }
}
