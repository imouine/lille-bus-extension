# Direction visuelle Chrome Web Store — v1.0.3

## Objectif

Présenter l’extension comme un petit outil fiable, immédiat et moderne. Les visuels doivent montrer la vraie interface `1.0.3`, en grand, avec une seule promesse par image.

## Système visuel

- Fond principal : `#07131F`.
- Surface : `#0E2132`.
- Bleu : `#38A9F5`.
- Bleu profond : `#0876C1`.
- Vert temps réel : `#45C695`.
- Orange urgence : `#FB923C`.
- Texte principal : `#EEF8FF`.
- Texte secondaire : `#B4C8D7`.
- Police : Inter ou police système sans-serif, titres très gras, pas de texte décoratif.
- Décor : halos bleus discrets et lignes rappelant un itinéraire, sans photo ni illustration générique de bus.

## Composition 1280 × 800

- Marge de sécurité : 64 px.
- Texte : 40 à 48 % de la largeur.
- Interface réelle : 380 px minimum de large, jamais floutée ni redessinée.
- Titre : deux lignes maximum, 54–64 px.
- Sous-titre : une ou deux lignes, 24–28 px.
- Aucun paragraphe, aucun faux bouton et aucun élément que le produit ne possède pas.

## Ordre recommandé

1. **Vos prochains bus, en un coup d’œil** — capture du tableau de bord.
2. **Le direct passe toujours en premier** — les horaires théoriques dépassés sont masqués.
3. **Tapez « mairie hem »** — recherche souple par débuts de mots.
4. **Le prochain bus sans ouvrir le popup** — badge affiché dans la vraie barre Chrome.
5. **À votre façon** — extraits réels des préférences et du code couleur.

## Fichiers prêts pour le Store

Les cinq PNG finaux sont opaques et mesurent exactement `1280 × 800 px` :

- `output/01-hero.png`
- `output/02-live-and-scheduled.png`
- `output/03-stop-search.png`
- `output/04-toolbar-badge.png`
- `output/05-preferences.png`

Les fichiers modifiables se trouvent dans `slides/`. Le fond réutilisable se trouve dans
`assets/transit-background-v1.png` et son prompt de génération dans `PROMPT.md`.

## Icône

Conserver `design/icon-v2-master.png` comme master et les déclinaisons de `src/assets/icons/`. Ne pas remettre de texte dans l’icône : « LILLE » était lisible sur la fiche Store mais disparaissait à 16 px.

## Sources des captures

Les interfaces visibles dans les cinq compositions sont des captures de l’extension
`1.0.3` réellement chargée dans Chrome. Les fichiers `assets/actual-*.png` ne doivent
pas être redessinés : il faut refaire les captures après toute évolution visible de
l’interface. Les SVG ajoutent uniquement le fond, les titres et les explications.

## Tuiles promotionnelles optionnelles

- Petite tuile : 440 × 280.
- Marquee : 1400 × 560.
- Réutiliser l’icône v2, le fond bleu nuit et la promesse « Vos prochains bus, en un coup d’œil ».
