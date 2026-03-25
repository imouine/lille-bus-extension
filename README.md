<div align="center">
  <img src="src/assets/icons/lille-bus-extension-logo.png" alt="Lille Bus Extension" width="128" />

  <h1>Lille Bus Extension</h1>

  <p>A Chrome extension that shows the minutes until your next bus in real time — right on the toolbar icon.</p>

  ![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)
  ![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue)
  ![MEL Open Data](https://img.shields.io/badge/Data-MEL%20Open%20Data-00a651)

</div>

---

## ✨ Features

- **Real-time badge** — displays the minutes remaining until the next bus, auto-refreshed every minute
- **Live departure times** — queries the MEL open data API (`ilevia:prochains_passages`), with automatic fallback to static timetables when the API is unavailable
- **Configuration popup** — stop search with live suggestions, line picker, and direction picker
- **Official line colors** — lines are displayed as colored pills using the official Ilévia color scheme
- **Light / dark theme** — follows the system theme automatically, overridable in preferences
- **FR / EN interface** — language toggle available in preferences

---

## 🚀 Installation (developer mode)

1. Clone the repository
   ```bash
   git clone https://github.com/imouine/lille-bus-extension.git
   ```
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select the `src/` folder of this repository

---

## 🗺️ Usage

1. Click the extension icon
2. Type your stop name and select it from the suggestions
3. Pick a line, then a direction
4. Click **Save / Valider**

The popup closes and the badge starts updating automatically every minute.

**Preferences** (theme, language) are accessible via the ⚙️ button at the bottom of the popup.

---

## 🗂️ Project structure

```
src/
├── manifest.json
├── background/
│   └── service-worker.js   # Badge, alarm, live API calls
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js            # Configuration UI + next departure display
├── options/
│   ├── options.html
│   ├── options.css
│   └── options.js          # Preferences page
├── data/
│   └── schedules.json      # Static timetables generated from the Ilévia GTFS feed
└── assets/
    └── icons/

scripts/
├── build_schedules.py      # Generates schedules.json from the Ilévia GTFS feed
├── check_direction_match.py
└── test_direction_match.py
```

---

## 📡 Data sources

All data comes from the **Métropole Européenne de Lille (MEL) open data platform** via OGC API Features:

| Collection | Purpose |
|---|---|
| `ilevia:prochains_passages` | Real-time next departures |
| `ilevia:couleurs_lignes` | Official line colors |

Static fallback timetables are generated from the **public Ilévia GTFS feed** using `scripts/build_schedules.py`.

---

## 🔒 Permissions

| Permission | Reason |
|---|---|
| `storage` | Save your stop selection and preferences locally |
| `alarms` | Refresh the badge every minute |
| `https://data.lillemetropole.fr/*` | Fetch open data from the MEL platform |

**No personal data is collected or transmitted.** Your selection (stop / line / direction) and preferences are stored only in `chrome.storage.local`, on your own machine.

---

## ⚙️ Regenerating static timetables

```bash
python scripts/build_schedules.py
```

Downloads the latest Ilévia GTFS feed and regenerates `src/data/schedules.json`.

---

## 🤝 Contributing

Contributions are welcome! Whether it's a bug report, a feature idea, or a pull request — feel free to get involved.

- Read the [Contributing guide](CONTRIBUTING.md) to get started
- Please follow the [Code of Conduct](CODE_OF_CONDUCT.md)

---

## ⚠️ Disclaimer

This project is not affiliated with, endorsed by, or sponsored by Ilévia, the MEL, or any public transport operator. It is intended for the Lille metropolitan area only and relies exclusively on publicly available open data.

---

## 📄 License

[GPL-3.0](LICENSE) — © imouine
