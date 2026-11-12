# Chrome Web Store listing — v1.0.2

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
- Refaire les captures après avoir chargé le ZIP final dans Chrome.
- Capture 1 : tableau de bord avec trois passages directs/théoriques.
- Capture 2 : ajout d’un trajet montrant deux arrêts homonymes avec leur commune.
- Capture 3 : préférences en thème clair avec le code couleur agrandi.
- Capture 4 : thème sombre et état temps réel indisponible.
- Taille recommandée des captures Store : 1280 × 800 ou 640 × 400, sans données personnelles ni éléments coupés.

## Final submission check

1. Exécuter `npm run check` et `npm run smoke`.
2. Exécuter `./scripts/package.sh` et charger le ZIP produit comme extension non empaquetée de test.
3. Vérifier le popup en français et en anglais, clair et sombre, puis pause/reprise.
4. Vérifier la fiche, la déclaration de pratiques de confidentialité et les captures.
5. Envoyer une seule fois la version `1.0.2` validée.
