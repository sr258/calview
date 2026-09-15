//! Kerberos/SPNEGO ("Negotiate") authentication support for Windows.
//!
//! Implements RFC 4559 (SPNEGO-based Kerberos and NTLM HTTP Authentication)
//! from the client side, using native Windows SSPI so the app can transparently
//! reuse the current domain user's existing Kerberos ticket (Windows Integrated
//! Authentication / "SSO") — no password is ever collected or stored.
//!
//! Only available on Windows: SSPI is a Windows-only API, and there is no
//! Kerberos ticket cache to draw on outside of a domain-joined Windows session.
//! On other platforms all commands return an error.
//!
//! Caveat for contributors: GitHub Actions Windows runners are not
//! domain-joined, so CI can only verify that this module compiles — the actual
//! handshake against a real KDC/CalDAV server must be tested manually on a
//! domain-joined Windows machine.

use serde::Serialize;

#[derive(Serialize)]
pub struct SpnegoStepResult {
    #[serde(rename = "contextId")]
    pub context_id: u32,
    #[serde(rename = "tokenB64")]
    pub token_b64: String,
    pub done: bool,
}

#[cfg(windows)]
mod win {
    use super::SpnegoStepResult;
    use base64::Engine;
    use std::collections::HashMap;
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Mutex;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{
        SEC_E_OK, SEC_I_COMPLETE_AND_CONTINUE, SEC_I_COMPLETE_NEEDED, SEC_I_CONTINUE_NEEDED,
    };
    use windows::Win32::Security::Authentication::Identity::{
        AcquireCredentialsHandleW, DeleteSecurityContext, FreeContextBuffer,
        FreeCredentialsHandle, InitializeSecurityContextW, SecBuffer, SecBufferDesc,
        ISC_REQ_ALLOCATE_MEMORY, ISC_REQ_CONNECTION, ISC_REQ_MUTUAL_AUTH, SECBUFFER_TOKEN,
        SECBUFFER_VERSION, SECPKG_CRED_OUTBOUND, SECURITY_NATIVE_DREP,
    };
    use windows::Win32::Security::Credentials::SecHandle;

    /// Holds the SSPI handles for one in-progress (or completed) handshake.
    /// Kept alive between the `spnego_start`/`spnego_continue` Tauri calls
    /// that make up one HTTP Negotiate challenge/response exchange.
    struct NegotiateContext {
        cred: SecHandle,
        ctx: SecHandle,
    }

    // SAFETY: SecHandle is an opaque (dwLower, dwUpper) token pair, not a
    // thread-affine object. Access to a given context is always serialized
    // by the SPNEGO_CONTEXTS mutex, so it is safe to hand off between threads.
    unsafe impl Send for NegotiateContext {}

    impl Drop for NegotiateContext {
        fn drop(&mut self) {
            unsafe {
                let _ = DeleteSecurityContext(&self.ctx);
                let _ = FreeCredentialsHandle(&self.cred);
            }
        }
    }

    static NEXT_CONTEXT_ID: AtomicU32 = AtomicU32::new(1);
    static SPNEGO_CONTEXTS: Mutex<Option<HashMap<u32, NegotiateContext>>> = Mutex::new(None);

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Acquires an outbound "Negotiate" credentials handle for the current
    /// process's logged-on user. Passing no explicit auth data (`None`) tells
    /// SSPI to use the ambient Windows identity — this is what makes it "SSO":
    /// whatever Kerberos ticket/NTLM identity the user already has is reused.
    fn acquire_credentials() -> Result<SecHandle, String> {
        let package = to_wide("Negotiate");
        let mut cred = SecHandle::default();
        unsafe {
            AcquireCredentialsHandleW(
                PCWSTR::null(),
                PCWSTR(package.as_ptr()),
                SECPKG_CRED_OUTBOUND,
                None,
                None,
                None,
                None,
                &mut cred,
                None,
            )
            .map_err(|e| format!("AcquireCredentialsHandleW fehlgeschlagen: {e}"))?;
        }
        Ok(cred)
    }

    /// Runs one leg of `InitializeSecurityContextW`: optionally feeding in a
    /// continuation token from the server (`in_token`), producing the next
    /// output token to send back, and reporting whether the handshake is done.
    fn init_context(
        cred: &SecHandle,
        ctx: Option<&SecHandle>,
        target_spn: &str,
        in_token: Option<&[u8]>,
    ) -> Result<(SecHandle, Vec<u8>, bool), String> {
        let target = to_wide(target_spn);

        let mut in_buf = SecBuffer {
            cbBuffer: in_token.map_or(0, |tok| tok.len() as u32),
            BufferType: SECBUFFER_TOKEN,
            pvBuffer: in_token.map_or(std::ptr::null_mut(), |tok| tok.as_ptr() as *mut c_void),
        };
        let in_desc = SecBufferDesc {
            ulVersion: SECBUFFER_VERSION,
            cBuffers: 1,
            pBuffers: &mut in_buf,
        };
        let input_ptr: Option<*const SecBufferDesc> = in_token.is_some().then_some(&in_desc);

        let mut out_buf = SecBuffer {
            cbBuffer: 0,
            BufferType: SECBUFFER_TOKEN,
            pvBuffer: std::ptr::null_mut(),
        };
        let mut out_desc = SecBufferDesc {
            ulVersion: SECBUFFER_VERSION,
            cBuffers: 1,
            pBuffers: &mut out_buf,
        };

        let mut new_ctx = SecHandle::default();
        let mut context_attr: u32 = 0;
        let req_flags = ISC_REQ_ALLOCATE_MEMORY | ISC_REQ_MUTUAL_AUTH | ISC_REQ_CONNECTION;

        let hr = unsafe {
            InitializeSecurityContextW(
                Some(cred as *const _),
                ctx.map(|c| c as *const _),
                Some(target.as_ptr()),
                req_flags,
                0,
                SECURITY_NATIVE_DREP,
                input_ptr,
                0,
                Some(&mut new_ctx),
                Some(&mut out_desc),
                &mut context_attr,
                None,
            )
        };

        let done = if hr == SEC_E_OK {
            true
        } else if hr == SEC_I_CONTINUE_NEEDED
            || hr == SEC_I_COMPLETE_AND_CONTINUE
            || hr == SEC_I_COMPLETE_NEEDED
        {
            false
        } else {
            return Err(format!(
                "InitializeSecurityContextW fehlgeschlagen: {}",
                hr.message()
            ));
        };

        let token = if out_buf.cbBuffer > 0 && !out_buf.pvBuffer.is_null() {
            let slice = unsafe {
                std::slice::from_raw_parts(out_buf.pvBuffer as *const u8, out_buf.cbBuffer as usize)
            };
            let vec = slice.to_vec();
            unsafe {
                let _ = FreeContextBuffer(out_buf.pvBuffer);
            }
            vec
        } else {
            Vec::new()
        };

        Ok((new_ctx, token, done))
    }

    fn store_context(cred: SecHandle, ctx: SecHandle) -> u32 {
        let id = NEXT_CONTEXT_ID.fetch_add(1, Ordering::SeqCst);
        let mut guard = SPNEGO_CONTEXTS.lock().unwrap();
        guard
            .get_or_insert_with(HashMap::new)
            .insert(id, NegotiateContext { cred, ctx });
        id
    }

    pub fn start(target_spn: String) -> Result<SpnegoStepResult, String> {
        let cred = acquire_credentials()?;
        let (ctx, token, done) = match init_context(&cred, None, &target_spn, None) {
            Ok(result) => result,
            Err(e) => {
                unsafe {
                    let _ = FreeCredentialsHandle(&cred);
                }
                return Err(e);
            }
        };
        let context_id = store_context(cred, ctx);
        Ok(SpnegoStepResult {
            context_id,
            token_b64: base64::engine::general_purpose::STANDARD.encode(token),
            done,
        })
    }

    pub fn continue_handshake(
        context_id: u32,
        target_spn: String,
        server_token_b64: String,
    ) -> Result<SpnegoStepResult, String> {
        let server_token = base64::engine::general_purpose::STANDARD
            .decode(server_token_b64)
            .map_err(|e| format!("Ungueltiges Server-Token: {e}"))?;

        let mut guard = SPNEGO_CONTEXTS.lock().unwrap();
        let map = guard.get_or_insert_with(HashMap::new);
        let existing = map
            .get(&context_id)
            .ok_or_else(|| "Unbekannter SPNEGO-Kontext (abgelaufen oder bereits bereinigt)".to_string())?;

        let (new_ctx, token, done) = init_context(
            &existing.cred,
            Some(&existing.ctx),
            &target_spn,
            Some(&server_token),
        )?;

        // Replace the context handle in place; the credentials handle is reused.
        let entry = map.get_mut(&context_id).unwrap();
        unsafe {
            let _ = DeleteSecurityContext(&entry.ctx);
        }
        entry.ctx = new_ctx;

        Ok(SpnegoStepResult {
            context_id,
            token_b64: base64::engine::general_purpose::STANDARD.encode(token),
            done,
        })
    }

    pub fn cleanup(context_id: u32) {
        let mut guard = SPNEGO_CONTEXTS.lock().unwrap();
        if let Some(map) = guard.as_mut() {
            map.remove(&context_id);
        }
    }
}

/// Starts a new Negotiate handshake for the given target SPN
/// (e.g. `"HTTP/caldav.example.org"`), returning the first token to send as
/// `Authorization: Negotiate <token>`.
#[tauri::command]
pub fn spnego_start(target_spn: String) -> Result<SpnegoStepResult, String> {
    #[cfg(windows)]
    {
        win::start(target_spn)
    }
    #[cfg(not(windows))]
    {
        let _ = target_spn;
        Err("Kerberos-Authentifizierung ist nur unter Windows verfuegbar.".to_string())
    }
}

/// Continues an in-progress Negotiate handshake with the continuation token
/// carried in the server's `WWW-Authenticate: Negotiate <token>` response.
#[tauri::command]
pub fn spnego_continue(
    context_id: u32,
    target_spn: String,
    server_token_b64: String,
) -> Result<SpnegoStepResult, String> {
    #[cfg(windows)]
    {
        win::continue_handshake(context_id, target_spn, server_token_b64)
    }
    #[cfg(not(windows))]
    {
        let _ = (context_id, target_spn, server_token_b64);
        Err("Kerberos-Authentifizierung ist nur unter Windows verfuegbar.".to_string())
    }
}

/// Releases the SSPI handles for a finished (or abandoned) handshake.
#[tauri::command]
pub fn spnego_cleanup(context_id: u32) {
    #[cfg(windows)]
    {
        win::cleanup(context_id);
    }
    #[cfg(not(windows))]
    {
        let _ = context_id;
    }
}
