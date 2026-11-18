//! W2.4 — persistent browser session profiles.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileConfig {
    /// Directory holding cookies/localStorage across runs.
    pub user_data_dir: PathBuf,
    /// When true, no cookies are persisted.
    pub incognito: bool,
}

impl ProfileConfig {
    pub fn persistent(root: &Path, name: &str) -> Self {
        Self {
            user_data_dir: root.join(name),
            incognito: false,
        }
    }

    /// Chromium command-line flags for this profile.
    pub fn launch_args(&self) -> Vec<String> {
        let mut args = vec![format!(
            "--user-data-dir={}",
            self.user_data_dir.to_string_lossy()
        )];
        if self.incognito {
            args.push("--incognito".to_string());
        }
        args
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persistent_profile_uses_stable_dir() {
        let p = ProfileConfig::persistent(Path::new("C:/phantom/profiles"), "alice");
        assert_eq!(p.user_data_dir, PathBuf::from("C:/phantom/profiles/alice"));
        let expected = format!(
            "--user-data-dir={}",
            p.user_data_dir.to_string_lossy()
        );
        assert_eq!(p.launch_args(), vec![expected]);
    }

    #[test]
    fn incognito_adds_flag() {
        let mut p = ProfileConfig::persistent(Path::new("p"), "x");
        p.incognito = true;
        assert!(p.launch_args().iter().any(|a| a == "--incognito"));
    }
}
