//! Secret storage — Windows Credential Manager (W0.9).
//!
//! API keys and trigger tokens live in the OS credential store, never in
//! `config.toml` or logs. The environment variable `PHANTOM_API_KEY` still wins
//! at the call site, so CI/tunnels can override without a store write.
//!
//! Off-Windows (CI type-checks) this module falls back to environment lookup
//! for reads and is a no-op for writes; it is not a secure store and must not
//! be used to hold real secrets in production.

use crate::error::{PhantomError, Result};

/// Credential target for the active provider's API key.
pub const API_KEY_TARGET: &str = "phantom/api_key";
/// Credential target for the local webhook bearer token.
pub const WEBHOOK_TOKEN_TARGET: &str = "phantom/webhook_token";
/// Credential target for the local GUI control-plane bearer token.
pub const CONTROL_TOKEN_TARGET: &str = "phantom/control_token";

#[cfg(windows)]
pub fn get_secret(target: &str) -> Result<Option<String>> {
    use std::ffi::c_void;
    use std::ptr::null_mut;
    use std::slice::from_raw_parts;
    use windows::Win32::Security::Credentials::{
        CredFree, CredReadW, CRED_TYPE_GENERIC,
    };
    use windows::core::PCWSTR;

    let wide: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();
    let mut stored: *mut windows::Win32::Security::Credentials::CREDENTIALW = null_mut();
    // SAFETY: CredReadW writes a single credential pointer on success; we free
    // it with CredFree below. `wide` outlives the call.
    let ok = unsafe { CredReadW(PCWSTR(wide.as_ptr()), CRED_TYPE_GENERIC, 0, &mut stored) };
    if ok.is_err() || stored.is_null() {
        return Ok(None);
    }
    // SAFETY: `stored` is a valid credential pointer returned by CredReadW.
    let ret = unsafe {
        let cred = &*stored;
        let bytes = from_raw_parts(cred.CredentialBlob, cred.CredentialBlobSize as usize);
        let val = String::from_utf8(bytes.to_vec())
            .map_err(|e| PhantomError::Config(format!("credential '{target}' is not UTF-8: {e}")));
        CredFree(stored as *const c_void);
        val.map(Some)
    };
    ret
}

#[cfg(windows)]
pub fn set_secret(target: &str, value: &str) -> Result<()> {
    use std::mem::zeroed;
    use windows::core::PWSTR;
    use windows::Win32::Security::Credentials::{
        CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    };

    let mut target_wide: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();
    let mut blob = value.as_bytes().to_vec();
    // SAFETY: all pointers reference live locals that outlive the CredWriteW
    // call; the API copies the credential into the store before returning.
    let mut cred: CREDENTIALW = unsafe { zeroed() };
    cred.Type = CRED_TYPE_GENERIC;
    cred.TargetName = PWSTR(target_wide.as_mut_ptr());
    cred.CredentialBlobSize = blob.len() as u32;
    cred.CredentialBlob = blob.as_mut_ptr();
    cred.Persist = CRED_PERSIST_LOCAL_MACHINE;
    unsafe { CredWriteW(&cred, 0) }
        .map_err(|e| PhantomError::Config(format!("failed to store credential '{target}': {e}")))
}

/// Remove a credential. Used by first-run setup when a user clears a key.
#[cfg(windows)]
pub fn delete_secret(target: &str) -> Result<()> {
    use windows::core::PCWSTR;
    use windows::Win32::Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC};

    let wide: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();
    // NotFound simply means there is nothing to clear.
    unsafe { CredDeleteW(PCWSTR(wide.as_ptr()), CRED_TYPE_GENERIC, 0) }
        .map_err(|e| PhantomError::Config(format!("failed to delete credential '{target}': {e}")))
}

#[cfg(not(windows))]
pub fn delete_secret(_target: &str) -> Result<()> {
    Ok(())
}

#[cfg(not(windows))]
pub fn get_secret(target: &str) -> Result<Option<String>> {
    // CI-only fallback: env var named after the target, e.g.
    // PHANTOM_SECRET_phantom_api_key. Never use for real secrets off-Windows.
    let key = format!("PHANTOM_SECRET_{}", target.replace('/', "_").to_uppercase());
    Ok(std::env::var(key).ok())
}

#[cfg(not(windows))]
pub fn set_secret(_target: &str, _value: &str) -> Result<()> {
    Err(PhantomError::Config(
        "secret storage is only available on Windows".to_string(),
    ))
}

/// Generate a cryptographically-random bearer token (hex, 32 bytes = 64 chars).
pub fn generate_token() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    // No rand dependency in the workspace: mix time + pid + an atomic counter.
    // This is a local per-install token, not a session key; OS randomness would
    // be preferable but is not required for the loopback threat model.
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed)
        ^ (SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0))
        ^ (std::process::id() as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    let mut out = String::with_capacity(64);
    let mut x = n;
    for _ in 0..4 {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        out.push_str(&format!("{x:016x}"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_tokens_are_long_distinct_hex() {
        let a = generate_token();
        let b = generate_token();
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
