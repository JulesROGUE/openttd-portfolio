/*
 * OpenTTD Portfolio — moteur JavaScript.
 * gui.js : fenêtres et widgets. Port de window.cpp (pile des fenêtres, dessin par zones,
 * déplacement, aimantation, placement automatique, infobulles) et de widget.cpp (dessin
 * des widgets), ainsi que des fenêtres du portfolio (engine/src/portfolio_gui.cpp) et de
 * la barre d'état (statusbar_gui.cpp) d'OpenTTD 15.3 (GPL v2). La mise en page de chaque
 * fenêtre est celle relevée dans le moteur natif (world.json, « windows »).
 */
'use strict';
var OT = window.OT || (window.OT = {});

(function () {
  var TC = OT.TC, SA = OT.SA;
  OT.windows = [];
  OT.mainWindow = null;
  OT.cursor = { x: 0, y: 0, inWindow: false, dx: 0, dy: 0 };

  function wd() { return OT.data.widget; }

  // --- Zones à redessiner (DrawDirtyBlocks) ----------------------------------
  var DBW = 64, DBH = 8;
  var dirty = null, dirtyCols = 0, dirtyRows = 0;
  var invalid = { left: 0, top: 0, right: 0, bottom: 0 };
  var changed = null; // zone de l'écran modifiée depuis la dernière copie dans le canvas
  OT.resetDirty = function () {
    dirtyCols = Math.ceil(OT.screen.width / DBW);
    dirtyRows = Math.ceil(OT.screen.height / DBH);
    dirty = new Uint8Array(dirtyCols * dirtyRows);
    invalid = { left: OT.screen.width, top: OT.screen.height, right: 0, bottom: 0 };
  };
  OT.addDirtyBlock = function (left, top, right, bottom) {
    var sw = OT.screen.width, sh = OT.screen.height;
    if (left < 0) left = 0;
    if (top < 0) top = 0;
    if (right > sw) right = sw;
    if (bottom > sh) bottom = sh;
    if (left >= right || top >= bottom) return;
    invalid.left = Math.min(invalid.left, left);
    invalid.top = Math.min(invalid.top, top);
    invalid.right = Math.max(invalid.right, right);
    invalid.bottom = Math.max(invalid.bottom, bottom);
    var l = Math.floor(left / DBW), t = Math.floor(top / DBH);
    var r = Math.ceil(right / DBW), h = Math.ceil(bottom / DBH) - t;
    for (; l < r; l++) dirty.fill(1, dirtyRows * l + t, dirtyRows * l + t + h);
  };
  OT.markWholeScreenDirty = function () { OT.addDirtyBlock(0, 0, OT.screen.width, OT.screen.height); };
  OT.markScreenChanged = function (left, top, width, height) {
    var r = [left, top, left + width, top + height];
    if (!changed) changed = r;
    else changed = [Math.min(changed[0], r[0]), Math.min(changed[1], r[1]), Math.max(changed[2], r[2]), Math.max(changed[3], r[3])];
  };
  OT.takeChanged = function () { var c = changed; changed = null; return c; };

  OT.drawDirtyBlocks = function () {
    var b = 0;
    for (var x = 0; x < dirtyCols; x++) {
      var lastOfColumn = (x + 1) * dirtyRows;
      for (var y = 0; y < dirtyRows; y++, b++) {
        if (!dirty[b]) continue;
        var e = b + 1;
        while (e < lastOfColumn && dirty[e]) e++;
        var height = e - b, width = 1;
        dirty.fill(0, b, b + height);
        var br = b;
        for (var xr = x + 1; xr < dirtyCols; xr++, width++) {
          br += dirtyRows;
          var ok = true;
          for (var k = 0; k < height; k++) if (!dirty[br + k]) { ok = false; break; }
          if (!ok) break;
          dirty.fill(0, br, br + height);
        }
        var left = Math.max(invalid.left, x * DBW), top = Math.max(invalid.top, y * DBH);
        var right = Math.min(invalid.right, (x + width) * DBW), bottom = Math.min(invalid.bottom, (y + height) * DBH);
        if (left < right && top < bottom) OT.redrawScreenRect(left, top, right, bottom);
      }
    }
    invalid = { left: OT.screen.width, top: OT.screen.height, right: 0, bottom: 0 };
  };

  OT.redrawScreenRect = function (left, top, right, bottom) {
    OT.undrawMouseCursorIfOver(left, top, right, bottom);
    drawOverlappedWindowForAll(left, top, right, bottom);
    OT.markScreenChanged(left, top, right - left, bottom - top);
  };

  function drawOverlappedWindow(w, idx, left, top, right, bottom) {
    var ws = OT.windows;
    for (var k = idx + 1; k < ws.length; k++) {
      var v = ws[k];
      if (right > v.left && bottom > v.top && left < v.left + v.width && top < v.top + v.height) {
        var x;
        if (left < (x = v.left)) {
          drawOverlappedWindow(w, idx, left, top, x, bottom);
          drawOverlappedWindow(w, idx, x, top, right, bottom);
          return;
        }
        if (right > (x = v.left + v.width)) {
          drawOverlappedWindow(w, idx, left, top, x, bottom);
          drawOverlappedWindow(w, idx, x, top, right, bottom);
          return;
        }
        if (top < (x = v.top)) {
          drawOverlappedWindow(w, idx, left, top, right, x);
          drawOverlappedWindow(w, idx, left, x, right, bottom);
          return;
        }
        if (bottom > (x = v.top + v.height)) {
          drawOverlappedWindow(w, idx, left, top, right, x);
          drawOverlappedWindow(w, idx, left, x, right, bottom);
          return;
        }
        return;
      }
    }
    OT.dpi = OT.makeDpi(left - w.left, top - w.top, right - left, bottom - top, 0, left, top);
    w.onPaint();
  }

  function drawOverlappedWindowForAll(left, top, right, bottom) {
    var ws = OT.windows;
    for (var i = 0; i < ws.length; i++) {
      var w = ws[i];
      if (right > w.left && bottom > w.top && left < w.left + w.width && top < w.top + w.height) {
        drawOverlappedWindow(w, i, Math.max(left, w.left), Math.max(top, w.top), Math.min(right, w.left + w.width), Math.min(bottom, w.top + w.height));
      }
    }
  }

  // --- Pile des fenêtres ------------------------------------------------------
  function zPriority(cls) {
    switch (cls) {
      case 'main': return 0;
      case 'tooltip': return 12;
      case 'statusbar': return 7;
      default: return 1;
    }
  }
  OT.setWindowDirty = function (w) { OT.addDirtyBlock(w.left, w.top, w.left + w.width, w.top + w.height); };
  function bringWindowToFront(w, dirty) {
    var ws = OT.windows;
    var i = ws.indexOf(w);
    if (i < 0) return;
    ws.splice(i, 1);
    var p = zPriority(w.cls), dest = 0;
    while (dest < ws.length && zPriority(ws[dest].cls) <= p) dest++;
    ws.splice(dest, 0, w);
    if (dirty !== false) OT.setWindowDirty(w);
  }
  OT.bringWindowToFront = bringWindowToFront;
  function findWindowById(cls, number) {
    for (var w of OT.windows) if (w.cls === cls && (number === undefined || w.number === number)) return w;
    return null;
  }
  OT.findWindowById = findWindowById;
  /** BringWindowToFrontById : liseré blanc et premier plan. */
  function bringWindowToFrontById(cls, number) {
    var w = findWindowById(cls, number);
    if (!w) return null;
    if (cls !== 'tooltip') setWhiteBorder(w);
    bringWindowToFront(w);
    return w;
  }
  function setWhiteBorder(w) { w.whiteBorder = 3; }
  OT.findWindowFromPt = function (x, y) {
    for (var i = OT.windows.length - 1; i >= 0; i--) {
      var w = OT.windows[i];
      if (x >= w.left && x < w.left + w.width && y >= w.top && y < w.top + w.height) return w;
    }
    return null;
  };
  function addWindow(w) {
    OT.windows.push(w);
    bringWindowToFront(w, false);
    if (w.cls !== 'tooltip' && w.cls !== 'statusbar' && w.cls !== 'main') setWhiteBorder(w);
    OT.setWindowDirty(w);
  }
  OT.closeWindow = function (w) {
    var i = OT.windows.indexOf(w);
    if (i < 0) return;
    OT.windows.splice(i, 1);
    if (w === mouseoverLast) mouseoverLast = null;
    if (w === lastScrollWindow) lastScrollWindow = null;
    if (draggingWindow === w) draggingWindow = null;
    OT.setWindowDirty(w);
    if (w.onClose) w.onClose();
  };

  // --- Widgets ----------------------------------------------------------------
  /** Copie de la mise en page relevée (rectangle, type...) avec l'état des boutons. */
  function makeWidgets(layout) {
    return layout.widgets.map(function (x) {
      return { type: x.type, colour: x.colour, index: x.index, r: { left: x.rect[0], top: x.rect[1], right: x.rect[2], bottom: x.rect[3] },
        tooltip: x.tooltip, push: x.push, disabled: x.disabled, lowered: false };
    });
  }
  function widgetFromPos(w, x, y) {
    var found = null;
    for (var nw of w.widgets) {
      if (w.shaded && nw.r.top >= w.captionHeight) continue;
      if (x >= nw.r.left && x <= nw.r.right && y >= nw.r.top && y <= nw.r.bottom) found = nw; // le plus profond (dernier dans l'ordre)
    }
    return found;
  }
  function getWidget(w, index) {
    for (var nw of w.widgets) if (nw.index === index) return nw;
    return null;
  }

  /** FillDrawPixelInfo : zone de dessin découpée au rectangle d'un widget. */
  function clipDpi(left, top, width, height) {
    var o = OT.dpi, n = { zoom: 0 };
    if ((left -= o.left) < 0) {
      width += left;
      if (width <= 0) return null;
      n.left = -left;
      left = 0;
    } else {
      n.left = 0;
    }
    if (width > o.width - left) {
      width = o.width - left;
      if (width <= 0) return null;
    }
    n.width = width;
    if ((top -= o.top) < 0) {
      height += top;
      if (height <= 0) return null;
      n.top = -top;
      top = 0;
    } else {
      n.top = 0;
    }
    if (height > o.height - top) {
      height = o.height - top;
      if (height <= 0) return null;
    }
    n.height = height;
    n.x0 = o.x0 + left;
    n.y0 = o.y0 + top;
    return n;
  }

  function drawSpriteIgnorePadding(img, pal, r, align) {
    var s = OT.getSpriteSize(img);
    var d = { width: s.width - s.x, height: s.height - s.y };
    var p = alignedPosition(r, d, align);
    OT.drawSprite(img, pal, p.x - s.x, p.y - s.y);
  }
  function alignedPosition(r, d, align) {
    var p = {};
    switch (align & SA.HOR_MASK) {
      case SA.LEFT: p.x = r.left; break;
      case SA.HOR_CENTER: p.x = OT.centreBounds(r.left, r.right, d.width); break;
      case SA.RIGHT: p.x = r.right + 1 - d.width; break;
    }
    switch (align & SA.VERT_MASK) {
      case SA.TOP: p.y = r.top; break;
      case SA.VERT_CENTER: p.y = OT.centreBounds(r.top, r.bottom, d.height); break;
      case SA.BOTTOM: p.y = r.bottom + 1 - d.height; break;
    }
    return p;
  }
  /** Rect::Shrink(horizontal, vertical). */
  function shrinkHV(r, h, v) { return { left: r.left + h[0], top: r.top + v[1], right: r.right - h[2], bottom: r.bottom - v[3] }; }
  function shrink(r, p) { return { left: r.left + p[0], top: r.top + p[1], right: r.right - p[2], bottom: r.bottom - p[3] }; }
  OT.shrinkRect = shrink;

  function drawLabel(r, colour, str, align, fs) {
    if (!str) return;
    var d = OT.getStringBoundingBox(str, fs);
    var p = alignedPosition(r, d, align);
    OT.drawString(r.left, r.right, p.y, str, colour, align, false, fs);
  }

  function drawCloseBox(r, colour) {
    if (colour !== OT.COLOUR.WHITE) OT.drawFrameRect(r.left, r.top, r.right, r.bottom, colour, {});
    var g = OT.data.guiSprites;
    var s = OT.getSpriteSize(g.closebox);
    var dw = s.width - s.x, dh = s.height - s.y;
    var sh = OT.scaleSpriteTrad(1);
    var pal = (colour !== OT.COLOUR.WHITE ? TC.BLACK : TC.SILVER) | (1 << OT.PALETTE_TEXT_RECOLOUR);
    OT.drawSprite(g.closebox, pal, OT.centreBounds(r.left, r.right, dw - sh) - s.x, OT.centreBounds(r.top, r.bottom, dh - sh) - s.y);
  }

  function drawCaption(r, colour, str) {
    OT.drawFrameRect(r.left, r.top, r.right, r.bottom, colour, { borderOnly: true });
    var ir = shrink(r, wd().bevel);
    OT.drawFrameRect(ir.left, ir.top, ir.right, ir.bottom, colour, { lowered: true, darkened: true });
    if (!str) return;
    var d = OT.getStringBoundingBox(str);
    var p = alignedPosition(r, d, SA.CENTER);
    OT.drawString(r.left + wd().captiontext[0], r.right - wd().captiontext[0], p.y, str, TC.WHITE, SA.CENTER, false, 0);
  }

  function drawImageButton(r, colour, clicked, img) {
    OT.drawFrameRect(r.left, r.top, r.right, r.bottom, colour, clicked ? { lowered: true } : {});
    drawSpriteIgnorePadding(img, 0, r, SA.CENTER);
  }

  /** Window::DrawWidgets : chaque widget dans l'ordre de l'arbre. */
  function drawWidgets(w) {
    var g = OT.data.guiSprites;
    var base = OT.dpi;
    for (var nw of w.widgets) {
      if (w.shaded && nw.r.top >= w.captionHeight) continue;
      var r = nw.r;
      if (base.left > r.right || base.left + base.width <= r.left || base.top > r.bottom || base.top + base.height <= r.top) continue;
      var leaf = nw.type !== 'panel' && nw.type !== 'inset' && nw.type !== 'viewport' || (nw.type === 'panel' && nw.push);
      if (leaf) {
        var extra = nw.type === 'empty' ? 1 : 0;
        var n = clipDpi(r.left, r.top, r.right - r.left + 1 + extra, r.bottom - r.top + 1 + extra);
        if (!n) continue;
        n.left += r.left;
        n.top += r.top;
        OT.dpi = n;
      }
      switch (nw.type) {
        case 'closebox': drawCloseBox(r, nw.colour); break;
        case 'caption': drawCaption(r, nw.colour, w.caption()); break;
        case 'stickybox': drawImageButton(r, nw.colour, !!w.sticky, w.sticky ? g.pin_up : g.pin_down); break;
        case 'shadebox': drawImageButton(r, nw.colour, !!w.shaded, w.shaded ? g.shade : g.unshade); break;
        case 'panel': OT.drawFrameRect(r.left, r.top, r.right, r.bottom, nw.colour, nw.lowered ? { lowered: true } : {}); break;
        case 'inset': OT.drawFrameRect(r.left, r.top, r.right, r.bottom, nw.colour, { lowered: true, darkened: true }); break;
        case 'textbtn':
          OT.drawFrameRect(r.left, r.top, r.right, r.bottom, nw.colour, nw.lowered ? { lowered: true } : {});
          drawLabel(r, TC.BLACK, w.widgetString(nw.index), SA.CENTER, 0);
          break;
        case 'viewport': drawViewport(w); break;
      }
      if (nw.index >= 0 && nw.type !== 'viewport' && w.drawWidget) w.drawWidget(r, nw.index);
      if (nw.disabled) {
        var s = shrink(r, wd().bevel);
        OT.gfxFillRect(s.left, s.top, s.right, s.bottom, OT.gradient(nw.colour, OT.SHADE.DARKER), OT.FILLRECT.CHECKER);
      }
      OT.dpi = base;
    }
    if (w.whiteBorder > 0) OT.drawFrameRect(0, 0, w.width - 1, w.height - 1, OT.COLOUR.WHITE, { borderOnly: true });
  }

  function drawViewport(w) {
    var dpi = OT.dpi;
    var saved = OT.dpi;
    OT.dpi = OT.makeDpi(dpi.left + w.left, dpi.top + w.top, dpi.width, dpi.height, 0, dpi.x0, dpi.y0);
    OT.viewportDraw(w.viewport, OT.dpi.left, OT.dpi.top, OT.dpi.left + OT.dpi.width, OT.dpi.top + OT.dpi.height);
    OT.dpi = saved;
  }

  function Win(cls, number, layout) {
    this.cls = cls;
    this.number = number;
    this.left = 0;
    this.top = 0;
    this.width = layout ? layout.width : 0;
    this.height = layout ? layout.height : 0;
    this.widgets = layout ? makeWidgets(layout) : [];
    this.sticky = false;
    this.shaded = false;
    this.whiteBorder = 0;
    this.timeout = 0;
    this.viewport = null;
    var cap = this.widgets.find(function (x) { return x.type === 'caption'; });
    this.captionHeight = cap ? cap.r.bottom + 1 : 0;
    this.fullHeight = this.height;
  }
  Win.prototype.onPaint = function () { drawWidgets(this); };
  Win.prototype.caption = function () { return ''; };
  Win.prototype.widgetString = function () { return ''; };
  OT.Win = Win;

  /** EnsureVisibleCaption : la barre de titre reste visible (et pas sous la barre d'état). */
  function ensureVisibleCaption(w, nx, ny) {
    var cap = w.widgets.find(function (x) { return x.type === 'caption'; });
    if (cap) {
      var cr = cap.r;
      var minVisible = cr.bottom - cr.top + 1;
      nx = Math.min(Math.max(nx, minVisible - cr.right), OT.screen.width - minVisible - cr.left);
      ny = Math.min(Math.max(ny, 0), OT.screen.height - minVisible);
      preventHiding(w, cr, findWindowById('statusbar'), w.left, true, function (x, y) { nx = x; ny = y; }, nx, ny);
    }
    moveWindow(w, nx, ny);
  }
  function preventHiding(w, rect, v, px, up, set, nx, ny) {
    if (!v) return;
    var minVisible = rect.bottom - rect.top + 1;
    var v_bottom = v.top + v.height - 1, v_right = v.left + v.width - 1;
    var safe_y = up ? (v.top - minVisible - rect.top) : (v_bottom + minVisible - rect.bottom);
    if (ny + rect.top <= v.top - minVisible) return;
    if (ny + rect.bottom >= v_bottom + minVisible) return;
    if (nx + rect.left + minVisible < v.left) {
      if (v.left < minVisible) set(nx, safe_y);
      return;
    }
    if (nx + rect.right - minVisible > v_right) {
      if (v_right > OT.screen.width - minVisible) set(nx, safe_y);
      return;
    }
    if (px + rect.left < v.left && v.left >= minVisible) set(v.left - minVisible - rect.left, ny);
    else if (px + rect.right > v_right && v_right <= OT.screen.width - minVisible) set(v_right + minVisible - rect.right, ny);
    else set(nx, safe_y);
  }
  function moveWindow(w, nx, ny) {
    if (w.viewport) {
      w.viewport.left += nx - w.left;
      w.viewport.top += ny - w.top;
    }
    w.left = nx;
    w.top = ny;
  }

  /** Placement : position initiale puis FindWindowPlacementAndResize. */
  function placeWindow(w, pt) {
    w.left = pt.x;
    w.top = pt.y;
    var nx = w.left, ny = w.top;
    if (nx + w.width > OT.screen.width) nx -= (nx + w.width - OT.screen.width);
    ny = Math.max(ny, 0);
    nx = Math.max(nx, 0);
    w.left = nx;
    w.top = ny;
  }

  function isGoodAutoPlace1(left, top, width, height) {
    var right = width + left, bottom = height + top;
    if (left < 0 || top < 0 || right > OT.screen.width || bottom > OT.screen.height) return null;
    for (var w of OT.windows) {
      if (w.cls === 'main') continue;
      if (right > w.left && w.left + w.width > left && bottom > w.top && w.top + w.height > top) return null;
    }
    return { x: left, y: top };
  }
  function isGoodAutoPlace2(left, top, width, height) {
    if (left < -(width >> 2) || left > OT.screen.width - (width >> 1)) return null;
    if (top < 0 || top > OT.screen.height - (height >> 2)) return null;
    for (var w of OT.windows) {
      if (w.cls === 'main') continue;
      if (left + width > w.left && w.left + w.width > left && top + height > w.top && w.top + w.height > top) return null;
    }
    return { x: left, y: top };
  }
  /** GetAutoPlacePosition (WDP_AUTO). */
  function autoPlace(width, height) {
    var pt = isGoodAutoPlace1(0, 0, width, height);
    if (pt) return pt;
    var w;
    for (w of OT.windows) {
      if (w.cls === 'main') continue;
      var tries = [
        [w.left + w.width, w.top], [w.left - width, w.top], [w.left, w.top + w.height], [w.left, w.top - height],
        [w.left + w.width, w.top + w.height - height], [w.left - width, w.top + w.height - height],
        [w.left + w.width - width, w.top + w.height], [w.left + w.width - width, w.top - height],
      ];
      for (var t of tries) if ((pt = isGoodAutoPlace1(t[0], t[1], width, height))) return pt;
    }
    for (w of OT.windows) {
      if (w.cls === 'main') continue;
      var tries2 = [[w.left + w.width, w.top], [w.left - width, w.top], [w.left, w.top + w.height], [w.left, w.top - height]];
      for (var t2 of tries2) if ((pt = isGoodAutoPlace2(t2[0], t2[1], width, height))) return pt;
    }
    var left = 0, top = 0;
    var cb = closeboxDimension();
    var offx = cb.width, offy = Math.max(cb.height, OT.getCharacterHeight(0) + wd().captiontext[1] + wd().captiontext[3]);
    var again = true;
    while (again) {
      again = false;
      for (w of OT.windows) {
        if (w.left === left && w.top === top) { left += offx; top += offy; again = true; break; }
      }
    }
    return { x: left, y: top };
  }
  function closeboxDimension() {
    var s = OT.getSpriteSize(OT.data.guiSprites.closebox);
    var p = wd().closebox;
    return { width: s.width + p[0] + p[2], height: s.height + p[1] + p[3] };
  }

  // --- Paragraphes des fenêtres du portfolio (DrawParagraphs) --------------------
  function drawParagraphs(r, paragraphs, draw, links, hover) {
    var y = r.top;
    var half = OT.getCharacterHeight(0) >> 1;
    for (var p of paragraphs) {
      y += p.gap * half;
      var h = OT.getStringHeight(p.text, r.right - r.left + 1);
      if (!p.url) {
        if (draw) OT.drawStringMultiLine(r.left, r.right, y, y + h, p.text, p.colour, SA.TOP | SA.LEFT);
      } else {
        var hovered = hover && hover === p.url;
        if (draw) OT.drawStringMultiLine(r.left, r.right, y, y + h, p.text, hovered ? TC.WHITE : TC.LIGHT_BLUE, SA.TOP | SA.LEFT, true);
        if (links) {
          var w = Math.min(r.right - r.left + 1, OT.getStringBoundingBox(p.text).width);
          links.push({ left: r.left, top: y, right: r.left + w - 1, bottom: y + h - 1, url: p.url });
        }
      }
      y += h;
    }
    return y - r.top;
  }

  function projectParagraphs(p) {
    var out = [];
    if (!p) return [{ colour: TC.BLACK, text: 'Cette ville ne correspond à aucun projet.', gap: 0 }];
    out.push({ colour: TC.WHITE, text: p.subtitle, gap: 0 });
    out.push({ colour: TC.GOLD, text: p.type, gap: 0 });
    out.push({ colour: TC.BLACK, text: p.summary, gap: 1 });
    if (p.highlights.length) {
      out.push({ colour: TC.ORANGE, text: 'Points forts', gap: 1 });
      p.highlights.forEach(function (h) { out.push({ colour: TC.BLACK, text: '- ' + h, gap: 0 }); });
    }
    out.push({ colour: TC.ORANGE, text: 'Technologies', gap: 1 });
    out.push({ colour: TC.BLACK, text: p.stack, gap: 0 });
    out.push({ colour: TC.ORANGE, text: 'Équipe', gap: 1 });
    out.push({ colour: TC.BLACK, text: p.team, gap: 0 });
    if (p.links.length) {
      out.push({ colour: TC.ORANGE, text: p.links.length > 1 ? 'Liens' : 'Lien', gap: 1 });
      p.links.forEach(function (l) { out.push({ colour: TC.LIGHT_BLUE, text: l.label + ' : ' + l.url, gap: 0, url: l.url }); });
    }
    if (p.note) out.push({ colour: TC.GREY, text: p.note, gap: 1 });
    return out;
  }

  function projectOfTown(townId) {
    var pf = OT.data.portfolio;
    for (var i = 0; i < pf.projects.length; i++) if (pf.projects[i].town === townId) return i;
    return -1;
  }
  function townById(id) {
    for (var t of OT.data.towns) if (t.id === id) return t;
    return null;
  }

  function openBrowser(url) {
    if (!/^https?:\/\//.test(url)) return;
    // comme openttd_open_url : on attend que le bouton de la souris soit relâché
    if (OT.leftButtonDown) {
      var f = function () { document.removeEventListener('mouseup', f, true); window.open(url, '_blank', 'noopener'); };
      document.addEventListener('mouseup', f, true);
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }

  // --- Fenêtre principale ------------------------------------------------------
  OT.createMainWindow = function () {
    var w = new Win('main', 0, null);
    w.width = OT.screen.width;
    w.height = OT.screen.height;
    w.widgets = [{ type: 'viewport', colour: 0, index: 0, r: { left: 0, top: 0, right: w.width - 1, bottom: w.height - 1 }, tooltip: '' }];
    OT.windows.push(w);
    OT.mainWindow = w;
    var pf = OT.data.portfolio;
    var center = townById(pf.projects[pf.center_project].town);
    OT.initializeViewport(w, 0, 0, w.width, w.height, { x: 0, y: 0 }, OT.Z.NORMAL);
    w.onScroll = function (dx, dy) {
      var vp = this.viewport;
      vp.scrollpos_x += dx << vp.zoom;
      vp.scrollpos_y += dy << vp.zoom;
      vp.dest_scrollpos_x = vp.scrollpos_x;
      vp.dest_scrollpos_y = vp.scrollpos_y;
    };
    w.onMouseWheel = function (wheel) { OT.zoomInOrOutToCursorWindow(wheel < 0, this); };
    // vue de départ : la ville centrale, un peu dézoomée (PortfolioAfterLoad)
    while (w.viewport.zoom < OT.Z.OUT2X && OT.doZoomInOutWindow(false, w)) { /* dézoom */ }
    OT.scrollMainWindowToTile(center ? { x: center.x, y: center.y } : { x: 64, y: 64 }, true);
    return w;
  };

  // --- Barre d'état -------------------------------------------------------------
  OT.createStatusBar = function () {
    var L = OT.data.windows.statusbar;
    var w = new Win('statusbar', 0, L);
    w.layoutKey = 'statusbar';
    w.noClose = true;
    w.status = { date: '', money: '', middle: '' };
    w.top = OT.screen.height - w.height;
    w.left = (OT.screen.width - w.width) >> 1;
    w.drawWidget = function (r, index) {
      var fr = wd().framerect;
      var tr = { left: r.left + fr[0], right: r.right - fr[2], top: OT.centreBounds(r.top, r.bottom, OT.getCharacterHeight(0)), bottom: r.bottom };
      if (index === 0) OT.drawString(tr.left, tr.right, tr.top, this.status.date, TC.WHITE, SA.HOR_CENTER);
      else if (index === 2) OT.drawString(tr.left, tr.right, tr.top, this.status.money, TC.WHITE, SA.HOR_CENTER);
      else if (index === 1) OT.drawString(tr.left, tr.right, tr.top, this.status.middle, TC.FROMSTRING, SA.HOR_CENTER);
    };
    w.onClick = function () { /* barre d'état en lecture seule (patch du moteur) */ };
    addWindow(w);
    return w;
  };
  OT.setStatus = function (what, text) {
    var w = findWindowById('statusbar');
    if (!w || w.status[what] === text) return;
    w.status[what] = text;
    var idx = what === 'date' ? 0 : (what === 'middle' ? 1 : 2);
    var nw = getWidget(w, idx);
    if (nw) OT.addDirtyBlock(w.left + nw.r.left, w.top + nw.r.top, w.left + nw.r.right + 1, w.top + nw.r.bottom + 1);
  };

  // --- Accueil ----------------------------------------------------------------------
  OT.showPortfolioWelcome = function () {
    if (bringWindowToFrontById('welcome', 0)) return;
    var pf = OT.data.portfolio;
    var w = new Win('welcome', 0, OT.data.windows.welcome);
    w.layoutKey = 'welcome';
    w.sticky = true;
    var intro = [{ colour: TC.BLACK, text: pf.intro, gap: 0 }, { colour: TC.GREY, text: pf.help, gap: 1 }];
    var lineHeight = function () { return OT.getCharacterHeight(0) + wd().matrix[1] + wd().matrix[3]; };
    w.caption = function () { return 'ProjectsLand'; };
    w.widgetString = function (i) { return i === 3 ? OT.data.strings.collaborators : ''; };
    w.drawWidget = function (r, index) {
      if (index === 1) {
        drawParagraphs(shrinkHV(r, wd().frametext, wd().framerect), intro, true);
      } else if (index === 2) {
        var tr = shrink(r, wd().framerect);
        var y = tr.top + wd().matrix[1];
        pf.projects.forEach(function (p) {
          OT.drawString(tr.left + wd().hsep_normal, tr.right, y, p.title, TC.ORANGE);
          OT.drawString(tr.left, tr.right - wd().hsep_normal, y, p.type, TC.GREY, SA.RIGHT);
          y += lineHeight();
        });
      }
    };
    w.onClick = function (pt, index) {
      if (index === 2) {
        var nw = getWidget(this, 2);
        var row = Math.trunc((pt.y - nw.r.top - wd().framerect[1]) / Math.max(1, lineHeight()));
        if (row < 0 || row >= pf.projects.length) return;
        var t = townById(pf.projects[row].town);
        if (!t) return;
        OT.scrollMainWindowToTile({ x: t.x, y: t.y });
        OT.showPortfolioProject(t.id);
      } else if (index === 3) {
        OT.showPortfolioCollaborators();
      }
    };
    placeWindow(w, { x: OT.scaleGUITrad(8), y: OT.scaleGUITrad(8) });
    addWindow(w);
  };

  // --- Fiche d'un projet ---------------------------------------------------------
  OT.showPortfolioProject = function (townId) {
    if (bringWindowToFrontById('project', townId)) return;
    var t = townById(townId);
    if (!t) return;
    var pi = projectOfTown(townId);
    var p = pi >= 0 ? OT.data.portfolio.projects[pi] : null;
    var key = OT.data.windows['project' + pi] ? 'project' + pi : 'project0';
    var w = new Win('project', townId, OT.data.windows[key]);
    w.layoutKey = key;
    var paragraphs = projectParagraphs(p);
    w.links = [];
    w.hoverUrl = '';
    w.caption = function () { return p ? p.title : t.name; };
    w.widgetString = function (i) {
      var s = OT.data.strings;
      return i === 3 ? s.show_on_map : (i === 4 ? s.open_link : (i === 5 ? s.collaborators : ''));
    };
    w.drawWidget = function (r, index) {
      if (index !== 2) return;
      this.links = [];
      drawParagraphs(shrinkHV(r, wd().frametext, wd().framerect), paragraphs, true, this.links, this.hoverUrl);
    };
    w.onMouseOver = function (pt, index) {
      var hover = '';
      if (index === 2) {
        for (var a of this.links) {
          if (pt.x >= a.left && pt.x <= a.right && pt.y >= a.top && pt.y <= a.bottom) { hover = a.url; break; }
        }
      }
      if (hover !== this.hoverUrl) {
        this.hoverUrl = hover;
        var nw = getWidget(this, 2);
        OT.addDirtyBlock(this.left + nw.r.left, this.top + nw.r.top, this.left + nw.r.right + 1, this.top + nw.r.bottom + 1);
      }
    };
    w.onClick = function (pt, index) {
      if (index === 3) OT.scrollMainWindowToTile({ x: t.x, y: t.y });
      else if (index === 4) { if (p && p.links.length) openBrowser(p.links[0].url); }
      else if (index === 2) {
        for (var a of this.links) {
          if (pt.x >= a.left && pt.x <= a.right && pt.y >= a.top && pt.y <= a.bottom) { openBrowser(a.url); break; }
        }
      } else if (index === 5) OT.showPortfolioCollaborators();
    };
    w.onReposition = function () {
      // OnResize : l'aperçu suit son widget et reste centré sur la ville
      var nw = getWidget(this, 1);
      this.viewport.left = this.left + nw.r.left;
      this.viewport.top = this.top + nw.r.top;
      OT.scrollWindowToTile({ x: t.x, y: t.y }, this, true);
    };
    w.onClose = function () { if (p && OT.onProjectClose) OT.onProjectClose(p.id); };
    // position : sous la fenêtre d'accueil, à gauche (OnInitialPosition)
    var S = OT.scaleGUITrad;
    var top = S(8);
    var welcome = findWindowById('welcome', 0);
    if (welcome) top = welcome.top + welcome.height + S(6);
    if (top + w.height > OT.screen.height - S(16)) top = Math.max(0, OT.screen.height - S(16) - w.height);
    placeWindow(w, { x: S(8), y: top });
    var vpw = getWidget(w, 1);
    OT.initializeViewport(w, vpw.r.left, vpw.r.top, vpw.r.right - vpw.r.left + 1, vpw.r.bottom - vpw.r.top + 1, { x: t.x, y: t.y }, OT.guiZoom);
    w.disableVpScroll = true;
    addWindow(w);
    if (p && OT.onProjectOpen) OT.onProjectOpen(p.id);
  };

  // --- Collaborateurs -------------------------------------------------------------
  OT.showPortfolioCollaborators = function () {
    if (bringWindowToFrontById('collaborators', 0)) return;
    var pf = OT.data.portfolio;
    var w = new Win('collaborators', 0, OT.data.windows.collaborators);
    w.layoutKey = 'collaborators';
    var intro = [{ colour: TC.BLACK, text: pf.collaborators_intro, gap: 0 }];
    if (!pf.collaborators.length) intro.push({ colour: TC.GREY, text: 'Aucun collaborateur.', gap: 1 });
    var lineHeight = function () { return OT.getCharacterHeight(0) + wd().matrix[1] + wd().matrix[3]; };
    w.caption = function () { return OT.data.strings.collaborators_caption; };
    w.drawWidget = function (r, index) {
      if (index === 0) {
        drawParagraphs(shrinkHV(r, wd().frametext, wd().framerect), intro, true);
      } else if (index === 1) {
        var tr = shrink(r, wd().framerect);
        var y = tr.top + wd().matrix[1];
        pf.collaborators.forEach(function (c) {
          OT.drawString(tr.left + wd().hsep_normal, tr.right, y, c.name, TC.ORANGE);
          var projects = c.projects.map(function (i) { return pf.projects[i].title; }).join(', ');
          OT.drawString(tr.left, tr.right - wd().hsep_normal, y, projects, TC.GREY, SA.RIGHT);
          y += lineHeight();
        });
      }
    };
    w.onClick = function (pt, index) {
      if (index !== 1) return;
      var nw = getWidget(this, 1);
      var row = Math.trunc((pt.y - nw.r.top - wd().framerect[1]) / Math.max(1, lineHeight()));
      if (row < 0 || row >= pf.collaborators.length) return;
      OT.showPortfolioCollaborator(row);
    };
    placeWindow(w, autoPlace(w.width, w.height));
    addWindow(w);
  };

  OT.showPortfolioCollaborator = function (index) {
    var pf = OT.data.portfolio;
    if (index >= pf.collaborators.length) return;
    if (bringWindowToFrontById('collaborator', index)) return;
    var c = pf.collaborators[index];
    var w = new Win('collaborator', index, OT.data.windows['collaborator' + index]);
    w.layoutKey = 'collaborator' + index;
    var paragraphs = [];
    c.projects.forEach(function (i) {
      var p = pf.projects[i];
      paragraphs.push({ colour: TC.ORANGE, text: 'Projet', gap: paragraphs.length ? 1 : 0 });
      paragraphs.push({ colour: TC.WHITE, text: p.title, gap: 0 });
      paragraphs.push({ colour: TC.BLACK, text: p.subtitle + ' (' + p.type + ')', gap: 0 });
      paragraphs.push({ colour: TC.ORANGE, text: "Rôle dans l'équipe", gap: 1 });
      paragraphs.push({ colour: TC.BLACK, text: p.team, gap: 0 });
    });
    w.caption = function () { return c.name; };
    w.widgetString = function (i) { return i === 4 ? OT.data.strings.open_project : ''; };
    w.drawWidget = function (r, idx) {
      if (idx === 1) {
        // DrawCompanyManagerFace
        var g = OT.data.guiSprites.gradient;
        var d = OT.getSpriteSize(g);
        var x = OT.centreBounds(r.left, r.right, d.width), y = OT.centreBounds(r.top, r.bottom, d.height);
        for (var k = 0; k < c.face.length; k += 2) OT.drawSprite(c.face[k], c.face[k + 1], x, y);
      } else if (idx === 2) {
        OT.drawStringMultiLine(r.left, r.right, r.top, r.bottom, c.name, TC.WHITE, SA.HOR_CENTER | SA.TOP);
      } else if (idx === 3) {
        drawParagraphs(r, paragraphs, true);
      }
    };
    w.onClick = function (pt, idx) {
      if (idx !== 4 || !c.projects.length) return;
      var t = townById(pf.projects[c.projects[0]].town);
      if (!t) return;
      OT.scrollMainWindowToTile({ x: t.x, y: t.y });
      OT.showPortfolioProject(t.id);
    };
    placeWindow(w, autoPlace(w.width, w.height));
    addWindow(w);
  };

  // --- Infobulles -----------------------------------------------------------------
  function showTooltip(text) {
    var old = findWindowById('tooltip');
    if (old) OT.closeWindow(old);
    if (!text || !OT.cursor.inWindow) return;
    var fr = wd().framerect, fb = wd().fullbevel;
    var width = Math.min(OT.getStringBoundingBox(text).width, OT.scaleGUITrad(194));
    var height = OT.getStringHeight(text, width);
    width += fr[0] + fr[2] + fb[0] + fb[2];
    height += fr[1] + fr[3] + fb[1] + fb[3];
    var w = new Win('tooltip', 0, null);
    w.width = width;
    w.height = height;
    w.noClose = true;
    w.noFocus = true;
    w.widgets = [{ type: 'empty', colour: 0, index: 0, r: { left: 0, top: 0, right: width - 1, bottom: height - 1 }, tooltip: '' }];
    w.drawWidget = function (r) {
      OT.gfxFillRect(r.left, r.top, r.right, r.bottom, 1 /* PC_BLACK */);
      var b = shrink(r, wd().bevel);
      OT.gfxFillRect(b.left, b.top, b.right, b.bottom, 0x44 /* PC_LIGHT_YELLOW */);
      var t = shrink(shrink(r, fr), fb);
      OT.drawStringMultiLine(t.left, t.right, t.top, t.bottom, text, TC.BLACK, SA.CENTER);
    };
    w.onMouseLoop = function () {
      if (!OT.cursor.inWindow || !mouseHovering) OT.closeWindow(this);
    };
    // OnInitialPosition
    var cur = OT.cursorSprite();
    var sb = findWindowById('statusbar');
    var scr_top = 0 + 2, scr_bot = OT.screen.height - (sb ? sb.height : 0) - 2;
    var y = softClamp(OT.cursor.y + cur.height + cur.y + 5, scr_top, scr_bot);
    if (y + height > scr_bot) y = Math.min(OT.cursor.y + cur.y - 5, scr_bot) - height;
    var x = width >= OT.screen.width ? 0 : softClamp(OT.cursor.x - (width >> 1), 0, OT.screen.width - width);
    w.left = x;
    w.top = y;
    addWindow(w);
  }
  function softClamp(a, min, max) {
    if (min > max) return Math.trunc((min + max) / 2);
    if (a <= min) return min;
    if (a >= max) return max;
    return a;
  }

  // --- Souris et clavier (window.cpp : MouseLoop, HandleMouseEvents...) -------------
  var draggingWindow = null, dragDelta = { x: 0, y: 0 };
  var scrollingViewport = false, lastScrollWindow = null;
  var mouseoverLast = null;
  var mouseHovering = false;
  var hoverPos = { x: 0, y: 0 }, hoverTime = 0;
  var doubleClickTime = -1e9, doubleClickPos = { x: 0, y: 0 };
  OT.leftButtonDown = false;
  var leftButtonClicked = false;
  var wheel = 0;
  OT.dirkeys = 0;

  var pendingClick = false;
  OT.mouseDown = function (button) { if (button === 0) { OT.leftButtonDown = true; leftButtonClicked = false; pendingClick = true; } };
  OT.mouseUp = function (button) { if (button === 0) OT.leftButtonDown = false; };
  OT.mouseWheel = function (d) { wheel += d; };

  function maybeBringWindowToFront(w) {
    if (w.cls === 'main' || w.cls === 'statusbar' || w.cls === 'tooltip') return true;
    var ww = w.width, wh = w.shaded ? w.fullHeight : w.height;
    var i = OT.windows.indexOf(w);
    var bring = false;
    for (var k = i + 1; k < OT.windows.length; k++) {
      var u = OT.windows[k];
      if (u.cls === 'main' || u.cls === 'statusbar' || u.cls === 'tooltip') continue;
      if (w.left + ww <= u.left || u.left + u.width <= w.left || w.top + wh <= u.top || u.top + u.height <= w.top) continue;
      bring = true;
    }
    if (bring) bringWindowToFront(w);
    return true;
  }

  function handleButtonClick(w, nw) {
    nw.lowered = true;
    w.timeout = 7;
    OT.addDirtyBlock(w.left + nw.r.left, w.top + nw.r.top, w.left + nw.r.right + 1, w.top + nw.r.bottom + 1);
  }

  function dispatchLeftClick(w, x, y) {
    var nw = widgetFromPos(w, x, y);
    if (!nw) return;
    if (nw.disabled) return;
    if (nw.push) handleButtonClick(w, nw);
    switch (nw.type) {
      case 'closebox': OT.closeWindow(w); return;
      case 'caption':
        draggingWindow = w;
        dragDelta = { x: w.left - OT.cursor.x, y: w.top - OT.cursor.y };
        bringWindowToFront(w);
        return;
      case 'shadebox': setShaded(w, !w.shaded); return;
      case 'stickybox':
        w.sticky = !w.sticky;
        OT.addDirtyBlock(w.left + nw.r.left, w.top + nw.r.top, w.left + nw.r.right + 1, w.top + nw.r.bottom + 1);
        return;
    }
    if (nw.index < 0) return;
    if (w.onClick) w.onClick({ x: x, y: y }, nw.index);
  }

  function setShaded(w, s) {
    OT.setWindowDirty(w);
    if (s) {
      w.fullHeight = w.height;
      w.height = w.captionHeight;
    } else {
      w.height = w.fullHeight;
    }
    w.shaded = s;
    OT.setWindowDirty(w);
  }

  function handleWindowDragging() {
    if (!draggingWindow) return false;
    if (OT.leftButtonDown && OT.cursor.dx === 0 && OT.cursor.dy === 0) return true;
    var w = draggingWindow;
    if (!OT.leftButtonDown) { draggingWindow = null; return false; }
    OT.setWindowDirty(w);
    var x = OT.cursor.x + dragDelta.x, y = OT.cursor.y + dragDelta.y;
    var nx = x, ny = y;
    var hsnap = OT.scaleGUITrad(10), vsnap = OT.scaleGUITrad(10), delta;
    for (var v of OT.windows) {
      if (v === w) continue;
      if (y + w.height > v.top && y < v.top + v.height) {
        delta = Math.abs(v.left + v.width - x);
        if (delta <= hsnap) { nx = v.left + v.width; hsnap = delta; }
        delta = Math.abs(v.left - x - w.width);
        if (delta <= hsnap) { nx = v.left - w.width; hsnap = delta; }
      }
      if (w.top + w.height >= v.top && w.top <= v.top + v.height) {
        delta = Math.abs(v.left - x);
        if (delta <= hsnap) { nx = v.left; hsnap = delta; }
        delta = Math.abs(v.left + v.width - x - w.width);
        if (delta <= hsnap) { nx = v.left + v.width - w.width; hsnap = delta; }
      }
      if (x + w.width > v.left && x < v.left + v.width) {
        delta = Math.abs(v.top + v.height - y);
        if (delta <= vsnap) { ny = v.top + v.height; vsnap = delta; }
        delta = Math.abs(v.top - y - w.height);
        if (delta <= vsnap) { ny = v.top - w.height; vsnap = delta; }
      }
      if (w.left + w.width >= v.left && w.left <= v.left + v.width) {
        delta = Math.abs(v.top - y);
        if (delta <= vsnap) { ny = v.top; vsnap = delta; }
        delta = Math.abs(v.top + v.height - y - w.height);
        if (delta <= vsnap) { ny = v.top + v.height - w.height; vsnap = delta; }
      }
    }
    ensureVisibleCaption(w, nx, ny);
    OT.setWindowDirty(w);
    return true;
  }

  function handleViewportScroll() {
    if (!scrollingViewport) return false;
    if (!lastScrollWindow) lastScrollWindow = OT.findWindowFromPt(OT.cursor.x, OT.cursor.y);
    if (!lastScrollWindow || !OT.leftButtonDown) {
      scrollingViewport = false;
      lastScrollWindow = null;
      return false;
    }
    var dx = -OT.cursor.dx, dy = -OT.cursor.dy;
    if ((dx !== 0 || dy !== 0) && lastScrollWindow.onScroll) lastScrollWindow.onScroll(dx, dy);
    OT.cursor.dx = 0;
    OT.cursor.dy = 0;
    return true;
  }

  function handleMouseOver() {
    var w = OT.findWindowFromPt(OT.cursor.x, OT.cursor.y);
    if (mouseoverLast && mouseoverLast !== w && mouseoverLast.onMouseOver) mouseoverLast.onMouseOver({ x: -1, y: -1 }, 0);
    mouseoverLast = w;
    if (w && w.onMouseOver) {
      var pt = { x: OT.cursor.x - w.left, y: OT.cursor.y - w.top };
      var nw = widgetFromPos(w, pt.x, pt.y);
      if (nw) w.onMouseOver(pt, nw.index);
    }
  }

  function isPtInWindowViewport(w, x, y) {
    var vp = w.viewport;
    if (!vp) return null;
    if (x >= vp.left && x < vp.left + vp.width && y >= vp.top && y < vp.top + vp.height) return vp;
    return null;
  }

  /** HandleMouseEvents + MouseLoop (appelé à chaque image). */
  OT.handleMouseEvents = function (now) {
    var click = null;
    if ((OT.leftButtonDown && !leftButtonClicked) || pendingClick) {
      pendingClick = false;
      click = 'left';
      if (now <= doubleClickTime + 500 && doubleClickPos.x !== 0 && Math.abs(OT.cursor.x - doubleClickPos.x) < 5 &&
          doubleClickPos.y !== 0 && Math.abs(OT.cursor.y - doubleClickPos.y) < 5) click = 'double';
      doubleClickTime = now;
      doubleClickPos = { x: OT.cursor.x, y: OT.cursor.y };
      leftButtonClicked = true;
    }
    var mw = wheel;
    wheel = 0;
    // survol prolongé : infobulles (hover_delay_ms = 250)
    if (!OT.cursor.inWindow || click || mw !== 0 || OT.leftButtonDown ||
        hoverPos.x === 0 || Math.abs(OT.cursor.x - hoverPos.x) >= 5 || hoverPos.y === 0 || Math.abs(OT.cursor.y - hoverPos.y) >= 5) {
      hoverPos = { x: OT.cursor.x, y: OT.cursor.y };
      hoverTime = now;
      mouseHovering = false;
    } else if (!mouseHovering && now > hoverTime + 250) {
      click = 'hover';
      mouseHovering = true;
      hoverTime = now;
    }
    mouseLoop(click, mw);
    OT.cursor.dx = 0;
    OT.cursor.dy = 0;
  };

  function mouseLoop(click, mousewheel) {
    if (handleWindowDragging()) return;
    if (handleViewportScroll()) return;
    handleMouseOver();
    if (!click && mousewheel === 0) return;
    var x = OT.cursor.x, y = OT.cursor.y;
    var w = OT.findWindowFromPt(x, y);
    if (!w) return;
    if (click !== 'hover' && !maybeBringWindowToFront(w)) return;
    var vp = isPtInWindowViewport(w, x, y);
    if (mousewheel !== 0 && w.onMouseWheel && vp) w.onMouseWheel(mousewheel);
    if (vp) {
      if (click === 'left' || click === 'double') {
        if (OT.handleViewportClicked(vp, x, y)) return;
        if (!w.disableVpScroll) {
          scrollingViewport = true;
          return;
        }
      }
    }
    if (click === 'left' || click === 'double') {
      dispatchLeftClick(w, x - w.left, y - w.top);
    } else if (click === 'hover') {
      var nw = widgetFromPos(w, x - w.left, y - w.top);
      if (nw && nw.tooltip) showTooltip(nw.tooltip);
    }
  }

  // --- Minuteries de l'interface (toutes les 30 ms) ---------------------------------
  var scrollamt = [[0, 0], [-2, 0], [0, -2], [-2, -1], [2, 0], [0, 0], [2, -1], [0, -2], [0, 2], [-2, 1], [0, 0], [-2, 0], [2, 1], [0, 2], [2, 0], [0, 0]];
  OT.windowInterval = function () {
    // HandleKeyScrolling
    if (OT.dirkeys) {
      var factor = OT.shiftPressed ? 50 : 10;
      var vp = OT.mainWindow.viewport;
      vp.dest_scrollpos_x += (scrollamt[OT.dirkeys][0] * factor) << vp.zoom;
      vp.dest_scrollpos_y += (scrollamt[OT.dirkeys][1] * factor) << vp.zoom;
    }
    // DecreaseWindowCounters
    OT.windows.slice().forEach(function (w) { if (w.onMouseLoop) w.onMouseLoop(); });
    OT.windows.forEach(function (w) {
      if (w.timeout > 0 && --w.timeout === 0) {
        w.widgets.forEach(function (nw) {
          if (nw.lowered && nw.push) {
            nw.lowered = false;
            OT.addDirtyBlock(w.left + nw.r.left, w.top + nw.r.top, w.left + nw.r.right + 1, w.top + nw.r.bottom + 1);
          }
        });
      }
    });
  };
  OT.whiteBorderInterval = function () {
    OT.windows.forEach(function (w) {
      if (w.whiteBorder > 0 && --w.whiteBorder === 0) OT.setWindowDirty(w);
    });
  };

  /** Touches (raccourcis de la fenêtre principale autorisés par le patch). */
  OT.handleKey = function (e) {
    if (e.key === 'Delete') {
      OT.windows.slice().forEach(function (w) {
        if (w.cls === 'main' || w.noClose) return;
        if (!e.shiftKey && w.sticky) return;
        OT.closeWindow(w);
      });
      return true;
    }
    if ((e.key === 'r' || e.key === 'R') && e.ctrlKey) { OT.markWholeScreenDirty(); return true; }
    if ((e.key === 'c' || e.key === 'C' || e.key === 'z' || e.key === 'Z') && !e.ctrlKey && !e.altKey && !e.metaKey) {
      var w = OT.findWindowFromPt(OT.cursor.x, OT.cursor.y);
      var vp = w && isPtInWindowViewport(w, OT.cursor.x, OT.cursor.y);
      if (!vp) return true;
      var pt = OT.translateXYToTileCoord(vp, OT.cursor.x, OT.cursor.y);
      if (pt.x === -1) return true;
      var zoom = e.key === 'z' || e.key === 'Z';
      var main = OT.mainWindow;
      var instant = zoom && main.viewport.zoom !== OT.ZOOM_MIN;
      if (zoom) while (OT.doZoomInOutWindow(true, main)) { /* MaxZoomInOut */ }
      OT.scrollWindowTo(pt.x, pt.y, -1, main, instant);
      return true;
    }
    return false;
  };

  /** Nouvelle taille de l'écran : RelocateAllWindows. */
  OT.relocateAllWindows = function (neww, newh) {
    OT.windows.forEach(function (w) {
      if (w.cls === 'main') {
        w.width = neww;
        w.height = newh;
        w.widgets[0].r = { left: 0, top: 0, right: neww - 1, bottom: newh - 1 };
        // NWidgetViewport::UpdateViewportCoordinates : le coin haut gauche reste en place
        var vp = w.viewport;
        vp.width = neww;
        vp.height = newh;
        vp.virtual_width = neww << vp.zoom;
        vp.virtual_height = newh << vp.zoom;
        return;
      }
      if (w.cls === 'statusbar') {
        w.top = newh - w.height;
        w.left = (neww - w.width) >> 1;
        return;
      }
      var left = w.left;
      if (left + (w.width >> 1) >= neww) left = neww - w.width;
      if (left < 0) left = 0;
      var top = w.top;
      if (top + (w.height >> 1) >= newh) top = newh - w.height;
      ensureVisibleCaption(w, left, top);
      if (w.onReposition) w.onReposition();
    });
  };

  // --- Échelle de l'interface (UpdateGUIZoom, AdjustGUIZoom, ReInitAllWindows) -------
  OT.computeGuiScale = function (w, h) {
    var scale = Math.trunc(Math.min(w / 640, h / 480) * 100);
    return Math.min(Math.max(Math.trunc(scale / 25) * 25, 100), 500);
  };
  function signWidth(str, fs) {
    var fb = wd().fullbevel;
    var w = OT.getStringBoundingBox(str, fs).width;
    return fb[0] + ((w + 1) & ~1) + fb[2];
  }
  /** Largeurs d'un panneau (ViewportSign::UpdatePosition) à l'échelle courante. */
  OT.updateSignWidths = function (sign, str, strSmall) {
    sign.width_normal = signWidth(str, OT.FS.NORMAL);
    sign.width_small = signWidth(strSmall || str, OT.FS.SMALL);
  };
  OT.applyGuiScale = function (s) {
    var d = OT.data, sc = d.scales[s];
    OT.guiScale = s;
    OT.guiZoom = sc.gui_zoom;
    OT.fontZoom = sc.font_zoom;
    d.widget = sc.widget;
    d.windows = sc.windows;
    sc.fonts.forEach(function (f, i) { d.fonts[i].height = f[0]; d.fonts[i].ascender = f[1]; });
    d.towns.forEach(function (t) {
      var sign = { width_normal: 0, width_small: 0 };
      OT.updateSignWidths(sign, t.label, t.label_small);
      t.sign[2] = sign.width_normal;
      t.sign[3] = sign.width_small;
    });
    (OT.textEffects || []).forEach(function (te) { OT.updateSignWidths(te, te.text); });
  };
  /** Changement d'échelle : positions et zooms ajustés, fenêtres remises en page. */
  OT.reinitAllWindows = function (oldScale, oldGuiZoom) {
    var shift = oldGuiZoom - OT.guiZoom;
    OT.windows.forEach(function (w) {
      w.left = Math.trunc(w.left * OT.guiScale / oldScale);
      w.top = Math.trunc(w.top * OT.guiScale / oldScale);
      if (w.viewport) w.viewport.zoom = Math.min(Math.max(w.viewport.zoom - shift, OT.ZOOM_MIN), OT.ZOOM_MAX);
      if (w.cls === 'main') {
        var vp = w.viewport;
        vp.virtual_width = vp.width << vp.zoom;
        vp.virtual_height = vp.height << vp.zoom;
        return;
      }
      if (!w.layoutKey) {
        if (w.cls === 'tooltip') OT.closeWindow(w);
        return;
      }
      var L = OT.data.windows[w.layoutKey];
      w.widgets = makeWidgets(L);
      w.width = L.width;
      w.fullHeight = L.height;
      var cap = w.widgets.find(function (x) { return x.type === 'caption'; });
      w.captionHeight = cap ? cap.r.bottom + 1 : 0;
      w.height = w.shaded ? w.captionHeight : L.height;
      if (w.viewport) {
        var nw = getWidget(w, 1);
        var vpp = w.viewport;
        vpp.left = w.left + nw.r.left;
        vpp.top = w.top + nw.r.top;
        vpp.width = nw.r.right - nw.r.left + 1;
        vpp.height = nw.r.bottom - nw.r.top + 1;
        vpp.virtual_width = vpp.width << vpp.zoom;
        vpp.virtual_height = vpp.height << vpp.zoom;
      }
    });
  };
})();
