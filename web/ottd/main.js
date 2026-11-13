/*
 * OpenTTD Portfolio — moteur JavaScript.
 * main.js : boucle du jeu (un tick toutes les 27 ms, comme OpenTTD), rejeu de la partie
 * relevée pendant le build (véhicules, tuiles, textes flottants, date et argent),
 * animation de la palette (palette.cpp), curseur de la souris, affichage dans le canvas,
 * clavier et souris. Aucun son.
 */
'use strict';
var OT = window.OT || (window.OT = {});

(function () {
  var MS_PER_TICK = 27;
  OT.ZOOM_MIN = 1; // gui.zoom_min (config/openttd.cfg)
  OT.ZOOM_MAX = 4; // gui.zoom_max

  var canvas, ctx, image, image32;
  var palette32 = new Uint32Array(256);
  var curPalette = new Uint8Array(768);
  var paletteDirty = true;

  // --- Palette et animation (DoPaletteAnimations) ------------------------------
  var animCounter = 0;
  function setPaletteEntry(i, r, g, b) {
    curPalette[i * 3] = r;
    curPalette[i * 3 + 1] = g;
    curPalette[i * 3 + 2] = b;
  }
  function rebuildPalette32() {
    for (var i = 0; i < 256; i++) {
      palette32[i] = (0xFF << 24) | (curPalette[i * 3 + 2] << 16) | (curPalette[i * 3 + 1] << 8) | curPalette[i * 3];
    }
  }
  function doPaletteAnimations() {
    var ev = OT.data.paletteAnim;
    animCounter = (animCounter + 8) | 0;
    var EXTR = function (p, q) { return (((animCounter * p) & 0xFFFF) * q) >>> 16; };
    var EXTR2 = function (p, q) { return (((~animCounter * p) & 0xFFFF) * q) >>> 16; };
    var before = curPalette.slice(ev.start * 3, (ev.start + ev.size) * 3);
    var pos = ev.start;
    function cycle(list, j, n, step) {
      for (var i = 0; i < n; i++) {
        setPaletteEntry(pos++, list[j * 3], list[j * 3 + 1], list[j * 3 + 2]);
        j += step;
        if (j >= list.length / 3) j -= list.length / 3;
      }
    }
    var fd = ev.fizzy_drink, n = fd.length / 3;
    cycle(fd, EXTR2(512, n), n, 1);
    var oil = ev.oil_refinery; n = oil.length / 3;
    cycle(oil, EXTR2(512, n), n, 1);
    var i = (animCounter >> 1) & 0x7F, v;
    v = i < 0x3f ? 255 : ((i < 0x4A || i >= 0x75) ? 128 : 20);
    setPaletteEntry(pos++, v, 0, 0);
    i ^= 0x40;
    v = i < 0x3f ? 255 : ((i < 0x4A || i >= 0x75) ? 128 : 20);
    setPaletteEntry(pos++, v, 0, 0);
    var lh = ev.lighthouse; n = lh.length / 3;
    cycle(lh, EXTR(256, n), n, 1);
    var dw = ev.dark_water; n = dw.length / 3;
    cycle(dw, EXTR(320, n), n, 1);
    var gw = ev.glitter_water; n = gw.length / 3;
    cycle(gw, EXTR(128, n), n / 3, 3);
    var after = curPalette.subarray(ev.start * 3, (ev.start + ev.size) * 3);
    for (i = 0; i < after.length; i++) if (after[i] !== before[i]) { paletteDirty = true; break; }
  }

  // --- Rejeu de la partie ------------------------------------------------------
  var tick = 0;
  var vehFrame = [];
  var vehPos = 0;
  var vehParents = [];
  var eventPos = 0, tileChangePos = 0;
  var staticTe = new Map();
  var risingTe = [];

  OT.currentVehicles = function () { return vehParents; };

  function vehicleBounds(list) {
    var rects = [];
    list.forEach(function (ps) {
      var l = ps.sl, t = ps.st, r = ps.sr, b = ps.sb;
      ps.children.forEach(function (cs) {
        var spr = OT.data.sprites[cs[0] & OT.SPRITE_MASK];
        if (!spr) return;
        var x = (cs[5] ? ps.left : ps.x) + cs[3] + spr.xo, y = (cs[5] ? ps.top : ps.y) + cs[4] + spr.yo;
        l = Math.min(l, x); t = Math.min(t, y); r = Math.max(r, x + spr.w); b = Math.max(b, y + spr.h);
      });
      rects.push([l, t, r, b]);
    });
    return rects;
  }
  function markRects(rects) {
    rects.forEach(function (r) { OT.markAllViewportsDirty(r[0], r[1], r[2] + OT.ZOOM_BASE, r[3] + OT.ZOOM_BASE); });
  }

  function readVehicles() {
    var s = OT.data.vehicleStream;
    if (vehPos >= s.length) return false;
    var h = s[vehPos++];
    if (h === -1) {
      var len = s[vehPos++];
      vehFrame = Array.prototype.slice.call(s.subarray(vehPos, vehPos + len));
      vehPos += len;
      return true;
    }
    for (var i = 0; i < h; i++) {
      vehFrame[s[vehPos]] += s[vehPos + 1];
      vehPos += 2;
    }
    return h > 0;
  }
  function updateVehicles() {
    if (!readVehicles()) return;
    var old = vehicleBounds(vehParents);
    vehParents = OT.parseDrawList(vehFrame).parents;
    markRects(old);
    markRects(vehicleBounds(vehParents));
  }

  function teSign(te) { return te; }
  function applyEvent(e) {
    switch (e[1]) {
      case 'date': OT.setStatus('date', e[2]); break;
      case 'money': OT.setStatus('money', e[2]); break;
      case 'middle': OT.setStatus('middle', e[2]); break;
      case 'te_add': {
        var te = { mode: e[3], center: e[4], top: e[5], width_normal: e[6], width_small: e[7], duration: e[8], text: e[9] };
        OT.updateSignWidths(te, te.text);
        if (te.mode === 1) risingTe.push(te);
        else staticTe.set(e[2], te);
        OT.markSignDirty(te);
        rebuildTeList();
        break;
      }
      case 'te_update': {
        var s = staticTe.get(e[2]);
        if (!s) break;
        OT.markSignDirty(s);
        s.text = e[9]; s.center = e[4]; s.top = e[5];
        OT.updateSignWidths(s, s.text);
        OT.markSignDirty(s);
        break;
      }
      case 'te_remove': {
        var r = staticTe.get(e[2]);
        if (r) {
          OT.markSignDirty(r);
          staticTe.delete(e[2]);
          rebuildTeList();
        }
        break;
      }
    }
  }
  function rebuildTeList() {
    OT.textEffects = Array.from(staticTe.values()).concat(risingTe);
  }

  /** Les textes qui montent (recettes) bougent toutes les 30 ms, comme dans le moteur. */
  function moveTextEffects(count) {
    var changed = false;
    risingTe = risingTe.filter(function (te) {
      if (te.duration < count) {
        OT.markSignDirty(te);
        changed = true;
        return false;
      }
      OT.markSignDirty(te, OT.Z.OUT2X);
      te.duration -= count;
      te.top -= count * OT.ZOOM_BASE;
      OT.markSignDirty(te, OT.Z.OUT2X);
      return true;
    });
    if (changed) rebuildTeList();
  }

  function restartReplay() {
    var d = OT.data;
    d.tilesNormal = d.tilesNormal0.slice();
    d.tilesFar = d.tilesFar0.slice();
    OT.resetTileCache();
    tick = 0;
    vehPos = 0;
    vehFrame = [];
    vehParents = [];
    eventPos = 0;
    tileChangePos = 0;
    staticTe.clear();
    risingTe = [];
    rebuildTeList();
    OT.markWholeScreenDirty();
  }

  /** Un tick de la partie (StateGameLoop rejoué). */
  function gameTick() {
    var d = OT.data;
    if (tick >= d.ticks) restartReplay();
    while (tileChangePos < d.tileChanges.length && d.tileChanges[tileChangePos].tick <= tick) {
      var c = d.tileChanges[tileChangePos++];
      d.tilesNormal[c.tile] = c.normal;
      d.tilesFar[c.tile] = c.far;
      OT.invalidateTileCache(c.tile);
      OT.markTileDirty(c.tile);
    }
    updateVehicles();
    while (eventPos < d.events.length && d.events[eventPos][0] <= tick) applyEvent(d.events[eventPos++]);
    doPaletteAnimations();
    tick++;
  }

  // --- Curseur de la souris (DrawMouseCursor / UndrawMouseCursor) ---------------
  var cursorDrawn = null; // {x, y, w, h, backup}
  var cursorDirty = true;
  OT.cursorSprite = function () { return OT.getSpriteSize(OT.data.guiSprites.cursor); };
  OT.undrawMouseCursorIfOver = function (left, top, right, bottom) {
    var c = cursorDrawn;
    if (!c) return;
    if (right > c.x && left < c.x + c.w && bottom > c.y && top < c.y + c.h) undrawMouseCursor();
  };
  function undrawMouseCursor() {
    var c = cursorDrawn;
    if (!c) return;
    var buf = OT.screen.buf, sw = OT.screen.width;
    for (var y = 0; y < c.h; y++) buf.set(c.backup.subarray(y * c.w, (y + 1) * c.w), (c.y + y) * sw + c.x);
    OT.markScreenChanged(c.x, c.y, c.w, c.h);
    cursorDrawn = null;
  }
  function drawMouseCursor() {
    if (!OT.cursor.inWindow) { undrawMouseCursor(); return; }
    if (cursorDrawn && !cursorDirty) return;
    undrawMouseCursor();
    var s = OT.cursorSprite();
    var left = OT.cursor.x + s.x, width = s.width - s.x;
    var top = OT.cursor.y + s.y, height = s.height - s.y;
    var sw = OT.screen.width, sh = OT.screen.height;
    if (left < 0) { width += left; left = 0; }
    if (left + width > sw) width = sw - left;
    if (width <= 0) return;
    if (top < 0) { height += top; top = 0; }
    if (top + height > sh) height = sh - top;
    if (height <= 0) return;
    var backup = new Uint8Array(width * height), buf = OT.screen.buf;
    for (var y = 0; y < height; y++) backup.set(buf.subarray((top + y) * sw + left, (top + y) * sw + left + width), y * width);
    OT.dpi = OT.makeDpi(0, 0, sw, sh, 0, 0, 0);
    OT.drawSprite(OT.data.guiSprites.cursor, 0, OT.cursor.x, OT.cursor.y);
    cursorDrawn = { x: left, y: top, w: width, h: height, backup: backup };
    cursorDirty = false;
    OT.markScreenChanged(left, top, width, height);
  }

  // --- Sortie dans le canvas -------------------------------------------------------
  function present() {
    var sw = OT.screen.width, sh = OT.screen.height, buf = OT.screen.buf;
    var r;
    if (paletteDirty) {
      rebuildPalette32();
      paletteDirty = false;
      OT.takeChanged();
      r = [0, 0, sw, sh];
    } else {
      r = OT.takeChanged();
      if (!r) return;
    }
    var l = Math.max(0, r[0]), t = Math.max(0, r[1]), rr = Math.min(sw, r[2]), b = Math.min(sh, r[3]);
    if (l >= rr || t >= b) return;
    for (var y = t; y < b; y++) {
      var o = y * sw;
      for (var x = l; x < rr; x++) image32[o + x] = palette32[buf[o + x]];
    }
    ctx.putImageData(image, 0, 0, l, t, rr - l, b - t);
  }

  // --- Taille de l'écran -------------------------------------------------------------
  function resize(first) {
    var w = Math.max(64, window.innerWidth | 0), h = Math.max(64, window.innerHeight | 0);
    if (!first && w === OT.screen.width && h === OT.screen.height) return;
    cursorDrawn = null;
    OT.setScreenSize(w, h);
    canvas.width = w;
    canvas.height = h;
    image = ctx.createImageData(w, h);
    image32 = new Uint32Array(image.data.buffer);
    OT.resetDirty();
    var scale = OT.computeGuiScale(w, h);
    if (first) {
      OT.applyGuiScale(scale);
    } else {
      if (scale !== OT.guiScale) {
        var oldScale = OT.guiScale, oldZoom = OT.guiZoom;
        OT.applyGuiScale(scale);
        OT.reinitAllWindows(oldScale, oldZoom);
      }
      OT.relocateAllWindows(w, h);
    }
    paletteDirty = true;
    OT.markWholeScreenDirty();
  }

  // --- Entrées -----------------------------------------------------------------------
  function setupInput() {
    function pos(e) {
      var rect = canvas.getBoundingClientRect();
      return { x: Math.floor((e.clientX - rect.left) * OT.screen.width / rect.width), y: Math.floor((e.clientY - rect.top) * OT.screen.height / rect.height) };
    }
    function move(e) {
      var p = pos(e);
      if (OT.cursor.inWindow) {
        OT.cursor.dx += p.x - OT.cursor.x;
        OT.cursor.dy += p.y - OT.cursor.y;
      }
      if (p.x !== OT.cursor.x || p.y !== OT.cursor.y || !OT.cursor.inWindow) cursorDirty = true;
      OT.cursor.x = p.x;
      OT.cursor.y = p.y;
      OT.cursor.inWindow = true;
    }
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseenter', move);
    canvas.addEventListener('mouseleave', function () { OT.cursor.inWindow = false; cursorDirty = true; });
    canvas.addEventListener('mousedown', function (e) {
      move(e);
      canvas.focus();
      OT.mouseDown(e.button);
      e.preventDefault();
    });
    window.addEventListener('mouseup', function (e) { OT.mouseUp(e.button); });
    canvas.addEventListener('wheel', function (e) {
      move(e);
      if (e.deltaY !== 0) OT.mouseWheel(e.deltaY > 0 ? 1 : -1);
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    // tactile : un doigt = souris gauche
    canvas.addEventListener('touchstart', function (e) {
      var t = e.changedTouches[0];
      move(t);
      OT.cursor.dx = 0; OT.cursor.dy = 0;
      OT.mouseDown(0);
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchmove', function (e) { move(e.changedTouches[0]); e.preventDefault(); }, { passive: false });
    canvas.addEventListener('touchend', function (e) { OT.mouseUp(0); e.preventDefault(); }, { passive: false });

    var keybits = { ArrowLeft: 1, ArrowUp: 2, ArrowRight: 4, ArrowDown: 8 };
    window.addEventListener('keydown', function (e) {
      OT.shiftPressed = e.shiftKey;
      if (keybits[e.key]) {
        OT.dirkeys |= keybits[e.key];
        e.preventDefault();
        return;
      }
      if (OT.handleKey(e)) e.preventDefault();
      if (e.key === 'Tab' || e.key === ' ') e.preventDefault();
    });
    window.addEventListener('keyup', function (e) {
      OT.shiftPressed = e.shiftKey;
      if (keybits[e.key]) OT.dirkeys &= ~keybits[e.key];
    });
    window.addEventListener('blur', function () { OT.dirkeys = 0; OT.leftButtonDown = false; });
  }

  // --- Boucle ---------------------------------------------------------------------------
  var lastFrame = 0, tickAcc = 0, winAcc = 0, wbAcc = 0, teAcc = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!lastFrame) lastFrame = now;
    var delta = Math.min(now - lastFrame, 1000);
    lastFrame = now;
    resize(false);

    // ticks de la partie (au plus 8 rattrapés par image)
    tickAcc += delta;
    var n = 0;
    while (tickAcc >= MS_PER_TICK && n < 8) {
      gameTick();
      tickAcc -= MS_PER_TICK;
      n++;
    }
    if (tickAcc > MS_PER_TICK * 8) tickAcc = 0;

    OT.handleMouseEvents(now);

    // minuteries de l'interface (30 ms)
    winAcc += delta;
    while (winAcc >= 30) { OT.windowInterval(); winAcc -= 30; }
    wbAcc += delta;
    while (wbAcc >= 30) { OT.whiteBorderInterval(); wbAcc -= 30; }
    teAcc += delta;
    var teCount = Math.floor(teAcc / 30);
    if (teCount > 0) { moveTextEffects(teCount); teAcc -= teCount * 30; }

    OT.drawDirtyBlocks();
    OT.windows.forEach(function (w) { if (w.viewport && !w.shaded) OT.updateViewportPosition(w, Math.max(1, Math.round(delta))); });
    drawMouseCursor();
    present();
  }

  /**
   * Outils de test (scripts Playwright du dépôt), comme pf_test_house_point : position à
   * l'écran de la maison la plus proche du centre de la ville d'un projet, ou null.
   */
  OT.testHousePoint = function (project) {
    var d = OT.data, m = d.map;
    var p = d.portfolio.projects[project];
    var t = p && d.towns.find(function (x) { return x.id === p.town; });
    var vp = OT.mainWindow.viewport;
    if (!t) return null;
    var best = -1, bestd = 1e9;
    for (var i = 0; i < m.type.length; i++) {
      if (m.type[i] !== 3 || m.town[i] !== t.id) continue;
      var x = i % m.size_x, y = Math.floor(i / m.size_x);
      var dd = Math.abs(x - t.x) + Math.abs(y - t.y);
      if (dd < bestd) { bestd = dd; best = i; }
    }
    if (best < 0) return null;
    var tx = best % m.size_x, ty = Math.floor(best / m.size_x);
    var maxz = Math.max(m.z[best] + (m.tileh[best] ? OT.TILE_HEIGHT : 0), 0);
    var pt = OT.remapCoords(tx * 16 + 8, ty * 16 + 8, maxz);
    var sx = ((pt.x - vp.virtual_left) >> vp.zoom) + vp.left, sy = ((pt.y - vp.virtual_top) >> vp.zoom) + vp.top;
    if (sx < 0 || sy < 0 || sx >= OT.screen.width || sy >= OT.screen.height) return null;
    return { x: sx, y: sy };
  };
  OT.testProjectWindows = function () { return OT.windows.filter(function (w) { return w.cls === 'project'; }).length; };

  /** Démarrage, une fois les données chargées. */
  OT.start = function (cv) {
    canvas = cv;
    ctx = canvas.getContext('2d', { alpha: false });
    curPalette.set(OT.data.palette);
    doPaletteAnimations();
    rebuildPalette32();
    resize(true);
    OT.createMainWindow();
    OT.createStatusBar();
    // état au tick 0 (date, argent, véhicules)
    gameTick();
    OT.showPortfolioWelcome();
    OT.markWholeScreenDirty();
    setupInput();
    // comme SDL, le curseur est dessiné en (0, 0) tant que la souris n'a pas bougé
    OT.cursor.inWindow = true;
    requestAnimationFrame(frame);
  };
})();
