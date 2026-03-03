use serde::{Deserialize, Serialize};

const KEYRING_SERVICE: &str = "calview";
const KEYRING_USER: &str = "credentials";

#[derive(Serialize, Deserialize)]
struct StoredCredentials {
    url: String,
    #[serde(rename = "authHeader")]
    auth_header: String,
}

/// Save CalDAV credentials to the OS keychain.
#[tauri::command(rename_all = "camelCase")]
fn save_credentials(url: String, auth_header: String) -> Result<(), String> {
    let creds = StoredCredentials { url, auth_header };
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            save_credentials,
            get_credentials,
            delete_credentials,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
