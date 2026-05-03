<div align="center">
  <img src="src/assets/icons/lille-bus-extension-logo.png" alt="Lille Bus Extension" width="128" />

  <h1>Lille Bus — Compte à rebours en direct</h1>

  <p>Une extension Chrome qui affiche les minutes avant le prochain bus — directement sur l'icône de la barre d'outils, en temps réel.</p>

  [![Chrome Web Store](https://img.shields.io/badge/Chrome-Web%20Store-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/kjacdkifcibhcolpbooimeidhhjdlfnk)
  ![Version](https://img.shields.io/badge/version-1.0.1-brightgreen)
  ![Manifest V3](https://img.shields.io/badge/Manifest-V3-4285F4?logo=googlechrome&logoColor=white)
  ![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue)
  ![MEL Open Data](https://img.shields.io/badge/Data-MEL%20Open%20Data-00a651)
  ![GTFS Ilévia](https://img.shields.io/badge/GTFS-Ilévia-ff6600)
  [![Ko-fi](https://img.shields.io/badge/Ko--fi-Soutenir-ff5e5b?logo=ko-fi&logoColor=white)](https://ko-fi.com/imouine)

</div>

---

## ✨ Fonctionnalités

### 🔴 Badge en direct
- Affiche le **temps restant en minutes** avant le prochain bus sur l'icône Chrome
- Rafraîchissement automatique à intervalle configurable (5s · 10s · 15s · 30s · 60s)
- **Couleur selon l'urgence** — bleu (> 5 min) → orange (2–5 min) → rouge (≤ 1 min)
- **Effet de halo pulsant** sur le badge quand les données sont en direct — l'intensité augmente à l'approche du bus
- Bascule automatique sur les horaires statiques (badge gris) en cas d'indisponibilité de l'API

### 👁️ Multi-surveillance
- **Surveiller plusieurs combinaisons arrêt / ligne / direction** simultanément
- Le badge affiche toujours le **meilleur temps (minimum)** parmi tous les suivis
- Chaque suivi affiche son propre compte à rebours avec une pastille colorée, un indicateur d'urgence, et un point (●) ou un tilde (~) pour distinguer temps réel et horaire théorique
- Ajouter des suivis avec **+ Ajouter**, valider et fermer avec **Valider**, ou supprimer individuellement avec ×
- Bouton **Tout supprimer** pour réinitialiser la liste en un clic

### ⏸ Pause / Reprise
- **Bouton pause** (‖) directement dans le popup — stoppe tous les appels API
- Le badge affiche `II` en gris quand en pause ; les suivis affichent une pastille grise
- L'état persiste après fermeture du popup et redémarrage du navigateur

### ⚙️ Préférences
| Réglage | Description |
|---|---|
| Mode nuit | Bascule entre le thème clair et sombre (suit le système par défaut) |
| Langue | Bascule entre Français et English |
| Fréquence d'actualisation | 5s · 10s · 15s · 30s · 60s (curseur) |
| Effet de glow | Active / désactive l'animation de pulsation du badge sur les données en direct |
| Soutenir | Intégration Ko-fi — soutenez le projet directement depuis la page d'options |

### 🎨 Interface
- **Sélection rétractable** — sélectionner un arrêt, une ligne ou une direction masque les autres choix ; cliquer à nouveau pour désélectionner et modifier
- **Couleurs officielles des lignes** — lignes affichées en pastilles colorées selon le schéma Ilévia
- Interface entièrement localisée **FR / EN**

---

## 🚀 Installation

### Depuis le Chrome Web Store *(recommandé)*

[![Installer depuis le Chrome Web Store](https://img.shields.io/badge/Installer%20sur-Chrome-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/jllciocpnnbaakdcommdoammhifoncme)

1. Rendez-vous sur la [page du Chrome Web Store](https://chromewebstore.google.com/detail/jllciocpnnbaakdcommdoammhifoncme)
2. Cliquez sur **Ajouter à Chrome**
3. Cliquez sur l'icône de l'extension dans la barre d'outils pour démarrer

### Mode développeur (depuis les sources)

1. Cloner le dépôt
   ```bash
   git clone https://github.com/imouine/lille-bus-extension.git
   ```
2. Ouvrir `chrome://extensions` dans Chrome
3. Activer le **Mode développeur** (bouton en haut à droite)
4. Cliquer sur **Charger l'extension non empaquetée**
5. Sélectionner le dossier `src/`

---

## 🗺️ Utilisation

### Premier démarrage
1. Cliquer sur l'icône de l'extension
2. Taper le nom de votre arrêt — le sélectionner dans les suggestions
3. Choisir une ligne, puis une direction
4. Cliquer sur **+ Ajouter** pour ajouter un suivi supplémentaire (ou **Valider** pour enregistrer et fermer)

Le badge se met à jour immédiatement.

### Gérer les suivis
- **Cliquer sur un élément sélectionné** (arrêt / ligne / direction) pour le désélectionner et en choisir un autre
- **+ Ajouter** enregistre la sélection courante et réinitialise le formulaire pour en ajouter un autre
- **×** sur une carte de suivi la supprime individuellement
- **Tout supprimer** supprime tous les suivis d'un coup

### Pause
Cliquer sur **‖** (à côté de ⚙️) pour mettre en pause tous les rafraîchissements. Le badge affiche `II` en gris. Cliquer sur ▶ pour reprendre.

---

## 🗂️ Structure du projet

```
src/
├── manifest.json
├── background/
│   └── service-worker.js     # Badge, alarme, API en direct, animation de pause
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js              # Interface de la liste de suivis, sélecteur arrêt/ligne/direction
├── options/
│   ├── options.html
│   ├── options.css
│   └── options.js            # Thème, langue, intervalle de rafraîchissement, halo
├── data/
│   └── schedules.json        # Horaires statiques + identifiants GTFS (généré)
└── assets/
    └── icons/

scripts/
├── build_schedules.py        # Génère schedules.json depuis le GTFS Ilévia
├── explore_stop_ids.py       # Vérifie la correspondance stop_id GTFS ↔ identifiant_station API
├── check_direction_match.py
├── test_direction_match.py
├── package.sh                # Empaquetage CWS (macOS / Linux)
└── package.ps1               # Empaquetage CWS (Windows)
```

---

## 📡 Sources de données

Toutes les données proviennent de la **plateforme open data de la Métropole Européenne de Lille (MEL)** et du **flux GTFS Ilévia** :

| Source | URL | Utilisation |
|---|---|---|
| `ilevia:prochains_passages` | [MEL Open Data](https://data.lillemetropole.fr) | Prochains passages en temps réel (compte à rebours) |
| `ilevia:couleurs_lignes` | [MEL Open Data](https://data.lillemetropole.fr) | Couleurs officielles des lignes (cache 30 jours) |
| Flux GTFS | [Ilévia GTFS](https://media.ilevia.fr/opendata/gtfs.zip) | Horaires statiques, identifiants d'arrêts, routes et destinations |

Les horaires de secours statiques sont construits depuis le **flux GTFS Ilévia** via `scripts/build_schedules.py`. Les données GTFS fournissent des identifiants d'arrêt (`stop_id`) permettant une correspondance fiable avec l'`identifiant_station` de l'API en direct.

### Stratégie de correspondance
Les passages en direct sont mis en correspondance via le **`stop_id` GTFS** (stocké comme `_stopIds` dans `schedules.json`), converti au format `identifiant_station` de l'API (`ILEVIA:StopPoint:BP:{id}:LOC`). Cela garantit une correspondance précise indépendamment des différences textuelles entre le `sens_ligne` de l'API et le headsign GTFS (ex. `"JEAN PAUL SARTRE"` vs `"JP SARTRE"`). Un fallback textuel approximatif est utilisé pour les anciens suivis antérieurs à l'enrichissement GTFS.

---

## 🔒 Permissions

| Permission | Raison |
|---|---|
| `storage` | Persister la liste de suivis, les préférences, les résultats en direct et le cache des couleurs de lignes |
| `alarms` | Planifier le rafraîchissement périodique du badge |
| `https://data.lillemetropole.fr/*` | Récupérer les passages en direct et les couleurs de lignes depuis la MEL open data |

**Aucune donnée personnelle n'est collectée ou transmise.** Tout est stocké uniquement dans `chrome.storage.local`, sur votre propre machine.

---

## ⚙️ Régénérer les horaires statiques

```bash
python scripts/build_schedules.py
```

Télécharge le dernier flux GTFS Ilévia et régénère `src/data/schedules.json` avec les horaires et identifiants GTFS pour toutes les lignes de bus régulières.

Pour vérifier la correspondance identifiant GTFS ↔ identifiant API pour un arrêt précis :

```bash
python scripts/explore_stop_ids.py
```

---

## 📋 Changelog

Voir [CHANGELOG.md](CHANGELOG.md) pour l'historique complet des versions.

---

## ❤️ Soutenir le projet

Ce projet est gratuit et développé sur mon temps libre. S'il vous est utile, vous pouvez soutenir son développement :

<a href="https://ko-fi.com/imouine" target="_blank">
  <img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Soutenir sur Ko-fi" height="36" />
</a>

---

## 🤝 Contribuer

Les contributions sont les bienvenues — signalements de bugs, idées de fonctionnalités ou pull requests.

- Lire le [guide de contribution](CONTRIBUTING.md) avant d'ouvrir une PR
- Merci de respecter le [Code de conduite](CODE_OF_CONDUCT.md)

---

## ⚠️ Avertissement

Ce projet n'est pas affilié à Ilévia, la MEL ou tout autre opérateur de transport en commun, et n'est ni approuvé ni sponsorisé par eux. Il couvre uniquement la métropole lilloise et s'appuie exclusivement sur des données ouvertes publiquement disponibles.

---

## 📄 Licence

[GPL-3.0](LICENSE) — © imouine

---

## 🔐 Confidentialité

[Politique de confidentialité](PRIVACY_POLICY.md) — Aucune collecte de données, aucun tracking, aucun cookie. Tout reste sur votre machine.
