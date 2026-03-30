# Changelog

All notable changes to this project will be documented in this file.

The format is inspired by Keep a Changelog,
and this project follows Semantic Versioning.

---

## [Unreleased]

### Added
-

### Changed
-

### Fixed
-

---

## [1.0.0] - 2026-03-30

### Added
- First public release of Lille Bus — Live Countdown
- Live toolbar badge displaying real-time minutes until next bus
- Color-coded urgency system (blue → orange → red)
- Glow pulse effect on badge based on urgency
- Multi-watcher system (track multiple stop / line / direction combinations)
- Individual and bulk watcher management (add, remove, clear all)
- Pause / resume functionality with persistent state
- Configurable refresh interval (5s · 10s · 15s · 30s · 60s)
- Light / dark theme support (system-based)
- French / English localization
- Static timetable fallback using Ilévia GTFS data
- Official line colors integration
- Options page for user preferences
- Chrome storage persistence (local only)
- Privacy policy (no tracking, no data collection)
- Project documentation (README, contributing guide, code of conduct, license)

### Technical
- Chrome Extension built with Manifest V3
- Background service worker handling badge updates and API calls
- Integration with MEL Open Data APIs
- GTFS data processing via Python scripts
