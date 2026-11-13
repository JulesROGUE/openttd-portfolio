/*
 * OpenTTD Portfolio — moteur JavaScript.
 * data.js : chargement des données relevées pendant le build par la version native du
 * moteur (world.json, world.bin, sprites.bin ; voir engine/src/portfolio_export.cpp).
 */
'use strict';
var OT = window.OT || (window.OT = {});

(function () {
  function fetchBuffer(url, onProgress) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ' : HTTP ' + r.status);
      var total = +r.headers.get('Content-Length') || 0;
      if (!r.body || !r.body.getReader || !onProgress) return r.arrayBuffer();
      var reader = r.body.getReader(), chunks = [], got = 0;
      function pump() {
        return reader.read().then(function (res) {
          if (res.done) {
            var out = new Uint8Array(got), o = 0;
            chunks.forEach(function (c) { out.set(c, o); o += c.length; });
            return out.buffer;
          }
          chunks.push(res.value);
          got += res.value.length;
          onProgress(got, total);
          return pump();
        });
      }
      return pump();
    });
  }

  /** Charge et prépare toutes les données. versioned(path) ajoute ?v=<build>. */
  OT.loadData = function (versioned, onStep) {
    onStep(0);
    return Promise.all([
      fetch(versioned('world.json')).then(function (r) { if (!r.ok) throw new Error('world.json : HTTP ' + r.status); return r.json(); }),
      fetchBuffer(versioned('world.bin')),
      fetchBuffer(versioned('sprites.bin')),
    ]).then(function (res) {
      onStep(1);
      return new Promise(function (resolve) { setTimeout(function () { resolve(prepare(res[0], res[1], res[2])); }, 0); });
    });
  };

  function prepare(json, worldBuf, spritesBuf) {
    var d = OT.data = {};
    d.json = json;
    var spx = new Uint8Array(spritesBuf);

    // Sprites : dimensions au zoom Min, pixels aux zooms Normal, Out2x et Out4x.
    d.sprites = Object.create(null);
    var zooms = [OT.Z.NORMAL, OT.Z.OUT2X, OT.Z.OUT4X];
    Object.keys(json.sprites).forEach(function (id) {
      var a = json.sprites[id];
      var s = { w: a[0], h: a[1], xo: a[2], yo: a[3], lv: [] };
      for (var i = 0; i < 3; i++) {
        var w = a[4 + i * 3], h = a[5 + i * 3], off = a[6 + i * 3];
        s.lv[zooms[i]] = { w: w, h: h, px: spx.subarray(off, off + w * h) };
      }
      d.sprites[id] = s;
    });
    d.glyphs = Object.create(null);
    Object.keys(json.glyphs).forEach(function (id) {
      var a = json.glyphs[id];
      var px = spx.subarray(a[4], a[4] + a[0] * a[1]);
      d.glyphs[id] = { w: a[0], h: a[1], xo: a[2], yo: a[3], lv: [{ w: a[0], h: a[1], px: px }] };
    });
    d.recolour = Object.create(null);
    Object.keys(json.recolour).forEach(function (pal) { d.recolour[pal] = Uint8Array.from(json.recolour[pal]); });
    d.identity = new Uint8Array(256);
    for (var i = 0; i < 256; i++) d.identity[i] = i;
    d.subsprites = json.subsprites;

    d.fonts = json.fonts.map(function (f) {
      var map = new Map(), widths = new Map();
      for (var j = 0; j < f.map.length; j += 3) {
        map.set(f.map[j], f.map[j + 1]);
        widths.set(f.map[j + 1], f.map[j + 2]);
      }
      return { height: f.height, ascender: f.ascender, map: map, widths: widths, fallback: f.fallback };
    });

    d.widget = json.widget;
    d.scales = json.scales;
    d.colourGradient = json.colour_gradient;
    d.stringColourmap = json.string_colourmap;
    d.scc = json.scc;
    d.strings = json.strings;
    d.guiSprites = json.gui_sprites;
    OT.SPR_EMPTY_BOUNDING_BOX = json.gui_sprites.empty_bbox;
    d.palette = Uint8Array.from(json.palette);
    d.paletteAnim = json.palette_anim;
    d.allBlack = json.map.all_black;
    d.windows = null;
    d.portfolio = json.portfolio;
    d.towns = json.towns;
    d.ticks = json.ticks;

    // Carte
    var m = d.map = json.map;
    var ints = new Int32Array(worldBuf);
    var u8 = new Uint8Array(worldBuf);
    var n = m.size_x * m.size_y;
    var info = ints.subarray(m.tile_info_offset >> 2, (m.tile_info_offset >> 2) + n * 6);
    m.type = new Uint8Array(n);
    m.height = new Uint8Array(n);
    m.tileh = new Uint8Array(n);
    m.z = new Int16Array(n);
    m.bridge = new Int32Array(n);
    m.town = new Int16Array(n);
    for (i = 0; i < n; i++) {
      m.type[i] = info[i * 6];
      m.height[i] = info[i * 6 + 1];
      m.tileh[i] = info[i * 6 + 2];
      m.z[i] = info[i * 6 + 3];
      m.bridge[i] = info[i * 6 + 4];
      m.town[i] = info[i * 6 + 5];
    }
    var pw = m.size_x * OT.TILE_SIZE, ph = m.size_y * OT.TILE_SIZE;
    if (m.pixel_z_bytes === 1) {
      m.pixelZ = u8.subarray(m.pixel_z_offset, m.pixel_z_offset + pw * ph);
    } else {
      m.pixelZ = new Uint16Array(worldBuf.slice(m.pixel_z_offset, m.pixel_z_offset + pw * ph * 2));
    }
    m.pixelW = pw;
    m.pixelH = ph;
    // hauteurs hors de la carte (bord noir)
    var ol = m.outside;
    m.outside = new Map();
    for (i = 0; i < ol.length; i += 4) m.outside.set(ol[i] + ',' + ol[i + 1], [ol[i + 2], ol[i + 3]]);

    // Listes de dessin de chaque tuile (zoom normal et lointain)
    var t = ints.subarray(json.tiles_offset >> 2, (json.tiles_offset >> 2) + json.tiles_length);
    d.tilesNormal = new Array(n);
    d.tilesFar = new Array(n);
    var p = 0;
    for (i = 0; i < n; i++) {
      var len = t[p++];
      d.tilesNormal[i] = t.subarray(p, p + len);
      p += len;
      len = t[p++];
      d.tilesFar[i] = len ? t.subarray(p, p + len) : null;
      p += len;
    }
    d.tilesNormal0 = d.tilesNormal.slice();
    d.tilesFar0 = d.tilesFar.slice();

    // Tuiles qui changent pendant la partie : [tick, tuile, liste normale, liste lointaine]
    var tc = ints.subarray(json.tile_changes_offset >> 2, (json.tile_changes_offset >> 2) + json.tile_changes_length);
    d.tileChanges = [];
    p = 0;
    while (p < tc.length) {
      var tick = tc[p++], tile = tc[p++];
      var ln = tc[p++];
      var a = tc.subarray(p, p + ln); p += ln;
      ln = tc[p++];
      var b = ln ? tc.subarray(p, p + ln) : null; p += ln;
      d.tileChanges.push({ tick: tick, tile: tile, normal: a, far: b });
    }

    d.vehicleStream = ints.subarray(json.vehicles_offset >> 2, (json.vehicles_offset >> 2) + json.vehicles_length);
    d.events = json.events;
    return d;
  }
})();
