/*
 * This file is part of OpenTTD Portfolio, a modified version of OpenTTD.
 * OpenTTD is free software; you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, version 2.
 * OpenTTD is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details. You should have received a copy of the GNU General Public License along with OpenTTD. If not, see <https://www.gnu.org/licenses/old-licenses/gpl-2.0>.
 */

/** @file portfolio_gui.h Fenêtres du portfolio (fiche d'un projet, accueil, collaborateurs). */

#ifndef PORTFOLIO_GUI_H
#define PORTFOLIO_GUI_H

#include "town_type.h"
#include "tile_type.h"

void ShowPortfolioProject(TownID town);
void ShowPortfolioWelcome();
void ShowPortfolioCollaborators();
bool PortfolioClickTile(TileIndex tile);
void PortfolioAfterLoad();

#endif /* PORTFOLIO_GUI_H */
