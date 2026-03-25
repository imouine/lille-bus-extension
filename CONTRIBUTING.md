# Contributing to Lille Bus Extension

First off — thank you for taking the time to contribute! 🎉

This is a small open-source project and every contribution matters, whether it's a bug report, a suggestion, a documentation fix, or a pull request.

---

## Table of contents

- [Reporting a bug](#reporting-a-bug)
- [Suggesting a feature](#suggesting-a-feature)
- [Development setup](#development-setup)
- [Making a pull request](#making-a-pull-request)
- [Code style](#code-style)

---

## Reporting a bug

Found something broken? Please [open an issue](https://github.com/imouine/lille-bus-extension/issues) and include:

- A clear description of the problem
- Steps to reproduce it
- What you expected to happen vs. what actually happened
- Your Chrome version and OS

The more context you provide, the faster it gets fixed.

---

## Suggesting a feature

Feature ideas are welcome. Before opening a large pull request, please **open an issue first** to discuss the idea. This avoids wasted effort if the direction doesn't fit the project.

---

## Development setup

1. **Clone** the repository

   ```bash
   git clone https://github.com/imouine/lille-bus-extension.git
   cd lille-bus-extension
   ```

2. **Load the extension** in Chrome

   - Go to `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked** and select the `src/` folder

3. **Regenerate static timetables** (optional, requires Python 3)

   ```bash
   python scripts/build_schedules.py
   ```

   This downloads the latest Ilévia GTFS feed and rebuilds `src/data/schedules.json`.

---

## Making a pull request

1. Fork the repository and create a branch from `main`

   ```bash
   git checkout -b fix/my-bug-fix
   ```

2. Make your changes and test them locally in Chrome

3. Keep commits focused — one logical change per commit

4. Open a pull request against `main` with a clear description of what changed and why

---

## Code style

- Plain **Vanilla JS** — no build step, no bundler, no framework
- The extension uses **Chrome Manifest V3** APIs (`chrome.alarms`, `chrome.storage`, `chrome.action`)
- Keep functions small and well-commented
- The `src/` folder is what gets loaded directly as an unpacked extension — keep it clean

---

Thanks again for contributing. Every improvement, big or small, is appreciated. 🚌

