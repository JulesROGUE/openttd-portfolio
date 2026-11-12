# OpenTTD Portfolio — les projets de Jules ROGUE dans OpenTTD

Une version **minimale et modifiée d'[OpenTTD](https://www.openttd.org) 15.3**, compilée en
**WebAssembly** (Emscripten), qui sert d'application « Projets » au portfolio
[julesrogue.fr](https://julesrogue.fr) : **chaque ville de la carte est un projet**.

> Projet réalisé dans le cadre du BTS SIO option SLAM.

## Ce que l'on voit

- **Lancement direct sur la carte** : pas d'intro, pas de menu principal, pas de barre
  d'outils. Seule reste la **barre d'état grise** d'OpenTTD en bas (date, argent).
  Le jeu n'est jamais en pause.
- **Une ville par projet** : Cube 2 Portfolio, Mineport, Magic Shape Generator,
  Portfolio OS (au centre) et Leboncoin Auto. La carte (128 × 128, climat tempéré) a du
  relief, des lacs et des rivières, des routes (et des ponts) entre les villes, et des
  bus qui font la navette entre la ville centrale et les autres.
- **Un clic sur un bâtiment** (ou sur le nom d'une ville) ouvre la **fiche du projet** :
  sous-titre, type, résumé, points forts, technologies, équipe, lien. Boutons :
  *Show on map*, *Open link* (nouvel onglet), *Collaborators*.
- **Collaborateurs** : bouton *Collaborators* (fiche d'un projet ou fenêtre d'accueil).
  La liste est tirée uniquement du champ `team` des données (« … réalisé avec X ») : nom
  et projet, rien d'autre. Un clic sur un collaborateur ouvre la fiche du projet.
- **Fenêtre d'accueil** : quelques mots d'explication et la liste des projets (un clic
  amène sur la ville). Déplacement : faire glisser la carte (ou flèches), zoom : molette.
- Tout ce qui permet de construire ou de gérer est désactivé : raccourcis clavier,
  fenêtres des véhicules, des gares, des finances, actualités, console.

Les libellés des boutons sont en anglais, comme le reste de l'interface d'OpenTTD ; les
textes des projets sont en français.

## Son et musique

Les navigateurs n'autorisent aucun son avant une interaction de l'utilisateur. Au
**premier clic** (ou touche) dans le jeu, `web/portfolio.js` :

1. réveille le contexte Web Audio de SDL (pilote de son `sdl` d'OpenTTD) ;
2. télécharge les **bruitages OpenSFX** (13 Mo, donc hors du chargement initial), les
   copie dans `/baseset/opensfx` et appelle `pf_load_sounds()`, qui relit les jeux de
   base et passe à OpenSFX à la place du jeu « NoSound » (`ChangeSoundSet`) ;
3. réveille le synthétiseur de musique.

**Musique** : OpenMSX est en MIDI, et OpenTTD n'a aucun pilote MIDI utilisable dans un
navigateur (le portage Emscripten officiel est muet, `-mnull`). Ce projet ajoute donc un
pilote de musique `emscripten` (`engine/src/music/emscripten_m.cpp`) : le morceau est lu
par **le lecteur MIDI d'OpenTTD lui-même** (`MidiFile`), puis la suite des messages datés
est confiée à `web/midisynth.js`, un **petit synthétiseur General MIDI en Web Audio** fait
uniquement d'oscillateurs (sinus, triangle, carré, dent de scie, filtres, enveloppes) et
de bruit calculé pour les percussions. Aucun échantillon ni banque de sons (SoundFont)
n'est utilisé. Les morceaux s'enchaînent tout seuls grâce à la liste de lecture
d'OpenTTD (tous les titres, ordre aléatoire) : le pilote indique au jeu quand un morceau
est fini. Avant le premier clic, le morceau demandé reste en attente.

## Ressources : uniquement celles d'OpenTTD

| Élément | Auteur | Licence | Utilisation |
|---|---|---|---|
| [OpenTTD 15.3](https://www.openttd.org) | L'équipe OpenTTD et ses contributeurs | GPL v2 | Moteur, modifié (patch + fichiers ajoutés) ; `openttd.grf`, `orig_extra.grf`, jeux « vides » |
| [OpenGFX 8.0](https://github.com/OpenTTD/OpenGFX) | Les auteurs d'OpenGFX (Zephyris, Zuu, planetmaker, Rubidium… liste dans son readme) | GPL v2 | Graphismes et polices (climat tempéré) |
| [OpenSFX 1.0.3](https://github.com/OpenTTD/OpenSFX) | Contributeurs d'OpenTTD, d'après des sons de freesound.org et pdsounds.org (détail dans son readme) | CC BY-SA 3.0 | Bruitages, chargés au premier clic |
| [OpenMSX 0.4.2](https://github.com/OpenTTD/OpenMSX) | Les auteurs d'OpenMSX, 2010-2021 (détail dans `themes.list`) | GPL v2 | Musiques MIDI |

Ces fichiers sont téléchargés pendant le build depuis le CDN officiel d'OpenTTD
(`cdn.openttd.org`), avec des sommes SHA-256 épinglées (`scripts/fetch-sources.sh`). Les
licences des jeux de base sont copiées à côté de leurs fichiers. Aucun autre asset
(image, son, police, NewGRF) n'est créé ni importé : la carte est générée par OpenTTD
lui-même, et les textes des projets sont de simples données.

## Fonctionnement

```
data/projects.json ──► tools/gen_data.py ──► src/portfolio_data.h (fiches, collaborateurs)
                                         └─► gamescript/projects.nut (noms des villes)

scripts/fetch-sources.sh   OpenTTD 15.3 + OpenGFX / OpenSFX / OpenMSX (SHA-256 vérifiés)
scripts/prepare-src.sh     archive + engine/openttd-portfolio.patch + engine/src, engine/os
scripts/build-engine.sh    OpenTTD natif (outils, génération de la carte) puis WebAssembly
scripts/gen-map.sh         partie générée par la version native, sans affichage :
                           graine fixe (config/pregen.cfg) + script de jeu PortfolioGS
scripts/build-web.sh       carte + paquet de données + coquille web -> dist/openttd
```

- **Carte** : `gamescript/main.nut` (GameScript Squirrel) renomme la ville créée par le
  générateur et fonde les autres à des emplacements fixes, les agrandit puis fige leur
  croissance, trace les routes avec un A* maison (ponts sur l'eau), construit les arrêts,
  un dépôt et achète les bus de la compagnie du joueur. La partie est enregistrée à la
  sortie (`autosave_on_exit`) : c'est cette sauvegarde que charge le navigateur. Même
  graine et mêmes données ⇒ même carte.
- **Patch du moteur** (`engine/openttd-portfolio.patch`, fichiers ajoutés dans
  `engine/src`) : barre d'outils supprimée, raccourcis et actualités désactivés, clic sur
  une maison et sur un nom de ville → fiche du projet, aucun clic sur véhicules, gares,
  barre d'état ; fenêtres du portfolio (`portfolio_gui.cpp`) ; pilote de musique ;
  `pre.js` (arguments : carte, réglages `config/openttd.cfg`, son SDL, musique).
- **Coquille web** (`web/`) : écran de chargement (étape, barre de progression, Mo
  téléchargés / total), ressources versionnées `?v=<build>` (empreinte injectée par
  `build-web.sh`), réveil de l'audio.
- **Serveur** (`server/server.js`) : fichiers statiques sous `/openttd/`, gzip
  pré-calculé, `Cache-Control` long et immuable pour les ressources versionnées, `no-cache`
  pour le reste (Cloudflare est devant le site).

## Construire et lancer

```bash
docker compose up -d --build        # http://127.0.0.1:8084/openttd/
```

Le build compile OpenTTD deux fois (natif puis WebAssembly) : compter une vingtaine de
minutes sur 8 cœurs. Pour développer sans Docker Compose :

```bash
docker build --target base -t openttd-portfolio-base -f docker/Dockerfile.web docker/
docker run --rm -v $PWD:$PWD -w $PWD -u $(id -u):$(id -g) -e EM_CACHE=$PWD/build/emcache \
  openttd-portfolio-base bash -c './scripts/fetch-sources.sh && ./scripts/build-engine.sh && ./scripts/build-web.sh'
```

Sur le serveur, le nginx de l'hôte (TLS) envoie `/openttd/` vers `127.0.0.1:8084`.

## Licence

OpenTTD Portfolio est une version modifiée d'OpenTTD et est donc distribué sous la
**GNU General Public License version 2** (fichier `LICENSE`), comme OpenTTD. Les jeux
de base gardent leurs licences (tableau ci-dessus). Ce portfolio n'est ni affilié ni
approuvé par l'équipe OpenTTD.

© 2026 Jules ROGUE pour les modifications et les fichiers ajoutés.
