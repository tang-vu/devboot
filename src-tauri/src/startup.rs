//! Windows startup management module
//! Handles adding/removing DevBoot from Windows auto-start

#[cfg(windows)]
use std::path::PathBuf;

const APP_NAME: &str = "DevBoot";

/// Get Windows Startup folder path
#[cfg(windows)]
fn get_startup_folder() -> Result<PathBuf, String> {
    let appdata = std::env::var("APPDATA")
        .map_err(|_| "Failed to get APPDATA path".to_string())?;
    
    let startup_path = PathBuf::from(appdata)
        .join("Microsoft")
        .join("Windows")
        .join("Start Menu")
        .join("Programs")
        .join("Startup");
    
    Ok(startup_path)
}

/// Get shortcut path in Startup folder
#[cfg(windows)]
fn get_shortcut_path() -> Result<PathBuf, String> {
    let startup_folder = get_startup_folder()?;
    Ok(startup_folder.join(format!("{}.lnk", APP_NAME)))
}

/// Enable auto-start on Windows login using Startup folder shortcut
#[cfg(windows)]
pub fn enable_auto_start() -> Result<(), String> {
    use std::process::Command;
    
    let exe_path = std::env::current_exe()
        .map_err(|e| format!("Failed to get exe path: {}", e))?;
    
    let shortcut_path = get_shortcut_path()?;
    
    // Use PowerShell to create shortcut
    let ps_script = format!(
        r#"
        $WshShell = New-Object -ComObject WScript.Shell
        $Shortcut = $WshShell.CreateShortcut('{}')
        $Shortcut.TargetPath = '{}'
        $Shortcut.WorkingDirectory = '{}'
        $Shortcut.Description = 'DevBoot - GitBash Manager'
        $Shortcut.Save()
        "#,
        shortcut_path.to_string_lossy().replace("'", "''"),
        exe_path.to_string_lossy().replace("'", "''"),
        exe_path.parent().unwrap_or(&exe_path).to_string_lossy().replace("'", "''")
    );
    
    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", &ps_script])
        .output()
        .map_err(|e| format!("Failed to run PowerShell: {}", e))?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to create shortcut: {}", stderr));
    }
    
    Ok(())
}

/// Disable auto-start on Windows login
#[cfg(windows)]
pub fn disable_auto_start() -> Result<(), String> {
    let shortcut_path = get_shortcut_path()?;
    
    if shortcut_path.exists() {
        std::fs::remove_file(&shortcut_path)
            .map_err(|e| format!("Failed to remove shortcut: {}", e))?;
    }
    
    // Also clean up old registry entry if exists
    cleanup_old_registry();
    
    Ok(())
}

/// Clean up old registry-based auto-start
#[cfg(windows)]
fn cleanup_old_registry() {
    use winreg::enums::*;
    use winreg::RegKey;
    
    if let Ok(hkcu) = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(r"Software\Microsoft\Windows\CurrentVersion\Run", KEY_WRITE)
    {
        let _ = hkcu.delete_value(APP_NAME);
    }
}

/// Check if auto-start is enabled
#[cfg(windows)]
pub fn is_auto_start_enabled() -> bool {
    if let Ok(shortcut_path) = get_shortcut_path() {
        if shortcut_path.exists() {
            return true;
        }
    }
    
    // Also check old registry method
    use winreg::enums::*;
    use winreg::RegKey;
    
    if let Ok(run_key) = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run")
    {
        if run_key.get_value::<String, _>(APP_NAME).is_ok() {
            return true;
        }
    }
    
    false
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
