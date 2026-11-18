//! W5.3 / W7.4 — task-scoped artifacts with reversible file mutations.

use anyhow::Result;
use std::fs;
use std::path::{Path, PathBuf};

/// Output folder for one task: `<root>/<task-id>/`.
pub struct ArtifactStore {
    root: PathBuf,
}

impl ArtifactStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn task_dir(&self, task_id: &str) -> PathBuf {
        self.root.join(task_id)
    }

    pub fn prepare(&self, task_id: &str) -> Result<PathBuf> {
        let dir = self.task_dir(task_id);
        fs::create_dir_all(&dir)?;
        Ok(dir)
    }

    pub fn record(&self, task_id: &str, name: &str, bytes: &[u8]) -> Result<PathBuf> {
        let dir = self.prepare(task_id)?;
        let path = dir.join(name);
        fs::write(&path, bytes)?;
        Ok(path)
    }

    pub fn list(&self, task_id: &str) -> Result<Vec<PathBuf>> {
        let dir = self.task_dir(task_id);
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        for entry in fs::read_dir(dir)? {
            out.push(entry?.path());
        }
        out.sort();
        Ok(out)
    }
}

/// Move a file to a task-scoped trash folder instead of deleting it (W7.4).
pub fn trash_file(root: &Path, task_id: &str, path: &Path) -> Result<PathBuf> {
    let trash = root.join(task_id).join("trash");
    fs::create_dir_all(&trash)?;
    let name = path
        .file_name()
        .ok_or_else(|| anyhow::anyhow!("cannot trash a path without a file name"))?;
    let dest = trash.join(name);
    if path.exists() {
        fs::rename(path, &dest)?;
    }
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("phantom-artifacts-{}-{name}", std::process::id()))
    }

    #[test]
    fn artifacts_are_task_scoped_and_listable() {
        let root = tmp("scope");
        let _ = fs::remove_dir_all(&root);
        let store = ArtifactStore::new(&root);
        store.record("task-1", "a.txt", b"hello").unwrap();
        store.record("task-2", "b.txt", b"world").unwrap();
        assert_eq!(store.list("task-1").unwrap().len(), 1);
        assert_eq!(store.list("task-2").unwrap().len(), 1);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn trash_is_reversible() {
        let root = tmp("trash");
        let _ = fs::remove_dir_all(&root);
        let dir = root.join("task-1");
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("note.txt");
        fs::write(&file, "keep me").unwrap();
        let trashed = trash_file(&root, "task-1", &file).unwrap();
        assert!(!file.exists());
        assert!(trashed.exists());
        assert_eq!(fs::read_to_string(trashed).unwrap(), "keep me");
        let _ = fs::remove_dir_all(&root);
    }
}
