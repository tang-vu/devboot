---
description: How to build and run DevBoot in development mode
---

# Build and Run DevBoot

## Prerequisites
- Node.js 20.19+ or 22.12+
- Rust (latest stable)
- Git Bash installed

## Development Mode

```bash
# Install dependencies
npm install

# Run dev server (hot-reload)
npm run tauri dev
```

## Production Build

```bash
# Build production bundle
npm run tauri build

# Outputs:
# - src-tauri/target/release/devboot.exe
# - src-tauri/target/release/bundle/nsis/DevBoot_x.x.x_x64-setup.exe
# - src-tauri/target/release/bundle/msi/DevBoot_x.x.x_x64_en-US.msi
```

## Quick Commands

// turbo
```bash
npm run tauri dev
```

// turbo
```bash
npm run tauri build
```
