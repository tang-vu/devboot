# Contributing to DevBoot

Thank you for considering contributing to DevBoot! 🎉

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/) (latest stable)
- [Git Bash](https://git-scm.com/)

### Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/devboot.git
cd devboot

# Install dependencies
npm install

# Run in development mode
npm run tauri dev
```

## 📝 Code Style

- Use **TypeScript** for frontend code
- Use **Rust** for backend/Tauri code
- Follow existing code formatting
- Use meaningful variable and function names
- Add comments for complex logic

## 🔄 Pull Request Process

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes with clear messages (`git commit -m 'Add amazing feature'`)
4. **Push** to your fork (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### PR Guidelines

- Keep changes focused and atomic
- Update documentation if needed
- Test your changes thoroughly
- Describe what your PR does and why

## 🐛 Reporting Issues

When reporting bugs, please include:

- DevBoot version
- OS version
- Steps to reproduce
- Expected vs actual behavior
- Screenshots if applicable

## 💡 Feature Requests

We welcome feature ideas! When suggesting features:

- Check if it already exists or is planned
- Describe the problem it solves
- Explain your proposed solution

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for helping make DevBoot better! ❤️

## Validation

```bash
npm ci
npm test
npm run build
# On Windows (PowerShell, with the Windows SDK installed):
pwsh -File ./scripts/test-rust-windows.ps1
# On other supported development hosts:
cargo test --manifest-path src-tauri/Cargo.toml --locked --all-targets
```

The frontend tests render the real form, App, and project hook with a synthetic
Tauri bridge. Rust tests use Tauri's mock runtime and test-owned temporary config
files to check IPC defaults, environment validation, and saved values. Process
environment tests launch only disposable Git Bash fixtures in temporary
directories to check initial start and restart; no configured user projects are
run and no Windows startup settings are changed. CI runs these checks on Windows; the tests do
not replace manual Windows GUI acceptance testing.

Terminal input tests also render the real Terminal and App selection flow with
deferred, synthetic IPC responses. They check project switches, closed views,
pending edits, duplicate submissions, failure/retry, stopped states, and IME
Enter without sending input or interrupts to any OS process.

Terminal-following component tests cover keyboard controls, paused state during
updates and clear boundaries, repeated text, and project/view lifetimes. JSDOM
does not perform layout or native scrolling; these tests do not establish
viewport anchoring. See [the synthetic browser fixture](tests/browser/README.md)
for real-browser checks of scrolling, wrapping, resizing, and retention without
launching any configured project or invoking Tauri commands.

Project-state tests render the real hook with deferred synthetic reads and event
registrations. They cover StrictMode replay, cleanup and registration failure,
superseded refreshes, and per-project status events arriving during reads. Log
tests cover accepted-record identities, reordered snapshots/events, identical
text, clear boundaries, retention, deleted-project retirement, and backend
session replacement. Only log hydration waits for its listener; project/status
loading remains independent. Failed listener setup leaves snapshot reads usable
and shows a live-update notice. Status events before subscription can still be
missed. Add/update/restart mutation races outside log reconciliation remain
separate work.

The Rust log-buffer tests are pure data tests: they do not create an app, launch
a process, touch project files, or change settings. They cover decimal sequence
serialization, retention and clear boundaries, and explicit counter exhaustion.
See [the log protocol](docs/log-protocol.md) for compatibility and delivery limits.

The Windows runner compiles every test target, embeds a Common Controls v6
manifest in only the generated test executables, and runs each one. This handles
[Tauri's Windows test-loader issue](https://github.com/tauri-apps/tauri/issues/13419)
without changing the application's build or manifest. Compilation, manifest, or
test failures fail the command.

Settings lifecycle tests render the real App, Settings dialog, and settings hook
with deferred synthetic IPC reads and writes. They cover load/retry, StrictMode
read ownership, every dismissal path, failed draft recovery, duplicate save
prevention across reopen, and partial startup failures. The full combination of
supported choices verifies exact preference payloads and the matching startup
command order. These tests do not invoke Tauri or change real settings, startup
entries, user projects, or processes.

Project detection tests render the real form and App with deferred synthetic
folder pickers, detector responses, and saves. They cover reordered results,
A-to-B-to-A selection, typed/browse/drop ownership, debounce and dismissal,
manual/template/suggestion edits, recoverable failures, save gating, and exact
add/update payloads. The separate project-detection browser fixture covers native
keyboard and mouse interactions using an isolated in-memory bridge. These tests
do not open native folder dialogs, inspect real directories, or start processes.
