/*
 * portfolio.js — coquille web d'OpenTTD Portfolio.
 * L'interface est celle d'OpenTTD, rejouée par le moteur JavaScript (ottd/*.js) ; ce
 * script ne fait que :
 *  - afficher l'étape du chargement (moteur, données, préparation de la carte) ;
 *  - demander toutes les ressources avec ?v=<build> (caches navigateur et Cloudflare) ;
 *  - afficher l'illustration du projet ouvert (images du portfolio).
 * Aucun son : ni bruitages, ni musique.
 */
(function () {
  'use strict';

  var canvas = document.getElementById('canvas');
  var loading = document.getElementById('loading');

  // --- Version du build et progression du chargement --------------------------
  var buildMeta = document.querySelector('meta[name="build"]');
  var BUILD = buildMeta && buildMeta.content !== '__BUILD__' ? buildMeta.content : '';
  function versioned(path) { return BUILD ? path + '?v=' + BUILD : path; }

  // Écran de chargement minimal : « Chargement.. » puis l'étape en cours (n/3).
  var stepEl = document.getElementById('ld-step');
  var STEPS = ['Moteur du jeu', 'Données du jeu', 'Préparation de la carte'];
  var step = 0, failed = false;
  function setStep(n) {
    if (failed || n < step) return;
    step = n;
    stepEl.textContent = STEPS[n] + ' ' + (n + 1) + '/' + STEPS.length;
  }
  function loadError(e) {
    failed = true;
    console.warn('chargement : ' + (e && e.message ? e.message : e));
    stepEl.className = 'ld-error';
    stepEl.textContent = 'Échec du chargement : actualisez la page';
    loading.className = '';
  }

  // --- Illustration du projet ouvert ------------------------------------------------
  // Exception accordée pour les illustrations : la couverture et les captures déjà
  // présentes dans le portfolio (/images/projects/…), chargées seulement quand on ouvre
  // la fiche d'un projet. Rien de tout cela n'entre dans le jeu lui-même.
  var illus = { data: null, open: [], id: '', index: 0 };
  var illusEl = document.getElementById('illus');
  function illusSlides(id) {
    var p = illus.data && illus.data[id];
    if (!p) return [];
    var slides = p.cover ? [{ image: p.cover, caption: '' }] : [];
    return slides.concat((p.gallery || []).map(function (g) { return { image: g.image, caption: g.title + ' — ' + g.caption }; }));
  }
  function illusRender() {
    var slides = illusSlides(illus.id);
    if (!slides.length) { illusEl.hidden = true; return; }
    var s = slides[illus.index % slides.length];
    document.getElementById('il-title').textContent = illus.data[illus.id].title;
    var img = document.getElementById('il-img');
    img.className = illus.index ? 'shot' : '';
    img.src = s.image;
    img.alt = illus.data[illus.id].title;
    document.getElementById('il-caption').textContent = s.caption;
    document.getElementById('il-nav').hidden = slides.length < 2;
    document.getElementById('il-count').textContent = (illus.index + 1) + ' / ' + slides.length;
    illusEl.hidden = false;
  }
  function illusShow(id) {
    illus.id = id;
    illus.index = 0;
    if (illus.data) return illusRender();
    fetch(versioned('illustrations.json')).then(function (r) { return r.json(); })
      .then(function (d) { illus.data = d; if (illus.id) illusRender(); })
      .catch(function (e) { console.warn('[illustrations] ' + e); });
  }
  OT.onProjectOpen = function (id) {
    illus.open = illus.open.filter(function (x) { return x !== id; }).concat([id]);
    illusShow(id);
  };
  OT.onProjectClose = function (id) {
    illus.open = illus.open.filter(function (x) { return x !== id; });
    if (illus.id !== id) return;
    if (illus.open.length) illusShow(illus.open[illus.open.length - 1]);
    else { illus.id = ''; illusEl.hidden = true; }
  };
  function illusStep(d) {
    var n = illusSlides(illus.id).length;
    if (!n) return;
    illus.index = (illus.index + d + n) % n;
    illusRender();
  }
  document.getElementById('il-prev').addEventListener('click', function () { illusStep(-1); });
  document.getElementById('il-next').addEventListener('click', function () { illusStep(1); });
  document.getElementById('il-close').addEventListener('click', function () { illusEl.hidden = true; });
  // les clics sur le panneau ne doivent pas atteindre la carte
  illusEl.addEventListener('mousedown', function (e) { e.stopPropagation(); });

  // --- Démarrage ----------------------------------------------------------------------
  setStep(0);
  OT.loadData(versioned, function (n) { setStep(n + 1); }).then(function () {
    OT.start(canvas);
    loading.className = 'done';
    document.body.className = 'game-ready'; // le jeu dessine maintenant son curseur
    canvas.focus();
    console.log('[portfolio] carte prête');
  }).catch(loadError);

  // Flèches / Tab ne doivent pas faire défiler la page ni sortir de l'iframe.
  window.addEventListener('keydown', function (e) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Space'].indexOf(e.code) >= 0) e.preventDefault();
  });
})();
