# Privacy Policy — Bus Lille Ilévia

**Last updated:** November 13, 2026

## Overview

Bus Lille Ilévia is a free, open-source Chrome extension that displays real-time bus arrival times for the Lille metropolitan area (France). This policy explains what data the extension accesses and how it is handled.

## Data collection

**Bus Lille Ilévia does not collect, sell, or store personal data on servers controlled by the developer.**

The extension does not:
- Collect your browsing history
- Track your location
- Use analytics or telemetry
- Send any data to external servers other than the public API described below
- Use cookies or any form of user tracking

## Network requests

The extension makes automatic requests to **one single domain**:

| Domain | Purpose |
|---|---|
| `data.lillemetropole.fr` | Fetch real-time bus departures and official line colors from the MEL (Métropole Européenne de Lille) open data API |

These requests contain the public identifiers of the transit stops in the watchlist, as required to retrieve their departures. They do not contain a user identifier, authentication token, browsing history, precise location, or the other locally stored preferences. As with any web request, the MEL service may technically receive network metadata such as the user's IP address; the extension developer does not receive or store it.

## Local storage

The extension uses `chrome.storage.local` to persist:

- Your selected stop/line/direction combinations (watchlist)
- Your preferences (theme, language, refresh interval)
- Cached API responses (live departure times, status timestamps, line colors)

This data is stored **locally on your machine**. Only the public transit stop identifiers needed for a live-data query are sent to the MEL API, as described above.

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Save your watchlist and preferences locally |
| `alarms` | Schedule periodic badge refresh |
| `https://data.lillemetropole.fr/*` | Fetch live departure data from the public MEL API |

## Third-party services

Automatic network requests are limited to the [MEL Open Data platform](https://data.lillemetropole.fr). The Ilévia GTFS feed is downloaded only when the project maintainer rebuilds the embedded fallback schedules; the installed extension does not download it automatically.

The options page contains user-initiated links to the project source code, issue tracker, and privacy policy on GitHub. GitHub is contacted only if the user chooses to open one of these links. All images displayed by the extension itself are bundled locally.

## Open source

The full source code is available at:
[https://github.com/imouine/lille-bus-extension](https://github.com/imouine/lille-bus-extension)

## Contact

For any questions regarding this privacy policy, please open an issue on [GitHub](https://github.com/imouine/lille-bus-extension/issues) or reach out at [imouine.com](https://imouine.com).

## Changes to this policy

Any changes to this privacy policy will be reflected in this document and in the GitHub repository.

