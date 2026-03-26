# Privacy Policy — Lille Bus Extension

**Last updated:** March 26, 2026

## Overview

Lille Bus Extension is a free, open-source Chrome extension that displays real-time bus arrival times for the Lille metropolitan area (France). This policy explains what data the extension accesses and how it is handled.

## Data collection

**Lille Bus Extension does not collect, transmit, or store any personal data.**

The extension does not:
- Collect your browsing history
- Track your location
- Use analytics or telemetry
- Send any data to external servers other than the public API described below
- Use cookies or any form of user tracking

## Network requests

The extension makes requests to **one single endpoint**:

| Domain | Purpose |
|---|---|
| `data.lillemetropole.fr` | Fetch real-time bus departures and official line colors from the MEL (Métropole Européenne de Lille) open data API |

These requests contain only the stop name being queried. No user identifiers, tokens, or personal data are included in any request.

## Local storage

The extension uses `chrome.storage.local` to persist:

- Your selected stop/line/direction combinations (watchlist)
- Your preferences (theme, language, refresh interval, glow effect)
- Cached API responses (live departure times, line colors)

All data is stored **locally on your machine** and is never transmitted anywhere.

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Save your watchlist and preferences locally |
| `alarms` | Schedule periodic badge refresh |
| `https://data.lillemetropole.fr/*` | Fetch live departure data from the public MEL API |

## Third-party services

The extension relies solely on the [MEL Open Data platform](https://data.lillemetropole.fr) and the [Ilévia GTFS feed](https://media.ilevia.fr/opendata/gtfs.zip). No other third-party services are used.

## Open source

The full source code is available at:
[https://github.com/imouine/lille-bus-extension](https://github.com/imouine/lille-bus-extension)

## Contact

For any questions regarding this privacy policy, please open an issue on [GitHub](https://github.com/imouine/lille-bus-extension/issues) or reach out at [imouine.com](https://imouine.com).

## Changes to this policy

Any changes to this privacy policy will be reflected in this document and in the GitHub repository.

