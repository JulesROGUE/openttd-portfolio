/*
 * midisynth.js — petit synthétiseur General MIDI pour la musique d'OpenTTD (OpenMSX).
 *
 * Le moteur lit le fichier MIDI avec son propre lecteur (MidiFile) et transmet ici
 * la suite des messages datés (pilote de musique « emscripten », emscripten_m.cpp).
 * Ce script les joue avec Web Audio, uniquement avec des oscillateurs et du bruit
 * généré par le code : aucun échantillon ni banque de sons extérieure.
 *
 * Chaque morceau est RENDU à l'avance dans des OfflineAudioContext (mono, 22,05 kHz),
 * par tranches de 8 s, bien plus vite que le temps réel ; les tranches sont jouées bout
 * à bout comme des AudioBufferSourceNode programmés sur l'horloge audio. La lecture ne
 * dépend donc ni de la boucle du jeu, ni des minuteries du navigateur (bridées quand
 * l'onglet est masqué), et il n'y a pas de limite de polyphonie qui couperait des notes.
 * Les rendus complets sont gardés en cache (les deux derniers morceaux).
 *
 * Interface utilisée par le moteur : window.openttd_music.{init, play, stop,
 * isPlaying, setVolume} ; et par la coquille web : resume() au premier clic.
 */
(function () {
  'use strict';

  var RATE = 22050;         // fréquence du rendu (mono)
  var TAIL = 3;             // secondes ajoutées après le dernier événement (relâchements)
  var CACHE_SIZE = 2;

  var ctx = null, master = null;
  var gameVolume = 1;       // réglage « musique » d'OpenTTD (0..1)
  var current = null;       // { name, chunks, startedAt, ended }
  var cache = [];           // [{ key, mix }] : morceaux complets déjà rendus
  var stats = { renders: 0, lastRenderMs: 0, firstChunkMs: 0, cacheHits: 0, lateChunks: 0 };

  function ensureContext() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    master.connect(comp);
    comp.connect(ctx.destination);
    applyVolume();
    ctx.onstatechange = function () {
      console.log('[musique] AudioContext : ' + ctx.state);
      if (ctx.state === 'running') startIfReady();
    };
    console.log('[musique] AudioContext créé (' + ctx.state + ')');
    return ctx;
  }

  function applyVolume() {
    if (master) master.gain.value = 0.22 * gameVolume;
  }

  // --- Décodage du format transmis par le moteur ---------------------------------
  // blocs : [ms : 4 octets LE][longueur : 2 octets LE][messages MIDI]
  function decode(bytes) {
    var events = [], p = 0;
    while (p + 6 <= bytes.length) {
      var t = (bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24)) >>> 0;
      var len = bytes[p + 4] | (bytes[p + 5] << 8);
      p += 6;
      var end = Math.min(bytes.length, p + len), status = 0;
      while (p < end) {
        var b = bytes[p];
        if (b & 0x80) { status = b; p++; }
        if (status === 0xF0 || status === 0xF7) {   // SysEx : ignoré
          while (p < end && bytes[p] !== 0xF7) p++;
          p++;
          status = 0;
          continue;
        }
        if (status === 0xFF) { p = end; break; }    // méta (ne devrait pas arriver)
        var type = status & 0xF0;
        var n = (type === 0xC0 || type === 0xD0) ? 1 : 2;
        if (!status || p + n > end) { p = end; break; }
        events.push({ t: t / 1000, s: status, a: bytes[p], b: n > 1 ? bytes[p + 1] : 0 });
        p += n;
      }
      p = end;
    }
    return events;
  }

  // --- Timbres ----------------------------------------------------------------------
  function mtof(note) { return 440 * Math.pow(2, (note - 69) / 12); }

  /** Timbre selon la famille General MIDI du programme. */
  function timbre(program) {
    var f = program >> 3;
    switch (f) {
      case 0: return { wave: 'triangle', a: 0.005, d: 0.6, s: 0.25, r: 0.3, cut: 4000 };   // pianos
      case 1: return { wave: 'sine', a: 0.003, d: 0.35, s: 0, r: 0.3, cut: 8000 };          // percussions chromatiques
      case 2: return { wave: 'square', a: 0.01, d: 0.1, s: 0.8, r: 0.08, cut: 2500 };       // orgues
      case 3: return { wave: 'sawtooth', a: 0.005, d: 0.5, s: 0.15, r: 0.2, cut: 2200 };    // guitares
      case 4: return { wave: 'triangle', a: 0.006, d: 0.4, s: 0.6, r: 0.1, cut: 900 };      // basses
      case 5: case 6: return { wave: 'sawtooth', a: 0.08, d: 0.3, s: 0.7, r: 0.35, cut: 2000 }; // cordes, ensembles
      case 7: return { wave: 'sawtooth', a: 0.03, d: 0.2, s: 0.75, r: 0.15, cut: 2600 };    // cuivres
      case 8: case 9: return { wave: 'square', a: 0.03, d: 0.2, s: 0.7, r: 0.12, cut: 3000 }; // anches, flûtes
      case 10: return { wave: 'square', a: 0.01, d: 0.2, s: 0.7, r: 0.1, cut: 3500 };       // synthé solo
      case 11: return { wave: 'sawtooth', a: 0.25, d: 0.5, s: 0.7, r: 0.6, cut: 1500 };     // nappes
      default: return { wave: 'triangle', a: 0.01, d: 0.3, s: 0.5, r: 0.2, cut: 3000 };
    }
  }

  // --- Rendu d'un morceau ---------------------------------------------------------------
  // 1) Les événements MIDI sont convertis en notes complètes (début, relâchement,
  //    timbre, volume, variations de hauteur).
  // 2) Le morceau est rendu par tranches de CHUNK secondes, chacune dans son propre
  //    OfflineAudioContext : une note est rendue en entier dans la tranche où elle
  //    commence, et sa queue est ajoutée aux tranches suivantes (somme exacte, le rendu
  //    est linéaire). Chaque tranche ne contient que ses notes : rendu rapide.
  // 3) Les tranches sont jouées bout à bout, programmées à l'échantillon près sur
  //    l'horloge audio : aucune dépendance à la boucle du jeu ni aux minuteries.
  var CHUNK = 8;

  function toNotes(events, duration) {
    var notes = [];
    var channels = [];
    for (var c = 0; c < 16; c++) channels.push({ program: 0, volume: 100 / 127, expression: 1, bend: 0, sustain: false, held: {}, sustained: [] });
    function release(n, t) { if (n.off === null) n.off = Math.max(t, n.t + n.tb.a); }
    events.forEach(function (e) {
      var t = e.t, type = e.s & 0xF0, chn = e.s & 0x0F, ch = channels[chn];
      if (type === 0x90 && e.b > 0) {
        var level = (e.b / 127) * ch.volume * ch.expression;
        if (level <= 0) return;
        if (chn === 9) { notes.push({ drum: true, t: t, note: e.a, amp: level * 0.7 }); return; }
        var tb = timbre(ch.program);
        var n = { t: t, note: e.a, tb: tb, peak: level * 0.5, off: tb.s === 0 ? t : null, bends: [[t, ch.bend]] };
        notes.push(n);
        (ch.held[e.a] = ch.held[e.a] || []).push(n);
      } else if (type === 0x80 || type === 0x90) {
        var list = ch.held[e.a];
        if (!list || !list.length) return;
        var m = list.shift();
        if (ch.sustain) ch.sustained.push(m); else release(m, t);
      } else if (type === 0xB0) {
        switch (e.a) {
          case 7: ch.volume = e.b / 127; break;
          case 11: ch.expression = e.b / 127; break;
          case 64:
            ch.sustain = e.b >= 64;
            if (!ch.sustain) { ch.sustained.forEach(function (x) { release(x, t); }); ch.sustained = []; }
            break;
          case 120: case 123:
            Object.keys(ch.held).forEach(function (k) { ch.held[k].forEach(function (x) { release(x, t); }); });
            ch.held = {};
            break;
          case 121: ch.expression = 1; ch.bend = 0; ch.sustain = false; break;
        }
      } else if (type === 0xC0) {
        ch.program = e.a;
      } else if (type === 0xE0) {
        ch.bend = (((e.b << 7) | e.a) - 8192) / 8192;
        Object.keys(ch.held).forEach(function (k) { ch.held[k].forEach(function (x) { x.bends.push([t, ch.bend]); }); });
      }
    });
    notes.forEach(function (n) {
      if (n.drum) { n.end = n.t + 1.3; return; }
      if (n.off === null) n.off = duration;           // jamais relâchée : fin du morceau
      n.end = n.tb.s === 0 ? n.t + n.tb.a + n.tb.d * 2 + 0.1 : n.off + n.tb.r * 2.5 + 0.05;
    });
    return notes;
  }

  function makeNoise(oc) {
    var noise = oc.createBuffer(1, RATE * 2, RATE);
    var nd = noise.getChannelData(0), seed = 12345;
    for (var i = 0; i < nd.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      nd[i] = seed / 0x3fffffff - 1;
    }
    return noise;
  }

  /** Rend les notes d'une tranche (temps relatifs au début de la tranche, t0). */
  function renderChunk(notes, t0, length) {
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var oc = new OAC(1, Math.max(1, Math.ceil(length * RATE)), RATE);
    var noise = null;
    notes.forEach(function (n) {
      var t = n.t - t0;
      if (n.drum) return drum(oc, n, t);
      var tb = n.tb;
      var osc = oc.createOscillator();
      osc.type = tb.wave;
      osc.frequency.value = mtof(n.note);
      n.bends.forEach(function (b) { osc.detune.setValueAtTime(b[1] * 200, Math.max(0, b[0] - t0)); });
      var filter = oc.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = Math.min(9000, tb.cut + n.note * 20);
      var gain = oc.createGain();
      // enveloppe sans clic : départ à 0, montée linéaire, décroissance, relâchement doux
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(n.peak, t + tb.a);
      gain.gain.setTargetAtTime(n.peak * tb.s, t + tb.a, tb.d / 3);
      if (tb.s !== 0) gain.gain.setTargetAtTime(0, n.off - t0, tb.r / 3);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(oc.destination);
      osc.start(t);
      osc.stop(n.end - t0);
    });
    function drum(oc, n, t) {
      var amp = n.amp, note = n.note;
      var g = oc.createGain();
      g.connect(oc.destination);
      function tone(f0, f1, dur, type) {
        var o = oc.createOscillator();
        o.type = type || 'sine';
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f1, t + dur);
        o.connect(g);
        o.start(t); o.stop(t + dur + 0.05);
      }
      function noiseHit(type, freq, dur) {
        if (!noise) noise = makeNoise(oc);
        var s = oc.createBufferSource();
        s.buffer = noise;
        var f = oc.createBiquadFilter();
        f.type = type; f.frequency.value = Math.min(freq, RATE / 2 - 100);
        s.connect(f); f.connect(g);
        s.start(t, (note * 0.137) % 0.5); s.stop(t + dur + 0.05);
      }
      var dur = 0.15;
      if (note === 35 || note === 36) { tone(150, 45, 0.25); dur = 0.3; amp *= 1.4; }
      else if (note === 38 || note === 40 || note === 37 || note === 39) { noiseHit('highpass', 1500, 0.18); tone(220, 160, 0.08, 'triangle'); dur = 0.2; }
      else if (note === 42 || note === 44) { noiseHit('highpass', 7000, 0.05); dur = 0.06; amp *= 0.5; }
      else if (note === 46) { noiseHit('highpass', 7000, 0.3); dur = 0.3; amp *= 0.5; }
      else if (note === 49 || note === 52 || note === 55 || note === 57) { noiseHit('highpass', 5000, 1.2); dur = 1.2; amp *= 0.5; }
      else if (note === 51 || note === 53 || note === 59) { noiseHit('bandpass', 8000, 0.5); dur = 0.5; amp *= 0.4; }
      else if (note >= 41 && note <= 50) { var f = 80 + (note - 41) * 18; tone(f * 1.6, f, 0.3); dur = 0.35; }
      else { noiseHit('bandpass', 2500 + (note % 12) * 300, 0.1); dur = 0.12; amp *= 0.6; }
      // attaque de 2 ms pour éviter le clic, puis décroissance
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    }
    return oc.startRendering();
  }

  /**
   * Rend le morceau tranche par tranche ; onChunk(index, Float32Array définitive) est
   * appelé dès qu'une tranche est complète (sa propre musique + les queues des
   * tranches précédentes). Renvoie une promesse résolue à la fin du rendu.
   */
  function renderSong(events, duration, onChunk, isCancelled) {
    var notes = toNotes(events, duration);
    var total = duration + TAIL;
    var count = Math.max(1, Math.ceil(total / CHUNK));
    var size = Math.round(CHUNK * RATE);
    var mix = new Float32Array(count * size + Math.round(TAIL * RATE));   // somme de toutes les tranches
    var groups = [];
    for (var i = 0; i < count; i++) groups.push([]);
    notes.forEach(function (n) { groups[Math.min(count - 1, Math.floor(n.t / CHUNK))].push(n); });
    var k = 0;
    function next() {
      if (isCancelled()) return Promise.resolve(null);
      if (k >= count) return Promise.resolve(mix);
      var t0 = k * CHUNK, g = groups[k];
      var len = CHUNK;
      g.forEach(function (n) { len = Math.max(len, n.end - t0); });
      len = Math.min(len, total - t0 + 0.01);
      var index = k;
      return renderChunk(g, t0, len).then(function (buf) {
        var data = buf.getChannelData(0), off = index * size;
        var n = Math.min(data.length, mix.length - off);
        for (var j = 0; j < n; j++) mix[off + j] += data[j];
        // la tranche index est complète : plus aucune note ne commence avant sa fin
        onChunk(index, mix.subarray(index * size, (index + 1) * size), index === count - 1);
        k++;
        return next();
      });
    }
    return next();
  }

  function cached(key) {
    for (var i = 0; i < cache.length; i++) if (cache[i].key === key) return cache[i].mix;
    return null;
  }
  function remember(key, mix) {
    cache = cache.filter(function (c) { return c.key !== key; });
    cache.push({ key: key, mix: mix });
    while (cache.length > CACHE_SIZE) cache.shift();
  }

  // --- Lecture ------------------------------------------------------------------------
  // Un morceau = une suite de tranches (AudioBuffer) jouées bout à bout à partir de
  // startedAt, chacune programmée à son heure exacte sur l'horloge audio.
  function scheduleChunk(s, index) {
    var c = s.chunks[index];
    if (!c || c.source || s.startedAt === null) return;
    var when = s.startedAt + index * CHUNK;
    if (when < ctx.currentTime) stats.lateChunks++;
    var src = ctx.createBufferSource();
    src.buffer = c.buffer;
    src.connect(master);
    if (c.last) {
      src.onended = function () {
        if (current === s) { s.ended = true; console.log('[musique] fin : ' + s.name); }
      };
    }
    c.source = src;
    src.start(Math.max(when, ctx.currentTime));
  }

  function startIfReady() {
    var s = current;
    if (!s || s.startedAt !== null || !s.chunks[0] || !ctx || ctx.state !== 'running') return;
    s.startedAt = ctx.currentTime + 0.1;
    s.chunks.forEach(function (c, i) { scheduleChunk(s, i); });
    console.log('[musique] lecture : ' + s.name);
  }

  function addChunk(s, index, samples, last) {
    var buffer = ctx.createBuffer(1, samples.length, RATE);
    buffer.copyToChannel(samples, 0);
    s.chunks[index] = { buffer: buffer, last: last, source: null };
    if (s.startedAt !== null) scheduleChunk(s, index); else startIfReady();
  }

  function stopCurrent() {
    if (current) {
      current.chunks.forEach(function (c) {
        if (c && c.source) { try { c.source.onended = null; c.source.stop(); } catch (e) {} }
      });
    }
    current = null;
  }

  window.openttd_music = {
    init: function () { ensureContext(); },
    play: function (bytes, name) {
      stopCurrent();
      if (!ensureContext()) return;
      var key = (name || '?') + ':' + bytes.length;
      var s = current = { name: name || '?', chunks: [], startedAt: null, ended: false };
      var mix = cached(key);
      if (mix) {
        stats.cacheHits++;
        addChunk(s, 0, mix, true);   // tout le morceau en une seule tranche
        return;
      }
      var events = decode(bytes);
      var duration = events.length ? events[events.length - 1].t : 0;
      var t0 = performance.now(), first = 0;
      renderSong(events, duration, function (index, samples, last) {
        if (current !== s) return;
        if (index === 0) {
          first = Math.round(performance.now() - t0);
          if (ctx.state !== 'running') console.log('[musique] en attente d\'un clic : ' + s.name);
        }
        // copie : la tranche du morceau complet reste en cache
        addChunk(s, index, new Float32Array(samples), last);
      }, function () { return current !== s; }).then(function (full) {
        if (!full) return;
        stats.renders++;
        stats.lastRenderMs = Math.round(performance.now() - t0);
        stats.firstChunkMs = first;
        remember(key, full);
        console.log('[musique] rendu : ' + s.name + ' (' + events.length + ' événements, ' + Math.round(duration) + ' s, première tranche en ' + first + ' ms, tout en ' + stats.lastRenderMs + ' ms)');
      }).catch(function (e) {
        console.warn('[musique] rendu impossible : ' + e);
        if (current === s) s.ended = true;
      });
    },
    stop: function () { stopCurrent(); },
    /** Vrai tant que le morceau est en préparation, en attente de l'audio ou en lecture. */
    isPlaying: function () { return !!current && !current.ended; },
    setVolume: function (v) { gameVolume = Math.max(0, Math.min(1, v)); applyVolume(); },
    /** Premier geste de l'utilisateur : réveil de l'audio. */
    resume: function () {
      if (!ensureContext()) return Promise.resolve();
      if (ctx.state === 'running') { startIfReady(); return Promise.resolve(); }
      return ctx.resume().then(startIfReady);
    },
    state: function () { return ctx ? ctx.state : 'none'; },
    current: function () {
      if (!current) return '';
      if (!current.chunks[0]) return current.name + ' (rendu)';
      if (current.startedAt === null) return current.name + ' (en attente)';
      return current.name;
    },
    /** Position de lecture dans le morceau (s), pour les tests. */
    position: function () {
      return current && current.startedAt !== null && ctx ? Math.max(0, ctx.currentTime - current.startedAt) : 0;
    },
    ctxTime: function () { return ctx ? ctx.currentTime : 0; },
    stats: function () { return stats; },
  };
})();
