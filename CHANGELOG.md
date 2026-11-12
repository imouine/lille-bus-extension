# Changelog

All notable changes to this project will be documented in this file.

The format is inspired by Keep a Changelog,
and this project follows Semantic Versioning.

---

## [1.0.2] - 2026-11-13

### Fixed
- **MEL API migration** — replaced the discontinued `/data/ogcapi` endpoints with the public GeoServer WFS service for live departures and official line colors
- **GeoJSON response parsing** — live departures and line colors are now read from WFS feature properties, while retaining compatibility with the legacy response format
- **Reliable timestamps** — explicit UTC offsets from the MEL feed are now preserved instead of being reinterpreted as local time
- **GTFS after-midnight trips** — times such as `25:10` keep their service day and no longer wrap incorrectly to `01:10`
- **Direction matching** — added normalized matching for known MEL/GTFS destination differences
- **False terminus directions** — final and no-pickup GTFS stops are no longer offered as departures toward the stop already selected
- **Same-name stops** — GTFS parent-station IDs and municipality labels prevent unrelated stops such as the many “Mairie” stations from being merged
- **Exact service days** — embedded schedules now use every GTFS service date instead of three representative weekday/weekend profiles
- **Stale badge values** — the badge countdown is recalculated every 30 seconds even when API refresh is set to five minutes

### Technical
- One batched MEL request now refreshes the whole watchlist instead of one request per watched trip
- Background refresh intervals now respect Chrome's 30-second minimum
- Removed the continuous 50 ms badge animation loop and its repeated storage reads
- Results are keyed by stable watcher IDs and include departure timestamps, source, status and freshness metadata
- Added shared ES modules for configuration, MEL access and transport logic
- Added automated tests, release validation and GitHub Actions CI
- Release validation now rejects expired embedded GTFS schedules
- Added pure background-logic and DOM-structure tests; CI now runs the complete check and package-integrity workflow
- Added localized manifest metadata in French and English

### Changed
- Rebuilt the popup as a dashboard with saved trips first, explicit data states and up to three upcoming departures
- Simplified the add-trip flow to one clear action
- Added a manual refresh action, last-update indicator and improved empty/error states
- Replaced the old refresh choices with `30 s`, `1 min`, `2 min` and `5 min`
- Removed the continuous badge glow and kept only lightweight interface animations that respect the system’s reduced-motion preference
- Added reduced-motion support and improved keyboard focus and touch targets
- Introduced a simplified icon designed to remain readable at 16 px
- Rebuilt the options page around the three functional preferences, a reset action and essential project links; removed the tab navigation, social profile card and donation panel
- Added a colour guide explaining live urgency and theoretical-time states
- The options page now reads the version directly from the manifest and uses only bundled images
- The popup paints saved trips before loading the 4 MB schedule file and updates countdown rows without rebuilding every card
- Added keyboard combobox navigation, exact departure-time tooltips, stale-data warnings and larger touch targets
- Existing name-based watchlists are migrated to stable GTFS station IDs when the match is unambiguous
- Added an explicit independent/non-affiliated notice and clarified the privacy disclosure for public stop-ID API queries

---

## [1.0.1] - 2026-05-04

### Fixed
- **Badge not updated after Save** — clicking "Save" now triggers an immediate badge refresh before closing the popup, so the badge no longer stays stuck on `…`
- **Wrong bus shown in badge with mixed live/theoretical watchers** — the badge now always displays the true minimum arrival time across all watchers; previously a live arrival in 6 min would incorrectly override a theoretical arrival in 3 min
- **Popup rounded corners** — removed the `border-radius` on the popup shell; Chrome already clips the popup to a rectangle, so the rounded border was visible as a white gap
- **Ko-fi icon in Support settings** — replaced the generic cup SVG with a proper mug + heart illustration

### Improved
- **Line picker** — each line in the dropdown now shows its full name (e.g. *Liane 5*) and its two terminus endpoints separated by `<>` (e.g. *Marcq Ferme Aux Oies <> Haubourdin Le Parc*), sourced directly from the GTFS `routes.txt` data; this replaces the previous per-stop direction list which was confusing on multi-direction stops
- **schedules.json** — a new top-level `routes` section stores `long_name` and `terminus` for every bus line, rebuilt from the latest GTFS feed

---

## [1.0.0] - 2026-03-30

### Added
- First public release of Bus Lille Ilévia — Live Countdown
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
