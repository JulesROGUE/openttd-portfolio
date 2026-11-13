/*
 * OpenTTD Portfolio — moteur JavaScript.
 * viewport.js : vues de la carte. Port de viewport.cpp (ViewportAddLandscape, tri des
 * sprites, dessin, panneaux des villes, défilement doux, zoom), de texteff.cpp et d'une
 * partie de landscape.cpp (OpenTTD 15.3, GPL v2). Les listes de dessin de chaque tuile
 * viennent du moteur natif (portfolio_viewport_export.inc) : rien n'est redessiné à la main.
 */
'use strict';
var OT = window.OT || (window.OT = {});

(function () {
  var ZB = OT.ZOOM_BASE, TS = OT.TILE_SIZE;
  var MAX_TILE_EXTENT_LEFT = ZB * OT.TILE_PIXELS;
  var MAX_TILE_EXTENT_RIGHT = ZB * OT.TILE_PIXELS;
  var MAX_TILE_EXTENT_TOP = ZB * OT.MAX_BUILDING_PIXELS;
  var MAX_TILE_EXTENT_BOTTOM = ZB * (OT.TILE_PIXELS + 2 * OT.TILE_HEIGHT);
  OT.SHOW_TOWN_NAMES = true;

  // --- Hauteurs ---------------------------------------------------------------
  function map() { return OT.data.map; }
  OT.tileHeightOutsideMap = function (x, y) {
    var m = map();
    x = Math.min(Math.max(x, 0), m.size_x - 1);
    y = Math.min(Math.max(y, 0), m.size_y - 1);
    return m.height[y * m.size_x + x];
  };
  OT.getSlopePixelZ = function (x, y) {
    var m = map();
    x = Math.min(Math.max(x, 0), m.pixelW - 1);
    y = Math.min(Math.max(y, 0), m.pixelH - 1);
    return m.pixelZ[y * m.pixelW + x];
  };
  function tileSlopeGivenHeight(hn, hw, he, hs) {
    var hmin = Math.min(hn, hw, he, hs), hmax = Math.max(hn, hw, he, hs);
    var r = 0;
    if (hn !== hmin) r |= 8;
    if (hw !== hmin) r |= 1;
    if (he !== hmin) r |= 4;
    if (hs !== hmin) r |= 2;
    if (hmax - hmin === 2) r |= 16;
    return [r, hmin];
  }
  function tilePixelSlopeOutsideMap(x, y) {
    var k = OT.data.map.outside.get(x + ',' + y);
    if (k) return k;
    var h = OT.tileHeightOutsideMap;
    var s = tileSlopeGivenHeight(h(x, y), h(x + 1, y), h(x, y + 1), h(x + 1, y + 1));
    return [s[0], s[1] * OT.TILE_HEIGHT];
  }
  function tilePixelHeightOutsideMap(x, y) { return OT.tileHeightOutsideMap(x, y) * OT.TILE_HEIGHT; }

  /** InverseRemapCoords2 : point du terrain sous un point de la vue (avec le relief). */
  OT.inverseRemapCoords2 = function (x, y, clamp) {
    var m = map();
    var pt = OT.inverseRemapCoords(x, y);
    var min_coord = m.freeform_edges ? TS : 0;
    var max_x = (m.size_x - 1) * TS - 1;
    var max_y = (m.size_y - 1) * TS - 1;
    var clamped = false;
    if (clamp) {
      var extra = Math.ceil(m.map_height_limit * OT.TILE_HEIGHT / OT.TILE_PIXELS);
      var ox = pt.x, oy = pt.y;
      pt.x = Math.min(Math.max(pt.x, -extra * TS), max_x);
      pt.y = Math.min(Math.max(pt.y, -extra * TS), max_y);
      clamped = pt.x !== ox || pt.y !== oy;
    }
    var cl = function (v, a, b) { return Math.min(Math.max(v, a), b); };
    var z = 0, i, mm;
    var gz = function (a, b) { return Math.trunc(OT.getSlopePixelZ(cl(a, min_coord, max_x), cl(b, min_coord, max_y)) / 2); };
    for (i = 0; i < 5; i++) z = gz(pt.x + Math.max(z, 4) - 4, pt.y + Math.max(z, 4) - 4);
    for (mm = 3; mm > 0; mm--) z = gz(pt.x + Math.max(z, mm) - mm, pt.y + Math.max(z, mm) - mm);
    for (i = 0; i < 5; i++) z = gz(pt.x + z, pt.y + z);
    pt.x += z;
    pt.y += z;
    if (clamp) {
      var old = { x: pt.x, y: pt.y };
      pt.x = cl(pt.x, min_coord, max_x);
      pt.y = cl(pt.y, min_coord, max_y);
      if (pt.x !== old.x || pt.y !== old.y) clamped = true;
    }
    pt.clamped = clamped;
    return pt;
  };

  // --- Listes de dessin --------------------------------------------------------
  /**
   * Analyse une liste de dessin relevée (format de PortfolioDumpDrawLists) :
   * { tiles: [[image, pal, sub, x, y]], parents: [ps] }.
   */
  OT.parseDrawList = function (a) {
    var p = 0, i, c;
    var nt = a[p++];
    var tiles = [];
    for (i = 0; i < nt; i++, p += 5) tiles.push([a[p] >>> 0, a[p + 1] >>> 0, a[p + 2], a[p + 3], a[p + 4]]);
    var np = a[p++];
    var parents = [];
    for (i = 0; i < np; i++) {
      var ps = {
        image: a[p] >>> 0, pal: a[p + 1] >>> 0, sub: a[p + 2], x: a[p + 3], y: a[p + 4], left: a[p + 5], top: a[p + 6],
        xmin: a[p + 7], xmax: a[p + 8], ymin: a[p + 9], ymax: a[p + 10], zmin: a[p + 11], zmax: a[p + 12],
        children: [], order: 0, sl: 0, sr: 0, st: 0, sb: 0,
      };
      var nc = a[p + 13];
      p += 14;
      for (c = 0; c < nc; c++, p += 6) ps.children.push([a[p] >>> 0, a[p + 1] >>> 0, a[p + 2], a[p + 3], a[p + 4], a[p + 5]]);
      screenExtents(ps);
      childrenExtents(ps);
      parents.push(ps);
    }
    return { tiles: tiles, parents: parents };
  };

  /** Étendue à l'écran d'un sprite trié (pour le découpage d'AddSortableSpriteToDraw). */
  function screenExtents(ps) {
    if ((ps.image & OT.SPRITE_MASK) === OT.SPR_EMPTY_BOUNDING_BOX) {
      var ex = ps.xmax - ps.xmin + 1, ey = ps.ymax - ps.ymin + 1, ez = ps.zmax - ps.zmin + 1;
      ps.sl = OT.remapCoords(ps.xmin + ex, ps.ymin, ps.zmin).x;
      ps.sr = OT.remapCoords(ps.xmin, ps.ymin + ey, ps.zmin).x + 1;
      ps.st = OT.remapCoords(ps.xmin, ps.ymin, ps.zmin + ez).y;
      ps.sb = OT.remapCoords(ps.xmin + ex, ps.ymin + ey, ps.zmin).y + 1;
    } else {
      var spr = OT.data.sprites[ps.image & OT.SPRITE_MASK];
      ps.sl = ps.left;
      ps.st = ps.top;
      ps.sr = ps.left + (spr ? spr.w : 0);
      ps.sb = ps.top + (spr ? spr.h : 0);
    }
  }

  /**
   * Les sprites « combinés » (StartSpriteCombine : plusieurs arbres d'une tuile, sprites
   * d'un véhicule) sont relevés comme un parent et ses enfants. Dans le moteur, le parent
   * est le premier sprite non découpé par la zone de dessin : un groupe doit donc être
   * gardé dès que l'un de ses sprites touche la zone, pas seulement le premier.
   */
  function childrenExtents(ps) {
    for (var c = 0; c < ps.children.length; c++) {
      var cs = ps.children[c];
      var spr = OT.data.sprites[cs[0] & OT.SPRITE_MASK];
      if (!spr) continue;
      var x = (cs[5] ? ps.left : ps.x) + cs[3] + spr.xo, y = (cs[5] ? ps.top : ps.y) + cs[4] + spr.yo;
      if (x < ps.sl) ps.sl = x;
      if (y < ps.st) ps.st = y;
      if (x + spr.w > ps.sr) ps.sr = x + spr.w;
      if (y + spr.h > ps.sb) ps.sb = y + spr.h;
    }
  }

  var tileCache = { normal: [], far: [] };
  OT.invalidateTileCache = function (tile) {
    tileCache.normal[tile] = undefined;
    tileCache.far[tile] = undefined;
  };
  OT.resetTileCache = function () { tileCache.normal = []; tileCache.far = []; };
  function tileDrawList(tile, far) {
    var d = OT.data;
    if (far && d.tilesFar[tile]) {
      return tileCache.far[tile] || (tileCache.far[tile] = OT.parseDrawList(d.tilesFar[tile]));
    }
    return tileCache.normal[tile] || (tileCache.normal[tile] = OT.parseDrawList(d.tilesNormal[tile]));
  }

  var slopeToSpriteOffset = null;
  var voidCache = new Map();
  function voidDrawList(x, y) {
    var key = x + ',' + y;
    var v = voidCache.get(key);
    if (v) return v;
    if (!slopeToSpriteOffset) slopeToSpriteOffset = OT.data.json.slope_to_sprite_offset;
    var s = tilePixelSlopeOutsideMap(x, y);
    var pt = OT.remapCoords(x * TS, y * TS, s[1]);
    v = { tiles: [[OT.data.map.void_sprite + slopeToSpriteOffset[s[0]], OT.data.allBlack, -1, pt.x, pt.y]], parents: [] };
    if (voidCache.size > 20000) voidCache.clear();
    voidCache.set(key, v);
    return v;
  }

  // --- Collecte (ViewportAddLandscape, véhicules, panneaux) -------------------
  function addDrawList(vd, dl) {
    var i;
    for (i = 0; i < dl.tiles.length; i++) vd.tiles.push(dl.tiles[i]);
    for (i = 0; i < dl.parents.length; i++) {
      var ps = dl.parents[i];
      if (ps.sl >= vd.left + vd.width || ps.sr <= vd.left || ps.st >= vd.top + vd.height || ps.sb <= vd.top) continue;
      vd.parents.push(ps);
    }
  }

  function getViewportY(tx, ty) {
    return (ty * (OT.TILE_PIXELS / 2) + tx * (OT.TILE_PIXELS / 2) - tilePixelHeightOutsideMap(tx, ty)) << OT.ZOOM_BASE_SHIFT;
  }

  function viewportAddLandscape(vd) {
    var m = map();
    var upper_left = OT.inverseRemapCoords(vd.left, vd.top);
    var upper_right = OT.inverseRemapCoords(vd.left + vd.width, vd.top);
    var left_column = Math.trunc((upper_left.y - upper_left.x) / TS) - 2;
    var right_column = Math.trunc((upper_right.y - upper_right.x) / TS) + 2;
    var potential_bridge_height = ZB * OT.TILE_HEIGHT * m.max_bridge_height;
    var far = vd.zoom > OT.Z.OUT2X;
    var row = Math.trunc((upper_left.x + upper_left.y) / TS) - 2;
    var last_row = false;
    for (; !last_row; row++) {
      last_row = true;
      for (var column = left_column; column <= right_column; column++) {
        if ((row + column) % 2 !== 0) continue;
        var tx = (row - column) / 2, ty = (row + column) / 2;
        var inside = tx >= 0 && tx < m.size_x && ty >= 0 && ty < m.size_y;
        var tile = inside ? ty * m.size_x + tx : -1;
        var isVoid = !inside || m.type[tile] === 7 /* MP_VOID */;
        var viewport_y = getViewportY(tx, ty);
        if (viewport_y + MAX_TILE_EXTENT_BOTTOM < vd.top) {
          last_row = false;
          continue;
        }
        var min_visible_height = viewport_y - (vd.top + vd.height);
        var tile_visible = min_visible_height <= 0;
        if (!isVoid) {
          if (min_visible_height < MAX_TILE_EXTENT_TOP) tile_visible = true;
          if (m.bridge[tile] >= 0 && min_visible_height < m.bridge[tile] + MAX_TILE_EXTENT_TOP) tile_visible = true;
          if (min_visible_height < potential_bridge_height + MAX_TILE_EXTENT_TOP) last_row = false;
        } else if ((tx <= 0 || ty <= 0) && min_visible_height < potential_bridge_height + MAX_TILE_EXTENT_TOP) {
          last_row = false;
        }
        if (tile_visible) {
          last_row = false;
          addDrawList(vd, inside ? tileDrawList(tile, far) : voidDrawList(tx, ty));
        }
      }
    }
  }

  /** ViewportAddString : panneau dans la zone de dessin ? */
  function viewportAddString(vd, sign, small, str, flags) {
    var w = OT.data.widget.fullbevel;
    var left = vd.left, top = vd.top, right = left + vd.width, bottom = top + vd.height;
    var sign_height = (w[1] + OT.getCharacterHeight(small ? OT.FS.SMALL : OT.FS.NORMAL) + w[3]) << vd.zoom;
    var sign_half_width = ((small ? sign.width_small : sign.width_normal) >> 1) << vd.zoom;
    if (bottom < sign.top || top > sign.top + sign_height || right < sign.center - sign_half_width || left > sign.center + sign_half_width) return;
    vd.strings.push({ x: sign.center - sign_half_width, y: sign.top, width: small ? sign.width_small : sign.width_normal, str: str, small: small, shadow: !!flags.shadow });
  }

  function viewportAddSigns(vd) {
    var small = vd.zoom >= OT.Z.OUT4X;
    if (OT.SHOW_TOWN_NAMES) {
      OT.data.towns.forEach(function (t) {
        var sign = { center: t.sign[0], top: t.sign[1], width_normal: t.sign[2], width_small: t.sign[3] };
        viewportAddString(vd, sign, small, small ? t.label_small : t.label, { shadow: small });
      });
    }
    // textes flottants (DrawTextEffects)
    if (vd.zoom > OT.Z.OUT2X) return;
    var smallTe = vd.zoom >= OT.Z.OUT2X;
    OT.textEffects.forEach(function (te) {
      if (te.mode === 1 /* TE_RISING */ || OT.data.map.loading_indicators) {
        viewportAddString(vd, te, smallTe, te.text, {});
      }
    });
  }

  // --- Tri (ViewportSortParentSprites) ----------------------------------------
  var ORDER_COMPARED = 0xFFFFFFFF, ORDER_RETURNED = 0xFFFFFFFE;
  function sortParentSprites(psdv) {
    var n = psdv.length;
    if (n < 2) return psdv;
    var order = [];
    var next_order = 0;
    var i;
    // pile : ordre inverse d'insertion
    for (i = n - 1; i >= 0; i--) {
      order.push(psdv[i]);
      psdv[i].order = next_order++;
    }
    // liste triée par xmin + ymin (à égalité : ordre d'insertion, comme le tri de paires)
    var nodes = psdv.map(function (ps, idx) { return { key: ps.xmin + ps.ymin, idx: idx, ps: ps, next: null }; });
    nodes.sort(function (a, b) { return a.key - b.key || a.idx - b.idx; });
    var head = { next: null };
    var prevNode = head;
    for (i = 0; i < nodes.length; i++) { prevNode.next = nodes[i]; prevNode = nodes[i]; }

    var out = [];
    var preceding = [];
    var preceding_prev = null;
    while (order.length) {
      var s = order.pop();
      if (s.order === ORDER_RETURNED) continue;
      if (s.order === ORDER_COMPARED) {
        out.push(s);
        s.order = ORDER_RETURNED;
        continue;
      }
      preceding.length = 0;
      var ssum = Math.max(s.xmax, s.xmin) + Math.max(s.ymax, s.ymin);
      var prev = head;
      var x = head.next;
      while (x !== null && x.key <= ssum) {
        var p = x.ps;
        if (p === s) {
          prev.next = x.next;
          x = x.next;
          continue;
        }
        var p_prev = prev;
        prev = x;
        x = x.next;
        if (s.xmax < p.xmin || s.ymax < p.ymin || s.zmax < p.zmin) continue;
        if (s.xmin <= p.xmax && s.ymin <= p.ymax && s.zmin <= p.zmax) {
          if (s.xmin + s.xmax + s.ymin + s.ymax + s.zmin + s.zmax <= p.xmin + p.xmax + p.ymin + p.ymax + p.zmin + p.zmax) continue;
        }
        preceding.push(p);
        preceding_prev = p_prev;
      }
      if (preceding.length === 0) {
        out.push(s);
        s.order = ORDER_RETURNED;
        continue;
      }
      if (preceding.length === 1) {
        var q = preceding[0];
        if (q.xmax <= s.xmax && q.ymax <= s.ymax && q.zmax <= s.zmax) {
          q.order = ORDER_RETURNED;
          s.order = ORDER_RETURNED;
          preceding_prev.next = preceding_prev.next.next;
          out.push(q);
          out.push(s);
          continue;
        }
      }
      preceding.sort(function (a, b) { return b.order - a.order; });
      s.order = ORDER_COMPARED;
      order.push(s);
      for (i = 0; i < preceding.length; i++) {
        preceding[i].order = next_order++;
        order.push(preceding[i]);
      }
    }
    return out;
  }

  function subOf(idx) { return idx < 0 ? null : OT.data.subsprites[idx]; }

  /** ViewportDoDraw : dessine une partie d'une vue (coordonnées virtuelles). */
  function viewportDoDraw(vp, left, top, right, bottom) {
    var zoom = vp.zoom;
    var mask = -1 << zoom;
    var vd = {
      zoom: zoom,
      width: (right - left) & mask,
      height: (bottom - top) & mask,
      left: left & mask,
      top: top & mask,
      tiles: [], parents: [], strings: [],
    };
    var x = ((vd.left - (vp.virtual_left & mask)) >> zoom) + vp.left;
    var y = ((vd.top - (vp.virtual_top & mask)) >> zoom) + vp.top;
    var old = OT.dpi;
    // position à l'écran du point (left, top) de la zone
    var sx = old.x0 + (x - old.left), sy = old.y0 + (y - old.top);
    OT.dpi = OT.makeDpi(vd.left, vd.top, vd.width, vd.height, zoom, sx, sy);

    viewportAddLandscape(vd);
    var veh = OT.currentVehicles();
    for (var i = 0; i < veh.length; i++) {
      var ps = veh[i];
      if (ps.sl >= vd.left + vd.width || ps.sr <= vd.left || ps.st >= vd.top + vd.height || ps.sb <= vd.top) continue;
      vd.parents.push(ps);
    }
    viewportAddSigns(vd);

    for (i = 0; i < vd.tiles.length; i++) {
      var ts = vd.tiles[i];
      OT.drawSpriteViewport(ts[0], ts[1], ts[3], ts[4], subOf(ts[2]));
    }
    var sorted = sortParentSprites(vd.parents);
    for (i = 0; i < sorted.length; i++) {
      var p = sorted[i];
      if ((p.image & OT.SPRITE_MASK) !== OT.SPR_EMPTY_BOUNDING_BOX) OT.drawSpriteViewport(p.image, p.pal, p.x, p.y, subOf(p.sub));
      for (var c = 0; c < p.children.length; c++) {
        var cs = p.children[c];
        if (cs[5]) OT.drawSpriteViewport(cs[0], cs[1], p.left + cs[3], p.top + cs[4], subOf(cs[2]));
        else OT.drawSpriteViewport(cs[0], cs[1], p.x + cs[3], p.y + cs[4], subOf(cs[2]));
      }
    }

    if (vd.strings.length) {
      // ViewportDrawStrings, au zoom Min, en coordonnées du monde dézoomées
      var dl = vd.left >> zoom, dt = vd.top >> zoom;
      OT.dpi = OT.makeDpi(dl, dt, vd.width >> zoom, vd.height >> zoom, 0, sx, sy);
      drawStrings(zoom, vd.strings);
    }
    OT.dpi = old;
  }

  function drawStrings(zoom, list) {
    var fb = OT.data.widget.fullbevel;
    list.forEach(function (ss) {
      var w = ss.width;
      var x = OT.unScaleByZoom(ss.x, zoom);
      var y = OT.unScaleByZoom(ss.y, zoom);
      var left = x + fb[0], right = x + w - 1 - fb[2], top = y + fb[1];
      var shadow = 0;
      if (ss.small && ss.shadow) {
        shadow = fb[1];
        OT.drawString(left + shadow, right + shadow, top, ss.str, OT.TC.BLACK, OT.SA.HOR_CENTER, false, OT.FS.SMALL);
      }
      OT.drawString(left, right, top - shadow, ss.str, OT.TC.WHITE, OT.SA.HOR_CENTER, false, ss.small ? OT.FS.SMALL : OT.FS.NORMAL);
    });
  }

  /** ViewportDraw : partie de la vue visible dans le rectangle (coordonnées de l'écran). */
  OT.viewportDraw = function (vp, left, top, right, bottom) {
    if (right <= vp.left || bottom <= vp.top) return;
    if (left >= vp.left + vp.width) return;
    if (left < vp.left) left = vp.left;
    if (right > vp.left + vp.width) right = vp.left + vp.width;
    if (top >= vp.top + vp.height) return;
    if (top < vp.top) top = vp.top;
    if (bottom > vp.top + vp.height) bottom = vp.top + vp.height;
    viewportDoDraw(vp,
      ((left - vp.left) << vp.zoom) + vp.virtual_left,
      ((top - vp.top) << vp.zoom) + vp.virtual_top,
      ((right - vp.left) << vp.zoom) + vp.virtual_left,
      ((bottom - vp.top) << vp.zoom) + vp.virtual_top);
  };

  // --- Vue d'une fenêtre ------------------------------------------------------
  OT.mapXYZToViewport = function (vp, x, y, z) {
    var p = OT.remapCoords(x, y, z);
    p.x -= vp.virtual_width >> 1;
    p.y -= vp.virtual_height >> 1;
    return p;
  };

  /** InitializeWindowViewport. */
  OT.initializeViewport = function (w, x, y, width, height, tile, zoom) {
    var vp = {
      left: x + w.left, top: y + w.top, width: width, height: height,
      zoom: Math.min(Math.max(zoom, OT.ZOOM_MIN), OT.ZOOM_MAX),
      virtual_left: 0, virtual_top: 0,
      offx: x, offy: y,
    };
    vp.virtual_width = width << zoom;
    vp.virtual_height = height << zoom;
    var tx = tile.x * TS, ty = tile.y * TS;
    var pt = OT.mapXYZToViewport(vp, tx, ty, OT.getSlopePixelZ(tx, ty));
    vp.scrollpos_x = vp.dest_scrollpos_x = pt.x;
    vp.scrollpos_y = vp.dest_scrollpos_y = pt.y;
    w.viewport = vp;
    return vp;
  };

  function clampViewportToMap(vp, sx, sy) {
    var pt = OT.inverseRemapCoords2(sx + (vp.virtual_width >> 1), sy + (vp.virtual_height >> 1), true);
    if (pt.clamped) {
      var z = OT.getSlopePixelZ(pt.x, pt.y);
      var r = OT.remapCoords(pt.x, pt.y, z);
      return [r.x - (vp.virtual_width >> 1), r.y - (vp.virtual_height >> 1)];
    }
    return [sx, sy];
  }

  function clampSmoothScroll(delta_ms, delta_hi, delta_lo) {
    var PIXELS_PER_TILE = OT.TILE_PIXELS * 2 * ZB;
    var delta_left = Math.trunc(delta_hi * Math.pow(0.75, delta_ms / 30.0));
    var m = map();
    var max_scroll = Math.trunc(16 * PIXELS_PER_TILE * delta_ms / 30);
    // Map::ScaleBySize1D : carte 128 × 128 (référence 256) -> moitié
    max_scroll = Math.ceil(max_scroll * (m.size_x + m.size_y) / 512);
    var hi = Math.min(Math.max(delta_hi - delta_left, -max_scroll), max_scroll);
    var lo = Math.trunc(delta_lo * hi / delta_hi);
    if (hi === 0) hi = delta_hi > 0 ? 1 : -1;
    return [hi, lo];
  }

  /** UpdateViewportPosition : défilement doux vers la destination. */
  OT.updateViewportPosition = function (w, delta_ms) {
    var vp = w.viewport;
    var c = clampViewportToMap(vp, vp.dest_scrollpos_x, vp.dest_scrollpos_y);
    vp.dest_scrollpos_x = c[0];
    vp.dest_scrollpos_y = c[1];
    var dx = vp.dest_scrollpos_x - vp.scrollpos_x;
    var dy = vp.dest_scrollpos_y - vp.scrollpos_y;
    var cx = vp.scrollpos_x, cy = vp.scrollpos_y;
    if (dx !== 0 || dy !== 0) {
      var r;
      if (Math.abs(dx) > Math.abs(dy)) {
        r = clampSmoothScroll(delta_ms, dx, dy);
        vp.scrollpos_x += r[0];
        vp.scrollpos_y += r[1];
      } else {
        r = clampSmoothScroll(delta_ms, dy, dx);
        vp.scrollpos_y += r[0];
        vp.scrollpos_x += r[1];
      }
    }
    c = clampViewportToMap(vp, vp.scrollpos_x, vp.scrollpos_y);
    vp.scrollpos_x = c[0];
    vp.scrollpos_y = c[1];
    if ((dx !== 0 || dy !== 0) && cx === vp.scrollpos_x && cy === vp.scrollpos_y) {
      vp.scrollpos_x = vp.dest_scrollpos_x;
      vp.scrollpos_y = vp.dest_scrollpos_y;
    }
    setViewportPosition(w, vp.scrollpos_x, vp.scrollpos_y);
  };

  var vpMoveOffs = { x: 0, y: 0 };
  function setViewportPosition(w, x, y) {
    var vp = w.viewport;
    var old_left = vp.virtual_left, old_top = vp.virtual_top;
    vp.virtual_left = x;
    vp.virtual_top = y;
    old_left = old_left >> vp.zoom;
    old_top = old_top >> vp.zoom;
    x = x >> vp.zoom;
    y = y >> vp.zoom;
    old_left -= x;
    old_top -= y;
    if (old_top === 0 && old_left === 0) return;
    vpMoveOffs.x = old_left;
    vpMoveOffs.y = old_top;
    var left = vp.left, top = vp.top, width = vp.width, height = vp.height;
    var sw = OT.screen.width, sh = OT.screen.height, i;
    if (left < 0) { width += left; left = 0; }
    i = left + width - sw;
    if (i >= 0) width -= i;
    if (width > 0) {
      if (top < 0) { height += top; top = 0; }
      i = top + height - sh;
      if (i >= 0) height -= i;
      if (height > 0) {
        var idx = OT.windows.indexOf(w);
        doSetViewportPosition(idx + 1, left, top, width, height);
      }
    }
  }

  function doSetViewportPosition(from, left, top, width, height) {
    var ws = OT.windows;
    for (var k = from; k < ws.length; k++) {
      var w = ws[k];
      if (left + width > w.left && w.left + w.width > left && top + height > w.top && w.top + w.height > top) {
        if (left < w.left) {
          doSetViewportPosition(k, left, top, w.left - left, height);
          doSetViewportPosition(k, left + (w.left - left), top, width - (w.left - left), height);
          return;
        }
        if (left + width > w.left + w.width) {
          doSetViewportPosition(k, left, top, (w.left + w.width - left), height);
          doSetViewportPosition(k, left + (w.left + w.width - left), top, width - (w.left + w.width - left), height);
          return;
        }
        if (top < w.top) {
          doSetViewportPosition(k, left, top, width, (w.top - top));
          doSetViewportPosition(k, left, top + (w.top - top), width, height - (w.top - top));
          return;
        }
        if (top + height > w.top + w.height) {
          doSetViewportPosition(k, left, top, width, (w.top + w.height - top));
          doSetViewportPosition(k, left, top + (w.top + w.height - top), width, height - (w.top + w.height - top));
          return;
        }
        return;
      }
    }
    var xo = vpMoveOffs.x, yo = vpMoveOffs.y;
    if (Math.abs(xo) >= width || Math.abs(yo) >= height) {
      OT.redrawScreenRect(left, top, left + width, top + height);
      return;
    }
    OT.undrawMouseCursorIfOver(left, top, left + width, top + height);
    OT.gfxScroll(left, top, width, height, xo, yo);
    OT.markScreenChanged(left, top, width, height);
    if (xo > 0) {
      OT.redrawScreenRect(left, top, xo + left, top + height);
      left += xo;
      width -= xo;
    } else if (xo < 0) {
      OT.redrawScreenRect(left + width + xo, top, left + width, top + height);
      width += xo;
    }
    if (yo > 0) OT.redrawScreenRect(left, top, width + left, top + yo);
    else if (yo < 0) OT.redrawScreenRect(left, top + height + yo, width + left, top + height);
  }

  /** ScrollWindowTo. */
  OT.scrollWindowTo = function (x, y, z, w, instant) {
    var m = map();
    if (z === -1) {
      if (x >= 0 && x <= m.size_x * TS - 1 && y >= 0 && y <= m.size_y * TS - 1) z = OT.getSlopePixelZ(x, y);
      else z = OT.tileHeightOutsideMap(Math.trunc(x / TS), Math.trunc(y / TS));
    }
    var pt = OT.mapXYZToViewport(w.viewport, x, y, z);
    if (w.viewport.dest_scrollpos_x === pt.x && w.viewport.dest_scrollpos_y === pt.y) return false;
    if (instant) {
      w.viewport.scrollpos_x = pt.x;
      w.viewport.scrollpos_y = pt.y;
    }
    w.viewport.dest_scrollpos_x = pt.x;
    w.viewport.dest_scrollpos_y = pt.y;
    return true;
  };
  OT.scrollWindowToTile = function (tile, w, instant) {
    return OT.scrollWindowTo(tile.x * TS, tile.y * TS, -1, w, instant);
  };
  OT.scrollMainWindowToTile = function (tile, instant) {
    return OT.scrollWindowTo(tile.x * TS + TS / 2, tile.y * TS + TS / 2, -1, OT.mainWindow, instant);
  };

  /** TranslateXYToTileCoord (avec rabattement sur la carte). */
  OT.translateXYToTileCoord = function (vp, x, y) {
    if (x < vp.left || x >= vp.left + vp.width || y < vp.top || y >= vp.top + vp.height) return { x: -1, y: -1 };
    return OT.inverseRemapCoords2(((x - vp.left) << vp.zoom) + vp.virtual_left, ((y - vp.top) << vp.zoom) + vp.virtual_top, true);
  };

  /** DoZoomInOutWindow. */
  OT.doZoomInOutWindow = function (zin, w) {
    var vp = w.viewport;
    if (zin) {
      if (vp.zoom <= OT.ZOOM_MIN) return false;
      vp.zoom--;
      vp.virtual_width >>= 1;
      vp.virtual_height >>= 1;
      vp.scrollpos_x += vp.virtual_width >> 1;
      vp.scrollpos_y += vp.virtual_height >> 1;
    } else {
      if (vp.zoom >= OT.ZOOM_MAX) return false;
      vp.zoom++;
      vp.scrollpos_x -= vp.virtual_width >> 1;
      vp.scrollpos_y -= vp.virtual_height >> 1;
      vp.virtual_width <<= 1;
      vp.virtual_height <<= 1;
    }
    vp.dest_scrollpos_x = vp.scrollpos_x;
    vp.dest_scrollpos_y = vp.scrollpos_y;
    vp.virtual_left = vp.scrollpos_x;
    vp.virtual_top = vp.scrollpos_y;
    OT.setWindowDirty(w);
    return true;
  };

  /** ZoomInOrOutToCursorWindow. */
  OT.zoomInOrOutToCursorWindow = function (zin, w) {
    var vp = w.viewport;
    if ((zin && vp.zoom <= OT.ZOOM_MIN) || (!zin && vp.zoom >= OT.ZOOM_MAX)) return;
    var cx = OT.cursor.x, cy = OT.cursor.y, x, y;
    if (zin) {
      x = ((cx - vp.left) >> 1) + (vp.width >> 2);
      y = ((cy - vp.top) >> 1) + (vp.height >> 2);
    } else {
      x = vp.width - (cx - vp.left);
      y = vp.height - (cy - vp.top);
    }
    var pt = OT.translateXYToTileCoord(vp, x + vp.left, y + vp.top);
    if (pt.x === -1) return;
    OT.scrollWindowTo(pt.x, pt.y, -1, w, true);
    OT.doZoomInOutWindow(zin, w);
  };

  // --- Zones à redessiner ------------------------------------------------------
  function markViewportDirty(vp, left, top, right, bottom) {
    right += (1 << vp.zoom) - 1;
    bottom += (1 << vp.zoom) - 1;
    right -= vp.virtual_left;
    if (right <= 0) return;
    bottom -= vp.virtual_top;
    if (bottom <= 0) return;
    left = Math.max(0, left - vp.virtual_left);
    if (left >= vp.virtual_width) return;
    top = Math.max(0, top - vp.virtual_top);
    if (top >= vp.virtual_height) return;
    OT.addDirtyBlock((left >> vp.zoom) + vp.left, (top >> vp.zoom) + vp.top,
      OT.unScaleByZoom(right, vp.zoom) + vp.left + 1, OT.unScaleByZoom(bottom, vp.zoom) + vp.top + 1);
  }
  OT.markAllViewportsDirty = function (left, top, right, bottom, maxzoom) {
    OT.windows.forEach(function (w) {
      if (!w.viewport || w.shaded) return;
      if (maxzoom !== undefined && w.viewport.zoom > maxzoom) return;
      markViewportDirty(w.viewport, left, top, right, bottom);
    });
  };
  OT.markTileDirty = function (tile) {
    var m = map();
    var x = tile % m.size_x, y = Math.floor(tile / m.size_x);
    var pt = OT.remapCoords(x * TS, y * TS, m.height[tile] * OT.TILE_HEIGHT);
    OT.markAllViewportsDirty(pt.x - MAX_TILE_EXTENT_LEFT, pt.y - MAX_TILE_EXTENT_TOP, pt.x + MAX_TILE_EXTENT_RIGHT, pt.y + MAX_TILE_EXTENT_BOTTOM);
  };
  /** ViewportSign::MarkDirty. */
  OT.markSignDirty = function (sign, maxzoom) {
    var fb = OT.data.widget.fullbevel;
    var half = (Math.max(sign.width_normal, sign.width_small) >> 1) + 1;
    var height = fb[1] + Math.max(OT.getCharacterHeight(0), OT.getCharacterHeight(1)) + fb[3] + 1;
    OT.windows.forEach(function (w) {
      if (!w.viewport || w.shaded) return;
      var vp = w.viewport;
      if (maxzoom !== undefined && vp.zoom > maxzoom) return;
      markViewportDirty(vp, sign.center - (half << vp.zoom), sign.top - (1 << vp.zoom), sign.center + (half << vp.zoom), sign.top + (height << vp.zoom));
    });
  };

  /** Clic dans une vue : panneau de ville, puis maison (HandleViewportClicked). */
  OT.handleViewportClicked = function (vp, x, y) {
    // panneaux des villes
    var px = ((x - vp.left) << vp.zoom) + vp.virtual_left;
    var py = ((y - vp.top) << vp.zoom) + vp.virtual_top;
    var small = vp.zoom >= OT.Z.OUT4X;
    var fb = OT.data.widget.fullbevel;
    var hit = null;
    if (OT.SHOW_TOWN_NAMES) {
      OT.data.towns.forEach(function (t) {
        var sign = { center: t.sign[0], top: t.sign[1], width_normal: t.sign[2], width_small: t.sign[3] };
        var sign_height = (fb[1] + OT.getCharacterHeight(small ? 1 : 0) + fb[3]) << vp.zoom;
        var sign_half_width = ((small ? sign.width_small : sign.width_normal) >> 1) << vp.zoom;
        if (py >= sign.top && py < sign.top + sign_height && px >= sign.center - sign_half_width && px < sign.center + sign_half_width) hit = t;
      });
    }
    if (hit) {
      OT.showPortfolioProject(hit.id);
      return true;
    }
    // CheckClickOnLandscape
    var pt = OT.translateXYToTileCoord(vp, x, y);
    if (pt.x === -1) return false;
    var m = map();
    var tx = pt.x >> 4, ty = pt.y >> 4;
    if (tx < 0 || ty < 0 || tx >= m.size_x || ty >= m.size_y) return false;
    var tile = ty * m.size_x + tx;
    if (m.type[tile] === 3 /* MP_HOUSE */ && m.town[tile] >= 0) {
      OT.showPortfolioProject(m.town[tile]);
      return true;
    }
    return false;
  };

  // --- Textes flottants (texteff.cpp) ----------------------------------------
  OT.textEffects = [];
})();
