/*
 * This file is part of OpenTTD Portfolio, a modified version of OpenTTD.
 * OpenTTD is free software; you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, version 2.
 * OpenTTD is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details. You should have received a copy of the GNU General Public License along with OpenTTD. If not, see <https://www.gnu.org/licenses/old-licenses/gpl-2.0>.
 */

/**
 * @file portfolio_viewport_export.inc Relevé des listes de dessin des vues (inclus à la fin
 * de viewport.cpp, pour accéder à ses données internes).
 *
 * OpenTTD Portfolio est rejoué en JavaScript dans le navigateur. Pendant le build, la version
 * native du moteur charge la carte et relève, pour chaque tuile, exactement ce que
 * ViewportAddLandscape() ajoute à la liste de dessin (sprites au sol, sprites triés avec leur
 * boîte englobante, sprites enfants), et de même pour les véhicules à chaque tick. Le moteur
 * JavaScript refait ensuite le tri et le dessin à l'identique (ViewportSortParentSprites,
 * ViewportDrawParentSprites).
 */

int PortfolioSubSpriteIndex(const SubSprite *sub);

/** Vide les listes de dessin de _vd dans out (format décrit dans portfolio_export.cpp). */
static void PortfolioDumpDrawLists(std::vector<int32_t> &out)
{
	out.push_back(static_cast<int32_t>(_vd.tile_sprites_to_draw.size()));
	for (const TileSpriteToDraw &ts : _vd.tile_sprites_to_draw) {
		out.insert(out.end(), { static_cast<int32_t>(ts.image), static_cast<int32_t>(ts.pal), PortfolioSubSpriteIndex(ts.sub), ts.x, ts.y });
	}
	out.push_back(static_cast<int32_t>(_vd.parent_sprites_to_draw.size()));
	for (const ParentSpriteToDraw &ps : _vd.parent_sprites_to_draw) {
		out.insert(out.end(), { static_cast<int32_t>(ps.image), static_cast<int32_t>(ps.pal), PortfolioSubSpriteIndex(ps.sub), ps.x, ps.y, ps.left, ps.top,
				ps.xmin, ps.xmax, ps.ymin, ps.ymax, ps.zmin, ps.zmax });
		size_t count_pos = out.size();
		out.push_back(0);
		int n = 0;
		for (int child = ps.first_child; child >= 0; child = _vd.child_screen_sprites_to_draw[child].next) {
			const ChildScreenSpriteToDraw &cs = _vd.child_screen_sprites_to_draw[child];
			out.insert(out.end(), { static_cast<int32_t>(cs.image), static_cast<int32_t>(cs.pal), PortfolioSubSpriteIndex(cs.sub), cs.x, cs.y, cs.relative ? 1 : 0 });
			n++;
		}
		out[count_pos] = n;
	}
	_vd.string_sprites_to_draw.clear();
	_vd.tile_sprites_to_draw.clear();
	_vd.parent_sprites_to_draw.clear();
	_vd.parent_sprites_to_sort.clear();
	_vd.child_screen_sprites_to_draw.clear();
}

/** Zone de dessin « infinie » : rien n'est écarté par le découpage, c'est le moteur JS qui découpe. */
static void PortfolioBeginCapture(ZoomLevel zoom)
{
	_vd.dpi = {};
	_vd.dpi.zoom = zoom;
	_vd.dpi.left = -(1 << 28);
	_vd.dpi.top = -(1 << 28);
	_vd.dpi.width = 1 << 29;
	_vd.dpi.height = 1 << 29;
	_vd.combine_sprites = SPRITE_COMBINE_NONE;
	_vd.last_child = LAST_CHILD_NONE;
}

/**
 * Relève la liste de dessin d'une tuile (dans la carte), comme ViewportAddLandscape().
 * @param x, y coordonnées de la tuile
 * @param zoom niveau de zoom (seuls les détails des routes en dépendent)
 */
void PortfolioCaptureTile(int x, int y, ZoomLevel zoom, std::vector<int32_t> &out)
{
	DrawPixelInfo *old_dpi = _cur_dpi;
	PortfolioBeginCapture(zoom);
	_cur_dpi = &_vd.dpi;

	_cur_ti.x = x * TILE_SIZE;
	_cur_ti.y = y * TILE_SIZE;
	_cur_ti.tile = TileXY(x, y);
	TileType tile_type = GetTileType(_cur_ti.tile);
	if (tile_type != MP_VOID) {
		std::tie(_cur_ti.tileh, _cur_ti.z) = GetTilePixelSlope(_cur_ti.tile);
	} else {
		std::tie(_cur_ti.tileh, _cur_ti.z) = GetTilePixelSlopeOutsideMap(x, y);
	}
	_vd.foundation_part = FOUNDATION_PART_NONE;
	_vd.foundation[0] = -1;
	_vd.foundation[1] = -1;
	_vd.last_foundation_child[0] = LAST_CHILD_NONE;
	_vd.last_foundation_child[1] = LAST_CHILD_NONE;
	_tile_type_procs[tile_type]->draw_tile_proc(&_cur_ti);

	PortfolioDumpDrawLists(out);
	_cur_dpi = old_dpi;
}

/** Relève les sprites de tous les véhicules (dans l'ordre de ViewportAddVehicles). */
void PortfolioCaptureVehicles(std::vector<int32_t> &out)
{
	DrawPixelInfo *old_dpi = _cur_dpi;
	PortfolioBeginCapture(ZoomLevel::Normal);
	_cur_dpi = &_vd.dpi;
	ViewportAddVehicles(&_vd.dpi);
	PortfolioDumpDrawLists(out);
	_cur_dpi = old_dpi;
}
