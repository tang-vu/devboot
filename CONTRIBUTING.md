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
cd src-tauri
cargo test --locked --all-targets
```

The frontend tests render the real form, App, and project hook with a synthetic
Tauri bridge. Rust tests use Tauri's mock runtime and test-owned temporary config
files to check IPC defaults and saved values. They do not launch project commands
or change Windows startup settings. CI runs these checks on Windows; the tests do
not replace manual Windows GUI acceptance testing.
