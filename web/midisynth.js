/*
 * midisynth.js — petit synthétiseur General MIDI pour la musique d'OpenTTD (OpenMSX).
 *
 * Le moteur lit le fichier MIDI avec son propre lecteur (MidiFile) et transmet ici
 * la suite des messages datés (pilote de musique « emscripten », emscripten_m.cpp).
 * Ce script les joue avec Web Audio, uniquement avec des oscillateurs et du bruit
 * généré par le code : aucun échantillon ni banque de sons extérieure.
 *
 * Interface utilisée par le moteur : window.openttd_music.{init, play, stop,
 * isPlaying, setVolume} ; et par la coquille web : resume() au premier clic.
 */
(function () {
  'use strict';

  var LOOKAHEAD = 1.5;      // secondes programmées à l'avance
  var TICK_MS = 200;        // période du programmateur
  var MAX_VOICES = 40;

  var ctx = null, master = null, out = null, noiseBuffer = null;
  var gameVolume = 1;       // réglage « musique » d'OpenTTD (0..1)
  var song = null;          // { events, name, start, next, end }
  var pending = null;       // morceau demandé avant que l'audio soit autorisé
  var timer = 0;
  var voices = [];          // voix programmées (pour l'arrêt et le vol de voix)
  var channels = [];

  function resetChannels() {
    channels = [];
    for (var i = 0; i < 16; i++) {
      channels.push({ program: 0, volume: 100 / 127, expression: 1, pan: 0, bend: 0, sustain: false,
                      held: {}, sustained: [] });
    }
  }
  resetChannels();

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
    out = master;
    applyVolume();
    // bruit blanc calculé (2 s), pour les percussions
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    var d = noiseBuffer.getChannelData(0);
    var seed = 12345;
    for (var i = 0; i < d.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      d[i] = seed / 0x3fffffff - 1;
    }
    ctx.onstatechange = function () {
      console.log('[musique] AudioContext : ' + ctx.state);
      if (ctx.state === 'running' && pending) startPending();
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

  // --- Voix ------------------------------------------------------------------------
  function mtof(note) { return 440 * Math.pow(2, (note - 69) / 12); }

  /** Timbre selon la famille General MIDI du programme. */
  function timbre(program) {
    var f = program >> 3;
    switch (f) {
      case 0: return { wave: 'triangle', a: 0.005, d: 0.6, s: 0.25, r: 0.3, cut: 4000 };   // pianos
      case 1: return { wave: 'sine', a: 0.002, d: 0.35, s: 0, r: 0.3, cut: 8000 };          // percussions chromatiques
      case 2: return { wave: 'square', a: 0.01, d: 0.1, s: 0.8, r: 0.08, cut: 2500 };       // orgues
      case 3: return { wave: 'sawtooth', a: 0.004, d: 0.5, s: 0.15, r: 0.2, cut: 2200 };    // guitares
      case 4: return { wave: 'triangle', a: 0.005, d: 0.4, s: 0.6, r: 0.1, cut: 900 };      // basses
      case 5: case 6: return { wave: 'sawtooth', a: 0.08, d: 0.3, s: 0.7, r: 0.35, cut: 2000 }; // cordes, ensembles
      case 7: return { wave: 'sawtooth', a: 0.03, d: 0.2, s: 0.75, r: 0.15, cut: 2600 };    // cuivres
      case 8: case 9: return { wave: 'square', a: 0.03, d: 0.2, s: 0.7, r: 0.12, cut: 3000 }; // anches, flûtes
      case 10: return { wave: 'square', a: 0.01, d: 0.2, s: 0.7, r: 0.1, cut: 3500 };       // synthé solo
      case 11: return { wave: 'sawtooth', a: 0.25, d: 0.5, s: 0.7, r: 0.6, cut: 1500 };     // nappes
      default: return { wave: 'triangle', a: 0.01, d: 0.3, s: 0.5, r: 0.2, cut: 3000 };
    }
  }

  function addVoice(v) {
    voices.push(v);
    if (voices.length > MAX_VOICES) {
      var old = voices.shift();
      try { old.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.01); old.stopAt(ctx.currentTime + 0.1); } catch (e) {}
    }
  }

  function connectOut(node, ch) {
    if (ctx.createStereoPanner) {
      var pan = ctx.createStereoPanner();
      pan.pan.value = ch.pan;
      node.connect(pan);
      pan.connect(out);
    } else {
      node.connect(out);
    }
  }

  function noteOn(chn, note, vel, t) {
    var ch = channels[chn];
    if (chn === 9) return drum(note, vel, t, ch);
    var tb = timbre(ch.program);
    var peak = (vel / 127) * ch.volume * ch.expression * 0.5;
    var osc = ctx.createOscillator();
    osc.type = tb.wave;
    osc.frequency.value = mtof(note);
    osc.detune.value = ch.bend * 200;
    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(12000, tb.cut + note * 20);
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + tb.a);
    gain.gain.setTargetAtTime(peak * tb.s, t + tb.a, tb.d / 3);
    osc.connect(filter);
    filter.connect(gain);
    connectOut(gain, ch);
    osc.start(t);
    var maxEnd = t + (tb.s === 0 ? tb.a + tb.d * 2 + 0.1 : 30);
    osc.stop(maxEnd);
    var v = { chn: chn, note: note, osc: osc, gain: gain, tb: tb, end: maxEnd,
              stopAt: function (when) { try { osc.stop(when); } catch (e) {} } };
    (ch.held[note] = ch.held[note] || []).push(v);
    addVoice(v);
  }

  function release(v, t) {
    var when = Math.max(t, ctx.currentTime);
    v.gain.gain.setTargetAtTime(0, when, v.tb.r / 3);
    var stop = when + v.tb.r * 2 + 0.05;
    if (stop < v.end) { v.end = stop; v.stopAt(stop); }
  }

  function noteOff(chn, note, t) {
    var ch = channels[chn];
    var list = ch.held[note];
    if (!list || !list.length) return;
    var v = list.shift();
    if (ch.sustain) ch.sustained.push(v); else release(v, t);
  }

  function drum(note, vel, t, ch) {
    var amp = (vel / 127) * ch.volume * ch.expression * 0.7;
    var g = ctx.createGain();
    connectOut(g, ch);
    var nodes = [];
    function tone(f0, f1, dur, type) {
      var o = ctx.createOscillator();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      o.connect(g);
      o.start(t); o.stop(t + dur + 0.05);
      nodes.push(o);
    }
    function noise(type, freq, dur) {
      var s = ctx.createBufferSource();
      s.buffer = noiseBuffer;
      var f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq;
      s.connect(f); f.connect(g);
      s.start(t, Math.random()); s.stop(t + dur + 0.05);
      nodes.push(s);
    }
    var dur = 0.15;
    if (note === 35 || note === 36) { tone(150, 45, 0.25); dur = 0.3; amp *= 1.4; }
    else if (note === 38 || note === 40 || note === 37 || note === 39) { noise('highpass', 1500, 0.18); tone(220, 160, 0.08, 'triangle'); dur = 0.2; }
    else if (note === 42 || note === 44) { noise('highpass', 7000, 0.05); dur = 0.06; amp *= 0.5; }
    else if (note === 46) { noise('highpass', 7000, 0.3); dur = 0.3; amp *= 0.5; }
    else if (note === 49 || note === 52 || note === 55 || note === 57) { noise('highpass', 5000, 1.2); dur = 1.2; amp *= 0.5; }
    else if (note === 51 || note === 53 || note === 59) { noise('bandpass', 8000, 0.5); dur = 0.5; amp *= 0.4; }
    else if (note >= 41 && note <= 50) { var f = 80 + (note - 41) * 18; tone(f * 1.6, f, 0.3); dur = 0.35; }
    else { noise('bandpass', 2500 + (note % 12) * 300, 0.1); dur = 0.12; amp *= 0.6; }
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    var v = { chn: 9, note: note, gain: g, tb: { r: 0.05 }, end: t + dur,
              stopAt: function (when) { nodes.forEach(function (n) { try { n.stop(when); } catch (e) {} }); } };
    addVoice(v);
  }

  function controlChange(chn, cc, val, t) {
    var ch = channels[chn];
    switch (cc) {
      case 7: ch.volume = val / 127; break;
      case 11: ch.expression = val / 127; break;
      case 10: ch.pan = (val - 64) / 64; break;
      case 64:
        ch.sustain = val >= 64;
        if (!ch.sustain) { ch.sustained.forEach(function (v) { release(v, t); }); ch.sustained = []; }
        break;
      case 120: case 123:   // tout couper / toutes les notes
        Object.keys(ch.held).forEach(function (k) { ch.held[k].forEach(function (v) { release(v, t); }); });
        ch.held = {};
        break;
      case 121: ch.expression = 1; ch.bend = 0; ch.sustain = false; break;
    }
  }

  function dispatch(e, t) {
    var type = e.s & 0xF0, chn = e.s & 0x0F;
    switch (type) {
      case 0x90: if (e.b > 0) noteOn(chn, e.a, e.b, t); else noteOff(chn, e.a, t); break;
      case 0x80: noteOff(chn, e.a, t); break;
      case 0xB0: controlChange(chn, e.a, e.b, t); break;
      case 0xC0: channels[chn].program = e.a; break;
      case 0xE0: {
        var ch = channels[chn];
        ch.bend = (((e.b << 7) | e.a) - 8192) / 8192;
        Object.keys(ch.held).forEach(function (k) {
          ch.held[k].forEach(function (v) { if (v.osc) v.osc.detune.setValueAtTime(ch.bend * 200, Math.max(t, ctx.currentTime)); });
        });
        break;
      }
    }
  }

  // --- Programmateur ----------------------------------------------------------------
  function schedule() {
    if (!song || !ctx) return;
    var horizon = ctx.currentTime + LOOKAHEAD;
    var ev = song.events;
    while (song.next < ev.length && song.start + ev[song.next].t <= horizon) {
      var e = ev[song.next++];
      dispatch(e, Math.max(song.start + e.t, ctx.currentTime));
    }
    // ménage des voix terminées
    var now = ctx.currentTime;
    voices = voices.filter(function (v) { return v.end > now; });
  }

  function startPending() {
    song = pending;
    pending = null;
    resetChannels();
    song.start = ctx.currentTime + 0.15;
    song.next = 0;
    console.log('[musique] lecture : ' + song.name + ' (' + song.events.length + ' événements, ' + Math.round(song.end) + ' s)');
    clearInterval(timer);
    timer = setInterval(schedule, TICK_MS);
    schedule();
  }

  function stopAll() {
    clearInterval(timer);
    timer = 0;
    if (ctx) {
      var now = ctx.currentTime;
      voices.forEach(function (v) {
        try { v.gain.gain.cancelScheduledValues(now); v.gain.gain.setTargetAtTime(0, now, 0.02); } catch (e) {}
        v.stopAt(now + 0.15);
      });
    }
    voices = [];
    resetChannels();
    song = null;
  }

  window.openttd_music = {
    init: function () { ensureContext(); },
    play: function (bytes, name) {
      stopAll();
      var events = decode(bytes);
      var last = events.length ? events[events.length - 1].t : 0;
      pending = { events: events, name: name || '?', end: last + 2 };
      if (ensureContext() && ctx.state === 'running') startPending();
      else console.log('[musique] en attente d\'un clic : ' + pending.name);
    },
    stop: function () { pending = null; stopAll(); },
    isPlaying: function () {
      if (pending) return true;                       // audio pas encore autorisé : on attend
      if (!song || !ctx) return false;
      return ctx.currentTime < song.start + song.end;
    },
    setVolume: function (v) { gameVolume = Math.max(0, Math.min(1, v)); applyVolume(); },
    /** Premier geste de l'utilisateur : réveil de l'audio. */
    resume: function () {
      if (!ensureContext()) return Promise.resolve();
      if (ctx.state === 'running') { if (pending) startPending(); return Promise.resolve(); }
      return ctx.resume().then(function () { if (pending && ctx.state === 'running') startPending(); });
    },
    state: function () { return ctx ? ctx.state : 'none'; },
    current: function () { return song ? song.name : (pending ? pending.name + ' (en attente)' : ''); },
  };
})();
