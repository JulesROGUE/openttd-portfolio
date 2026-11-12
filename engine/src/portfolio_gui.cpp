/*
 * This file is part of OpenTTD Portfolio, a modified version of OpenTTD.
 * OpenTTD is free software; you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, version 2.
 * OpenTTD is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details. You should have received a copy of the GNU General Public License along with OpenTTD. If not, see <https://www.gnu.org/licenses/old-licenses/gpl-2.0>.
 */

/**
 * @file portfolio_gui.cpp Fenêtres du portfolio de Jules ROGUE.
 *
 * Chaque ville de la carte est un projet. Ce fichier ajoute :
 *  - la fiche d'un projet, ouverte par un clic sur une maison (ou sur le nom) de sa ville ;
 *  - la fenêtre d'accueil, avec la liste des projets ;
 *  - la fenêtre des collaborateurs (tirés du champ « team » des données des projets) ;
 *  - le chargement différé des bruitages (OpenSFX) depuis la coquille web.
 * Les textes viennent de portfolio_data.h, généré depuis data/projects.json.
 */

#include "stdafx.h"
#include "window_gui.h"
#include "window_func.h"
#include "viewport_func.h"
#include "strings_func.h"
#include "gfx_func.h"
#include "town.h"
#include "town_map.h"
#include "road_map.h"
#include "tile_map.h"
#include "openttd.h"
#include "map_func.h"
#include "video/video_driver.hpp"
#include "zoom_func.h"
#include "base_media_base.h"
#include "base_media_sounds.h"
#include "sound_func.h"
#include "debug.h"
#include "landscape.h"
#include "tile_map.h"
#include "portfolio_gui.h"
#include "portfolio_data.h"
#include "table/strings.h"

#ifdef __EMSCRIPTEN__
#	include <emscripten.h>
#endif

#include "safeguards.h"

/** Projet représenté par une ville (même nom), ou nullptr. */
static const PortfolioProject *ProjectOfTown(const Town *t)
{
	if (t == nullptr) return nullptr;
	std::string name = GetString(STR_TOWN_NAME, t->index);
	for (const auto &p : _portfolio_projects) {
		if (p.title == name) return &p;
	}
	return nullptr;
}

/** Ville d'un projet (même nom), ou nullptr. */
static Town *TownOfProject(size_t index)
{
	if (index >= _portfolio_projects.size()) return nullptr;
	for (Town *t : Town::Iterate()) {
		if (GetString(STR_TOWN_NAME, t->index) == _portfolio_projects[index].title) return t;
	}
	return nullptr;
}

/** Un paragraphe de texte : couleur et contenu. */
struct PortfolioParagraph {
	TextColour colour;
	std::string text;
	int gap_before; ///< espace avant, en lignes / 2
};

/**
 * Dessine (ou mesure, si draw == false) une suite de paragraphes dans la largeur de r.
 * @return la hauteur utilisée
 */
static int DrawParagraphs(const Rect &r, const std::vector<PortfolioParagraph> &paragraphs, bool draw)
{
	int y = r.top;
	int half = GetCharacterHeight(FS_NORMAL) / 2;
	for (const auto &p : paragraphs) {
		y += p.gap_before * half;
		int h = GetStringHeight(p.text, r.Width());
		if (draw) DrawStringMultiLine(r.left, r.right, y, y + h, p.text, p.colour, SA_TOP | SA_LEFT);
		y += h;
	}
	return y - r.top;
}

/* ------------------------------------------------------------------------- */
/* Fiche d'un projet                                                         */
/* ------------------------------------------------------------------------- */

enum PortfolioProjectWidgets : WidgetID {
	WID_PP_CAPTION,
	WID_PP_VIEWPORT,
	WID_PP_TEXT,
	WID_PP_CENTER,
	WID_PP_LINK,
	WID_PP_COLLABORATORS,
};

static const int PORTFOLIO_TEXT_WIDTH = 420; ///< largeur du texte (pixels « traditionnels »)

static constexpr std::initializer_list<NWidgetPart> _nested_portfolio_project_widgets = {
	NWidget(NWID_HORIZONTAL),
		NWidget(WWT_CLOSEBOX, COLOUR_BROWN),
		NWidget(WWT_CAPTION, COLOUR_BROWN, WID_PP_CAPTION),
		NWidget(WWT_STICKYBOX, COLOUR_BROWN),
	EndContainer(),
	NWidget(WWT_PANEL, COLOUR_BROWN),
		NWidget(WWT_INSET, COLOUR_BROWN), SetPadding(2, 2, 2, 2),
			NWidget(NWID_VIEWPORT, INVALID_COLOUR, WID_PP_VIEWPORT), SetMinimalSize(PORTFOLIO_TEXT_WIDTH, 96), SetFill(1, 0),
		EndContainer(),
	EndContainer(),
	NWidget(WWT_PANEL, COLOUR_BROWN, WID_PP_TEXT), SetFill(1, 0), EndContainer(),
	NWidget(NWID_HORIZONTAL, NWidContainerFlag::EqualSize),
		NWidget(WWT_PUSHTXTBTN, COLOUR_BROWN, WID_PP_CENTER), SetFill(1, 1), SetStringTip(STR_PORTFOLIO_SHOW_ON_MAP, STR_PORTFOLIO_SHOW_ON_MAP_TOOLTIP),
		NWidget(WWT_PUSHTXTBTN, COLOUR_BROWN, WID_PP_LINK), SetFill(1, 1), SetStringTip(STR_PORTFOLIO_OPEN_LINK, STR_PORTFOLIO_OPEN_LINK_TOOLTIP),
		NWidget(WWT_PUSHTXTBTN, COLOUR_BROWN, WID_PP_COLLABORATORS), SetFill(1, 1), SetStringTip(STR_PORTFOLIO_COLLABORATORS, STR_PORTFOLIO_COLLABORATORS_TOOLTIP),
	EndContainer(),
};

static WindowDesc _portfolio_project_desc(
	WDP_AUTO, "portfolio_project", 0, 0,
	WC_PORTFOLIO_PROJECT, WC_NONE,
	{},
	_nested_portfolio_project_widgets
);

struct PortfolioProjectWindow : Window {
	const Town *town = nullptr;
	const PortfolioProject *project = nullptr;

	PortfolioProjectWindow(WindowDesc &desc, WindowNumber window_number) : Window(desc)
	{
		this->town = Town::Get(window_number);
		this->project = ProjectOfTown(this->town);
		this->InitNested(window_number);
		this->flags.Set(WindowFlag::DisableVpScroll);
		this->GetWidget<NWidgetViewport>(WID_PP_VIEWPORT)->InitializeViewport(this, this->town->xy, ScaleZoomGUI(ZoomLevel::Town));
		this->SetWidgetDisabledState(WID_PP_LINK, this->project == nullptr || this->project->link_url.empty());
	}

	std::vector<PortfolioParagraph> Paragraphs() const
	{
		std::vector<PortfolioParagraph> out;
		const PortfolioProject *p = this->project;
		if (p == nullptr) {
			out.push_back({TC_BLACK, "Cette ville ne correspond à aucun projet.", 0});
			return out;
		}
		out.push_back({TC_WHITE, std::string(p->subtitle), 0});
		out.push_back({TC_GOLD, std::string(p->type), 0});
		out.push_back({TC_BLACK, std::string(p->summary), 1});
		if (!p->highlights.empty()) {
			out.push_back({TC_ORANGE, "Points forts", 1});
			for (const auto &h : p->highlights) out.push_back({TC_BLACK, "- " + std::string(h), 0});
		}
		out.push_back({TC_ORANGE, "Technologies", 1});
		out.push_back({TC_BLACK, std::string(p->stack), 0});
		out.push_back({TC_ORANGE, "Équipe", 1});
		out.push_back({TC_BLACK, std::string(p->team), 0});
		if (!p->link_url.empty()) {
			out.push_back({TC_ORANGE, "Lien", 1});
			out.push_back({TC_BLACK, std::string(p->link_label) + " : " + std::string(p->link_url), 0});
		}
		if (!p->note.empty()) out.push_back({TC_GREY, std::string(p->note), 1});
		return out;
	}

	std::string GetWidgetString(WidgetID widget, StringID stringid) const override
	{
		if (widget == WID_PP_CAPTION) {
			return this->project != nullptr ? std::string(this->project->title) : GetString(STR_TOWN_NAME, this->town->index);
		}
		return this->Window::GetWidgetString(widget, stringid);
	}

	void UpdateWidgetSize(WidgetID widget, Dimension &size, [[maybe_unused]] const Dimension &padding, [[maybe_unused]] Dimension &fill, [[maybe_unused]] Dimension &resize) override
	{
		if (widget != WID_PP_TEXT) return;
		int width = ScaleGUITrad(PORTFOLIO_TEXT_WIDTH);
		Rect r{0, 0, width - 1, 0};
		size.width = std::max<uint>(size.width, width + WidgetDimensions::scaled.frametext.Horizontal());
		size.height = DrawParagraphs(r, this->Paragraphs(), false) + WidgetDimensions::scaled.frametext.Vertical() + WidgetDimensions::scaled.framerect.Vertical();
	}

	void DrawWidget(const Rect &r, WidgetID widget) const override
	{
		if (widget != WID_PP_TEXT) return;
		DrawParagraphs(r.Shrink(WidgetDimensions::scaled.frametext, WidgetDimensions::scaled.framerect), this->Paragraphs(), true);
	}

	void OnClick([[maybe_unused]] Point pt, WidgetID widget, [[maybe_unused]] int click_count) override
	{
		switch (widget) {
			case WID_PP_CENTER: ScrollMainWindowToTile(this->town->xy); break;
			case WID_PP_LINK: if (this->project != nullptr && !this->project->link_url.empty()) OpenBrowser(std::string(this->project->link_url)); break;
			case WID_PP_COLLABORATORS: ShowPortfolioCollaborators(); break;
		}
	}
};

void ShowPortfolioProject(TownID town)
{
	if (!Town::IsValidID(town)) return;
	AllocateWindowDescFront<PortfolioProjectWindow>(_portfolio_project_desc, town);
}

/* ------------------------------------------------------------------------- */
/* Accueil : présentation et liste des projets                               */
/* ------------------------------------------------------------------------- */

enum PortfolioWelcomeWidgets : WidgetID {
	WID_PW_CAPTION,
	WID_PW_INTRO,
	WID_PW_LIST,
	WID_PW_COLLABORATORS,
};

static constexpr std::initializer_list<NWidgetPart> _nested_portfolio_welcome_widgets = {
	NWidget(NWID_HORIZONTAL),
		NWidget(WWT_CLOSEBOX, COLOUR_BROWN),
		NWidget(WWT_CAPTION, COLOUR_BROWN, WID_PW_CAPTION),
		NWidget(WWT_SHADEBOX, COLOUR_BROWN),
		NWidget(WWT_STICKYBOX, COLOUR_BROWN),
	EndContainer(),
	NWidget(WWT_PANEL, COLOUR_BROWN, WID_PW_INTRO), SetFill(1, 0), EndContainer(),
	NWidget(WWT_PANEL, COLOUR_BROWN),
		NWidget(WWT_INSET, COLOUR_BROWN, WID_PW_LIST), SetPadding(2, 2, 2, 2), SetFill(1, 0), SetToolTip(STR_PORTFOLIO_PROJECT_LIST_TOOLTIP), EndContainer(),
	EndContainer(),
	NWidget(WWT_PUSHTXTBTN, COLOUR_BROWN, WID_PW_COLLABORATORS), SetFill(1, 1), SetStringTip(STR_PORTFOLIO_COLLABORATORS, STR_PORTFOLIO_COLLABORATORS_TOOLTIP),
};

static WindowDesc _portfolio_welcome_desc(
	WDP_MANUAL, "portfolio_welcome", 0, 0,
	WC_PORTFOLIO_WELCOME, WC_NONE,
	{},
	_nested_portfolio_welcome_widgets
);

static const char * const PORTFOLIO_INTRO =
	"Chaque ville de cette carte est un projet de Jules ROGUE (BTS SIO SLAM). "
	"Cliquez sur un bâtiment pour afficher le projet de sa ville.";
static const char * const PORTFOLIO_HELP =
	"Se déplacer : faire glisser la carte ou flèches du clavier. Zoom : molette.";

struct PortfolioWelcomeWindow : Window {
	int line_height = 0;

	PortfolioWelcomeWindow(WindowDesc &desc) : Window(desc)
	{
		this->InitNested(0);
		/* épinglée : la liste des projets reste ouverte quand on ferme les autres fenêtres */
		this->flags.Set(WindowFlag::Sticky);
	}

	Point OnInitialPosition([[maybe_unused]] int16_t sm_width, [[maybe_unused]] int16_t sm_height, [[maybe_unused]] int window_number) override
	{
		return { ScaleGUITrad(8), ScaleGUITrad(8) };
	}

	std::vector<PortfolioParagraph> Intro() const
	{
		return { {TC_BLACK, PORTFOLIO_INTRO, 0}, {TC_GREY, PORTFOLIO_HELP, 1} };
	}

	std::string GetWidgetString(WidgetID widget, StringID stringid) const override
	{
		if (widget == WID_PW_CAPTION) return "Portfolio de Jules ROGUE";
		return this->Window::GetWidgetString(widget, stringid);
	}

	void UpdateWidgetSize(WidgetID widget, Dimension &size, [[maybe_unused]] const Dimension &padding, [[maybe_unused]] Dimension &fill, [[maybe_unused]] Dimension &resize) override
	{
		int width = ScaleGUITrad(300);
		switch (widget) {
			case WID_PW_INTRO: {
				Rect r{0, 0, width - 1, 0};
				size.width = std::max<uint>(size.width, width + WidgetDimensions::scaled.frametext.Horizontal());
				size.height = DrawParagraphs(r, this->Intro(), false) + WidgetDimensions::scaled.frametext.Vertical() + WidgetDimensions::scaled.framerect.Vertical();
				break;
			}
			case WID_PW_LIST:
				this->line_height = GetCharacterHeight(FS_NORMAL) + WidgetDimensions::scaled.matrix.Vertical();
				size.height = this->line_height * static_cast<uint>(_portfolio_projects.size()) + WidgetDimensions::scaled.framerect.Vertical();
				break;
		}
	}

	void DrawWidget(const Rect &r, WidgetID widget) const override
	{
		switch (widget) {
			case WID_PW_INTRO:
				DrawParagraphs(r.Shrink(WidgetDimensions::scaled.frametext, WidgetDimensions::scaled.framerect), this->Intro(), true);
				break;

			case WID_PW_LIST: {
				Rect tr = r.Shrink(WidgetDimensions::scaled.framerect);
				int y = tr.top + WidgetDimensions::scaled.matrix.top;
				for (const auto &p : _portfolio_projects) {
					DrawString(tr.left + WidgetDimensions::scaled.hsep_normal, tr.right, y, std::string(p.title), TC_ORANGE);
					DrawString(tr.left, tr.right - WidgetDimensions::scaled.hsep_normal, y, std::string(p.type), TC_GREY, SA_RIGHT);
					y += this->line_height;
				}
				break;
			}
		}
	}

	void OnClick(Point pt, WidgetID widget, [[maybe_unused]] int click_count) override
	{
		switch (widget) {
			case WID_PW_LIST: {
				const NWidgetBase *nwid = this->GetWidget<NWidgetBase>(WID_PW_LIST);
				int row = (pt.y - nwid->pos_y - WidgetDimensions::scaled.framerect.top) / std::max(1, this->line_height);
				if (row < 0 || row >= static_cast<int>(_portfolio_projects.size())) break;
				Town *t = TownOfProject(row);
				if (t == nullptr) break;
				ScrollMainWindowToTile(t->xy);
				ShowPortfolioProject(t->index);
				break;
			}
			case WID_PW_COLLABORATORS: ShowPortfolioCollaborators(); break;
		}
	}
};

void ShowPortfolioWelcome()
{
	if (BringWindowToFrontById(WC_PORTFOLIO_WELCOME, 0)) return;
	new PortfolioWelcomeWindow(_portfolio_welcome_desc);
}

/* ------------------------------------------------------------------------- */
/* Collaborateurs                                                            */
/* ------------------------------------------------------------------------- */

enum PortfolioCollaboratorsWidgets : WidgetID {
	WID_PC_LIST,
};

static constexpr std::initializer_list<NWidgetPart> _nested_portfolio_collaborators_widgets = {
	NWidget(NWID_HORIZONTAL),
		NWidget(WWT_CLOSEBOX, COLOUR_BROWN),
		NWidget(WWT_CAPTION, COLOUR_BROWN), SetStringTip(STR_PORTFOLIO_COLLABORATORS_CAPTION, STR_TOOLTIP_WINDOW_TITLE_DRAG_THIS),
		NWidget(WWT_STICKYBOX, COLOUR_BROWN),
	EndContainer(),
	NWidget(WWT_PANEL, COLOUR_BROWN, WID_PC_LIST), SetFill(1, 0), SetToolTip(STR_PORTFOLIO_COLLABORATORS_LIST_TOOLTIP), EndContainer(),
};

static WindowDesc _portfolio_collaborators_desc(
	WDP_AUTO, "portfolio_collaborators", 0, 0,
	WC_PORTFOLIO_COLLABORATORS, WC_NONE,
	{},
	_nested_portfolio_collaborators_widgets
);

struct PortfolioCollaboratorsWindow : Window {
	std::vector<int> entry_top; ///< position (relative) du début de chaque collaborateur

	PortfolioCollaboratorsWindow(WindowDesc &desc) : Window(desc)
	{
		this->InitNested(0);
	}

	std::vector<PortfolioParagraph> Paragraphs() const
	{
		std::vector<PortfolioParagraph> out;
		out.push_back({TC_BLACK, "Les personnes qui ont réalisé un projet avec Jules ROGUE, telles qu'elles sont citées dans la fiche du projet.", 0});
		if (_portfolio_collaborators.empty()) out.push_back({TC_GREY, "Aucun collaborateur.", 1});
		for (const auto &c : _portfolio_collaborators) {
			const PortfolioProject &p = _portfolio_projects[c.project];
			out.push_back({TC_WHITE, std::string(c.name), 1});
			out.push_back({TC_BLACK, "Projet : " + std::string(p.title) + " (" + std::string(p.type) + ")", 0});
			out.push_back({TC_BLACK, "Équipe : " + std::string(p.team), 0});
		}
		return out;
	}

	void UpdateWidgetSize(WidgetID widget, Dimension &size, [[maybe_unused]] const Dimension &padding, [[maybe_unused]] Dimension &fill, [[maybe_unused]] Dimension &resize) override
	{
		if (widget != WID_PC_LIST) return;
		int width = ScaleGUITrad(320);
		Rect r{0, 0, width - 1, 0};
		size.width = std::max<uint>(size.width, width + WidgetDimensions::scaled.frametext.Horizontal());
		size.height = DrawParagraphs(r, this->Paragraphs(), false) + WidgetDimensions::scaled.frametext.Vertical() + WidgetDimensions::scaled.framerect.Vertical();
	}

	void DrawWidget(const Rect &r, WidgetID widget) const override
	{
		if (widget != WID_PC_LIST) return;
		DrawParagraphs(r.Shrink(WidgetDimensions::scaled.frametext, WidgetDimensions::scaled.framerect), this->Paragraphs(), true);
	}

	/** Un clic sur un collaborateur ouvre la fiche de son projet. */
	void OnClick(Point pt, WidgetID widget, [[maybe_unused]] int click_count) override
	{
		if (widget != WID_PC_LIST || _portfolio_collaborators.empty()) return;
		/* chaque collaborateur occupe trois paragraphes après l'introduction */
		const NWidgetBase *nwid = this->GetWidget<NWidgetBase>(WID_PC_LIST);
		Rect r{0, 0, static_cast<int>(nwid->current_x) - 1 - static_cast<int>(WidgetDimensions::scaled.frametext.Horizontal()), 0};
		auto paragraphs = this->Paragraphs();
		int y = nwid->pos_y + WidgetDimensions::scaled.frametext.top + WidgetDimensions::scaled.framerect.top;
		y += DrawParagraphs(r, {paragraphs[0]}, false);
		for (size_t i = 0; i < _portfolio_collaborators.size(); i++) {
			int h = DrawParagraphs(r, {paragraphs[1 + i * 3], paragraphs[2 + i * 3], paragraphs[3 + i * 3]}, false);
			if (pt.y >= y && pt.y < y + h) {
				Town *t = TownOfProject(_portfolio_collaborators[i].project);
				if (t != nullptr) {
					ScrollMainWindowToTile(t->xy);
					ShowPortfolioProject(t->index);
				}
				return;
			}
			y += h;
		}
	}
};

void ShowPortfolioCollaborators()
{
	if (BringWindowToFrontById(WC_PORTFOLIO_COLLABORATORS, 0)) return;
	new PortfolioCollaboratorsWindow(_portfolio_collaborators_desc);
}

/* ------------------------------------------------------------------------- */
/* Clics sur la carte, démarrage                                             */
/* ------------------------------------------------------------------------- */

bool PortfolioClickTile(TileIndex tile)
{
	if (_game_mode != GM_NORMAL) return false;
	if (IsTileType(tile, MP_HOUSE)) {
		ShowPortfolioProject(GetTownIndex(tile));
		return true;
	}
	return false;
}

void PortfolioAfterLoad()
{
	if (_game_mode != GM_NORMAL || !VideoDriver::GetInstance()->HasGUI()) return;

	/* Vue de départ : la ville centrale, un peu dézoomée. */
	Window *w = GetMainWindow();
	Town *center = TownOfProject(PORTFOLIO_CENTER_PROJECT);
	if (w != nullptr && w->viewport != nullptr) {
		while (w->viewport->zoom < ZoomLevel::Out2x && DoZoomInOutWindow(ZOOM_OUT, w)) {}
		ScrollMainWindowToTile(center != nullptr ? center->xy : TileXY(Map::SizeX() / 2, Map::SizeY() / 2), true);
	}
	ShowPortfolioWelcome();

#ifdef __EMSCRIPTEN__
	/* la coquille web masque l'écran de chargement */
	EM_ASM({ if (Module.onGameReady) Module.onGameReady(); });
#endif
}

#ifdef __EMSCRIPTEN__
/**
 * Appelé par la coquille web une fois OpenSFX copié dans /baseset/opensfx :
 * on relit les jeux de base et on passe aux bruitages d'OpenSFX.
 */
extern "C" EMSCRIPTEN_KEEPALIVE int pf_load_sounds()
{
	BaseSounds::FindSets();
	for (int i = 0; i < BaseSounds::GetNumSets(); i++) {
		const SoundsSet *set = BaseSounds::GetSet(i);
		if (set->name == "OpenSFX" && set->GetNumMissing() == 0) {
			ChangeSoundSet(i);
			Debug(misc, 0, "Bruitages : {}", set->name);
			return 1;
		}
	}
	Debug(misc, 0, "Bruitages : OpenSFX introuvable");
	return 0;
}
/**
 * Outils de test (scripts Playwright du dépôt) : position à l'écran d'une maison de la
 * ville d'un projet, et nombre de fiches de projet ouvertes.
 * @return (x << 16) | y en pixels du canvas, ou -1
 */
extern "C" EMSCRIPTEN_KEEPALIVE int pf_test_house_point(int project)
{
	Town *t = TownOfProject(project);
	Window *w = GetMainWindow();
	if (t == nullptr || w == nullptr || w->viewport == nullptr) return -1;
	const Viewport &vp = *w->viewport;
	TileIndex best = INVALID_TILE;
	uint bestd = UINT_MAX;
	for (TileIndex tile : Map::Iterate()) {
		if (!IsTileType(tile, MP_HOUSE) || GetTownIndex(tile) != t->index) continue;
		uint d = DistanceManhattan(tile, t->xy);
		if (d < bestd) { bestd = d; best = tile; }
	}
	if (best == INVALID_TILE) return -1;
	Point pt = RemapCoords(TileX(best) * TILE_SIZE + TILE_SIZE / 2, TileY(best) * TILE_SIZE + TILE_SIZE / 2, GetTileMaxZ(best) * TILE_HEIGHT);
	int x = UnScaleByZoom(pt.x - vp.virtual_left, vp.zoom) + vp.left;
	int y = UnScaleByZoom(pt.y - vp.virtual_top, vp.zoom) + vp.top;
	if (x < 0 || y < 0 || x >= _screen.width || y >= _screen.height) return -1;
	return (x << 16) | y;
}

extern "C" EMSCRIPTEN_KEEPALIVE int pf_test_project_windows()
{
	int n = 0;
	for (const Window *w : Window::Iterate()) {
		if (w->window_class == WC_PORTFOLIO_PROJECT) n++;
	}
	return n;
}
#endif
