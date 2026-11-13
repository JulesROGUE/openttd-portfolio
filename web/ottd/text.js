/*
 * OpenTTD Portfolio — moteur JavaScript.
 * text.js : texte avec les polices d'OpenTTD (sprites d'OpenGFX) : découpage en lignes,
 * codes de couleur, troncature, alignement. Port de gfx_layout.cpp,
 * gfx_layout_fallback.cpp et des fonctions de texte de gfx.cpp (OpenTTD 15.3, GPL v2).
 */
'use strict';
var OT = window.OT || (window.OT = {});

(function () {
  var FS = OT.FS = { NORMAL: 0, SMALL: 1, LARGE: 2, MONO: 3 };
  var TC = OT.TC, SA = OT.SA;

  OT.getCharacterHeight = function (fs) { return OT.data.fonts[fs || 0].height; };

  /** Glyphe d'un caractère (0 si absent : le « ? » sera dessiné à la place). */
  function glyphOf(fs, c) {
    var f = OT.data.fonts[fs];
    var g = f.map.get(c);
    return g === undefined ? 0 : g;
  }
  /** SpriteFontCache::GetGlyphWidth : largeur au zoom de la police, + 1 (mis à l'échelle) hors police normale. */
  function glyphWidth(fs, sprite) {
    var f = OT.data.fonts[fs];
    if (sprite === 0) sprite = f.fallback;
    var g = OT.data.glyphs[sprite];
    if (!g) return 0;
    var k = 1 << (OT.Z.NORMAL - OT.fontZoom);
    return g.w * k + (fs !== FS.NORMAL ? k : 0);
  }
  var scaledGlyphs = Object.create(null), scaledZoom = -1;
  /** Glyphe au zoom de la police (zoom Min du sprite = _font_zoom). */
  function scaledGlyph(sprite) {
    if (scaledZoom !== OT.fontZoom) { scaledGlyphs = Object.create(null); scaledZoom = OT.fontZoom; }
    var g = scaledGlyphs[sprite];
    if (g) return g;
    var b = OT.data.glyphs[sprite];
    if (!b) return null;
    var sh = OT.Z.NORMAL - OT.fontZoom, k = 1 << sh;
    if (sh === 0) g = b;
    else g = { w: b.w * k, h: b.h * k, xo: b.xo * k, yo: b.yo * k, lv: [OT.enlargeLevel(b.lv[0], sh)] };
    scaledGlyphs[sprite] = g;
    return g;
  }
  OT.getCharacterWidth = function (fs, c) { return glyphWidth(fs, glyphOf(fs, c)); };

  function isPrintable(c) {
    if (c < 0x20) return false;
    if (c < 0xE000) return true;
    if (c < 0xE200) return false;
    return true;
  }
  function isTextDirectionChar(c) {
    return (c >= 0x200E && c <= 0x200F) || (c >= 0x202A && c <= 0x202E) || (c >= 0x2066 && c <= 0x2069);
  }

  /**
   * Découpe un paragraphe en « runs » (couleur, taille de police), comme GetLayouter :
   * renvoie { chars: [codes], runs: [{end, fs, colour}] } et l'état après le paragraphe.
   */
  function parseParagraph(str, state) {
    var scc = OT.data.scc;
    var chars = [];
    var runs = [];
    var font = { fs: state.fs, colour: state.colour };
    for (var ch of str) {
      var c = ch.codePointAt(0);
      if (c >= scc.blue && c <= scc.black) {
        if ((state.colour & TC.FORCED) === 0) state.colour = c - scc.blue;
      } else if (c === scc.push) {
        state.stack.push(state.colour);
      } else if (c === scc.pop) {
        if (state.stack.length) {
          var col = state.stack.pop();
          if ((state.colour & TC.FORCED) === 0) state.colour = col;
        }
      } else {
        if (!isPrintable(c)) continue;
        if (isTextDirectionChar(c)) continue;
        chars.push(c);
        continue;
      }
      if (!runs.length || runs[runs.length - 1].end !== chars.length) {
        runs.push({ end: chars.length, fs: font.fs, colour: font.colour });
      }
      font = { fs: state.fs, colour: state.colour };
    }
    if (!runs.length || runs[runs.length - 1].end !== chars.length) {
      runs.push({ end: chars.length, fs: font.fs, colour: font.colour });
    }
    return { chars: chars, runs: runs };
  }

  /** FallbackParagraphLayout::NextLine : lignes d'au plus maxw pixels. */
  function layoutParagraph(p, maxw) {
    var lines = [];
    var chars = p.chars, runs = p.runs;
    var pos = 0;
    if (chars.length === 0) {
      lines.push(makeLine([{ font: runs[0], start: 0, count: 0, x: 0 }]));
      return lines;
    }
    while (pos !== -1) {
      var l = [];
      var lineWidth = function () {
        if (!l.length) return 0;
        var r = l[l.length - 1];
        return r.right;
      };
      var ri = 0;
      while (runs[ri].end <= pos) ri++;
      var font = runs[ri];
      var nextRun = font.end;
      var begin = pos, lastSpace = -1, lastChar, width = 0;
      var b = pos;
      for (;;) {
        lastChar = b;
        if (b >= chars.length) { pos = -1; break; }
        var c = chars[b];
        if (b === nextRun) {
          l.push(makeRun(font, chars, begin, b - begin, lineWidth()));
          ri++;
          font = runs[ri];
          nextRun = font.end;
          begin = b;
          lastSpace = begin - 1;
        }
        if (c === 0x20 || c === 0x3000) lastSpace = b;
        width += glyphWidth(font.fs, glyphOf(font.fs, c));
        if (width > maxw) {
          if (width === glyphWidth(font.fs, glyphOf(font.fs, c))) { lines.push(makeLine(l)); return lines; }
          if (lastSpace === -1) {
            lastChar = b;
            pos = b;
          } else {
            pos = lastSpace + 1;
            lastChar = lastSpace;
          }
          break;
        }
        b++;
      }
      if (!l.length || lastChar - begin > 0) l.push(makeRun(font, chars, begin, lastChar - begin, lineWidth()));
      lines.push(makeLine(l));
    }
    return lines;
  }

  function makeRun(font, chars, start, count, x) {
    var glyphs = [], positions = [];
    var advance = x;
    var asc = OT.data.fonts[font.fs].ascender;
    for (var i = 0; i < count; i++) {
      var g = glyphOf(font.fs, chars[start + i]);
      var w = glyphWidth(font.fs, g);
      glyphs.push(g);
      positions.push([advance, advance + w - 1, asc]);
      advance += w;
    }
    return { font: font, glyphs: glyphs, positions: positions, right: count ? positions[count - 1][1] + 1 : x };
  }
  function makeLine(runs) {
    var leading = 0;
    for (var r of runs) leading = Math.max(leading, OT.data.fonts[r.font.fs].height);
    var width = 0;
    if (runs.length) {
      var last = runs[runs.length - 1];
      width = last.positions.length ? last.positions[last.positions.length - 1][1] + 1 : 0;
    }
    return { runs: runs, width: width, leading: leading };
  }

  /** Layouter : toutes les lignes d'un texte (paragraphes séparés par \n). */
  OT.layout = function (str, maxw, fs) {
    var state = { fs: fs || 0, colour: TC.INVALID, stack: [] };
    var lines = [];
    var paras = String(str).split('\n');
    for (var i = 0; i < paras.length; i++) {
      var p = parseParagraph(paras[i], state);
      var ls = p.chars.length === 0 ? [makeLine([{ font: p.runs[0], glyphs: [], positions: [], right: 0 }])] : layoutParagraph(p, maxw);
      for (var l of ls) lines.push(l);
    }
    return lines;
  };

  OT.getStringBoundingBox = function (str, fs) {
    var lines = OT.layout(str, 0x7FFFFFFF, fs || 0);
    var w = 0, h = 0;
    for (var l of lines) { w = Math.max(w, l.width); h += l.leading; }
    return { width: w, height: h };
  };

  OT.getStringHeight = function (str, maxw, fs) {
    var lines = OT.layout(str, maxw, fs || 0);
    var h = 0;
    for (var l of lines) h += l.leading;
    return h;
  };

  /** DrawLayoutLine : dessine une ligne (ombre puis texte), avec troncature éventuelle. */
  function drawLayoutLine(line, y, left, right, align, underline, truncation, defaultColour) {
    if (!line.runs.length) return 0;
    var w = line.width;
    var maxW = right - left + 1;
    var offsetX = 0, minX = left, maxX = right;
    truncation = truncation && maxW < w;
    var truncLine = null, truncW = 0;
    if (truncation) {
      truncLine = OT.layout(OT.data.strings.ellipsis, 0x7FFFFFFF, line.runs[0].font.fs)[0];
      truncW = truncLine.width;
      if (maxW < truncW) return right;
      maxX -= truncW;
      w = maxW;
    }
    switch (align & SA.HOR_MASK) {
      case SA.LEFT: right = left + w - 1; break;
      case SA.HOR_CENTER: left = OT.roundDivSU(right + 1 + left - w, 2); right = left + w - 1; break;
      case SA.RIGHT: left = right + 1 - w; break;
    }
    var drawLine = function (ln, doShadow, lft, mnx, mxx, trunc, initial) {
      var dpi = OT.dpi;
      var dpiLeft = dpi.left, dpiRight = dpi.left + dpi.width - 1;
      var last = initial;
      for (var run of ln.runs) {
        var colour = run.font.colour;
        if (colour === TC.INVALID || (initial & TC.FORCED)) colour = initial;
        last = colour;
        if (doShadow) continue; // les polices en sprites n'ont pas d'ombre séparée
        OT.setColourRemap(colour);
        for (var i = 0; i < run.glyphs.length; i++) {
          var g = run.glyphs[i];
          var bx = run.positions[i][0] + lft, ex = run.positions[i][1] + lft;
          var top = run.positions[i][2] + y;
          if (trunc && (bx < mnx || ex > mxx)) continue;
          var sprite = g === 0 ? OT.data.fonts[run.font.fs].fallback : g;
          var glyph = scaledGlyph(sprite);
          if (!glyph) continue;
          if (bx + glyph.xo > dpiRight || bx + glyph.xo + glyph.w < dpiLeft) continue;
          OT.drawGlyph(glyph, bx, top);
        }
      }
      return last;
    };
    for (var doShadow of [true, false]) {
      var colour = drawLine(line, doShadow, left - offsetX, minX, maxX, truncation, defaultColour);
      if (truncation) drawLine(truncLine, doShadow, right - truncW, -0x7FFFFFFF, 0x7FFFFFFF, false, colour);
    }
    if (underline) {
      OT.gfxFillRect(left, y + line.leading, right, y + line.leading + OT.data.widget.bevel[1] - 1, OT.stringRemap[1]);
    }
    return (align & SA.HOR_MASK) === SA.RIGHT ? left : right;
  }

  /** DrawString : une ligne, tronquée avec « ... » si elle dépasse. */
  OT.drawString = function (left, right, top, str, colour, align, underline, fs) {
    fs = fs || 0;
    align = align || 0;
    var maxH = OT.getCharacterHeight(FS.LARGE);
    var extra = maxH >> 1;
    var dpi = OT.dpi;
    if (dpi.top + dpi.height + extra < top || dpi.top > top + maxH + extra || dpi.left + dpi.width + extra < left || dpi.left > right + extra) return 0;
    var lines = OT.layout(str, 0x7FFFFFFF, fs);
    if (!lines.length) return 0;
    return drawLayoutLine(lines[0], top, left, right, align, !!underline, true, colour);
  };

  /** DrawStringMultiLine. */
  OT.drawStringMultiLine = function (left, right, top, bottom, str, colour, align, underline, fs) {
    align = align || 0;
    var maxw = right - left + 1;
    var maxh = bottom - top + 1;
    if (maxh <= 0) return top;
    var lines = OT.layout(str, maxw, fs || 0);
    var total = 0;
    for (var l of lines) total += l.leading;
    var y;
    switch (align & SA.VERT_MASK) {
      case SA.VERT_CENTER: y = OT.roundDivSU(bottom + top - total, 2); break;
      case SA.BOTTOM: y = bottom - total; break;
      default: y = top;
    }
    var lastLine = top, firstLine = bottom;
    for (var ln of lines) {
      var lh = ln.leading;
      if (y >= top && y + lh - 1 <= bottom) {
        lastLine = y + lh;
        if (firstLine > y) firstLine = y;
        drawLayoutLine(ln, y, left, right, align, !!underline, false, colour);
      }
      y += lh;
    }
    return (align & SA.VERT_MASK) === SA.BOTTOM ? firstLine : lastLine;
  };

  /** Lignes d'un texte avec leur largeur (pour les zones cliquables des liens). */
  OT.getStringLines = function (str, maxw, fs) { return OT.layout(str, maxw, fs || 0); };
})();
