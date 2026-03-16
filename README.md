# Lille Bus Extension

![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4)
![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue)

Chrome extension (Manifest V3) for the Lille metropolitan area (Métropole Européenne de Lille / MEL) that shows the minutes until your next bus directly on the extension icon badge.

It includes a popup to configure your stop/line/direction, then refreshes the badge automatically every minute.

## Table of contents

- [Features](#features)
- [Install (dev)](#install-dev)
- [Usage](#usage)
- [Configuration](#configuration)
- [Data sources](#data-sources)
- [Permissions](#permissions)
- [Privacy](#privacy)
- [Project status](#project-status)
- [Contributing](#contributing)
- [Disclaimer](#disclaimer)
- [License](#license)

## Features

- Popup flow: search a stop (with suggestions) → pick a line → pick a direction → save
- Badge: displays the remaining minutes until the next bus
- Auto-refresh: updates every minute (background alarm)
- Bus-only filtering: excludes tram/metro and special replacement/night lines (heuristic)
- Line “logos”: displayed as colored pills based on official line colors (not image logos)
- Preferences: light/dark theme toggle + French/English UI toggle (saved locally)

## Install (dev)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `src/` folder of this repo

## Usage

1. Click the extension icon
2. Type your stop name and pick it from suggestions
3. Choose the line, then the direction
4. Click **Save/Valider**

The popup closes and the badge will update automatically.

## Configuration

In the popup, use **Preferences/Préférences** to:

- Switch light/dark theme
- Switch UI language (FR/EN)

## Data sources

This extension uses public open data from the Métropole Européenne de Lille (MEL) (OGC API Features):

- Next arrivals: `ilevia:prochains_passages`
- Stops reference: `ilevia:arret_point`
- Stop → lines mapping: `ilevia:physical_stop`
- Line colors: `ilevia:couleurs_lignes`

Note: data availability and fields may change over time.

## Permissions

- `storage`: save your selection and preferences locally
- `alarms`: refresh badge every minute
- Host permission: `https://data.lillemetropole.fr/*` to fetch open data

## Privacy

- No account, no analytics
- No personal data is collected or sent anywhere
- Your selection (stop/line/direction) and preferences (theme/language) are stored in `chrome.storage.local`

## Project status

Working MVP. Some rules (e.g. “regular bus lines/stops”) are heuristic-based and may be tuned.

## Contributing

PRs welcome.

- See `CONTRIBUTING.md`
- Code of conduct: `CODE_OF_CONDUCT.md`
- Security: `SECURITY.md`

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by any public transport operator. It is intended for the Lille metropolitan area (MEL) only.

## License

GPL-3.0 (see `LICENSE`).