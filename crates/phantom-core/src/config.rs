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
    /// Active LLM provider: claude | openai | gemini | ollama.
    pub provider: String,
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
}

impl Default for Config {
    fn default() -> Self {
        Config {
            provider: "claude".to_string(),
            llm_endpoint: String::new(),
            api_key: String::new(),
            mode: Mode::Safe,
            allowed_folders: default_allowed_folders(),
            grpc_endpoint: "http://127.0.0.1:50051".to_string(),
            max_iterations: 25,
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
