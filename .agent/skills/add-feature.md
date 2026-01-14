---
description: How to add a new feature to DevBoot
---

# Adding Features to DevBoot

## Project Structure

```
devboot/
├── src-tauri/src/       # Rust backend
│   ├── lib.rs           # Entry point, register commands
│   ├── commands.rs      # Tauri IPC commands
│   ├── config.rs        # Config persistence
│   ├── process_manager.rs # Git Bash process management
│   ├── detector.rs      # Project type detection
│   └── startup.rs       # Windows auto-start
├── src/                 # React frontend
│   ├── components/      # UI components
│   ├── hooks/           # React hooks
│   ├── types/           # TypeScript interfaces
│   ├── App.tsx          # Main app
│   └── App.css          # Global styles
```

## Adding a Backend Feature

1. Create new module in `src-tauri/src/`
2. Add `mod your_module;` in `lib.rs`
3. Create Tauri command with `#[tauri::command]`
4. Register in `lib.rs` invoke_handler

Example:
```rust
// src-tauri/src/your_module.rs
pub fn your_function() -> String {
    "Hello".to_string()
}

// src-tauri/src/commands.rs
#[tauri::command]
pub fn your_command() -> String {
    crate::your_module::your_function()
}

// src-tauri/src/lib.rs - add to invoke_handler
commands::your_command,
```

## Adding a Frontend Feature

1. Create component in `src/components/YourComponent.tsx`
2. Add CSS in `src/components/YourComponent.css`
3. Import and use in `src/App.tsx`
4. Call backend with `invoke('your_command')`

Example:
```typescript
import { invoke } from '@tauri-apps/api/core';

const result = await invoke<string>('your_command');
```

## Type Sync

Keep TypeScript interfaces (`src/types/index.ts`) in sync with Rust structs.
