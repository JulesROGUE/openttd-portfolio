# OpenTTD Portfolio — ProjectsLand, les projets de Jules ROGUE dans OpenTTD

Une version **minimale et modifiée d'[OpenTTD](https://www.openttd.org) 15.3**, rejouée dans
le navigateur par un **moteur JavaScript** (port du code de dessin et d'interface d'OpenTTD,
sans WebAssembly), qui sert d'application « Projets » au portfolio
[julesrogue.fr](https://julesrogue.fr). Le monde s'appelle **ProjectsLand** :
**chaque ville est un projet**. L'application est **entièrement muette** : ni bruitages, ni
musique.

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
  sous-titre, type, résumé, points forts, technologies, équipe, liens. Chaque lien du
  projet (champ `links`, http/https uniquement, vérifié à la génération) est **cliquable
  dans le texte** : bleu clair souligné, blanc au survol, ouverture dans un nouvel onglet
  (`noopener`). Boutons : *Show on map*, *Open link* (premier lien), *Collaborators*.
- **Collaborateurs** : bouton *Collaborators* (fiche d'un projet ou fenêtre d'accueil),
  puis un clic sur un nom ouvre la **fiche du collaborateur**, comme la fenêtre d'une
  compagnie : son **avatar** est un visage de président dessiné par le moteur
  (`DrawCompanyManagerFace`, sprites d'OpenGFX), dans un cadre, avec son nom, ses projets
  et le texte d'équipe, et un bouton *Open project*. La liste est tirée uniquement du
  champ `team` des données (« … réalisé avec X ») : rien d'autre n'est affiché. Le visage
  et sa couleur de fond sont tirés au sort à partir du nom (hachage FNV-1a comme
  graine), sauf les pièces imposées par `data/collaborators.json` (voir plus bas).
- **Fenêtre d'accueil** : quelques mots d'explication et la liste des projets (un clic
  amène sur la ville). Déplacement : faire glisser la carte (ou flèches), zoom : molette.
- Tout ce qui permet de construire ou de gérer est désactivé : raccourcis clavier,
  fenêtres des véhicules, des gares, des finances, actualités, console.
- L'échelle de l'interface suit la taille de l'écran, comme OpenTTD en mode automatique
  (100 % pour 640 × 480, par paliers de 25 % : 125 % dans la fenêtre du bureau du portfolio,
  200 % en plein écran Full HD).

Les libellés des boutons sont en anglais, comme le reste de l'interface d'OpenTTD ; les
textes des projets sont en français.

## Panneau d'illustration (coquille web)

À côté de la fiche d'un projet, la page affiche la couverture et les captures du projet dans
un panneau HTML dessiné comme une fenêtre du jeu (relevé au pixel, interface à 100 %) :
brun de l'interface, reliefs clairs / sombres, case de fermeture à gauche avec la croix du
jeu, titre centré, et police **OpenTTD Sans** (version TrueType de la police du jeu par
Zephyris, GPL v2, fournie avec les sources d'OpenTTD et copiée dans `fonts/` par
`scripts/build-web.sh`).

## Avatars des collaborateurs (`data/collaborators.json`)

L'avatar d'un collaborateur est un visage de président d'OpenTTD. Par défaut, tout est
tiré au sort à partir de la graine du nom. Le fichier `data/collaborators.json` peut
imposer certaines pièces (le reste reste tiré du nom, donc toujours le même visage) :

```json
{ "Roman Corobca": { "face": { "gender": "male", "hair": "red", "glasses": true, "build": "large" } } }
```

| Clé | Valeurs |
|---|---|
| `gender` | `male` (style `default/face1`) ou `female` (`default/face2`) ; `style` donne un style exact (`default/face1` à `default/face4`) |
| `glasses` | `true` (verres clairs) / `false` |
| `hair` | style homme : `black`, `bald`, `grey`, `brown`, `auburn`, `red`, ou un numéro de variante (0 à 8) |
| `jacket`, `collar`, `chin` | homme : `dark` / `maroon` / `navy`, `blue` / `white` / `checked` / `open`, `narrow` / `square` / `stubble`, ou un numéro |
| `build` | `large` : veste sombre, col ouvert, menton large (le portrait ne montre que la tête et les épaules) |
| `tie`, `eyebrows`, `nose`, `lips`, `eyecolour`, `moustache` | numéro de variante |

Les noms des variantes ont été repérés sur les sprites d'OpenGFX (le roux est la teinte la
plus proche proposée par les visages d'OpenGFX). Ils sont définis dans `tools/gen_data.py`
(`FACE_NAMED`, `FACE_BUILD`). Aucune image n'est ajoutée : le moteur assemble le visage
avec les sprites d'OpenGFX (`DrawCompanyManagerFace`).

## Illustrations des projets

Exception accordée au principe « uniquement les ressources d'OpenTTD » : quand une fiche
de projet est ouverte, la page du jeu affiche à côté (panneau HTML façon fenêtre OpenTTD,
coin haut droit) **l'image de couverture et les captures du projet déjà présentes dans le
portfolio** (`/images/projects/<id>/…`, déclarées dans les données des projets), avec
*Prev* / *Next*. Elles sont chargées à la demande depuis julesrogue.fr, ne sont pas dans
le paquet de données et ne servent qu'à illustrer les fiches : le jeu lui-même
(graphismes, sons, musique) n'utilise que les ressources d'OpenTTD.

## Moteur JavaScript (sans WebAssembly)

Le navigateur n'exécute plus OpenTTD compilé en WebAssembly. Le rendu reste celui
d'OpenTTD, au pixel près, grâce à un partage du travail :

1. **Pendant le build**, la version native du moteur patché (sans affichage ni son) charge
   la carte et relève tout ce qu'elle dessinerait (`engine/src/portfolio_export.cpp`,
   `engine/src/portfolio_viewport_export.inc`) :
   - pour chaque tuile, la liste de dessin exacte de `ViewportAddLandscape()` (sprites au
     sol, sprites triés avec leur boîte englobante, sprites enfants), aux deux niveaux de
     détail (les décors des routes disparaissent au-delà du zoom Out2x) ;
   - les sprites d'OpenGFX utilisés, décodés à chaque niveau de zoom exactement comme le
     moteur les prépare (`ResizeSprites`), les tables de recoloriage, la palette et ses
     tables d'animation (eau), les polices (glyphes et largeurs) ;
   - **deux ans de partie, tick par tick** : sprites des bus (différences d'un tick à
     l'autre), tuiles qui changent (arbres qui poussent...), textes flottants (indicateurs
     de chargement, recettes), date et argent de la barre d'état ;
   - la **mise en page exacte de chaque fenêtre** (chaque widget relevé avec
     `GetWidgetFromPos`), à toutes les échelles d'interface de 100 % à 500 %, et le visage
     de chaque collaborateur (liste des sprites de `DrawCompanyManagerFace`).
2. **Dans le navigateur**, `web/ottd/` rejoue tout cela avec un port en JavaScript du code
   d'OpenTTD : écran 8 bits et blitter (`gfx.js`), textes avec les polices en sprites
   (`text.js`), vues de la carte avec le même parcours des tuiles, le même tri des sprites
   (`ViewportSortParentSprites`), les panneaux des villes, le défilement doux et le zoom
   (`viewport.js`), fenêtres, widgets, déplacement avec aimantation, placement automatique,
   infobulles et zones à redessiner (`gui.js`), boucle à 27 ms par tick, animation de la
   palette et curseur (`main.js`). La partie enregistrée est rejouée en boucle.

| Fichier | Taille | Transféré (gzip) |
|---|---|---|
| `world.bin` (listes de dessin, deux ans de partie) | ≈ 20 Mo | ≈ 1 Mo |
| `sprites.bin` (sprites et glyphes d'OpenGFX) | ≈ 0,9 Mo | ≈ 0,23 Mo |
| `world.json` (index, fenêtres, textes, palette) | ≈ 0,7 Mo | ≈ 0,11 Mo |
| moteur JavaScript et coquille web | ≈ 0,1 Mo | ≈ 0,03 Mo |
| **Chargement de la carte** | | **≈ 1,4 Mo** |

## Ressources : uniquement celles d'OpenTTD

| Élément | Auteur | Licence | Utilisation |
|---|---|---|---|
| [OpenTTD 15.3](https://www.openttd.org) | L'équipe OpenTTD et ses contributeurs | GPL v2 | Moteur natif modifié (patch + fichiers ajoutés) qui génère et relève la carte ; code de dessin et d'interface porté en JavaScript (`web/ottd`) |
| [OpenGFX 8.0](https://github.com/OpenTTD/OpenGFX) | Les auteurs d'OpenGFX (Zephyris, Zuu, planetmaker, Rubidium… liste dans son readme) | GPL v2 | Graphismes et polices (climat tempéré), licence servie avec les données (`opengfx-license.txt`) |

Ces fichiers sont téléchargés pendant le build depuis le CDN officiel d'OpenTTD
(`cdn.openttd.org`), avec des sommes SHA-256 épinglées (`scripts/fetch-sources.sh`). Aucun
autre asset (image, son, musique, police, NewGRF) n'est créé ni importé : la carte est
générée par OpenTTD lui-même, et les textes des projets sont de simples données.

## Fonctionnement

```
data/projects.json ──► tools/gen_data.py ──► src/portfolio_data.h (fiches, collaborateurs)
                                         └─► gamescript/projects.nut (noms des villes)

scripts/fetch-sources.sh   OpenTTD 15.3 + OpenGFX (SHA-256 vérifiés)
scripts/prepare-src.sh     archive + engine/openttd-portfolio.patch + engine/src
scripts/build-engine.sh    OpenTTD natif (sans affichage ni son au lancement)
scripts/gen-map.sh         partie générée par la version native :
                           graine fixe (-G 20260) + config/pregen.cfg + script de jeu PortfolioGS
scripts/export-js.sh       relevé de la carte et de deux ans de partie pour le moteur JS
                           (world.json, world.bin, sprites.bin)
scripts/build-web.sh       carte + relevé + moteur JS + coquille web -> dist/openttd
```

- **Carte** : `gamescript/main.nut` (GameScript Squirrel) renomme la ville créée par le
  générateur et fonde les autres à des emplacements fixes, les agrandit puis fige leur
  croissance, trace les routes avec un A* maison (ponts sur l'eau), construit les arrêts,
  un dépôt et achète les bus de la compagnie du joueur. La partie est enregistrée à la
  sortie (`autosave_on_exit`) : c'est cette sauvegarde que relève `export-js.sh`. Même
  graine et mêmes données ⇒ même carte.
- **Patch du moteur** (`engine/openttd-portfolio.patch`, fichiers ajoutés dans
  `engine/src`) : barre d'outils supprimée, raccourcis et actualités désactivés, clic sur
  une maison et sur un nom de ville → fiche du projet, aucun clic sur véhicules, gares,
  barre d'état ; fenêtres du portfolio (`portfolio_gui.cpp`) ; relevé pour la version
  JavaScript (`portfolio_export.cpp`, `portfolio_viewport_export.inc`, crochets dans
  `viewport.cpp` et `texteff.cpp`, actifs seulement avec `OPENTTD_PORTFOLIO_EXPORT`).
- **Moteur JavaScript** (`web/ottd/`) : voir plus haut. Les mêmes réglages que le jeu
  (`config/openttd.cfg` : glisser la carte avec le bouton gauche, zoom à la molette de
  In2x à Out4x, défilement doux, noms des villes) ; clic sur une maison ou un nom de ville,
  flèches du clavier, touches C / Z (centrer, centrer et zoomer), Suppr (fermer les
  fenêtres non épinglées), Maj+Suppr (toutes), Ctrl+R (tout redessiner).
- **Coquille web** (`web/`) : écran de chargement minimal (fond noir, en bas au
  centre : « Chargement.. » puis « Moteur du jeu 1/3 », « Données du jeu 2/3 »,
  « Préparation de la carte 3/3 », même gabarit que Cube 2), ressources versionnées
  `?v=<build>` (empreinte injectée par `build-web.sh`). Le curseur du navigateur est
  masqué au-dessus du jeu (OpenTTD dessine le sien) mais reste visible pendant le
  chargement et au-dessus du panneau des illustrations.
- **Serveur** (`server/server.js`) : fichiers statiques sous `/openttd/`, gzip
  pré-calculé, `Cache-Control` long et immuable pour les ressources versionnées, `no-cache`
  pour le reste (Cloudflare est devant le site).

Le relevé n'utilise que les fichiers d'OpenGFX du climat tempéré (`ogfx1_base`,
`ogfxe_extra`, `ogfxi_logos`) : seuls les sprites réellement dessinés sont exportés.

## Construire et lancer

```bash
docker compose up -d --build        # http://127.0.0.1:8084/openttd/
```

Le build compile OpenTTD une fois, en natif (quelques minutes sur 8 cœurs), génère la
carte puis la relève. Pour développer sans Docker Compose :

```bash
docker build --target base -t openttd-portfolio-base -f docker/Dockerfile.web docker/
docker run --rm -v $PWD:$PWD -w $PWD -u $(id -u):$(id -g) openttd-portfolio-base \
  bash -c './scripts/fetch-sources.sh && ./scripts/prepare-src.sh && ./scripts/build-engine.sh && ./scripts/build-web.sh'
```

`TICKS=3000 ./scripts/export-js.sh build/native build/out/projectsland.sav <dossier>`
relève une partie plus courte (essais rapides).

Sur le serveur, le nginx de l'hôte (TLS) envoie `/openttd/` vers `127.0.0.1:8084`.

## Licence

OpenTTD Portfolio est une version modifiée d'OpenTTD et est donc distribué sous la
**GNU General Public License version 2** (fichier `LICENSE`), comme OpenTTD ; le moteur
JavaScript (`web/ottd/`) est un port du code d'OpenTTD et suit la même licence. OpenGFX
garde sa licence (tableau ci-dessus). Ce portfolio n'est ni affilié ni approuvé par
l'équipe OpenTTD.

© 2026 Jules ROGUE pour les modifications et les fichiers ajoutés.

## Tests

`tests/villes.js` (un clic sur une maison de chaque ville ouvre sa fiche, puis la fenêtre
des collaborateurs) se lance avec Node et `playwright-core` contre un serveur local ou en
ligne : `node tests/villes.js http://127.0.0.1:8084/openttd/ <dossier des captures>`.
Il utilise les points d'entrée `OT.testHousePoint` et `OT.testProjectWindows`.
