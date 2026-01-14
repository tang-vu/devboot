---
description: How to release a new version of DevBoot
---

# Release Process

## Version Bump

Update version in these files:
1. `src-tauri/Cargo.toml` → `version = "x.x.x"`
2. `src-tauri/tauri.conf.json` → `"version": "x.x.x"`
3. `package.json` → `"version": "x.x.x"`

## Build Release

// turbo
```bash
npm run tauri build
```

## Output Files

After build:
- `src-tauri/target/release/bundle/nsis/DevBoot_x.x.x_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/DevBoot_x.x.x_x64_en-US.msi`

## Git Release

```bash
git add .
git commit -m "Release vx.x.x"
git tag vx.x.x
git push origin main --tags
```

## GitHub Release

1. Go to https://github.com/tang-vu/devboot/releases
2. Click "Create new release"
3. Select tag `vx.x.x`
4. Title: `DevBoot vx.x.x`
5. Upload installer files
6. Publish release
