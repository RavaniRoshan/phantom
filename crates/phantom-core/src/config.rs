use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Agent operating mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// Restricted folders, permission prompts before writes/exec.
    #[default]
    Safe,
    /// Full system access, no prompts.
    Hero,
}

impl std::fmt::Display for Mode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Mode::Safe => write!(f, "safe"),
            Mode::Hero => write!(f, "hero"),
        }
    }
}

impl std::str::FromStr for Mode {
    type Err = String;
    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s.trim().to_ascii_lowercase().as_str() {
            "safe" => Ok(Mode::Safe),
            "hero" => Ok(Mode::Hero),
            other => Err(format!("unknown mode '{other}' (expected 'safe' or 'hero')")),
        }
    }
}

/// Top-level Phantom configuration, persisted as TOML at `~/.phantom/config.toml`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    /// Active LLM provider: claude | openai | gemini | ollama | nvidia | mock.
    pub provider: String,
    /// Optional model override. Blank means "use the provider's default model".
    pub model: String,
    /// Override for the LLM provider base URL (used by Ollama / self-hosted).
    pub llm_endpoint: String,
    /// API key. Prefer supplying via env var `PHANTOM_API_KEY`; this falls back to the file.
    pub api_key: String,
    /// Operating mode.
    pub mode: Mode,
    /// Folders the agent may read/write when in Safe mode.
    pub allowed_folders: Vec<PathBuf>,
    /// Address of the Python gRPC LLM service.
    pub grpc_endpoint: String,
    /// Upper bound on DecideAction iterations per task.
    pub max_iterations: u32,
    /// Upper bound on concurrent workers the Master Planner may run at once.
    /// The effective count is further capped by available RAM (~2 GiB/worker).
    pub max_parallel_workers: u32,
    /// Confidence threshold (0..1) for the Phase D autonomy gate. In Safe
    /// mode an action the LLM is *less* confident than this about is paused
    /// for human approval (if a TUI is attached) or skipped (headless). Hero
    /// mode ignores the gate. `0.0` disables it (everything auto-runs).
    pub confidence_gate: f32,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            provider: "claude".to_string(),
            model: String::new(),
            llm_endpoint: String::new(),
            api_key: String::new(),
            mode: Mode::Safe,
            allowed_folders: default_allowed_folders(),
            grpc_endpoint: "http://127.0.0.1:50051".to_string(),
            max_iterations: 25,
            max_parallel_workers: 4,
            confidence_gate: 0.95,
        }
    }
}

impl Config {
    /// Path to the config file: `~/.phantom/config.toml`.
    pub fn path() -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".phantom")
            .join("config.toml")
    }

    /// Load config from `path`, filling any missing fields with defaults.
    /// If the file does not exist, returns the default config (and does not write it).
    pub fn load(path: &Path) -> crate::Result<Self> {
        if !path.exists() {
            return Ok(Config::default());
        }
        let text = std::fs::read_to_string(path)
            .map_err(|e| crate::PhantomError::Config(format!("reading {}: {e}", path.display())))?;
        let mut cfg: Config = toml::from_str(&text)
            .map_err(|e| crate::PhantomError::Config(e.to_string()))?;
        cfg.normalize();
        Ok(cfg)
    }

    /// Persist the config to `path`, creating parent directories.
    pub fn save(&self, path: &Path) -> crate::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let text = toml::to_string_pretty(self)
            .map_err(|e| crate::PhantomError::Config(e.to_string()))?;
        std::fs::write(path, text)
            .map_err(|e| crate::PhantomError::Config(format!("writing {}: {e}", path.display())))?;
        Ok(())
    }

    /// Resolve the API key: prefer the env var, then the file value.
    pub fn resolved_api_key(&self) -> String {
        std::env::var("PHANTOM_API_KEY").unwrap_or_else(|_| self.api_key.clone())
    }

    /// Fill empty fields with defaults so a partially-written TOML is usable.
    fn normalize(&mut self) {
        if self.provider.is_empty() {
            self.provider = "claude".to_string();
        }
        if self.grpc_endpoint.is_empty() {
            self.grpc_endpoint = "http://127.0.0.1:50051".to_string();
        }
        if self.max_iterations == 0 {
            self.max_iterations = 25;
        }
        if self.max_parallel_workers == 0 {
            self.max_parallel_workers = 4;
        }
        // Clamp the autonomy gate into [0, 1]; out-of-range means "disabled".
        if !self.confidence_gate.is_finite() {
            self.confidence_gate = 0.0;
        } else if self.confidence_gate < 0.0 {
            self.confidence_gate = 0.0;
        } else if self.confidence_gate > 1.0 {
            self.confidence_gate = 1.0;
        }
        if self.allowed_folders.is_empty() {
            self.allowed_folders = default_allowed_folders();
        }
    }
}

/// Sensible Safe-mode roots: Downloads, Documents, Desktop, and a Phantom work dir.
fn default_allowed_folders() -> Vec<PathBuf> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let mut folders = Vec::new();
    if let Some(d) = dirs::download_dir() {
        folders.push(d);
    }
    if let Some(d) = dirs::document_dir() {
        folders.push(d);
    }
    if let Some(d) = dirs::desktop_dir() {
        folders.push(d);
    }
    folders.push(home.join("phantom-work"));
    folders
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_field_round_trips_through_toml() {
        let mut cfg = Config::default();
        cfg.provider = "nvidia".to_string();
        cfg.model = "meta/llama-3.2-90b-vision-instruct".to_string();
        cfg.mode = Mode::Hero;

        let path = std::env::temp_dir().join("phantom-config-test.toml");
        let _ = std::fs::remove_file(&path);
        cfg.save(&path).expect("save");
        let loaded = Config::load(&path).expect("load");

        assert_eq!(loaded.provider, "nvidia");
        assert_eq!(loaded.model, "meta/llama-3.2-90b-vision-instruct");
        assert_eq!(loaded.mode, Mode::Hero);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn missing_file_returns_default() {
        let path = std::env::temp_dir().join("phantom-config-does-not-exist.toml");
        let _ = std::fs::remove_file(&path);
        let cfg = Config::load(&path).expect("load default");
        assert_eq!(cfg.provider, "claude");
        assert!(cfg.model.is_empty());
    }

    #[test]
    fn confidence_gate_round_trips_and_clamps() {
        let mut cfg = Config::default();
        cfg.confidence_gate = 0.8;
        let path = std::env::temp_dir().join("phantom-gate.toml");
        let _ = std::fs::remove_file(&path);
        cfg.save(&path).expect("save");
        let loaded = Config::load(&path).expect("load");
        assert_eq!(loaded.confidence_gate, 0.8);

        // Out-of-range values are clamped into [0, 1] on load.
        let mut bad = Config::default();
        bad.confidence_gate = 5.0;
        bad.normalize();
        assert_eq!(bad.confidence_gate, 1.0);
        bad.confidence_gate = -1.0;
        bad.normalize();
        assert_eq!(bad.confidence_gate, 0.0);
        let _ = std::fs::remove_file(&path);
    }
}

