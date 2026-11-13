/*
 * OpenTTD Portfolio — moteur JavaScript.
 * gfx.js : écran 8 bits (index de palette), dessin des sprites, rectangles et cadres.
 * Port en JavaScript de gfx.cpp, blitter/8bpp_optimized.cpp et widget.cpp (DrawFrameRect)
 * d'OpenTTD 15.3 (GPL v2), dont OpenTTD Portfolio est une version modifiée.
 */
'use strict';
var OT = window.OT || (window.OT = {});

(function () {
  // --- Constantes d'OpenTTD -------------------------------------------------
  OT.ZOOM_BASE_SHIFT = 2;
  OT.ZOOM_BASE = 4;
  OT.Z = { MIN: 0, IN2X: 1, NORMAL: 2, OUT2X: 3, OUT4X: 4, OUT8X: 5 };
  OT.TILE_SIZE = 16;
  OT.TILE_PIXELS = 32;
  OT.TILE_HEIGHT = 8;
  OT.MAX_BUILDING_PIXELS = 200;

  // Modes du blitter
  var BM = OT.BM = { NORMAL: 0, COLOUR_REMAP: 1, TRANSPARENT: 2, TRANSPARENT_REMAP: 3, CRASH_REMAP: 4, BLACK_REMAP: 5 };

  // Couleurs de texte (TextColour)
  OT.TC = {
    BLUE: 0, SILVER: 1, GOLD: 2, RED: 3, PURPLE: 4, LIGHT_BROWN: 5, ORANGE: 6, GREEN: 7, YELLOW: 8,
    DARK_GREEN: 9, CREAM: 10, BROWN: 11, WHITE: 12, LIGHT_BLUE: 13, GREY: 14, DARK_BLUE: 15, BLACK: 16,
    INVALID: 0xFF, IS_PALETTE_COLOUR: 0x100, NO_SHADE: 0x200, FORCED: 0x400, FROMSTRING: 0,
  };
  // Alignements (StringAlignment)
  OT.SA = { LEFT: 0, HOR_CENTER: 1, RIGHT: 2, HOR_MASK: 3, TOP: 0, VERT_CENTER: 4, BOTTOM: 8, VERT_MASK: 12, CENTER: 5, FORCE: 16 };
  // Nuances (ColourShade)
  OT.SHADE = { DARKEST: 0, DARKER: 1, DARK: 2, NORMAL: 3, LIGHT: 4, LIGHTER: 5, LIGHTEST: 6, LIGHTEREST: 7 };
  OT.COLOUR = { BROWN: 13, GREY: 14, WHITE: 15 };
  OT.PAL_NONE = 0;
  OT.PALETTE_TO_TRANSPARENT = 802;
  OT.PALETTE_CRASH = 804;
  OT.SPRITE_WIDTH = 24;
  OT.SPRITE_MASK = (1 << 24) - 1;
  OT.TRANSPARENT_BIT = 31;
  OT.RECOLOUR_BIT = 30;
  OT.PALETTE_TEXT_RECOLOUR = 29;
  OT.SPR_EMPTY_BOUNDING_BOX = 0; // remplacé au chargement (valeur du moteur)

  OT.guiScale = 100;
  OT.guiZoom = 2;
  OT.fontZoom = 2;
  /** ScaleGUITrad. */
  OT.scaleGUITrad = function (v) { return Math.trunc(v * OT.guiScale / 100); };
  /** ScaleSpriteTrad. */
  OT.scaleSpriteTrad = function (v) { return OT.unScaleByZoom(v * OT.ZOOM_BASE, OT.guiZoom); };
  OT.scaleByZoom = function (v, z) { return v << z; };
  OT.unScaleByZoom = function (v, z) { return (v + (1 << z) - 1) >> z; };
  OT.unScaleByZoomLower = function (v, z) { return v >> z; };
  OT.centreBounds = function (min, max, size) { return Math.trunc((min + max - size + 1) / 2); };
  OT.roundDivSU = function (a, b) {
    return a > 0 ? Math.trunc((a + Math.trunc(b / 2)) / b) : Math.trunc((a - Math.trunc((b - 1) / 2)) / b);
  };
  OT.remapCoords = function (x, y, z) { return { x: (y - x) * 2 * OT.ZOOM_BASE, y: (y + x - z) * OT.ZOOM_BASE }; };
  OT.inverseRemapCoords = function (x, y) { return { x: (y * 2 - x) >> (2 + OT.ZOOM_BASE_SHIFT), y: (y * 2 + x) >> (2 + OT.ZOOM_BASE_SHIFT) }; };

  // --- Écran -----------------------------------------------------------------
  var screen = OT.screen = { width: 0, height: 0, buf: null };
  OT.setScreenSize = function (w, h) {
    screen.width = w;
    screen.height = h;
    screen.buf = new Uint8Array(w * h);
  };

  /**
   * Zone de dessin courante (DrawPixelInfo) : coordonnées propres (left, top, width,
   * height, zoom) et position à l'écran (x0, y0) du point (left, top).
   */
  OT.dpi = { left: 0, top: 0, width: 0, height: 0, zoom: 0, x0: 0, y0: 0 };
  OT.makeDpi = function (left, top, width, height, zoom, x0, y0) {
    return { left: left, top: top, width: width, height: height, zoom: zoom || 0, x0: x0, y0: y0 };
  };

  var remap = null; // table de recoloriage courante (_colour_remap_ptr)
  var stringRemap = new Uint8Array(256);

  // --- Sprites ---------------------------------------------------------------
  /** Données d'un niveau de zoom d'un sprite (In2x = Normal doublé, comme ResizeSpriteOut sur Min). */
  OT.spriteLevel = function (spr, zoom) {
    var lv = spr.lv[zoom];
    if (lv) return lv;
    if (zoom < OT.Z.NORMAL) {
      lv = spr.lv[zoom] = OT.enlargeLevel(spr.lv[OT.Z.NORMAL], OT.Z.NORMAL - zoom);
      return lv;
    }
    return spr.lv[OT.Z.NORMAL];
  };

  /** Agrandissement exact d'un niveau (ResizeSpriteIn / ResizeSpriteOut sur Min). */
  OT.enlargeLevel = function (n, shift) {
    var f = 1 << shift;
    var w = n.w * f, h = n.h * f, px = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) {
      var srow = (y >> shift) * n.w, drow = y * w;
      for (var x = 0; x < w; x++) px[drow + x] = n.px[srow + (x >> shift)];
    }
    return { w: w, h: h, px: px };
  };

  /**
   * GfxBlitter : position, découpage (sous-sprite et zone de dessin) puis dessin.
   * @param zb 1 (GUI, coordonnées non mises à l'échelle) ou ZOOM_BASE (vues)
   * @param scaledXY les coordonnées sont-elles à mettre à l'échelle du zoom ?
   */
  function gfxBlitter(spr, x, y, mode, sub, zoom, zb, scaledXY, dpi) {
    dpi = dpi || OT.dpi;
    var bp = { skip_left: 0, skip_top: 0, width: 0, height: 0, left: 0, top: 0 };
    if (scaledXY) {
      x = x << zoom;
      y = y << zoom;
    }
    x += spr.xo;
    y += spr.yo;
    if (!sub) {
      bp.width = OT.unScaleByZoom(spr.w, zoom);
      bp.height = OT.unScaleByZoom(spr.h, zoom);
    } else {
      var clip_left = Math.max(0, -spr.xo + sub[0] * zb);
      var clip_top = Math.max(0, -spr.yo + sub[1] * zb);
      var clip_right = Math.max(0, spr.w - (-spr.xo + (sub[2] + 1) * zb));
      var clip_bottom = Math.max(0, spr.h - (-spr.yo + (sub[3] + 1) * zb));
      if (clip_left + clip_right >= spr.w) return;
      if (clip_top + clip_bottom >= spr.h) return;
      bp.skip_left = clip_left >> zoom;
      bp.skip_top = clip_top >> zoom;
      bp.width = OT.unScaleByZoom(spr.w - clip_left - clip_right, zoom);
      bp.height = OT.unScaleByZoom(spr.h - clip_top - clip_bottom, zoom);
      x += bp.skip_left << zoom;
      y += bp.skip_top << zoom;
    }
    if (bp.width <= 0 || bp.height <= 0) return;

    y -= scaledXY ? (dpi.top << zoom) : dpi.top;
    var y_unscaled = OT.unScaleByZoom(y, zoom);
    if (y < 0) {
      bp.height -= -y_unscaled;
      if (bp.height <= 0) return;
      bp.skip_top += -y_unscaled;
      y = 0;
    } else {
      bp.top = y_unscaled;
    }
    y += scaledXY ? ((bp.height - dpi.height) << zoom) : ((bp.height << zoom) - dpi.height);
    if (y > 0) {
      bp.height -= OT.unScaleByZoom(y, zoom);
      if (bp.height <= 0) return;
    }

    x -= scaledXY ? (dpi.left << zoom) : dpi.left;
    var x_unscaled = OT.unScaleByZoom(x, zoom);
    if (x < 0) {
      bp.width -= -x_unscaled;
      if (bp.width <= 0) return;
      bp.skip_left += -x_unscaled;
      x = 0;
    } else {
      bp.left = x_unscaled;
    }
    x += scaledXY ? ((bp.width - dpi.width) << zoom) : ((bp.width << zoom) - dpi.width);
    if (x > 0) {
      bp.width -= OT.unScaleByZoom(x, zoom);
      if (bp.width <= 0) return;
    }

    var lv = OT.spriteLevel(spr, zoom);
    blit(lv, bp, mode, dpi);
  }

  /** Blitter 8 bits (Blitter_8bppOptimized::Draw). */
  function blit(lv, bp, mode, dpi) {
    var buf = screen.buf, sw = screen.width;
    var px = lv.px, lw = lv.w;
    var dx0 = dpi.x0 + bp.left, dy0 = dpi.y0 + bp.top;
    // sécurité : jamais hors de l'écran
    var w = bp.width, h = bp.height, sl = bp.skip_left, st = bp.skip_top;
    if (dx0 < 0) { w += dx0; sl -= dx0; dx0 = 0; }
    if (dy0 < 0) { h += dy0; st -= dy0; dy0 = 0; }
    if (dx0 + w > sw) w = sw - dx0;
    if (dy0 + h > screen.height) h = screen.height - dy0;
    if (sl + w > lw) w = lw - sl;
    if (st + h > lv.h) h = lv.h - st;
    if (w <= 0 || h <= 0) return;
    var r = remap;
    for (var yy = 0; yy < h; yy++) {
      var s = (st + yy) * lw + sl;
      var d = (dy0 + yy) * sw + dx0;
      var c, m, xx;
      switch (mode) {
        case BM.COLOUR_REMAP:
        case BM.CRASH_REMAP:
          for (xx = 0; xx < w; xx++) {
            c = px[s + xx];
            if (c !== 0) { m = r[c]; if (m !== 0) buf[d + xx] = m; }
          }
          break;
        case BM.BLACK_REMAP:
          for (xx = 0; xx < w; xx++) if (px[s + xx] !== 0) buf[d + xx] = 0;
          break;
        case BM.TRANSPARENT:
        case BM.TRANSPARENT_REMAP:
          for (xx = 0; xx < w; xx++) if (px[s + xx] !== 0) buf[d + xx] = r[buf[d + xx]];
          break;
        default:
          for (xx = 0; xx < w; xx++) {
            c = px[s + xx];
            if (c !== 0) buf[d + xx] = c;
          }
      }
    }
  }

  function getBlitterMode(pal) {
    if (pal === OT.PAL_NONE) return BM.NORMAL;
    if (pal === OT.PALETTE_CRASH) return BM.CRASH_REMAP;
    if (pal === OT.data.allBlack) return BM.BLACK_REMAP;
    return BM.COLOUR_REMAP;
  }

  function recolour(pal) {
    return OT.data.recolour[pal] || OT.data.identity;
  }

  function setupPalette(img, pal) {
    if ((img >>> OT.TRANSPARENT_BIT) & 1) {
      pal &= 0xFFFFFF;
      remap = recolour(pal);
      return pal === OT.PALETTE_TO_TRANSPARENT ? BM.TRANSPARENT : BM.TRANSPARENT_REMAP;
    }
    if (pal !== OT.PAL_NONE) {
      if ((pal >>> OT.PALETTE_TEXT_RECOLOUR) & 1) {
        OT.setColourRemap(pal & 0xFFFFFF);
      } else {
        remap = recolour(pal & 0xFFFFFF);
      }
      return getBlitterMode(pal);
    }
    return BM.NORMAL;
  }

  /** DrawSpriteViewport : coordonnées à l'échelle ZOOM_BASE, zoom de la zone de dessin. */
  OT.drawSpriteViewport = function (img, pal, x, y, sub) {
    var spr = OT.data.sprites[img & OT.SPRITE_MASK];
    if (!spr) return;
    var mode = setupPalette(img >>> 0, pal >>> 0);
    gfxBlitter(spr, x, y, mode, sub, OT.dpi.zoom, OT.ZOOM_BASE, false);
  };

  /** DrawSprite : sprite de l'interface (zoom de l'interface, _gui_zoom). */
  OT.drawSprite = function (img, pal, x, y, sub, zoom) {
    var spr = OT.data.sprites[img & OT.SPRITE_MASK];
    if (!spr) return;
    var mode = setupPalette(img >>> 0, (pal || 0) >>> 0);
    gfxBlitter(spr, x, y, mode, sub || null, zoom === undefined ? OT.guiZoom : zoom, 1, true);
  };

  /** Dessin d'un glyphe de police (GfxMainBlitter, zoom Min, recoloriage du texte). */
  OT.drawGlyph = function (glyph, x, y) {
    remap = stringRemap;
    gfxBlitter(glyph, x, y, BM.COLOUR_REMAP, null, OT.Z.MIN, 1, true);
  };

  /** GetSpriteSize (zoom de l'interface) : dimensions et décalage. */
  OT.getSpriteSize = function (img, zoom) {
    zoom = zoom === undefined ? OT.guiZoom : zoom;
    var spr = OT.data.sprites[img & OT.SPRITE_MASK];
    if (!spr) return { width: 0, height: 0, x: 0, y: 0 };
    return {
      x: OT.unScaleByZoom(spr.xo, zoom), y: OT.unScaleByZoom(spr.yo, zoom),
      width: Math.max(0, OT.unScaleByZoom(spr.xo + spr.w, zoom)),
      height: Math.max(0, OT.unScaleByZoom(spr.yo + spr.h, zoom)),
    };
  };

  /** SetColourRemap : couleur d'un texte (index 1) et son ombre (index 2). */
  OT.setColourRemap = function (colour) {
    if (colour === OT.TC.INVALID) return;
    var noShade = (colour & OT.TC.NO_SHADE) !== 0 || colour === OT.TC.BLACK;
    var raw = (colour & OT.TC.IS_PALETTE_COLOUR) !== 0;
    colour &= ~(OT.TC.NO_SHADE | OT.TC.IS_PALETTE_COLOUR | OT.TC.FORCED);
    stringRemap[1] = raw ? colour : OT.data.stringColourmap[colour];
    stringRemap[2] = noShade ? 0 : 1;
    remap = stringRemap;
  };
  OT.stringRemap = stringRemap;

  // --- Rectangles ------------------------------------------------------------
  OT.FILLRECT = { OPAQUE: 0, CHECKER: 1, RECOLOUR: 2 };

  /** GfxFillRect (coordonnées de la zone de dessin courante, zoom Min). */
  OT.gfxFillRect = function (left, top, right, bottom, colour, mode) {
    var dpi = OT.dpi;
    var otop = top, oleft = left;
    if (dpi.zoom !== OT.Z.MIN) return;
    if (left > right || top > bottom) return;
    if (right < dpi.left || left >= dpi.left + dpi.width) return;
    if (bottom < dpi.top || top >= dpi.top + dpi.height) return;
    if ((left -= dpi.left) < 0) left = 0;
    right = right - dpi.left + 1;
    if (right > dpi.width) right = dpi.width;
    right -= left;
    if ((top -= dpi.top) < 0) top = 0;
    bottom = bottom - dpi.top + 1;
    if (bottom > dpi.height) bottom = dpi.height;
    bottom -= top;
    var buf = screen.buf, sw = screen.width;
    var x0 = dpi.x0 + left, y0 = dpi.y0 + top, x, y, d;
    switch (mode || 0) {
      case OT.FILLRECT.RECOLOUR: {
        var r = recolour(colour & 0xFFFFFF);
        for (y = 0; y < bottom; y++) {
          d = (y0 + y) * sw + x0;
          for (x = 0; x < right; x++) buf[d + x] = r[buf[d + x]];
        }
        break;
      }
      case OT.FILLRECT.CHECKER: {
        var bo = (oleft - left + dpi.left + otop - top + dpi.top) & 1;
        for (y = 0; y < bottom; y++) {
          bo ^= 1;
          d = (y0 + y) * sw + x0;
          for (x = bo; x < right; x += 2) buf[d + x] = colour;
        }
        break;
      }
      default:
        for (y = 0; y < bottom; y++) {
          d = (y0 + y) * sw + x0;
          buf.fill(colour, d, d + right);
        }
    }
  };

  OT.gradient = function (colour, shade) { return OT.data.colourGradient[colour][shade]; };

  /** DrawFrameRect (widget.cpp). flags : lowered, darkened, borderOnly. */
  OT.drawFrameRect = function (left, top, right, bottom, colour, flags) {
    flags = flags || {};
    var bevel = OT.data.widget.bevel;
    var dark = OT.gradient(colour, OT.SHADE.DARK);
    var medium_dark = OT.gradient(colour, OT.SHADE.LIGHT);
    var medium_light = OT.gradient(colour, OT.SHADE.LIGHTER);
    var light = OT.gradient(colour, OT.SHADE.LIGHTEST);
    var il = left + bevel[0], it = top + bevel[1], ir = right - bevel[2], ib = bottom - bevel[3];
    var interior;
    if (flags.lowered) {
      OT.gfxFillRect(left, top, il - 1, bottom, dark);
      OT.gfxFillRect(il, top, right, it - 1, dark);
      OT.gfxFillRect(ir + 1, it, right, ib, light);
      OT.gfxFillRect(il, ib + 1, right, bottom, light);
      interior = flags.darkened ? medium_dark : medium_light;
    } else {
      OT.gfxFillRect(left, top, il - 1, ib, light);
      OT.gfxFillRect(il, top, ir, it - 1, light);
      OT.gfxFillRect(ir + 1, top, right, ib, dark);
      OT.gfxFillRect(left, ib + 1, right, bottom, dark);
      interior = medium_dark;
    }
    if (!flags.borderOnly) OT.gfxFillRect(il, it, ir, ib, interior);
  };

  /** Décale une partie de l'écran (GfxScroll / Blitter::ScrollBuffer). */
  OT.gfxScroll = function (left, top, width, height, xo, yo) {
    if (xo === 0 && yo === 0) return;
    var buf = screen.buf, sw = screen.width, y;
    if (yo > 0) {
      for (y = height - 1; y >= yo; y--) moveRow(buf, sw, left, top + y - yo, top + y, width, xo);
    } else {
      for (y = 0; y < height + yo; y++) moveRow(buf, sw, left, top + y - yo, top + y, width, xo);
    }
  };
  function moveRow(buf, sw, left, sy, dy, width, xo) {
    var s = sy * sw + left, d = dy * sw + left;
    if (xo > 0) buf.copyWithin(d + xo, s, s + width - xo);
    else buf.copyWithin(d, s - xo, s + width);
  }
})();
