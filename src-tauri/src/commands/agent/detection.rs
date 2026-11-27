use super::{AgentCommandError, AgentErrorCode, CliSource};
use std::collections::HashSet;
use std::env;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;

#[derive(Debug)]
pub(crate) struct ResolvedCli {
    pub path: PathBuf,
    pub source: CliSource,
}

pub(crate) fn resolve_codex_path(
    configured_path: Option<&str>,
    path_entries: &[PathBuf],
    common_entries: &[PathBuf],
) -> Result<ResolvedCli, AgentCommandError> {
    if let Some(configured_path) = configured_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        let path = expand_home(configured_path);
        return validate_executable(&path)
            .map(|path| ResolvedCli {
                path,
                source: CliSource::Configured,
            })
            .map_err(|_| AgentCommandError::new(AgentErrorCode::InvalidCliPath));
    }

    for directory in path_entries {
        for name in executable_names() {
            let candidate = directory.join(name);
            if let Ok(path) = validate_executable(&candidate) {
                return Ok(ResolvedCli {
                    path,
                    source: CliSource::Path,
                });
            }
        }
    }

    for entry in common_entries {
        let candidates = if entry.is_dir() {
            executable_names()
                .iter()
                .map(|name| entry.join(name))
                .collect::<Vec<_>>()
        } else {
            vec![entry.clone()]
        };
        for candidate in candidates {
            if let Ok(path) = validate_executable(&candidate) {
                return Ok(ResolvedCli {
                    path,
                    source: CliSource::CommonLocation,
                });
            }
        }
    }

    Err(AgentCommandError::new(AgentErrorCode::CliNotFound))
}

pub(crate) fn resolve_installed_codex(
    configured_path: Option<&str>,
) -> Result<ResolvedCli, AgentCommandError> {
    let path_entries = env::var_os("PATH")
        .map(|value| env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();
    resolve_codex_path(configured_path, &path_entries, &common_codex_locations())
}

pub(crate) async fn probe_codex_version(path: &Path) -> Result<String, AgentCommandError> {
    let mut command = version_command(path);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let output = tokio::time::timeout(Duration::from_secs(5), command.output())
        .await
        .map_err(|_| AgentCommandError::new(AgentErrorCode::CliVersionFailed))?
        .map_err(|_| AgentCommandError::new(AgentErrorCode::CliVersionFailed))?;

    if !output.status.success() {
        return Err(AgentCommandError::new(AgentErrorCode::CliVersionFailed));
    }

    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() {
        return Err(AgentCommandError::new(AgentErrorCode::CliVersionFailed));
    }
    Ok(version)
}

fn validate_executable(path: &Path) -> Result<PathBuf, ()> {
    let canonical = path.canonicalize().map_err(|_| ())?;
    let metadata = canonical.metadata().map_err(|_| ())?;
    if !metadata.is_file() {
        return Err(());
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 {
            return Err(());
        }
    }

    #[cfg(windows)]
    {
        let extension = canonical
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !matches!(extension.as_str(), "exe" | "cmd" | "bat") {
            return Err(());
        }
    }

    Ok(canonical)
}

fn expand_home(path: &str) -> PathBuf {
    if path == "~" {
        return home_directory().unwrap_or_else(|| PathBuf::from(path));
    }
    if let Some(suffix) = path.strip_prefix("~/") {
        if let Some(home) = home_directory() {
            return home.join(suffix);
        }
    }
    PathBuf::from(path)
}

fn home_directory() -> Option<PathBuf> {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn executable_names() -> &'static [&'static str] {
    #[cfg(windows)]
    {
        &["codex.exe", "codex.cmd", "codex.bat"]
    }
    #[cfg(not(windows))]
    {
        &["codex"]
    }
}

fn common_codex_locations() -> Vec<PathBuf> {
    let mut entries = Vec::new();

    #[cfg(target_os = "macos")]
    {
        entries.extend([
            PathBuf::from("/opt/homebrew/bin/codex"),
            PathBuf::from("/usr/local/bin/codex"),
            PathBuf::from("/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"),
            PathBuf::from("/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"),
        ]);
    }

    #[cfg(target_os = "linux")]
    entries.extend([
        PathBuf::from("/usr/local/bin/codex"),
        PathBuf::from("/usr/bin/codex"),
    ]);

    if let Some(home) = home_directory() {
        entries.extend([
            home.join(".local/bin/codex"),
            home.join(".npm-global/bin/codex"),
            home.join(".volta/bin/codex"),
            home.join(".asdf/shims/codex"),
            home.join(".bun/bin/codex"),
        ]);
    }

    for variable in ["PNPM_HOME", "npm_config_prefix"] {
        if let Some(directory) = env::var_os(variable).map(PathBuf::from) {
            entries.push(directory.join("bin/codex"));
            entries.push(directory);
        }
    }

    #[cfg(windows)]
    {
        if let Some(app_data) = env::var_os("APPDATA").map(PathBuf::from) {
            entries.push(app_data.join("npm"));
        }
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA").map(PathBuf::from) {
            entries.push(local_app_data.join("pnpm"));
        }
    }

    let mut seen = HashSet::new();
    entries
        .into_iter()
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

#[cfg(not(windows))]
fn version_command(path: &Path) -> Command {
    let mut command = Command::new(path);
    command.arg("--version");
    command
}

#[cfg(windows)]
fn version_command(path: &Path) -> Command {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if matches!(extension.as_str(), "cmd" | "bat") {
        let mut command = Command::new("cmd.exe");
        command.args(["/D", "/S", "/C"]);
        command.arg(format!("\"{}\" --version", path.display()));
        return command;
    }
    let mut command = Command::new(path);
    command.arg("--version");
    command
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::agent::{AgentErrorCode, CliSource};
    use std::fs;
    use std::path::Path;

    #[test]
    fn configured_path_has_priority_over_path_candidates() {
        let temp = tempfile::tempdir().unwrap();
        let configured = temp.path().join(test_binary_name("configured"));
        let discovered = temp.path().join(test_binary_name("codex"));
        create_test_executable(&configured);
        create_test_executable(&discovered);

        let resolved = resolve_codex_path(
            Some(configured.to_string_lossy().as_ref()),
            &[temp.path().to_path_buf()],
            &[],
        )
        .unwrap();

        assert_eq!(resolved.path, configured.canonicalize().unwrap());
        assert_eq!(resolved.source, CliSource::Configured);
    }

    #[test]
    fn invalid_configured_path_does_not_fall_back() {
        let error = resolve_codex_path(Some("/missing/codex"), &[], &[]).unwrap_err();
        assert_eq!(error.code, AgentErrorCode::InvalidCliPath);
    }

    #[test]
    fn path_candidate_precedes_common_locations() {
        let temp = tempfile::tempdir().unwrap();
        let path_dir = temp.path().join("path");
        let common_dir = temp.path().join("common");
        fs::create_dir_all(&path_dir).unwrap();
        fs::create_dir_all(&common_dir).unwrap();
        create_test_executable(&path_dir.join(test_binary_name("codex")));
        create_test_executable(&common_dir.join(test_binary_name("codex")));

        let resolved = resolve_codex_path(None, &[path_dir], &[common_dir]).unwrap();
        assert_eq!(resolved.source, CliSource::Path);
    }

    fn create_test_executable(path: &Path) {
        fs::write(path, b"test").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
        }
    }

    #[cfg(windows)]
    fn test_binary_name(name: &str) -> String {
        format!("{name}.cmd")
    }

    #[cfg(not(windows))]
    fn test_binary_name(name: &str) -> String {
        name.to_string()
    }
}
