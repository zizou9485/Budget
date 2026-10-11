# Budget

Budget par enveloppes avec projection sur les mois à venir. Pas de serveur, pas de compte : tout est stocké dans le navigateur de l'appareil.

## Tester sur l'ordinateur

Ouvre ce dossier dans VS Code, installe l'extension Live Server, clic droit sur `index.html`, « Open with Live Server ». Le mode hors-ligne ne marche qu'en http ou https, pas en ouvrant le fichier directement.

## La mettre sur le téléphone

1. Crée un dépôt GitHub (par exemple `budget`) et mets-y le contenu de ce dossier, à la racine.
2. Dans le dépôt : Settings, Pages, « Deploy from a branch », branche `main`, dossier `/ (root)`.
3. Quelques minutes plus tard, l'appli est sur `https://<ton-compte>.github.io/budget/`.
4. Ouvre ce lien sur le téléphone puis :
   - iPhone (Safari) : Partager, « Sur l'écran d'accueil ».
   - Android (Chrome) : menu ⋮, « Installer l'application ».

Le dépôt est public, mais il ne contient que le code. Tes chiffres restent sur ton téléphone. Ne mets surtout pas `donnees-depart.json` dans le dépôt : tu l'importes une fois dans l'appli (Réglages, Sauvegarde, Importer un fichier).

## Mettre à jour le code

Après une modification, change `VERSION` dans `sw.js` (par exemple `budget-v2`) pour que les téléphones récupèrent la nouvelle version.

## Sauvegarde

Les données sont locales. Exporte régulièrement un fichier depuis Réglages, Sauvegarde : c'est la seule copie si tu changes de téléphone.
