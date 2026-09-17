# Make it Meme — Modded

Clone multijoueur en temps réel inspiré du principe de Make it Meme (image imposée
→ légende → vote collectif → classement), avec un mode supplémentaire **Upload
perso** : au lieu d'un template déjà stocké, chaque joueur importe sa propre image
et place son propre texte dessus.

## Lancer le jeu

```bash
npm install
npm start
```

Puis ouvre `http://localhost:3000` dans plusieurs onglets/navigateurs pour tester
en multijoueur (2 joueurs minimum par partie).

## Comment ça marche

- **Créer une partie** : choisis un pseudo, un mode (Classique ou Upload perso),
  le nombre de manches, le temps de création et le temps de vote. Un code de
  salle à 5 caractères est généré.
- **Rejoindre** : les autres joueurs entrent le code + leur pseudo.
- **Manche** :
  - *Mode Classique* : le serveur impose une image (template) à tous les
    joueurs ; chacun écrit un texte haut/bas dessus.
  - *Mode Upload perso* : chaque joueur choisit **sa propre image** (upload
    depuis son appareil), redimensionnée/compressée côté navigateur, puis
    écrit son texte dessus avec le même éditeur (canvas, style meme
    Impact blanc/contour noir).
  - Quand tout le monde a validé (ou que le temps est écoulé), on passe au
    vote.
- **Vote** : chaque joueur voit la galerie des mèmes des autres (jamais le
  sien) et vote pour son préféré.
- **Résultats** : les votes rapportent des points (100 pts/vote), le
  classement de la manche et le classement général s'affichent, puis la
  manche suivante démarre automatiquement.
- **Fin de partie** : classement final ; l'hôte peut relancer une partie dans
  la même salle.

## Architecture

- `server/index.js` — serveur Express + Socket.IO, relaie les événements
  client vers le moteur de jeu.
- `server/gameManager.js` — moteur de jeu pur (salles, phases, timers,
  scoring), testable indépendamment du réseau.
- `server/templates.js` — liste des templates du mode Classique.
- `public/templates/*.svg` — illustrations vectorielles originales utilisées
  comme templates de démo (à remplacer par de vrais visuels si besoin : dépose
  un fichier dans `public/templates/` et ajoute une entrée dans
  `server/templates.js`).
- `public/js/memeCanvas.js` — moteur de rendu canvas (image + texte haut/bas),
  partagé par les deux modes.
- `public/js/main.js` — logique client (écrans, Socket.IO, upload/compression
  d'image, minuteurs, galerie de vote).

## Notes techniques

- Les images (templates comme uploads) sont transmises en `dataURL` via
  Socket.IO ; les uploads sont redimensionnés et compressés côté navigateur
  (max ~1000px, JPEG) avant envoi pour rester léger.
- Toute la logique de manche/scoring est dans `GameManager`, sans dépendance
  au réseau — elle peut être testée directement en Node (voir les scénarios
  utilisés pendant le développement : création de salle, soumissions,
  vote, avance automatique quand tout le monde a validé, gestion d'une
  manche sans soumission, fin de partie).
- Paramètres bornés côté serveur pour éviter les abus : 3 à 10 manches, 30 à
  180s pour créer, 15 à 90s pour voter, 12 joueurs max par salle.
