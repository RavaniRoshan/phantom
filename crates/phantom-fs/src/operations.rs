//! Cross-platform file operations + ripgrep-powered content search.

use crate::error::{FsError, Result};
use std::path::Path;

/// Read a file to a string.
pub fn read_file(path: &Path) -> Result<String> {
    Ok(std::fs::read_to_string(path)?)
}

/// Write a file, creating parent directories as needed.
pub fn write_file(path: &Path, content: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    std::fs::write(path, content)?;
    Ok(())
}

/// Copy a file (creating parent dirs of the destination).
pub fn copy_file(from: &Path, to: &Path) -> Result<()> {
    if let Some(parent) = to.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    std::fs::copy(from, to)?;
    Ok(())
}

/// Move a file.
pub fn move_file(from: &Path, to: &Path) -> Result<()> {
    copy_file(from, to)?;
    delete_file(from)?;
    Ok(())
}

/// Delete a file or directory tree.
pub fn delete_file(path: &Path) -> Result<()> {
    if path.is_dir() {
        std::fs::remove_dir_all(path)?;
    } else {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

/// List the immediate children of a directory.
pub fn list_dir(path: &Path) -> Result<Vec<String>> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(path)? {
        out.push(entry?.path().display().to_string());
    }
    Ok(out)
}

/// Recursively search file contents under `root` for `pattern` (ripgrep engine).
pub fn search_content(pattern: &str, root: &Path) -> Result<Vec<String>> {
    use grep::regex::RegexMatcher;
    use grep::searcher::sinks::UTF8;
    use grep::searcher::Searcher;

    let matcher =
        RegexMatcher::new(pattern).map_err(|e| FsError::Search(e.to_string()))?;
    let mut out: Vec<String> = Vec::new();

    for entry in walkdir::WalkDir::new(root)
        .into_iter()
        .filter_map(std::result::Result::ok)
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        Searcher::new()
            .search_path(&matcher, path, UTF8(|_line_num, line| {
                out.push(format!("{}: {}", path.display(), line));
                Ok(true)
            }))
            .map_err(|e| FsError::Search(e.to_string()))?;
    }
    Ok(out)
}
