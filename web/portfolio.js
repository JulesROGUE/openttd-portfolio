/*
 * portfolio.js — coquille web minimale d'OpenTTD Portfolio.
 * L'interface est celle d'OpenTTD (patché) ; ce script ne fait que :
 *  - afficher la progression du chargement (moteur .wasm + paquet de données) ;
 *  - demander toutes les ressources avec ?v=<build> (caches navigateur et Cloudflare) ;
 *  - réveiller l'audio au premier clic (les navigateurs l'interdisent avant) :
 *    contexte Web Audio de SDL (bruitages) et synthé MIDI (musique, midisynth.js) ;
 *  - télécharger les bruitages OpenSFX à ce moment-là seulement (13 Mo), puis
 *    demander au moteur de les utiliser (pf_load_sounds).
 */
(function () {
  'use strict';

  var canvas = document.getElementById('canvas');
  var loading = document.getElementById('loading');
  var statusEl = document.getElementById('status');
  var basePath = location.pathname.replace(/[^\/]*$/, '');

  // --- Version du build et progression du chargement --------------------------
  var buildMeta = document.querySelector('meta[name="build"]');
  var BUILD = buildMeta && buildMeta.content !== '__BUILD__' ? buildMeta.content : '';
  function versioned(path) { return BUILD ? path + '?v=' + BUILD : path; }

  var stepEl = document.getElementById('ld-step');
  var fillEl = document.getElementById('ld-fill');
  var detailEl = document.getElementById('ld-detail');
  var dl = { wasm: [0, 0], data: [0, 0] };   // [chargé, total] en octets
  var phase = 'download';
  var dataRaw = 0;
  fetch(versioned('openttd.data'), { method: 'HEAD' }).then(function (r) {
    dataRaw = +r.headers.get('X-Raw-Length') || 0;
    if (dataRaw && dl.data[1] < dataRaw) { dl.data[1] = dataRaw; renderProgress(); }
  }).catch(function () {});
  function mo(n) { return (n / 1048576).toLocaleString('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 }); }
  function renderProgress() {
    if (phase !== 'download') return;
    var loaded = dl.wasm[0] + dl.data[0];
    var total = dl.wasm[1] + dl.data[1];
    var pct = total ? Math.min(100, Math.round(loaded / total * 100)) : 0;
    fillEl.style.width = pct + '%';
    detailEl.textContent = total
      ? mo(loaded) + ' / ' + mo(total) + ' Mo (' + pct + ' %) — moteur ' + mo(dl.wasm[0]) + '/' + mo(dl.wasm[1]) + ' Mo, données ' + mo(dl.data[0]) + '/' + mo(dl.data[1]) + ' Mo'
      : 'Connexion au serveur…';
  }
  function setPhase(name, text) {
    if (phase === name) return;
    phase = name;
    stepEl.textContent = 'Étape 2/2 · Ouverture de la carte';
    fillEl.style.width = '100%';
    fillEl.className = 'ld-fill indeterminate';
    detailEl.textContent = text;
  }
  function loadError(e) {
    stepEl.textContent = 'Le chargement a échoué';
    detailEl.className = 'ld-detail ld-error';
    detailEl.textContent = 'Actualise la page pour réessayer (' + (e && e.message ? e.message : e) + ').';
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
      fetch(versioned('openttd.wasm')).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        dl.wasm[1] = +r.headers.get('X-Raw-Length') || +r.headers.get('Content-Length') || 0;
        renderProgress();
        if (!r.body || !r.body.getReader) return r.arrayBuffer();
        var reader = r.body.getReader(), chunks = [], got = 0;
        var pump = function () {
          return reader.read().then(function (res) {
            if (res.done) return;
            chunks.push(res.value);
            got += res.value.length;
            dl.wasm[0] = got;
            if (got > dl.wasm[1]) dl.wasm[1] = got;
            renderProgress();
            return pump();
          });
        };
        return pump().then(function () {
          var buf = new Uint8Array(got), off = 0;
          chunks.forEach(function (c) { buf.set(c, off); off += c.length; });
          return buf.buffer;
        });
      }).then(function (bytes) {
        return WebAssembly.instantiate(bytes, imports);
      }).then(function (out) {
        receive(out.instance, out.module);
      }).catch(loadError);
      return {};
    },
    print: function (t) { console.log(t); },
    printErr: function (t) { console.warn(t); },
    // Messages d'Emscripten : « Downloading data... (x/y) », « Running... »
    setStatus: function (t) {
      t = t || '';
      var m = /Downloading data\.\.\. \((\d+)\/(\d+)\)/.exec(t);
      if (m) {
        dl.data = [+m[1], Math.max(dataRaw, +m[2], +m[1])];
        renderProgress();
        return;
      }
      if (/Running/.test(t) || (t === '' && dl.data[1] && dl.data[0] >= dl.data[1])) {
        setPhase('prepare', 'Chargement des graphismes et de la carte…');
      }
    },
    // appelé par le moteur (PortfolioAfterLoad) quand la carte est affichée
    onGameReady: function () {
      loading.className = 'done';
      canvas.focus();
      console.log('[portfolio] carte prête');
    },
    onExit: function () { loadError('le jeu s\'est arrêté'); },
    onAbort: function () { loadError('le jeu a planté'); },
  };

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
