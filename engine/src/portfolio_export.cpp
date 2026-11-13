/*
 * This file is part of OpenTTD Portfolio, a modified version of OpenTTD.
 * OpenTTD is free software; you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, version 2.
 * OpenTTD is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details. You should have received a copy of the GNU General Public License along with OpenTTD. If not, see <https://www.gnu.org/licenses/old-licenses/gpl-2.0>.
 */

/**
 * @file portfolio_export.cpp Extraction de la carte pour la version JavaScript d'OpenTTD Portfolio.
 *
 * Utilisé seulement pendant le build, par la version native sans affichage
 * (variable d'environnement OPENTTD_PORTFOLIO_EXPORT=<dossier>) :
 *  - listes de dessin de chaque tuile (voir portfolio_viewport_export.inc), aux deux
 *    niveaux de détail (les décors des routes disparaissent au-delà du zoom Out2x) ;
 *  - sprites utilisés (OpenGFX), décodés à chaque niveau de zoom exactement comme le
 *    moteur les prépare (ResizeSprites), tables de recoloriage, palette, polices ;
 *  - déroulé de la partie tick par tick : sprites des véhicules, tuiles qui changent,
 *    textes flottants (chargement, recettes), date et argent de la barre d'état ;
 *  - données du portfolio (projets, collaborateurs, visages) et dimensions de l'interface.
 * Le moteur JavaScript (web/ottd/*.js) rejoue tout cela à l'identique, sans WebAssembly.
 */

#include "stdafx.h"
#include "openttd.h"
#include "gfx_func.h"
#include "palette_func.h"
#include "spritecache.h"
#include "spriteloader/spriteloader.hpp"
#include "fontcache.h"
#include "strings_func.h"
#include "string_func.h"
#include "window_gui.h"
#include "map_func.h"
#include "tile_map.h"
#include "landscape.h"
#include "town.h"
#include "company_base.h"
#include "company_func.h"
#include "settings_type.h"
#include "timer/timer.h"
#include "timer/timer_game_tick.h"
#include "timer/timer_game_calendar.h"
#include "core/endian_func.hpp"
#include "zoom_func.h"
#include "bridge_map.h"
#include "table/sprites.h"
#include "table/strings.h"
#include "table/control_codes.h"
#include "table/string_colours.h"
#include "table/palettes.h"
#include "portfolio_export.h"

#include <fstream>
#include <map>
#include <cstdlib>

/* pas de safeguards.h : fichier utilisé seulement au build (fprintf, atoi, to_string). */

bool _pf_export_active = false;

void PortfolioCaptureTile(int x, int y, ZoomLevel zoom, std::vector<int32_t> &out);
void PortfolioCaptureVehicles(std::vector<int32_t> &out);

static std::string _pf_dir;
static int _pf_ticks_total = 0;
static int _pf_tick = 0;

/** Sous-sprites (zones partielles) rencontrés, par valeur. */
static std::vector<SubSprite> _pf_subs;

int PortfolioSubSpriteIndex(const SubSprite *sub)
{
	if (sub == nullptr) return -1;
	for (size_t i = 0; i < _pf_subs.size(); i++) {
		const SubSprite &s = _pf_subs[i];
		if (s.left == sub->left && s.top == sub->top && s.right == sub->right && s.bottom == sub->bottom) return static_cast<int>(i);
	}
	_pf_subs.push_back(*sub);
	return static_cast<int>(_pf_subs.size() - 1);
}

/* Sprites et palettes à exporter. */
static std::set<uint32_t> _pf_sprites;
static std::set<uint32_t> _pf_font_sprites;
static std::set<uint32_t> _pf_palettes;

static void CollectImage(uint32_t image, uint32_t pal)
{
	uint32_t sprite = GB(image, 0, SPRITE_WIDTH);
	if (sprite != SPR_EMPTY_BOUNDING_BOX) _pf_sprites.insert(sprite);
	if (HasBit(image, PALETTE_MODIFIER_TRANSPARENT)) {
		_pf_palettes.insert(GB(pal, 0, PALETTE_WIDTH));
	} else if (pal != PAL_NONE && !HasBit(pal, PALETTE_TEXT_RECOLOUR)) {
		_pf_palettes.insert(GB(pal, 0, PALETTE_WIDTH));
	}
}

/** Parcourt une liste de dessin (format de PortfolioDumpDrawLists) pour noter sprites et palettes. */
static void CollectDrawList(const std::vector<int32_t> &v, size_t pos = 0)
{
	int nt = v[pos++];
	for (int i = 0; i < nt; i++, pos += 5) CollectImage(v[pos], v[pos + 1]);
	int np = v[pos++];
	for (int i = 0; i < np; i++) {
		CollectImage(v[pos], v[pos + 1]);
		int nc = v[pos + 13];
		pos += 14;
		for (int c = 0; c < nc; c++, pos += 6) CollectImage(v[pos], v[pos + 1]);
	}
}

/* ------------------------------------------------------------------------- */
/* Sprites : décodage exact, à chaque zoom                                    */
/* ------------------------------------------------------------------------- */

/** Encodeur qui garde les pixels (index de palette) de chaque niveau de zoom. */
class PortfolioSpriteEncoder : public SpriteEncoder {
public:
	struct Level {
		int width = 0, height = 0, x_offs = 0, y_offs = 0;
		std::vector<uint8_t> pixels;
	};
	Level levels[to_underlying(ZoomLevel::End)];

	bool Is32BppSupported() override { return false; }

	Sprite *Encode([[maybe_unused]] SpriteType sprite_type, const SpriteLoader::SpriteCollection &sprite, SpriteAllocator &allocator) override
	{
		for (ZoomLevel z = ZoomLevel::Begin; z != ZoomLevel::End; z++) {
			const SpriteLoader::Sprite &s = sprite[z];
			Level &l = this->levels[to_underlying(z)];
			l.width = s.width;
			l.height = s.height;
			l.x_offs = s.x_offs;
			l.y_offs = s.y_offs;
			l.pixels.assign(static_cast<size_t>(s.width) * s.height, 0);
			if (s.data == nullptr) continue;
			for (size_t i = 0; i < l.pixels.size(); i++) {
				l.pixels[i] = s.data[i].a != 0 ? s.data[i].m : 0;
			}
		}
		const SpriteLoader::Sprite &root = sprite[ZoomLevel::Min];
		Sprite *s = allocator.Allocate<Sprite>(sizeof(Sprite));
		s->width = root.width;
		s->height = root.height;
		s->x_offs = root.x_offs;
		s->y_offs = root.y_offs;
		return s;
	}
};

/**
 * Écrit les sprites dans sprites.bin et leur index dans le JSON :
 * id: [w, h, x_offs, y_offs (zoom Min), puis pour chaque zoom exporté : largeur, hauteur, position dans le fichier].
 */
static void ExportSprites(PortfolioJson &json, std::vector<uint8_t> &bin)
{
	static const ZoomLevel zooms[] = { ZoomLevel::Normal, ZoomLevel::Out2x, ZoomLevel::Out4x };

	json.Key("sprites");
	json.Open('{');
	for (uint32_t id : _pf_sprites) {
		if (!SpriteExists(id) || GetSpriteType(id) != SpriteType::Normal) continue;
		PortfolioSpriteEncoder enc;
		UniquePtrSpriteAllocator alloc;
		const Sprite *s = static_cast<const Sprite *>(GetRawSprite(id, SpriteType::Normal, &alloc, &enc));
		json.Key(std::to_string(id));
		json.Open('[');
		json.Num(s->width); json.Num(s->height); json.Num(s->x_offs); json.Num(s->y_offs);
		for (ZoomLevel z : zooms) {
			const auto &l = enc.levels[to_underlying(z)];
			json.Num(l.width); json.Num(l.height); json.Num(static_cast<int64_t>(bin.size()));
			bin.insert(bin.end(), l.pixels.begin(), l.pixels.end());
		}
		json.Close(']');
	}
	json.Close('}');

	/* Glyphes : seul le zoom « Min » existe (c'est le zoom de la police). */
	json.Key("glyphs");
	json.Open('{');
	for (uint32_t id : _pf_font_sprites) {
		if (!SpriteExists(id) || GetSpriteType(id) != SpriteType::Font) continue;
		PortfolioSpriteEncoder enc;
		UniquePtrSpriteAllocator alloc;
		GetRawSprite(id, SpriteType::Font, &alloc, &enc);
		const auto &l = enc.levels[to_underlying(ZoomLevel::Min)];
		json.Key(std::to_string(id));
		json.Open('[');
		json.Num(l.width); json.Num(l.height); json.Num(l.x_offs); json.Num(l.y_offs); json.Num(static_cast<int64_t>(bin.size()));
		bin.insert(bin.end(), l.pixels.begin(), l.pixels.end());
		json.Close(']');
	}
	json.Close('}');

	json.Key("recolour");
	json.Open('{');
	for (uint32_t pal : _pf_palettes) {
		if (!SpriteExists(pal) || GetSpriteType(pal) != SpriteType::Recolour) continue;
		const uint8_t *remap = GetNonSprite(pal, SpriteType::Recolour) + 1;
		json.Key(std::to_string(pal));
		json.Open('[');
		for (int i = 0; i < 256; i++) json.Num(remap[i]);
		json.Close(']');
	}
	json.Close('}');

	json.Key("subsprites");
	json.Open('[');
	for (const SubSprite &s : _pf_subs) {
		json.Open('[');
		json.Num(s.left); json.Num(s.top); json.Num(s.right); json.Num(s.bottom);
		json.Close(']');
	}
	json.Close(']');
}

/** Polices : correspondance caractère -> glyphe, largeurs, hauteurs. */
static void ExportFonts(PortfolioJson &json)
{
	json.Key("fonts");
	json.Open('[');
	for (FontSize fs = FS_BEGIN; fs < FS_END; fs++) {
		FontCache *fc = FontCache::Get(fs);
		json.Open('{');
		json.Key("height"); json.Num(GetCharacterHeight(fs));
		json.Key("ascender"); json.Num(fc->GetAscender());
		json.Key("map");
		json.Open('[');
		for (char32_t c = 0x20; c < 0xF900; c++) {
			if (!IsPrintable(c)) continue;
			GlyphID g = fc->MapCharToGlyph(c, false);
			if (g == 0) continue;
			uint32_t sprite = g & ~SPRITE_GLYPH;
			json.Num(c); json.Num(sprite); json.Num(fc->GetGlyphWidth(g));
			_pf_font_sprites.insert(sprite);
		}
		json.Close(']');
		/* glyphe de remplacement (« ? ») */
		json.Key("fallback"); json.Num(fc->MapCharToGlyph('?', false) & ~SPRITE_GLYPH);
		json.Close('}');
	}
	json.Close(']');
}

/* ------------------------------------------------------------------------- */
/* Déroulé de la partie                                                      */
/* ------------------------------------------------------------------------- */

static std::vector<std::vector<int32_t>> _pf_tiles_normal; ///< liste de dessin de chaque tuile (zoom <= Detail)
static std::vector<std::vector<int32_t>> _pf_tiles_far;    ///< idem au-delà (vide si identique)
static std::set<uint32_t> _pf_dirty_tiles;

/** Événements de la partie (JSON), dans l'ordre des ticks. */
static PortfolioJson _pf_events;
/** Véhicules : différences d'un tick à l'autre (entiers). */
static std::vector<int32_t> _pf_vehicles;
static std::vector<int32_t> _pf_vehicles_prev;

static std::string _pf_status_date, _pf_status_money, _pf_status_middle;

static void CaptureTilePair(uint32_t tile, std::vector<int32_t> &normal, std::vector<int32_t> &far)
{
	int x = TileX(TileIndex{tile}), y = TileY(TileIndex{tile});
	normal.clear();
	far.clear();
	PortfolioCaptureTile(x, y, ZoomLevel::Normal, normal);
	PortfolioCaptureTile(x, y, ZoomLevel::Out4x, far);
	if (far == normal) far.clear();
}

/** Écrit une liste de dessin dans le flux binaire : longueur puis entiers. */
static void AppendList(std::vector<int32_t> &out, const std::vector<int32_t> &list)
{
	out.push_back(static_cast<int32_t>(list.size()));
	out.insert(out.end(), list.begin(), list.end());
}

static std::vector<int32_t> _pf_tile_changes; ///< (tick, tuile, liste normale, liste lointaine)

void PortfolioExportTileDirty(uint32_t tile)
{
	if (!_pf_export_active || tile >= Map::Size()) return;
	_pf_dirty_tiles.insert(tile);
}

void PortfolioExportTextEffect(int kind, unsigned id, int mode, int center, int top, int width_normal, int width_small, int duration, const std::string &text)
{
	if (!_pf_export_active) return;
	_pf_events.Open('[');
	_pf_events.Num(_pf_tick);
	_pf_events.Str(kind == 0 ? "te_add" : (kind == 1 ? "te_update" : "te_remove"));
	_pf_events.Num(id);
	if (kind != 2) {
		_pf_events.Num(mode);
		_pf_events.Num(center);
		_pf_events.Num(top);
		_pf_events.Num(width_normal);
		_pf_events.Num(width_small);
		_pf_events.Num(duration);
		_pf_events.Str(text);
	}
	_pf_events.Close(']');
}

static void CaptureStatus()
{
	std::string date = GetString(STR_JUST_DATE_LONG, TimerGameCalendar::date);
	std::string money;
	const Company *c = Company::GetIfValid(_local_company);
	if (c != nullptr) money = GetString(STR_JUST_CURRENCY_LONG, c->money);
	std::string middle = Company::IsValidID(_local_company) ? GetString(STR_STATUSBAR_COMPANY_NAME, _local_company) : std::string{};
	auto emit = [&](const char *what, std::string &prev, const std::string &now) {
		if (now == prev) return;
		prev = now;
		_pf_events.Open('[');
		_pf_events.Num(_pf_tick);
		_pf_events.Str(what);
		_pf_events.Str(now);
		_pf_events.Close(']');
	};
	emit("date", _pf_status_date, date);
	emit("money", _pf_status_money, money);
	emit("middle", _pf_status_middle, middle);
}

/** Véhicules du tick courant : la liste complète au tick 0, ensuite les seules différences. */
static void CaptureVehicles()
{
	std::vector<int32_t> now;
	PortfolioCaptureVehicles(now);
	CollectDrawList(now);
	if (now.size() != _pf_vehicles_prev.size()) {
		_pf_vehicles.push_back(-1); // liste complète
		AppendList(_pf_vehicles, now);
	} else {
		std::vector<int32_t> diff;
		for (size_t i = 0; i < now.size(); i++) {
			if (now[i] != _pf_vehicles_prev[i]) {
				diff.push_back(static_cast<int32_t>(i));
				diff.push_back(now[i] - _pf_vehicles_prev[i]);
			}
		}
		_pf_vehicles.push_back(static_cast<int32_t>(diff.size() / 2));
		_pf_vehicles.insert(_pf_vehicles.end(), diff.begin(), diff.end());
	}
	_pf_vehicles_prev = std::move(now);
}

static void CaptureDirtyTiles()
{
	std::vector<int32_t> normal, far;
	for (uint32_t tile : _pf_dirty_tiles) {
		CaptureTilePair(tile, normal, far);
		if (normal == _pf_tiles_normal[tile] && far == _pf_tiles_far[tile]) continue;
		_pf_tiles_normal[tile] = normal;
		_pf_tiles_far[tile] = far;
		CollectDrawList(normal);
		if (!far.empty()) CollectDrawList(far);
		_pf_tile_changes.push_back(_pf_tick);
		_pf_tile_changes.push_back(static_cast<int32_t>(tile));
		AppendList(_pf_tile_changes, normal);
		AppendList(_pf_tile_changes, far);
	}
	_pf_dirty_tiles.clear();
}

static void WriteFile(const std::string &name, const void *data, size_t size)
{
	std::ofstream f(_pf_dir + "/" + name, std::ios::binary);
	f.write(static_cast<const char *>(data), size);
}

static void WriteInts(std::vector<uint8_t> &bin, const std::vector<int32_t> &v)
{
	for (int32_t x : v) {
		uint32_t u = static_cast<uint32_t>(x);
		bin.push_back(u & 0xFF); bin.push_back((u >> 8) & 0xFF); bin.push_back((u >> 16) & 0xFF); bin.push_back((u >> 24) & 0xFF);
	}
}

static void ExportGui(PortfolioJson &json)
{
	const WidgetDimensions &wd = WidgetDimensions::scaled;
	json.Key("widget");
	json.Open('{');
	auto pad = [&](const char *name, const RectPadding &p) {
		json.Key(name);
		json.Open('[');
		json.Num(p.left); json.Num(p.top); json.Num(p.right); json.Num(p.bottom);
		json.Close(']');
	};
	pad("imgbtn", wd.imgbtn); pad("inset", wd.inset); pad("bevel", wd.bevel); pad("fullbevel", wd.fullbevel);
	pad("framerect", wd.framerect); pad("frametext", wd.frametext); pad("matrix", wd.matrix);
	pad("shadebox", wd.shadebox); pad("stickybox", wd.stickybox); pad("closebox", wd.closebox);
	pad("captiontext", wd.captiontext); pad("modalpopup", wd.modalpopup);
	json.Key("vsep_normal"); json.Num(wd.vsep_normal);
	json.Key("vsep_wide"); json.Num(wd.vsep_wide);
	json.Key("hsep_normal"); json.Num(wd.hsep_normal);
	json.Key("hsep_wide"); json.Num(wd.hsep_wide);
	json.Close('}');

	json.Key("gui_scale"); json.Num(_gui_scale);

	json.Key("colour_gradient");
	json.Open('[');
	for (int c = 0; c < COLOUR_END; c++) {
		json.Open('[');
		for (int s = 0; s < SHADE_END; s++) json.Num(GetColourGradient(static_cast<Colours>(c), static_cast<ColourShade>(s)).p);
		json.Close(']');
	}
	json.Close(']');

	json.Key("string_colourmap");
	json.Open('[');
	for (const PixelColour &pc : _string_colourmap) json.Num(pc.p);
	json.Close(']');

	json.Key("scc");
	json.Open('{');
	json.Key("blue"); json.Num(SCC_BLUE);
	json.Key("black"); json.Num(SCC_BLACK);
	json.Key("push"); json.Num(SCC_PUSH_COLOUR);
	json.Key("pop"); json.Num(SCC_POP_COLOUR);
	json.Key("tiny"); json.Num(SCC_TINYFONT);
	json.Key("big"); json.Num(SCC_BIGFONT);
	json.Close('}');

	json.Key("palette");
	json.Open('[');
	for (int i = 0; i < 256; i++) {
		json.Num(_palette.palette[i].r); json.Num(_palette.palette[i].g); json.Num(_palette.palette[i].b);
	}
	json.Close(']');

	/* Tables de l'animation de la palette (eau, phares...) */
	const ExtraPaletteValues &ev = _extra_palette_values;
	auto colours = [&](const char *name, const Colour *c, int n) {
		json.Key(name);
		json.Open('[');
		for (int i = 0; i < n; i++) { json.Num(c[i].r); json.Num(c[i].g); json.Num(c[i].b); }
		json.Close(']');
	};
	json.Key("palette_anim");
	json.Open('{');
	colours("dark_water", ev.dark_water, EPV_CYCLES_DARK_WATER);
	colours("lighthouse", ev.lighthouse, EPV_CYCLES_LIGHTHOUSE);
	colours("oil_refinery", ev.oil_refinery, EPV_CYCLES_OIL_REFINERY);
	colours("fizzy_drink", ev.fizzy_drink, EPV_CYCLES_FIZZY_DRINK);
	colours("glitter_water", ev.glitter_water, EPV_CYCLES_GLITTER_WATER);
	json.Key("start"); json.Num(PALETTE_ANIM_START);
	json.Key("size"); json.Num(PALETTE_ANIM_SIZE);
	json.Close('}');

	/* Sprites de l'interface */
	static const SpriteID gui_sprites[] = { SPR_CURSOR_MOUSE, SPR_PIN_UP, SPR_PIN_DOWN, SPR_WINDOW_SHADE, SPR_WINDOW_UNSHADE,
			SPR_CLOSEBOX, SPR_GRADIENT, SPR_UNREAD_NEWS, SPR_WINDOW_RESIZE_LEFT, SPR_WINDOW_RESIZE_RIGHT };
	json.Key("gui_sprites");
	json.Open('{');
	json.Key("cursor"); json.Num(SPR_CURSOR_MOUSE);
	json.Key("pin_up"); json.Num(SPR_PIN_UP);
	json.Key("pin_down"); json.Num(SPR_PIN_DOWN);
	json.Key("shade"); json.Num(SPR_WINDOW_SHADE);
	json.Key("unshade"); json.Num(SPR_WINDOW_UNSHADE);
	json.Key("closebox"); json.Num(SPR_CLOSEBOX);
	json.Key("gradient"); json.Num(SPR_GRADIENT);
	json.Key("empty_bbox"); json.Num(SPR_EMPTY_BOUNDING_BOX);
	json.Close('}');
	for (SpriteID s : gui_sprites) _pf_sprites.insert(s);

	json.Key("strings");
	json.Open('{');
	auto str = [&](const char *name, StringID id) { json.Key(name); json.Str(GetString(id)); };
	str("close_window", STR_TOOLTIP_CLOSE_WINDOW);
	str("caption_drag", STR_TOOLTIP_WINDOW_TITLE_DRAG_THIS);
	str("shade", STR_TOOLTIP_SHADE);
	str("sticky", STR_TOOLTIP_STICKY);
	str("statusbar_news", STR_STATUSBAR_TOOLTIP_SHOW_LAST_NEWS);
	str("show_on_map", STR_PORTFOLIO_SHOW_ON_MAP);
	str("show_on_map_tip", STR_PORTFOLIO_SHOW_ON_MAP_TOOLTIP);
	str("open_link", STR_PORTFOLIO_OPEN_LINK);
	str("open_link_tip", STR_PORTFOLIO_OPEN_LINK_TOOLTIP);
	str("collaborators", STR_PORTFOLIO_COLLABORATORS);
	str("collaborators_tip", STR_PORTFOLIO_COLLABORATORS_TOOLTIP);
	str("collaborators_caption", STR_PORTFOLIO_COLLABORATORS_CAPTION);
	str("collaborators_list_tip", STR_PORTFOLIO_COLLABORATORS_LIST_TOOLTIP);
	str("open_project", STR_PORTFOLIO_OPEN_PROJECT);
	str("open_project_tip", STR_PORTFOLIO_OPEN_PROJECT_TOOLTIP);
	str("project_list_tip", STR_PORTFOLIO_PROJECT_LIST_TOOLTIP);
	str("ellipsis", STR_TRUNCATION_ELLIPSIS);
	json.Close('}');
}

static void ExportMap(PortfolioJson &json, std::vector<uint8_t> &bin)
{
	json.Key("map");
	json.Open('{');
	json.Key("size_x"); json.Num(Map::SizeX());
	json.Key("size_y"); json.Num(Map::SizeY());
	json.Key("max_bridge_height"); json.Num(_settings_game.construction.max_bridge_height);
	json.Key("map_height_limit"); json.Num(_settings_game.construction.map_height_limit);
	json.Key("freeform_edges"); json.Bool(_settings_game.construction.freeform_edges);
	json.Key("loading_indicators"); json.Num(_settings_client.gui.loading_indicators);

	/* Par tuile : type, hauteur (TileHeight), pente et z en pixels, hauteur de pont au-dessus (-1 sinon), ville d'une maison. */
	std::vector<int32_t> info;
	for (TileIndex t : Map::Iterate()) {
		auto [tileh, z] = GetTilePixelSlope(t);
		int bridge = -1;
		if (IsBridgeAbove(t)) bridge = ZOOM_BASE * (GetBridgePixelHeight(GetNorthernBridgeEnd(t)) - TilePixelHeight(t));
		int town = IsTileType(t, MP_HOUSE) ? GetTownIndex(t).base() : -1;
		info.insert(info.end(), { static_cast<int32_t>(GetTileType(t)), static_cast<int32_t>(TileHeight(t)), static_cast<int32_t>(tileh), z, bridge, town });
	}
	json.Key("tile_info_offset"); json.Num(static_cast<int64_t>(bin.size()));
	WriteInts(bin, info);

	/* Altitude au pixel près (GetSlopePixelZ), pour retrouver la tuile sous la souris. */
	std::vector<uint8_t> heights;
	int w = Map::SizeX() * TILE_SIZE, h = Map::SizeY() * TILE_SIZE;
	int maxz = 0;
	std::vector<int> zs(static_cast<size_t>(w) * h);
	for (int y = 0; y < h; y++) {
		for (int x = 0; x < w; x++) {
			int z = GetSlopePixelZOutsideMap(x, y);
			zs[static_cast<size_t>(y) * w + x] = z;
			maxz = std::max(maxz, z);
		}
	}
	json.Key("pixel_z_offset"); json.Num(static_cast<int64_t>(bin.size()));
	json.Key("pixel_z_bytes"); json.Num(maxz < 256 ? 1 : 2);
	for (int z : zs) {
		bin.push_back(z & 0xFF);
		if (maxz >= 256) bin.push_back((z >> 8) & 0xFF);
	}
	while (bin.size() % 4 != 0) bin.push_back(0);

	/* Altitudes hors de la carte, pour les tuiles « vides » (noires) du bord. */
	json.Key("outside");
	json.Open('[');
	for (int y = -1; y <= static_cast<int>(Map::SizeY()); y++) {
		for (int x = -1; x <= static_cast<int>(Map::SizeX()); x++) {
			if (x >= 0 && y >= 0 && x < static_cast<int>(Map::SizeX()) && y < static_cast<int>(Map::SizeY())) continue;
			auto [tileh, z] = GetTilePixelSlopeOutsideMap(x, y);
			json.Num(x); json.Num(y); json.Num(tileh); json.Num(z);
		}
	}
	json.Close(']');
	json.Key("void_sprite"); json.Num(SPR_FLAT_BARE_LAND);
	json.Key("all_black"); json.Num(PALETTE_ALL_BLACK);
	_pf_palettes.insert(PALETTE_ALL_BLACK);
	for (int i = 0; i < 19; i++) _pf_sprites.insert(SPR_FLAT_BARE_LAND + i);
	json.Close('}');
	{
		extern const uint8_t _slope_to_sprite_offset[32];
		json.Key("slope_to_sprite_offset");
		json.Open('[');
		for (int i = 0; i < 32; i++) json.Num(_slope_to_sprite_offset[i]);
		json.Close(']');
	}

	/* Villes : nom et panneau (centre, haut, largeurs). */
	json.Key("towns");
	json.Open('[');
	for (const Town *t : Town::Iterate()) {
		json.Open('{');
		json.Key("id"); json.Num(t->index.base());
		json.Key("name"); json.Str(GetString(STR_TOWN_NAME, t->index));
		json.Key("label"); json.Str(GetString(t->larger_town ? STR_VIEWPORT_TOWN_CITY : STR_TOWN_NAME, t->index, t->cache.population));
		json.Key("label_small"); json.Str(GetString(STR_TOWN_NAME, t->index, t->cache.population));
		json.Key("x"); json.Num(TileX(t->xy));
		json.Key("y"); json.Num(TileY(t->xy));
		json.Key("sign");
		json.Open('[');
		json.Num(t->cache.sign.center); json.Num(t->cache.sign.top); json.Num(t->cache.sign.width_normal); json.Num(t->cache.sign.width_small);
		json.Close(']');
		json.Close('}');
	}
	json.Close(']');
}

static void WriteAll()
{
	std::vector<uint8_t> bin;
	PortfolioJson json;
	json.Open('{');
	json.Key("ticks"); json.Num(_pf_ticks_total);

	ExportMap(json, bin);

	/* Listes de dessin initiales */
	std::vector<int32_t> tiles;
	for (size_t i = 0; i < _pf_tiles_normal.size(); i++) {
		AppendList(tiles, _pf_tiles_normal[i]);
		AppendList(tiles, _pf_tiles_far[i]);
	}
	json.Key("tiles_offset"); json.Num(static_cast<int64_t>(bin.size()));
	json.Key("tiles_length"); json.Num(static_cast<int64_t>(tiles.size()));
	WriteInts(bin, tiles);

	json.Key("tile_changes_offset"); json.Num(static_cast<int64_t>(bin.size()));
	json.Key("tile_changes_length"); json.Num(static_cast<int64_t>(_pf_tile_changes.size()));
	WriteInts(bin, _pf_tile_changes);

	json.Key("vehicles_offset"); json.Num(static_cast<int64_t>(bin.size()));
	json.Key("vehicles_length"); json.Num(static_cast<int64_t>(_pf_vehicles.size()));
	WriteInts(bin, _pf_vehicles);

	_pf_events.Close(']');
	json.Key("events"); json.Raw(_pf_events.out);

	PortfolioExportData(json, _pf_sprites, _pf_palettes);
	ExportGui(json);
	ExportFonts(json);

	std::vector<uint8_t> sprites_bin;
	ExportSprites(json, sprites_bin);
	json.Close('}');

	WriteFile("world.bin", bin.data(), bin.size());
	WriteFile("sprites.bin", sprites_bin.data(), sprites_bin.size());
	WriteFile("world.json", json.out.data(), json.out.size());
	fprintf(stderr, "[portfolio-export] %d ticks, world.bin %zu octets, sprites.bin %zu octets, world.json %zu octets, %zu sprites\n",
			_pf_ticks_total, bin.size(), sprites_bin.size(), json.out.size(), _pf_sprites.size());
	_pf_export_active = false;
}

bool PortfolioExportRequested()
{
	return getenv("OPENTTD_PORTFOLIO_EXPORT") != nullptr;
}

/** Appelé après le chargement de la carte (PortfolioAfterLoad), tick 0. */
void PortfolioExportStart()
{
	_pf_dir = getenv("OPENTTD_PORTFOLIO_EXPORT");
	const char *ticks = getenv("OPENTTD_PORTFOLIO_EXPORT_TICKS");
	_pf_ticks_total = ticks != nullptr ? atoi(ticks) : 1000;
	_pf_export_active = true;
	_pf_tick = 0;
	_pf_events.Open('[');

	_pf_tiles_normal.assign(Map::Size(), {});
	_pf_tiles_far.assign(Map::Size(), {});
	for (TileIndex t : Map::Iterate()) {
		CaptureTilePair(t.base(), _pf_tiles_normal[t.base()], _pf_tiles_far[t.base()]);
		CollectDrawList(_pf_tiles_normal[t.base()]);
		if (!_pf_tiles_far[t.base()].empty()) CollectDrawList(_pf_tiles_far[t.base()]);
	}
	_pf_dirty_tiles.clear();
	CaptureStatus();
	CaptureVehicles();
	fprintf(stderr, "[portfolio-export] carte relevée (%u tuiles), enregistrement de %d ticks\n", Map::Size(), _pf_ticks_total);
}

/** Après chaque tick de la partie. */
static const IntervalTimer<TimerGameTick> _pf_tick_timer = { { TimerGameTick::Priority::NONE, 1 }, [](auto) {
	if (!_pf_export_active) return;
	_pf_tick++;
	CaptureDirtyTiles();
	CaptureVehicles();
	CaptureStatus();
	if (_pf_tick >= _pf_ticks_total) WriteAll();
}};
