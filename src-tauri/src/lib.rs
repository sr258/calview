use serde::{Deserialize, Serialize};

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
    /// "success" | "error"
    status: String,
    /// Human-readable message
    message: String,
}

// ─── Windows COM automation for Outlook ─────────────────────────────────────

#[cfg(windows)]
mod outlook_com {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::System::Com::{
        CLSIDFromProgID, CoCreateInstance, CoInitializeEx, CoUninitialize, IDispatch,
        CLSCTX_LOCAL_SERVER, COINIT_APARTMENTTHREADED, DISPATCH_METHOD, DISPATCH_PROPERTYGET,
        DISPATCH_PROPERTYPUT, DISPPARAMS,
    };
    use windows::Win32::System::Ole::SystemTimeToVariantTime;
    use windows::Win32::System::Variant::{VARIANT, VT_BSTR, VT_DATE, VT_DISPATCH, VT_I4};

    /// Convert a Rust string to a null-terminated wide string.
    fn to_wide(s: &str) -> Vec<u16> {
        OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    /// Get the DISPID for a named member of an IDispatch interface.
    fn get_dispid(disp: &IDispatch, name: &str) -> Result<i32, String> {
        let wide = to_wide(name);
        let names = [wide.as_ptr()];
        let mut dispid = [0i32];
        unsafe {
            disp.GetIDsOfNames(
                &windows::core::GUID::zeroed(),
                names.as_ptr(),
                1,
                0,
                dispid.as_mut_ptr(),
            )
            .map_err(|e| format!("GetIDsOfNames('{}') fehlgeschlagen: {}", name, e))?;
        }
        Ok(dispid[0])
    }

    /// Invoke a method on an IDispatch interface with the given arguments.
    /// Arguments must be passed in reverse order (COM convention).
    fn invoke_method(
        disp: &IDispatch,
        name: &str,
        args: &mut [VARIANT],
    ) -> Result<VARIANT, String> {
        let dispid = get_dispid(disp, name)?;
        let mut result = VARIANT::default();
        let mut params = DISPPARAMS {
            rgvarg: if args.is_empty() {
                std::ptr::null_mut()
            } else {
                args.as_mut_ptr()
            },
            cArgs: args.len() as u32,
            rgdispidNamedArgs: std::ptr::null_mut(),
            cNamedArgs: 0,
        };
        unsafe {
            disp.Invoke(
                dispid,
                &windows::core::GUID::zeroed(),
                0,
                DISPATCH_METHOD,
                &mut params,
                Some(&mut result),
                None,
                None,
            )
            .map_err(|e| format!("Invoke('{}') fehlgeschlagen: {}", name, e))?;
        }
        Ok(result)
    }

    /// Get a property value from an IDispatch interface.
    fn get_property(disp: &IDispatch, name: &str) -> Result<VARIANT, String> {
        let dispid = get_dispid(disp, name)?;
        let mut result = VARIANT::default();
        let mut params = DISPPARAMS {
            rgvarg: std::ptr::null_mut(),
            cArgs: 0,
            rgdispidNamedArgs: std::ptr::null_mut(),
            cNamedArgs: 0,
        };
        unsafe {
            disp.Invoke(
                dispid,
                &windows::core::GUID::zeroed(),
                0,
                DISPATCH_PROPERTYGET,
                &mut params,
                Some(&mut result),
                None,
                None,
            )
            .map_err(|e| format!("Get('{}') fehlgeschlagen: {}", name, e))?;
        }
        Ok(result)
    }

    /// Put (set) a property value on an IDispatch interface.
    fn put_property(disp: &IDispatch, name: &str, value: &VARIANT) -> Result<(), String> {
        let dispid = get_dispid(disp, name)?;
        let mut args = [value.clone()];
        let mut named_arg = [-3i32]; // DISPID_PROPERTYPUT
        let mut params = DISPPARAMS {
            rgvarg: args.as_mut_ptr(),
            cArgs: 1,
            rgdispidNamedArgs: named_arg.as_mut_ptr(),
            cNamedArgs: 1,
        };
        unsafe {
            disp.Invoke(
                dispid,
                &windows::core::GUID::zeroed(),
                0,
                DISPATCH_PROPERTYPUT,
                &mut params,
                None,
                None,
                None,
            )
            .map_err(|e| format!("Put('{}') fehlgeschlagen: {}", name, e))?;
        }
        Ok(())
    }

    /// Extract an IDispatch pointer from a VARIANT.
    fn variant_to_dispatch(var: &VARIANT) -> Result<IDispatch, String> {
        unsafe {
            let vt = var.Anonymous.Anonymous.vt;
            if vt != VT_DISPATCH {
                return Err(format!("Erwarteter VT_DISPATCH, aber erhalten: {:?}", vt));
            }
            let punk = var.Anonymous.Anonymous.Anonymous.pdispVal;
            if punk.is_null() {
                return Err("IDispatch-Zeiger ist null".to_string());
            }
            Ok((*punk).clone())
        }
    }

    /// Create a VT_BSTR VARIANT from a Rust string.
    fn variant_bstr(s: &str) -> VARIANT {
        let bstr = windows::core::BSTR::from(s);
        let mut var = VARIANT::default();
        unsafe {
            var.Anonymous.Anonymous.vt = VT_BSTR;
            var.Anonymous.Anonymous.Anonymous.bstrVal = std::mem::ManuallyDrop::new(bstr);
        }
        var
    }

    /// Create a VT_I4 VARIANT from an i32.
    fn variant_i4(val: i32) -> VARIANT {
        let mut var = VARIANT::default();
        unsafe {
            var.Anonymous.Anonymous.vt = VT_I4;
            var.Anonymous.Anonymous.Anonymous.lVal = val;
        }
        var
    }

    /// Create a VT_DATE VARIANT from a date string "YYYY-MM-DD HH:mm".
    fn variant_date(date_str: &str) -> Result<VARIANT, String> {
        // Parse "YYYY-MM-DD HH:mm"
        let parts: Vec<&str> = date_str
            .split(|c| c == '-' || c == ' ' || c == ':')
            .collect();
        if parts.len() != 5 {
            return Err(format!(
                "Ungueltiges Datumsformat: '{}' (erwartet 'YYYY-MM-DD HH:mm')",
                date_str
            ));
        }
        let year: u16 = parts[0]
            .parse()
            .map_err(|_| format!("Ungueltiges Jahr: '{}'", parts[0]))?;
        let month: u16 = parts[1]
            .parse()
            .map_err(|_| format!("Ungueltiger Monat: '{}'", parts[1]))?;
        let day: u16 = parts[2]
            .parse()
            .map_err(|_| format!("Ungueltiger Tag: '{}'", parts[2]))?;
        let hour: u16 = parts[3]
            .parse()
            .map_err(|_| format!("Ungueltige Stunde: '{}'", parts[3]))?;
        let minute: u16 = parts[4]
            .parse()
            .map_err(|_| format!("Ungueltige Minute: '{}'", parts[4]))?;

        let st = windows::Win32::Foundation::SYSTEMTIME {
            wYear: year,
            wMonth: month,
            wDayOfWeek: 0,
            wDay: day,
            wHour: hour,
            wMinute: minute,
            wSecond: 0,
            wMilliseconds: 0,
        };

        let mut vtime: f64 = 0.0;
        unsafe {
            SystemTimeToVariantTime(&st, &mut vtime)
                .ok()
                .map_err(|e| format!("SystemTimeToVariantTime fehlgeschlagen: {}", e))?;
        }

        let mut var = VARIANT::default();
        unsafe {
            var.Anonymous.Anonymous.vt = VT_DATE;
            var.Anonymous.Anonymous.Anonymous.date = vtime;
        }
        Ok(var)
    }

    /// Create an Outlook appointment using COM automation.
    ///
    /// Spawns a dedicated STA thread, creates Outlook.Application via COM,
    /// sets appointment properties, adds attendees, and calls Display().
    pub fn create_appointment(
        subject: String,
        start: String,
        duration: u32,
        location: String,
        body: String,
        attendees: Vec<String>,
    ) -> Result<String, String> {
        // Spawn a dedicated thread with its own COM apartment (STA)
        let handle = std::thread::spawn(move || -> Result<String, String> {
            unsafe {
                // Initialize COM in single-threaded apartment mode
                CoInitializeEx(None, COINIT_APARTMENTTHREADED)
                    .map_err(|e| format!("CoInitializeEx fehlgeschlagen: {}", e))?;
            }

            let result =
                create_appointment_inner(&subject, &start, duration, &location, &body, &attendees);

            unsafe {
                CoUninitialize();
            }

            result
        });

        handle
            .join()
            .map_err(|_| "COM-Thread ist unerwartet abgestuerzt".to_string())?
    }

    fn create_appointment_inner(
        subject: &str,
        start: &str,
        duration: u32,
        location: &str,
        body: &str,
        attendees: &[String],
    ) -> Result<String, String> {
        unsafe {
            // Create Outlook.Application instance
            let prog_id = to_wide("Outlook.Application");
            let clsid = CLSIDFromProgID(PCWSTR(prog_id.as_ptr())).map_err(|e| {
                format!(
                    "Outlook ist nicht installiert oder nicht registriert: {}",
                    e
                )
            })?;

            let app: IDispatch = CoCreateInstance(&clsid, None, CLSCTX_LOCAL_SERVER)
                .map_err(|e| format!("Outlook konnte nicht gestartet werden: {}", e))?;

            // CreateItem(1) — 1 = olAppointmentItem
            let mut args = [variant_i4(1)];
            let item_var = invoke_method(&app, "CreateItem", &mut args)?;
            let item = variant_to_dispatch(&item_var)?;

            // Set Subject
            if !subject.is_empty() {
                put_property(&item, "Subject", &variant_bstr(subject))?;
            }

            // Set Start (VT_DATE)
            let date_variant = variant_date(start)?;
            put_property(&item, "Start", &date_variant)?;

            // Set Duration
            put_property(&item, "Duration", &variant_i4(duration as i32))?;

            // Set Location
            if !location.is_empty() {
                put_property(&item, "Location", &variant_bstr(location))?;
            }

            // Set Body
            if !body.is_empty() {
                put_property(&item, "Body", &variant_bstr(body))?;
            }

            // Set MeetingStatus = 1 (olMeeting) if there are attendees
            if !attendees.is_empty() {
                put_property(&item, "MeetingStatus", &variant_i4(1))?;

                // Get Recipients collection
                let recipients_var = get_property(&item, "Recipients")?;
                let recipients = variant_to_dispatch(&recipients_var)?;

                // Add each attendee
                for attendee in attendees {
                    if !attendee.is_empty() {
                        let mut add_args = [variant_bstr(attendee)];
                        let recip_var = invoke_method(&recipients, "Add", &mut add_args)?;
                        let recip = variant_to_dispatch(&recip_var)?;
                        // Set Type = 1 (olRequired)
                        put_property(&recip, "Type", &variant_i4(1))?;
                    }
                }

                // Resolve all recipients
                invoke_method(&recipients, "ResolveAll", &mut [])?;
            }

            // Display the appointment dialog
            invoke_method(&item, "Display", &mut [])?;

            Ok("Outlook-Termindialog geoeffnet".to_string())
        }
    }
}

/// Open an Outlook appointment dialog via COM automation (Windows only).
///
/// On Windows: spawns a dedicated STA thread and creates the appointment
/// using direct COM calls to Outlook.Application. No temp files, no PowerShell.
///
/// On non-Windows: returns an error message.
#[tauri::command]
fn open_outlook_appointment(
    subject: String,
    start: String,
    duration: u32,
    location: Option<String>,
    body: Option<String>,
    attendees: Vec<String>,
) -> Result<OutlookCommandResult, String> {
    log::info!(
        "[outlook] open_outlook_appointment called: subject='{}', start='{}', duration={}, attendees={:?}",
        subject, start, duration, attendees
    );

    #[cfg(windows)]
    {
        let location = location.unwrap_or_default();
        let body = body.unwrap_or_default();
        let attendees: Vec<String> = attendees
            .into_iter()
            .map(|a| a.trim().to_string())
            .filter(|a| !a.is_empty())
            .collect();

        // create_appointment spawns its own STA thread and joins it
        match outlook_com::create_appointment(subject, start, duration, location, body, attendees) {
            Ok(msg) => {
                log::info!("[outlook] COM success: {}", msg);
                Ok(OutlookCommandResult {
                    status: "success".to_string(),
                    message: msg,
                })
            }
            Err(msg) => {
                log::error!("[outlook] COM error: {}", msg);
                Ok(OutlookCommandResult {
                    status: "error".to_string(),
                    message: msg,
                })
            }
        }
    }

    #[cfg(not(windows))]
    {
        let _ = (subject, start, duration, location, body, attendees);
        Ok(OutlookCommandResult {
            status: "error".to_string(),
            message: "Outlook-Integration ist nur unter Windows verfuegbar".to_string(),
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
