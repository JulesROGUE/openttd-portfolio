/*
 * portfolio.js — coquille web minimale d'OpenTTD Portfolio.
 * L'interface est celle d'OpenTTD (patché) ; ce script ne fait que :
 *  - afficher l'étape du chargement (moteur, données, préparation de la carte) ;
 *  - demander toutes les ressources avec ?v=<build> (caches navigateur et Cloudflare) ;
 *  - réveiller l'audio au premier clic (les navigateurs l'interdisent avant) :
 *    contexte Web Audio de SDL (bruitages) et synthé MIDI (musique, midisynth.js) ;
 *  - suivre la coupure globale du son du portfolio (applet KMix du bureau : clé
 *    localStorage « portfolioos:sounds-muted » et message « portfolioos:mute »),
 *    bloc repris tel quel de Cube 2 ;
 *  - télécharger les bruitages OpenSFX à ce moment-là seulement (13 Mo), puis
 *    demander au moteur de les utiliser (pf_load_sounds).
 */
(function () {
  'use strict';

  // --- Coupure globale du son du portfolio (applet KMix du bureau) -----------
  // Même origine que le portfolio : on lit sa clé de localStorage, on suit
  // l'événement `storage` et le message `portfolioos:mute`. Tous les
  // AudioContext créés par le moteur (sons et musique) sont suspendus tant que
  // c'est coupé, et le moteur ne peut pas les relancer lui-même.
  (function () {
    var KEY = 'portfolioos:sounds-muted';
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || AC.__portfolioMute) return;
    var contexts = [];
    var muted = false;
    try { muted = localStorage.getItem(KEY) === '1'; } catch (e) {}
    var resume = AC.prototype.resume;
    AC.prototype.resume = function () {
      return muted ? Promise.resolve() : resume.call(this);
    };
    function Wrapped(opts) {
      var ctx = opts === undefined ? new AC() : new AC(opts);
      contexts.push(ctx);
      if (muted) ctx.suspend();
      return ctx;
    }
    Wrapped.prototype = AC.prototype;
    Wrapped.__portfolioMute = true;
    window.AudioContext = Wrapped;
    window.webkitAudioContext = Wrapped;
    function apply(value) {
      muted = value;
      contexts.forEach(function (ctx) {
        if (ctx.state === 'closed') return;
        if (muted) ctx.suspend(); else resume.call(ctx).catch(function () {});
      });
    }
    window.addEventListener('storage', function (e) {
      if (e.key === KEY) apply(e.newValue === '1');
    });
    window.addEventListener('message', function (e) {
      if (e.origin === location.origin && e.data && e.data.type === 'portfolioos:mute') apply(!!e.data.muted);
    });
  })();

  var canvas = document.getElementById('canvas');
  var loading = document.getElementById('loading');
  var basePath = location.pathname.replace(/[^\/]*$/, '');

  // --- Version du build et progression du chargement --------------------------
  var buildMeta = document.querySelector('meta[name="build"]');
  var BUILD = buildMeta && buildMeta.content !== '__BUILD__' ? buildMeta.content : '';
  function versioned(path) { return BUILD ? path + '?v=' + BUILD : path; }

  // Écran de chargement minimal : « Chargement.. » puis l'étape en cours (n/3).
  // Étapes : moteur (.wasm), données (paquet Emscripten), préparation de la carte.
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

  window.Module = {
    preRun: [],
    postRun: [],
    arguments: [],
    canvas: canvas,
    locateFile: function (path) { return versioned(path); },
    // Téléchargement du moteur (.wasm) en suivant sa progression
    instantiateWasm: function (imports, receive) {
      setStep(0);
      fetch(versioned('openttd.wasm')).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      }).then(function (bytes) {
        return WebAssembly.instantiate(bytes, imports);
      }).then(function (out) {
        setStep(1);
        receive(out.instance, out.module);
      }).catch(loadError);
      return {};
    },
    print: function (t) { console.log(t); },
    printErr: function (t) { console.warn(t); },
    // Messages d'Emscripten : « Downloading data... (x/y) », « Running... »
    setStatus: function (t) {
      if (/Running/.test(t || '')) setStep(2);
    },
    // le paquet de données est arrivé : il ne reste qu'à préparer la carte
    monitorRunDependencies: function (left) {
      if (left === 0) setStep(2);
    },
    // appelé par le moteur (PortfolioAfterLoad) quand la carte est affichée
    onGameReady: function () {
      loading.className = 'done';
      document.body.className = 'game-ready';   // le jeu dessine maintenant son curseur
      canvas.focus();
      console.log('[portfolio] carte prête');
    },
    onExit: function () { loadError('le jeu s\'est arrêté'); },
    onAbort: function () { loadError('le jeu a planté'); },
  };

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
  Module.onProjectOpen = function (id) {
    illus.open = illus.open.filter(function (x) { return x !== id; }).concat([id]);
    illusShow(id);
  };
  Module.onProjectClose = function (id) {
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

  // --- Son : rien avant le premier geste de l'utilisateur --------------------------
  var soundsRequested = false, soundsLoaded = false;
  function loadSounds() {
    if (soundsRequested) return;
    soundsRequested = true;
    var files = ['opensfx.obs', 'opensfx.cat'];
    console.log('[son] téléchargement des bruitages OpenSFX');
    Promise.all(files.map(function (f) {
      return fetch(versioned('sfx/' + f)).then(function (r) {
        if (!r.ok) throw new Error(f + ' : HTTP ' + r.status);
        return r.arrayBuffer();
      });
    })).then(function (bufs) {
      Module.FS.mkdirTree('/baseset/opensfx');
      files.forEach(function (f, i) { Module.FS.writeFile('/baseset/opensfx/' + f, new Uint8Array(bufs[i])); });
      soundsLoaded = Module.ccall('pf_load_sounds', 'number', [], []) === 1;
      console.log('[son] bruitages OpenSFX ' + (soundsLoaded ? 'actifs' : 'refusés par le moteur'));
    }).catch(function (e) {
      soundsRequested = false;
      console.warn('[son] bruitages indisponibles : ' + e);
    });
  }

  function wakeAudio() {
    var sdl = Module.SDL2 && Module.SDL2.audioContext;
    if (sdl && sdl.state === 'suspended') sdl.resume();
    if (window.openttd_music) window.openttd_music.resume();
    if (Module.calledRun) loadSounds();
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (type) {
    document.addEventListener(type, wakeAudio, true);
  });

  /** État de l'audio, pour les tests et le débogage. */
  window.pfAudioState = function () {
    var sdl = Module.SDL2 && Module.SDL2.audioContext;
    return {
      sfxContext: sdl ? sdl.state : 'none',
      sfxLoaded: soundsLoaded,
      musicContext: window.openttd_music ? window.openttd_music.state() : 'none',
      music: window.openttd_music ? window.openttd_music.current() : '',
    };
  };

  // Flèches / Tab ne doivent pas faire défiler la page ni sortir de l'iframe.
  window.addEventListener('keydown', function (e) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Space'].indexOf(e.code) >= 0) e.preventDefault();
  });
})();
