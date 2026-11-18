//! W3 — local run store (SQLite) and tamper-evident audit log.

use anyhow::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RunRecord {
    pub id: String,
    pub task: String,
    pub status: String,
    pub outcome: String,
    pub created_at: String,
}

/// SQLite-backed run store with idempotent migrations.
pub struct RunStore {
    conn: Connection,
}

impl RunStore {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                task TEXT NOT NULL,
                status TEXT NOT NULL,
                outcome TEXT NOT NULL,
                created_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS steps (
                task_id TEXT NOT NULL,
                idx INTEGER NOT NULL,
                action TEXT NOT NULL,
                result_hash TEXT NOT NULL,
                PRIMARY KEY (task_id, idx)
             );
             CREATE TABLE IF NOT EXISTS artifacts (
                task_id TEXT NOT NULL,
                path TEXT NOT NULL,
                PRIMARY KEY (task_id, path)
             );",
        )?;
        Ok(Self { conn })
    }

    pub fn insert_task(&self, run: &RunRecord) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO tasks (id, task, status, outcome, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![run.id, run.task, run.status, run.outcome, run.created_at],
        )?;
        Ok(())
    }

    pub fn record_step(&self, task_id: &str, idx: usize, action: &str, result: &str) -> Result<()> {
        let mut hasher = Sha256::new();
        hasher.update(result.as_bytes());
        let hash = hex::encode(hasher.finalize());
        self.conn.execute(
            "INSERT OR REPLACE INTO steps (task_id, idx, action, result_hash) VALUES (?1, ?2, ?3, ?4)",
            params![task_id, idx as i64, action, hash],
        )?;
        Ok(())
    }

    pub fn add_artifact(&self, task_id: &str, path: &str) -> Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO artifacts (task_id, path) VALUES (?1, ?2)",
            params![task_id, path],
        )?;
        Ok(())
    }

    pub fn history(&self, limit: usize) -> Result<Vec<RunRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, task, status, outcome, created_at FROM tasks ORDER BY created_at DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map([limit as i64], |row| {
            Ok(RunRecord {
                id: row.get(0)?,
                task: row.get(1)?,
                status: row.get(2)?,
                outcome: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn step_count(&self, task_id: &str) -> Result<usize> {
        Ok(self.conn.query_row(
            "SELECT COUNT(*) FROM steps WHERE task_id = ?1",
            [task_id],
            |r| r.get::<_, i64>(0),
        )? as usize)
    }
}

/// Append-only JSONL audit log with a SHA-256 hash chain.
pub struct AuditLog {
    path: PathBuf,
    last_hash: String,
}

impl AuditLog {
    pub const GENESIS: &'static str = "0000000000000000000000000000000000000000000000000000000000000000";

    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut last_hash = Self::GENESIS.to_string();
        if path.exists() {
            for line in BufReader::new(fs::File::open(path)?).lines() {
                let line = line?;
                if let Ok(entry) = serde_json::from_str::<AuditEntry>(&line) {
                    last_hash = entry.hash;
                }
            }
        }
        Ok(Self {
            path: path.to_path_buf(),
            last_hash,
        })
    }

    pub fn append(&mut self, task_id: &str, action: &str, params_hash: &str, result: &str) -> Result<String> {
        let mut hasher = Sha256::new();
        hasher.update(self.last_hash.as_bytes());
        hasher.update(task_id.as_bytes());
        hasher.update(action.as_bytes());
        hasher.update(params_hash.as_bytes());
        hasher.update(result.as_bytes());
        let hash = hex::encode(hasher.finalize());
        let entry = AuditEntry {
            task_id: task_id.to_string(),
            action: action.to_string(),
            params_hash: params_hash.to_string(),
            result: result.to_string(),
            prev: self.last_hash.clone(),
            hash: hash.clone(),
        };
        let mut file = OpenOptions::new().create(true).append(true).open(&self.path)?;
        writeln!(file, "{}", serde_json::to_string(&entry)?)?;
        self.last_hash = hash.clone();
        Ok(hash)
    }

    /// Verify the chain and return the number of entries checked.
    pub fn verify(&self) -> Result<usize> {
        let mut prev = Self::GENESIS.to_string();
        let mut count = 0usize;
        for line in BufReader::new(fs::File::open(&self.path)?).lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            let entry: AuditEntry = serde_json::from_str(&line)?;
            let mut hasher = Sha256::new();
            hasher.update(prev.as_bytes());
            hasher.update(entry.task_id.as_bytes());
            hasher.update(entry.action.as_bytes());
            hasher.update(entry.params_hash.as_bytes());
            hasher.update(entry.result.as_bytes());
            let expected = hex::encode(hasher.finalize());
            anyhow::ensure!(entry.prev == prev, "audit chain prev mismatch at entry {count}");
            anyhow::ensure!(entry.hash == expected, "audit chain hash mismatch at entry {count}");
            prev = entry.hash;
            count += 1;
        }
        Ok(count)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuditEntry {
    task_id: String,
    action: String,
    params_hash: String,
    result: String,
    prev: String,
    hash: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("phantom-store-{}-{name}", std::process::id()))
    }

    #[test]
    fn run_store_persists_history() {
        let path = temp("runs.sqlite");
        let _ = fs::remove_file(&path);
        let store = RunStore::open(&path).unwrap();
        let run = RunRecord {
            id: "task-1".into(),
            task: "do thing".into(),
            status: "done".into(),
            outcome: "Completed".into(),
            created_at: "2026-11-18T00:00:00Z".into(),
        };
        store.insert_task(&run).unwrap();
        store.record_step("task-1", 0, "browser/navigate", "ok").unwrap();
        assert_eq!(store.history(10).unwrap()[0].id, "task-1");
        assert_eq!(store.step_count("task-1").unwrap(), 1);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn audit_log_detects_tampering() {
        let path = temp("audit.jsonl");
        let _ = fs::remove_file(&path);
        let mut log = AuditLog::open(&path).unwrap();
        log.append("t1", "cli/run_command", "abc", "ok").unwrap();
        log.append("t1", "file/write_file", "def", "ok").unwrap();
        assert_eq!(log.verify().unwrap(), 2);

        let mut text = fs::read_to_string(&path).unwrap();
        text = text.replacen("\"result\":\"ok\"", "\"result\":\"TAMPERED\"", 1);
        fs::write(&path, text).unwrap();
        assert!(AuditLog::verify(&AuditLog::open(&path).unwrap()).is_err());
        let _ = fs::remove_file(&path);
    }
}
