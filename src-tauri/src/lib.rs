use serde::{Deserialize, Serialize};
use std::io::Read as _;
use std::io::Write as _;
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
    /// Path to the PowerShell log file for remote debugging
    #[serde(rename = "logFile")]
    log_file: String,
}

/// JSON structure written to the temp file for the PowerShell script.
#[derive(Serialize)]
struct OutlookParams {
    subject: String,
    start: String,
    duration: u32,
    location: String,
    body: String,
    attendees: Vec<String>,
}

/// Open an Outlook appointment dialog via PowerShell COM automation.
///
/// This command resolves the bundled PowerShell script, writes all parameters
/// to a temporary JSON file (avoiding all quoting/escaping issues with process
/// argument lists), spawns `powershell -ExecutionPolicy Bypass -File ... <json_path>`,
/// and waits up to 3 seconds for early failures (e.g. Outlook not installed).
/// If the process is still running after 3s, we assume the Outlook dialog is
/// open and return success (fire-and-forget).
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
    // The PowerShell script logs to %TEMP%\calview-outlook.log
    let log_file_path = std::env::temp_dir()
        .join("calview-outlook.log")
        .to_string_lossy()
        .to_string();

    log::info!(
        "[outlook] open_outlook_appointment called: subject='{}', start='{}', duration={}, attendees={:?}",
        subject, start, duration, attendees
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

    // Step 2: Write parameters to a temporary JSON file
    // This avoids all quoting/escaping issues with process argument passing.
    // Names with spaces, empty strings, and special characters all work correctly.
    let params = OutlookParams {
        subject,
        start,
        duration,
        location: location.unwrap_or_default(),
        body: body.unwrap_or_default(),
        attendees: attendees
            .into_iter()
            .map(|a| a.trim().to_string())
            .filter(|a| !a.is_empty())
            .collect(),
    };

    let params_json = serde_json::to_string_pretty(&params).map_err(|e| {
        let msg = format!("Failed to serialize parameters to JSON: {}", e);
        log::error!("[outlook] {}", msg);
        msg
    })?;

    log::info!("[outlook] Parameters JSON:\n{}", params_json);

    let params_file = std::env::temp_dir().join("calview-outlook-params.json");
    let mut file = std::fs::File::create(&params_file).map_err(|e| {
        let msg = format!("Failed to create temp params file at {:?}: {}", params_file, e);
        log::error!("[outlook] {}", msg);
        msg
    })?;
    file.write_all(params_json.as_bytes()).map_err(|e| {
        let msg = format!("Failed to write params file: {}", e);
        log::error!("[outlook] {}", msg);
        msg
    })?;
    drop(file); // Ensure file is flushed and closed before PowerShell reads it

    log::info!("[outlook] Wrote params file: {:?}", params_file);

    let script_path_str = script_path.to_string_lossy().to_string();
    let params_file_str = params_file.to_string_lossy().to_string();

    // Step 3: Spawn PowerShell process
    // Only argument to the script is the path to the JSON params file.
    let mut cmd = Command::new("powershell");
    cmd.args([
        "-ExecutionPolicy",
        "Bypass",
        "-NoProfile",
        "-NonInteractive",
        "-File",
        &script_path_str,
        &params_file_str,
    ]);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    // On Windows, prevent a console window from flashing
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    log::info!(
        "[outlook] Spawning: powershell -ExecutionPolicy Bypass -NoProfile -NonInteractive -File \"{}\" \"{}\"",
        script_path_str, params_file_str
    );

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
            "[outlook] PowerShell exited quickly: code={}, stdout_len={}, stderr_len={}",
            exit_code,
            stdout_str.len(),
            stderr_str.len()
        );
        log::info!("[outlook] stdout: {}", stdout_str.trim());
        log::info!("[outlook] stderr: {}", stderr_str.trim());

        if exit_code != 0 {
            // Build a helpful error message including the log file path
            let detail = if !stderr_str.trim().is_empty() {
                stderr_str.trim().to_string()
            } else if !stdout_str.trim().is_empty() {
                stdout_str.trim().to_string()
            } else {
                format!("PowerShell exited with code {}", exit_code)
            };

            let error_msg = format!(
                "{} (Details in Log-Datei: {})",
                detail, log_file_path
            );

            log::error!("[outlook] PowerShell error: {}", error_msg);

            return Ok(OutlookCommandResult {
                status: "error".to_string(),
                message: error_msg,
                stdout: stdout_str,
                stderr: stderr_str,
                exit_code,
                log_file: log_file_path,
            });
        }

        // Exited with code 0 within 3s — unusual but OK (maybe Display() returned fast)
        Ok(OutlookCommandResult {
            status: "completed".to_string(),
            message: "PowerShell script completed successfully".to_string(),
            stdout: stdout_str,
            stderr: stderr_str,
            exit_code,
            log_file: log_file_path,
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
            log_file: log_file_path,
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
