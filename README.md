<div align="center">
  <img src="src/assets/icons/lille-bus-extension-logo.png" alt="Lille Bus Extension" width="128" />

  <h1>Lille Bus Extension</h1>

  <p>A Chrome extension that shows the minutes until your next bus — right on the toolbar badge, in real time.</p>

  ![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)
  ![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue)
  ![MEL Open Data](https://img.shields.io/badge/Data-MEL%20Open%20Data-00a651)
  ![GTFS Ilévia](https://img.shields.io/badge/GTFS-Ilévia-ff6600)

</div>

---

## ✨ Features

### 🔴 Live badge
- Displays the **minutes remaining** until the next bus on the Chrome toolbar icon
- Auto-refreshes at a configurable interval (5s · 10s · 15s · 30s · 60s)
- **Color-coded urgency** — blue (> 5 min) → orange (≤ 5 min) → red (≤ 1 min)
- **Glow pulse effect** on the badge when data is live — intensity increases as the bus approaches
- Automatic fallback to static timetables (grey badge) when the API is unavailable

### 👁️ Multi-watcher
- **Watch multiple stop / line / direction combinations** at once
- The badge always shows the **best (minimum) time** across all watchers
- Each watcher displays its own live countdown with a colored pill, urgency indicator, and live dot (●) or tilde (~) to distinguish real-time from scheduled times
- Add watchers with **+ Add**, replace all with **Save**, or remove individually with ×
- **Clear all** button to reset the watchlist in one click

### ⏸ Pause / Resume
- **Pause button** (‖) directly in the popup — stops all API calls
- Badge displays `II` in grey when paused; watchers show a grey pill
- State persists across popup closes and browser restarts

### ⚙️ Preferences
| Setting | Options |
|---|---|
| Theme | Light / Dark (follows system by default) |
| Language | Français / English |
| Refresh interval | 5s · 10s · 15s · 30s · 60s (slider) |
| Glow effect | Enable / Disable the badge pulse animation |

### 🎨 Interface
- **Collapsible selection** — selecting a stop, line or direction hides the other choices; click again to deselect and change
- **Official line colors** — lines rendered as colored pills using the Ilévia color scheme
- **FR / EN** fully localized interface

---

## 🚀 Installation (developer mode)

1. Clone the repository
   ```bash
   git clone https://github.com/imouine/lille-bus-extension.git
   ```
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select the `src/` folder

---

## 🗺️ Usage

### First setup
1. Click the extension icon
2. Type your stop name — select it from suggestions
3. Pick a line, then a direction
4. Click **+ Add** to watch it (or **Save** to replace the watchlist and close)

The badge starts updating immediately.

### Managing watchers
- **Click a selected item** (stop / line / direction) to deselect and pick another
- **+ Add** saves the current selection and resets the form to add another watcher
- **×** on a watcher card removes it individually
- **Clear all** removes all watchers at once

### Pause
Click **‖** (next to ⚙️) to pause all refreshes. The badge shows `II` in grey. Click ▶ to resume.

---

## 🗂️ Project structure

```
src/
├── manifest.json
├── background/
│   └── service-worker.js     # Badge, alarm, live API, pause animation
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js              # Watchlist UI, stop/line/direction picker
├── options/
│   ├── options.html
│   ├── options.css
│   └── options.js            # Theme, language, refresh interval, glow
├── data/
│   └── schedules.json        # Static timetables + GTFS stop IDs (generated)
└── assets/
    └── icons/

scripts/
├── build_schedules.py        # Generates schedules.json from Ilévia GTFS
├── explore_stop_ids.py       # Verifies GTFS stop_id ↔ API identifiant_station mapping
├── check_direction_match.py
└── test_direction_match.py
```

---

## 📡 Data sources

All data comes from the **Métropole Européenne de Lille (MEL) open data platform** and the **Ilévia GTFS feed**:

| Source | URL | Purpose |
|---|---|---|
| `ilevia:prochains_passages` | [MEL Open Data](https://data.lillemetropole.fr) | Real-time next departures (live countdown) |
| `ilevia:couleurs_lignes` | [MEL Open Data](https://data.lillemetropole.fr) | Official line colors (cached 30 days) |
| GTFS Feed | [Ilévia GTFS](https://media.ilevia.fr/opendata/gtfs.zip) | Static timetables, stop IDs, routes & trip headsigns |

Static fallback timetables are built from the **Ilévia GTFS feed** via `scripts/build_schedules.py`. The GTFS data provides stop IDs (`stop_id`) that enable reliable matching with the live API's `identifiant_station`.

### Matching strategy
Live departures are matched using the **GTFS `stop_id`** (stored as `_stopIds` in `schedules.json`), translated to the API's `identifiant_station` format (`ILEVIA:StopPoint:BP:{id}:LOC`). This guarantees accurate matching regardless of text differences between the API's `sens_ligne` and the GTFS headsign (e.g. `"JEAN PAUL SARTRE"` vs `"JP SARTRE"`). A fuzzy text fallback is used for legacy watchers that predate the GTFS stop ID enrichment.

---

## 🔒 Permissions

| Permission | Reason |
|---|---|
| `storage` | Persist watchlist, preferences, live results and line color cache |
| `alarms` | Schedule periodic badge refresh |
| `https://data.lillemetropole.fr/*` | Fetch live departures and line colors from MEL open data |

**No personal data is collected or transmitted.** Everything is stored only in `chrome.storage.local`, on your own machine.

---

## ⚙️ Regenerating static timetables

```bash
python scripts/build_schedules.py
```

Downloads the latest Ilévia GTFS feed and regenerates `src/data/schedules.json` with timetables and GTFS stop IDs for all regular bus lines.

To verify the GTFS stop ID ↔ API identifier mapping for a specific stop:

```bash
python scripts/explore_stop_ids.py
```

---

## 🤝 Contributing

Contributions are welcome — bug reports, feature ideas, or pull requests.

- Read the [Contributing guide](CONTRIBUTING.md) before opening a PR
- Please follow the [Code of Conduct](CODE_OF_CONDUCT.md)

---

## ⚠️ Disclaimer

This project is not affiliated with, endorsed by, or sponsored by Ilévia, the MEL, or any public transport operator. It covers the Lille metropolitan area only and relies exclusively on publicly available open data.

---

## 📄 License

[GPL-3.0](LICENSE) — © imouine
