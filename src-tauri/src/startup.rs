//! Windows startup management module
//! Handles adding/removing DevBoot from Windows auto-start registry

#[cfg(windows)]
use winreg::enums::*;
#[cfg(windows)]
use winreg::RegKey;

const APP_NAME: &str = "DevBoot";

/// Enable auto-start on Windows login
#[cfg(windows)]
pub fn enable_auto_start() -> Result<(), String> {
    let exe_path = std::env::current_exe()
        .map_err(|e| format!("Failed to get exe path: {}", e))?;
    
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let run_key = hkcu
        .open_subkey_with_flags(
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            KEY_WRITE,
        )
        .map_err(|e| format!("Failed to open registry: {}", e))?;

    run_key
        .set_value(APP_NAME, &exe_path.to_string_lossy().to_string())
        .map_err(|e| format!("Failed to set registry value: {}", e))?;

    Ok(())
}

/// Disable auto-start on Windows login
#[cfg(windows)]
pub fn disable_auto_start() -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let run_key = hkcu
        .open_subkey_with_flags(
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            KEY_WRITE,
        )
        .map_err(|e| format!("Failed to open registry: {}", e))?;

    run_key
        .delete_value(APP_NAME)
        .map_err(|e| format!("Failed to delete registry value: {}", e))?;

    Ok(())
}

/// Check if auto-start is enabled
#[cfg(windows)]
pub fn is_auto_start_enabled() -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    
    if let Ok(run_key) = hkcu.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run") {
        run_key.get_value::<String, _>(APP_NAME).is_ok()
    } else {
        false
    }
}

// Non-Windows stubs
#[cfg(not(windows))]
pub fn enable_auto_start() -> Result<(), String> {
    Err("Auto-start not supported on this platform".to_string())
}

#[cfg(not(windows))]
pub fn disable_auto_start() -> Result<(), String> {
    Err("Auto-start not supported on this platform".to_string())
}

#[cfg(not(windows))]
pub fn is_auto_start_enabled() -> bool {
    false
}
