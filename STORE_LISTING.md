# Chrome Web Store listing — v1.0.2

## Audit de la fiche publique — 13 novembre 2026

La fiche actuellement publiée présente encore la version `1.0.1` :

- ancienne icône détaillée avec le mot « LILLE », moins lisible dans la barre Chrome ;
- cinq captures construites autour de l’ancienne interface ;
- texte annonçant encore une actualisation de 5 à 60 secondes ;
- ancien popup blanc et ancien écran de préférences ;
- langue déclarée : français uniquement ;
- dernière mise à jour affichée : 14 avril 2026.

Pour la `1.0.2`, conserver l’icône `icon-v2` déjà intégrée au manifeste. Elle est plus simple, sans petit texte illisible et reste reconnaissable à 16 px. La priorité visuelle est donc de remplacer les captures Store, pas de redessiner une troisième icône.

## Short description

Les prochains bus Ilévia en direct et selon les horaires théoriques, dans le popup et sur le badge Chrome.

## Detailed description

Bus Lille Ilévia permet de surveiller jusqu’à 12 trajets arrêt / ligne / direction dans la métropole lilloise.

- prochains passages en temps réel via l’open data MEL ;
- horaires théoriques exacts en complément ou si le direct est indisponible ;
- compte à rebours du prochain bus sur le badge Chrome ;
- actualisation réglable de 30 secondes à 5 minutes ;
- plusieurs trajets, thème clair/sombre et interface français/anglais ;
- code couleur simple : bleu, orange, rouge et gris théorique.

L’extension stocke la liste de trajets et les préférences localement. Pour demander les passages en direct, elle transmet uniquement les identifiants publics des arrêts surveillés à l’API open data de la Métropole Européenne de Lille. Aucun compte, aucune publicité et aucun suivi analytique.

Extension indépendante et open source, non affiliée, approuvée ou sponsorisée par Ilévia ou la MEL.

## Privacy disclosure checklist

- Permissions : `storage`, `alarms`.
- Accès hôte : `https://data.lillemetropole.fr/*` uniquement.
- Données locales : trajets, préférences, cache des couleurs et derniers passages.
- Données envoyées : identifiants publics des arrêts nécessaires à la requête MEL.
- Aucun compte, cookie, analytics, publicité, vente ou partage de données par le développeur.
- URL de confidentialité : `https://github.com/imouine/lille-bus-extension/blob/main/PRIVACY_POLICY.md`.

## Assets and screenshots before submission

- Icône 128 × 128 : `src/assets/icons/icon-v2-128.png`.
- Refaire les captures après avoir chargé le ZIP final dans Chrome, de préférence en journée pour montrer des temps d’attente courts et crédibles.
- Capture 1 — promesse principale : tableau de bord sombre avec plusieurs trajets et le texte « Vos prochains bus, en un coup d’œil ».
- Capture 2 — direct + théorique : trois passages proches, avec les deux sources visibles et le texte « Le direct, complété par les horaires prévus ».
- Capture 3 — ajout simple : recherche « mairie » montrant plusieurs communes, ligne et direction ; texte « Le bon arrêt, sans ambiguïté ».
- Capture 4 — badge Chrome : badge coloré dans la barre d’outils et popup ; texte « Le prochain bus sans ouvrir le popup ».
- Capture 5 — préférences : thème sombre, fréquence et code couleur ; texte « Clair, lisible et personnalisable ».
- Taille recommandée des captures Store : 1280 × 800 ou 640 × 400, sans données personnelles ni éléments coupés.
- Éviter l’ancien fond illustré de gare routière : il réduit le contraste et donne plus de place au décor qu’au produit.
- Utiliser le système visuel défini dans `design/store/README.md`.

## Final submission check

1. Exécuter `npm run check` et `npm run smoke`.
2. Exécuter `./scripts/package.sh` et charger le ZIP produit comme extension non empaquetée de test.
3. Vérifier le popup en français et en anglais, clair et sombre, puis pause/reprise.
4. Vérifier la fiche, la déclaration de pratiques de confidentialité et les captures.
5. Envoyer une seule fois la version `1.0.2` validée.
