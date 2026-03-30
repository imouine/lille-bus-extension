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

## [1.0.1] - 2026-03-31

### Fixed
- **Badge not updated after Save** — clicking "Save" now triggers an immediate badge refresh before closing the popup, so the badge no longer stays stuck on `…`
- **Wrong bus shown in badge with mixed live/theoretical watchers** — the badge now always displays the true minimum arrival time across all watchers; previously a live arrival in 6 min would incorrectly override a theoretical arrival in 3 min
- **Popup rounded corners** — removed the `border-radius` on the popup shell; Chrome already clips the popup to a rectangle, so the rounded border was visible as a white gap
- **Ko-fi icon in Support settings** — replaced the generic cup SVG with a proper mug + heart illustration

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
