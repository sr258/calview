use serde::{Deserialize, Serialize};
use std::io::Read as _;
use std::process::{Command, Stdio};
use tauri::Manager;

const KEYRING_SERVICE: &str = "calview";
const KEYRING_USER: &str = "credentials";

#[derive(Serialize, Deserialize)]
struct StoredCredentials {
    url: String,
    #[serde(rename = "authHeader")]
    auth_header: String,
    #[serde(rename = "acceptInvalidCerts", default)]
    accept_invalid_certs: bool,
}

/// Save CalDAV credentials to the OS keychain.
#[tauri::command]
fn save_credentials(
    url: String,
    auth_header: String,
    accept_invalid_certs: bool,
) -> Result<(), String> {
    let creds = StoredCredentials {
        url,
        auth_header,
        accept_invalid_certs,
    };
    let json = serde_json::to_string(&creds).map_err(|e| e.to_string())?;

    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())?;
    entry.set_password(&json).map_err(|e| e.to_string())?;
    Ok(())
}

/// Load CalDAV credentials from the OS keychain.
/// Returns null if no credentials are stored.
#[tauri::command]
fn get_credentials() -> Result<Option<StoredCredentials>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(json) => {
            let creds: StoredCredentials =
                serde_json::from_str(&json).map_err(|e| e.to_string())?;
            Ok(Some(creds))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Delete stored CalDAV credentials from the OS keychain.
#[tauri::command]
fn delete_credentials() -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // already gone, not an error
        Err(e) => Err(e.to_string()),
    }
}

/// Escape a string for use inside PowerShell single-quoted strings.
/// In single-quoted strings, the only escape is '' for a literal '.
fn escape_powershell_single_quote(s: &str) -> String {
    s.replace('\'', "''")
}

/// Result returned from the open_outlook_appointment command.
#[derive(Serialize)]
struct OutlookCommandResult {
    /// "dialog_opened" | "completed" | "error"
    status: String,
    /// Human-readable message for debugging
    message: String,
    /// PowerShell stdout (if available)
    stdout: String,
    /// PowerShell stderr (if available)
    stderr: String,
    /// PowerShell exit code (-1 if still running or unknown)
    #[serde(rename = "exitCode")]
    exit_code: i32,
}

/// Open an Outlook appointment dialog via PowerShell COM automation.
///
/// This command resolves the bundled PowerShell script, spawns a
/// `powershell -ExecutionPolicy Bypass -File ...` process, and waits
/// up to 3 seconds for early failures (e.g. Outlook not installed).
/// If the process is still running after 3s, we assume the Outlook
/// dialog is open and return success (fire-and-forget).
///
/// Only works on Windows with Outlook installed.
#[tauri::command]
async fn open_outlook_appointment(
    app: tauri::AppHandle,
    subject: String,
    start: String,
    duration: u32,
    location: Option<String>,
    body: Option<String>,
    attendees: Vec<String>,
) -> Result<OutlookCommandResult, String> {
    log::info!(
        "[outlook] open_outlook_appointment called: subject='{}', start='{}', duration={}, attendees={}",
        subject, start, duration, attendees.len()
    );

    // Step 1: Resolve the bundled PowerShell script path
    let script_path = app
        .path()
        .resolve("resources/create-appointment.ps1", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("Failed to resolve script path: {}", e))?;

    log::info!("[outlook] Resolved script path: {:?}", script_path);

    if !script_path.exists() {
        let msg = format!("PowerShell script not found at: {:?}", script_path);
        log::error!("[outlook] {}", msg);
        return Err(msg);
    }

    // Step 2: Build PowerShell arguments with proper escaping
    let escaped_subject = escape_powershell_single_quote(&subject);
    let escaped_location = escape_powershell_single_quote(location.as_deref().unwrap_or(""));
    let escaped_body = escape_powershell_single_quote(body.as_deref().unwrap_or(""));
    let escaped_attendees = escape_powershell_single_quote(
        &attendees
            .iter()
            .map(|a| a.trim().to_string())
            .filter(|a| !a.is_empty())
            .collect::<Vec<_>>()
            .join(";"),
    );

    let script_path_str = script_path.to_string_lossy().to_string();

    log::info!(
        "[outlook] PowerShell args: -Subject '{}' -Start '{}' -Duration {} -Attendees '{}'",
        escaped_subject, start, duration, escaped_attendees
    );

    // Step 3: Spawn PowerShell process
    let mut cmd = Command::new("powershell");
    cmd.args([
        "-ExecutionPolicy",
        "Bypass",
        "-NoProfile",
        "-NonInteractive",
        "-File",
        &script_path_str,
        "-Subject",
        &format!("{}", escaped_subject),
        "-Start",
        &format!("{}", start),
        "-Duration",
        &format!("{}", duration),
        "-Location",
        &format!("{}", escaped_location),
        "-Body",
        &format!("{}", escaped_body),
        "-Attendees",
        &format!("{}", escaped_attendees),
    ]);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    // On Windows, prevent a console window from flashing
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    log::info!("[outlook] Spawning PowerShell process...");

    let mut child = cmd.spawn().map_err(|e| {
        let msg = format!("Failed to start PowerShell: {}", e);
        log::error!("[outlook] {}", msg);
        msg
    })?;

    log::info!("[outlook] PowerShell process spawned (pid: {:?})", child.id());

    // Step 4: Fire-and-forget with 3 second timeout for early failures
    //
    // We spawn a thread that waits on the child process, then sleep 3 seconds
    // on the current thread. If the child exits within that time, we read the
    // output. Otherwise, we assume the Outlook dialog is open.

    // Take ownership of stdout/stderr handles before moving child to thread
    let child_stdout = child.stdout.take();
    let child_stderr = child.stderr.take();

    let handle = std::thread::spawn(move || child.wait());

    // Wait 3 seconds for the process to potentially fail fast
    std::thread::sleep(std::time::Duration::from_secs(3));

    if handle.is_finished() {
        // Process exited within 3 seconds — read output and check exit code
        let wait_result = handle
            .join()
            .map_err(|_| "Thread panicked while waiting for PowerShell".to_string())?
            .map_err(|e| format!("Failed to wait for PowerShell: {}", e))?;

        let exit_code = wait_result.code().unwrap_or(-1);

        // Read stdout and stderr
        let mut stdout_str = String::new();
        let mut stderr_str = String::new();
        if let Some(mut out) = child_stdout {
            let _ = out.read_to_string(&mut stdout_str);
        }
        if let Some(mut err) = child_stderr {
            let _ = err.read_to_string(&mut stderr_str);
        }

        log::info!(
            "[outlook] PowerShell exited quickly: code={}, stdout='{}', stderr='{}'",
            exit_code,
            stdout_str.trim(),
            stderr_str.trim()
        );

        if exit_code != 0 {
            let error_msg = if !stderr_str.trim().is_empty() {
                stderr_str.trim().to_string()
            } else if !stdout_str.trim().is_empty() {
                stdout_str.trim().to_string()
            } else {
                format!("PowerShell exited with code {}", exit_code)
            };

            log::error!("[outlook] PowerShell error: {}", error_msg);

            return Ok(OutlookCommandResult {
                status: "error".to_string(),
                message: error_msg,
                stdout: stdout_str,
                stderr: stderr_str,
                exit_code,
            });
        }

        // Exited with code 0 within 3s — unusual but OK (maybe Display() returned fast)
        Ok(OutlookCommandResult {
            status: "completed".to_string(),
            message: "PowerShell script completed successfully".to_string(),
            stdout: stdout_str,
            stderr: stderr_str,
            exit_code,
        })
    } else {
        // Process still running after 3s — the Outlook dialog is likely open
        log::info!(
            "[outlook] PowerShell still running after 3s — Outlook dialog is likely open"
        );

        Ok(OutlookCommandResult {
            status: "dialog_opened".to_string(),
            message: "Outlook dialog is open (process still running)".to_string(),
            stdout: String::new(),
            stderr: String::new(),
            exit_code: -1,
        })
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            save_credentials,
            get_credentials,
            delete_credentials,
            open_outlook_appointment,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
