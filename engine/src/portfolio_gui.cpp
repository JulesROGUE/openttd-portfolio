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
 *  - les données relevées pour la version JavaScript (mises en page, visages, textes).
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
#include "debug.h"
#include "company_manager_face.h"
#include "core/random_func.hpp"
#include "core/geometry_func.hpp"
#include "table/sprites.h"
#include "landscape.h"
#include "tile_map.h"
#include "portfolio_gui.h"
#include "portfolio_data.h"
#include "portfolio_export.h"
#include "statusbar_gui.h"
#include "fontcache.h"
#include "gfx_func.h"
#include "company_base.h"
#include "timer/timer_game_calendar.h"
#include <map>
#include "table/strings.h"

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
	std::string url{}; ///< lien ouvert au clic (http/https des données), sinon vide
};

/** Zone cliquable d'un lien, en coordonnées de la fenêtre. */
struct PortfolioLinkArea {
	Rect rect;
	std::string url;
};

/**
 * Dessine (ou mesure, si draw == false) une suite de paragraphes dans la largeur de r.
 * @return la hauteur utilisée
 */
static int DrawParagraphs(const Rect &r, const std::vector<PortfolioParagraph> &paragraphs, bool draw,
		std::vector<PortfolioLinkArea> *links = nullptr, std::string_view hover = {})
{
	int y = r.top;
	int half = GetCharacterHeight(FS_NORMAL) / 2;
	for (const auto &p : paragraphs) {
		y += p.gap_before * half;
		int h = GetStringHeight(p.text, r.Width());
		if (p.url.empty()) {
			if (draw) DrawStringMultiLine(r.left, r.right, y, y + h, p.text, p.colour, SA_TOP | SA_LEFT);
		} else {
			/* lien : bleu clair souligné, blanc au survol */
			bool hovered = !hover.empty() && hover == p.url;
			if (draw) DrawStringMultiLine(r.left, r.right, y, y + h, p.text, hovered ? TC_WHITE : TC_LIGHT_BLUE, SA_TOP | SA_LEFT, true);
			if (links != nullptr) {
				int w = std::min<int>(r.Width(), GetStringBoundingBox(p.text).width);
				links->push_back({Rect{r.left, y, r.left + w - 1, y + h - 1}, p.url});
			}
		}
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
	mutable std::vector<PortfolioLinkArea> link_areas; ///< liens du texte, relevés au dessin
	std::string hover_url; ///< lien survolé

	PortfolioProjectWindow(WindowDesc &desc, WindowNumber window_number) : Window(desc)
	{
		this->town = Town::Get(window_number);
		this->project = ProjectOfTown(this->town);
		this->InitNested(window_number);
		this->flags.Set(WindowFlag::DisableVpScroll);
		this->GetWidget<NWidgetViewport>(WID_PP_VIEWPORT)->InitializeViewport(this, this->town->xy, ScaleZoomGUI(ZoomLevel::Town));
		this->SetWidgetDisabledState(WID_PP_LINK, this->project == nullptr || this->project->links.empty());
	}

	/**
	 * Fenêtre déplacée ou redimensionnée (notamment quand le navigateur change de taille :
	 * le moteur replace toutes les fenêtres) : l'aperçu de la ville suit son widget,
	 * comme dans la fenêtre de ville d'OpenTTD (town_gui.cpp). Sans cela, il restait à
	 * son ancienne place, décalé vers la croix de fermeture ou hors de la fenêtre.
	 */
	void OnResize() override
	{
		if (this->viewport == nullptr) return;
		this->GetWidget<NWidgetViewport>(WID_PP_VIEWPORT)->UpdateViewportCoordinates(this);
		ScrollWindowToTile(this->town->xy, this, true); // recentre l'aperçu sur la ville
	}

	/** Sous la fenêtre d'accueil, à gauche : le coin haut droit reste libre pour l'illustration. */
	Point OnInitialPosition([[maybe_unused]] int16_t sm_width, [[maybe_unused]] int16_t sm_height, [[maybe_unused]] int window_number) override
	{
		int top = ScaleGUITrad(8);
		const Window *welcome = FindWindowById(WC_PORTFOLIO_WELCOME, 0);
		if (welcome != nullptr) top = welcome->top + welcome->height + ScaleGUITrad(6);
		if (top + sm_height > _screen.height - ScaleGUITrad(16)) top = std::max(0, _screen.height - ScaleGUITrad(16) - sm_height);
		return { ScaleGUITrad(8), top };
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
		if (!p->links.empty()) {
			out.push_back({TC_ORANGE, p->links.size() > 1 ? "Liens" : "Lien", 1});
			for (const auto &l : p->links) {
				out.push_back({TC_LIGHT_BLUE, std::string(l.label) + " : " + std::string(l.url), 0, std::string(l.url)});
			}
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
		this->link_areas.clear();
		DrawParagraphs(r.Shrink(WidgetDimensions::scaled.frametext, WidgetDimensions::scaled.framerect), this->Paragraphs(), true, &this->link_areas, this->hover_url);
		/* r est déjà en coordonnées de la fenêtre : les zones aussi */
	}

	/** Survol : le lien sous la souris passe en blanc (le jeu dessine son propre curseur). */
	void OnMouseOver(Point pt, WidgetID widget) override
	{
		std::string hover;
		if (widget == WID_PP_TEXT) {
			for (const auto &area : this->link_areas) {
				if (IsInsideMM(pt.x, area.rect.left, area.rect.right + 1) && IsInsideMM(pt.y, area.rect.top, area.rect.bottom + 1)) {
					hover = area.url;
					break;
				}
			}
		}
		if (hover != this->hover_url) {
			this->hover_url = hover;
			this->SetWidgetDirty(WID_PP_TEXT);
		}
	}

	void OnClick([[maybe_unused]] Point pt, WidgetID widget, [[maybe_unused]] int click_count) override
	{
		switch (widget) {
			case WID_PP_CENTER: ScrollMainWindowToTile(this->town->xy); break;
			case WID_PP_LINK: if (this->project != nullptr && !this->project->links.empty()) OpenBrowser(std::string(this->project->links.front().url)); break;
			case WID_PP_TEXT: {
				/* clic sur un lien du texte */
				for (const auto &area : this->link_areas) {
					if (IsInsideMM(pt.x, area.rect.left, area.rect.right + 1) && IsInsideMM(pt.y, area.rect.top, area.rect.bottom + 1)) {
						OpenBrowser(area.url);
						break;
					}
				}
				break;
			}
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
	"Bienvenue à ProjectsLand : chaque ville est un projet de Jules ROGUE (BTS SIO SLAM). "
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
		if (widget == WID_PW_CAPTION) return "ProjectsLand";
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
/* Collaborateurs : liste, puis fiche avec un avatar façon président          */
/* ------------------------------------------------------------------------- */

/**
 * Avatar d'un collaborateur : un visage de président de compagnie (sprites d'OpenGFX),
 * tiré au sort de façon déterministe à partir du seul nom (hachage FNV-1a). Le style de
 * visage découle de la graine uniquement ; il n'est ni affiché ni interprété.
 */
static CompanyManagerFace PortfolioFace(const PortfolioCollaborator &c)
{
	uint32_t hash = 2166136261u;
	for (char ch : c.name) hash = (hash ^ static_cast<uint8_t>(ch)) * 16777619u;
	Randomizer randomizer;
	randomizer.SetSeed(hash);
	CompanyManagerFace face{};

	/* Style imposé par data/collaborators.json, sinon tiré de la graine. */
	std::optional<uint> style = c.face_style.empty() ? std::nullopt : FindCompanyManagerFaceLabel(c.face_style);
	if (style.has_value()) {
		SetCompanyManagerFaceStyle(face, *style);
		RandomiseCompanyManagerFaceBits(face, GetCompanyManagerFaceVars(face.style), randomizer);
	} else {
		RandomiseCompanyManagerFace(face, randomizer);
	}

	/* Pièces imposées (cheveux, lunettes, veste...) : tout le reste vient du nom. */
	FaceVars vars = GetCompanyManagerFaceVars(face.style);
	for (const PortfolioFacePart &part : c.face_parts) {
		for (const FaceVar &var : vars) {
			if (var.name != part.part) continue;
			if (var.type == FaceVarType::Toggle) {
				var.SetBits(face, part.value != 0 ? 1 : 0);
			} else if (part.part == STR_FACE_GLASSES) {
				var.SetBits(face, 0); // lunettes : verres clairs (la variante 1 est solaire)
			} else if (part.value >= 0 && static_cast<uint>(part.value) < var.valid_values) {
				var.SetBits(face, part.value);
			}
		}
	}
	return face;
}

/** Couleur du fond de l'avatar, elle aussi tirée du nom. */
static Colours PortfolioFaceColour(std::string_view name)
{
	uint32_t hash = 5381;
	for (char c : name) hash = hash * 33 + static_cast<uint8_t>(c);
	return static_cast<Colours>(hash % COLOUR_END);
}

void ShowPortfolioCollaborator(uint index);

enum PortfolioCollaboratorsWidgets : WidgetID {
	WID_PC_INTRO,
	WID_PC_LIST,
};

static constexpr std::initializer_list<NWidgetPart> _nested_portfolio_collaborators_widgets = {
	NWidget(NWID_HORIZONTAL),
		NWidget(WWT_CLOSEBOX, COLOUR_BROWN),
		NWidget(WWT_CAPTION, COLOUR_BROWN), SetStringTip(STR_PORTFOLIO_COLLABORATORS_CAPTION, STR_TOOLTIP_WINDOW_TITLE_DRAG_THIS),
		NWidget(WWT_STICKYBOX, COLOUR_BROWN),
	EndContainer(),
	NWidget(WWT_PANEL, COLOUR_BROWN, WID_PC_INTRO), SetFill(1, 0), EndContainer(),
	NWidget(WWT_PANEL, COLOUR_BROWN),
		NWidget(WWT_INSET, COLOUR_BROWN, WID_PC_LIST), SetPadding(2, 2, 2, 2), SetFill(1, 0), SetToolTip(STR_PORTFOLIO_COLLABORATORS_LIST_TOOLTIP), EndContainer(),
	EndContainer(),
};

static WindowDesc _portfolio_collaborators_desc(
	WDP_AUTO, "portfolio_collaborators", 0, 0,
	WC_PORTFOLIO_COLLABORATORS, WC_NONE,
	{},
	_nested_portfolio_collaborators_widgets
);

static const char * const PORTFOLIO_COLLABORATORS_INTRO =
	"Les personnes citées dans l'équipe d'un projet. Cliquez sur un nom pour ouvrir sa fiche.";

/** Liste des collaborateurs : un clic sur un nom ouvre sa fiche. */
struct PortfolioCollaboratorsWindow : Window {
	int line_height = 0;

	PortfolioCollaboratorsWindow(WindowDesc &desc) : Window(desc)
	{
		this->InitNested(0);
	}

	std::vector<PortfolioParagraph> Intro() const
	{
		std::vector<PortfolioParagraph> out{ {TC_BLACK, PORTFOLIO_COLLABORATORS_INTRO, 0} };
		if (_portfolio_collaborators.empty()) out.push_back({TC_GREY, "Aucun collaborateur.", 1});
		return out;
	}

	static std::string ProjectsOf(const PortfolioCollaborator &c)
	{
		std::string out;
		for (size_t i : c.projects) {
			if (!out.empty()) out += ", ";
			out += _portfolio_projects[i].title;
		}
		return out;
	}

	void UpdateWidgetSize(WidgetID widget, Dimension &size, [[maybe_unused]] const Dimension &padding, [[maybe_unused]] Dimension &fill, [[maybe_unused]] Dimension &resize) override
	{
		int width = ScaleGUITrad(300);
		switch (widget) {
			case WID_PC_INTRO: {
				Rect r{0, 0, width - 1, 0};
				size.width = std::max<uint>(size.width, width + WidgetDimensions::scaled.frametext.Horizontal());
				size.height = DrawParagraphs(r, this->Intro(), false) + WidgetDimensions::scaled.frametext.Vertical() + WidgetDimensions::scaled.framerect.Vertical();
				break;
			}
			case WID_PC_LIST:
				this->line_height = GetCharacterHeight(FS_NORMAL) + WidgetDimensions::scaled.matrix.Vertical();
				size.height = this->line_height * static_cast<uint>(std::max<size_t>(1, _portfolio_collaborators.size())) + WidgetDimensions::scaled.framerect.Vertical();
				break;
		}
	}

	void DrawWidget(const Rect &r, WidgetID widget) const override
	{
		switch (widget) {
			case WID_PC_INTRO:
				DrawParagraphs(r.Shrink(WidgetDimensions::scaled.frametext, WidgetDimensions::scaled.framerect), this->Intro(), true);
				break;

			case WID_PC_LIST: {
				Rect tr = r.Shrink(WidgetDimensions::scaled.framerect);
				int y = tr.top + WidgetDimensions::scaled.matrix.top;
				for (const auto &c : _portfolio_collaborators) {
					DrawString(tr.left + WidgetDimensions::scaled.hsep_normal, tr.right, y, std::string(c.name), TC_ORANGE);
					DrawString(tr.left, tr.right - WidgetDimensions::scaled.hsep_normal, y, ProjectsOf(c), TC_GREY, SA_RIGHT);
					y += this->line_height;
				}
				break;
			}
		}
	}

	void OnClick(Point pt, WidgetID widget, [[maybe_unused]] int click_count) override
	{
		if (widget != WID_PC_LIST) return;
		const NWidgetBase *nwid = this->GetWidget<NWidgetBase>(WID_PC_LIST);
		int row = (pt.y - nwid->pos_y - WidgetDimensions::scaled.framerect.top) / std::max(1, this->line_height);
		if (row < 0 || row >= static_cast<int>(_portfolio_collaborators.size())) return;
		ShowPortfolioCollaborator(row);
	}
};

void ShowPortfolioCollaborators()
{
	if (BringWindowToFrontById(WC_PORTFOLIO_COLLABORATORS, 0)) return;
	new PortfolioCollaboratorsWindow(_portfolio_collaborators_desc);
}

/* Fiche d'un collaborateur : avatar dans un cadre (comme la fenêtre de compagnie),
 * nom, équipe et projets tels qu'ils figurent dans les données. */

enum PortfolioCollaboratorWidgets : WidgetID {
	WID_PCF_CAPTION,
	WID_PCF_FACE,
	WID_PCF_NAME,
	WID_PCF_TEXT,
	WID_PCF_PROJECT,
};

static constexpr std::initializer_list<NWidgetPart> _nested_portfolio_collaborator_widgets = {
	NWidget(NWID_HORIZONTAL),
		NWidget(WWT_CLOSEBOX, COLOUR_BROWN),
		NWidget(WWT_CAPTION, COLOUR_BROWN, WID_PCF_CAPTION),
		NWidget(WWT_STICKYBOX, COLOUR_BROWN),
	EndContainer(),
	NWidget(WWT_PANEL, COLOUR_BROWN),
		NWidget(NWID_HORIZONTAL), SetPIP(0, WidgetDimensions::unscaled.hsep_wide, 0), SetPadding(4),
			NWidget(NWID_VERTICAL), SetPIP(0, WidgetDimensions::unscaled.vsep_normal, 0),
				NWidget(WWT_INSET, COLOUR_BROWN),
					NWidget(WWT_EMPTY, INVALID_COLOUR, WID_PCF_FACE), SetMinimalSize(92, 119), SetFill(1, 0),
				EndContainer(),
				NWidget(WWT_EMPTY, INVALID_COLOUR, WID_PCF_NAME), SetFill(1, 1), SetMinimalTextLines(2, 0),
			EndContainer(),
			NWidget(WWT_EMPTY, INVALID_COLOUR, WID_PCF_TEXT), SetFill(1, 1),
		EndContainer(),
	EndContainer(),
	NWidget(WWT_PUSHTXTBTN, COLOUR_BROWN, WID_PCF_PROJECT), SetFill(1, 1), SetStringTip(STR_PORTFOLIO_OPEN_PROJECT, STR_PORTFOLIO_OPEN_PROJECT_TOOLTIP),
};

static WindowDesc _portfolio_collaborator_desc(
	WDP_AUTO, "portfolio_collaborator", 0, 0,
	WC_PORTFOLIO_COLLABORATOR, WC_NONE,
	{},
	_nested_portfolio_collaborator_widgets
);

struct PortfolioCollaboratorWindow : Window {
	const PortfolioCollaborator *collaborator = nullptr;
	CompanyManagerFace face{};
	Colours colour = COLOUR_BLUE;

	PortfolioCollaboratorWindow(WindowDesc &desc, WindowNumber number) : Window(desc)
	{
		this->collaborator = &_portfolio_collaborators[number];
		this->face = PortfolioFace(*this->collaborator);
		this->colour = PortfolioFaceColour(this->collaborator->name);
		this->InitNested(number);
	}

	std::vector<PortfolioParagraph> Paragraphs() const
	{
		std::vector<PortfolioParagraph> out;
		for (size_t i : this->collaborator->projects) {
			const PortfolioProject &p = _portfolio_projects[i];
			out.push_back({TC_ORANGE, "Projet", out.empty() ? 0 : 1});
			out.push_back({TC_WHITE, std::string(p.title), 0});
			out.push_back({TC_BLACK, std::string(p.subtitle) + " (" + std::string(p.type) + ")", 0});
			out.push_back({TC_ORANGE, "Rôle dans l'équipe", 1});
			out.push_back({TC_BLACK, std::string(p.team), 0});
		}
		return out;
	}

	std::string GetWidgetString(WidgetID widget, StringID stringid) const override
	{
		if (widget == WID_PCF_CAPTION) return std::string(this->collaborator->name);
		return this->Window::GetWidgetString(widget, stringid);
	}

	void UpdateWidgetSize(WidgetID widget, Dimension &size, [[maybe_unused]] const Dimension &padding, [[maybe_unused]] Dimension &fill, [[maybe_unused]] Dimension &resize) override
	{
		switch (widget) {
			case WID_PCF_FACE:
				size = maxdim(size, GetScaledSpriteSize(SPR_GRADIENT));
				break;
			case WID_PCF_NAME:
				size.width = std::max(size.width, GetStringBoundingBox(std::string(this->collaborator->name)).width);
				break;
			case WID_PCF_TEXT: {
				int width = ScaleGUITrad(240);
				size.width = std::max<uint>(size.width, width);
				size.height = std::max<uint>(size.height, DrawParagraphs({0, 0, width - 1, 0}, this->Paragraphs(), false));
				break;
			}
		}
	}

	void DrawWidget(const Rect &r, WidgetID widget) const override
	{
		switch (widget) {
			case WID_PCF_FACE:
				DrawCompanyManagerFace(this->face, this->colour, r);
				break;
			case WID_PCF_NAME:
				DrawStringMultiLine(r, std::string(this->collaborator->name), TC_WHITE, SA_HOR_CENTER | SA_TOP);
				break;
			case WID_PCF_TEXT:
				DrawParagraphs(r, this->Paragraphs(), true);
				break;
		}
	}

	void OnClick([[maybe_unused]] Point pt, WidgetID widget, [[maybe_unused]] int click_count) override
	{
		if (widget != WID_PCF_PROJECT || this->collaborator->projects.empty()) return;
		Town *t = TownOfProject(this->collaborator->projects.front());
		if (t == nullptr) return;
		ScrollMainWindowToTile(t->xy);
		ShowPortfolioProject(t->index);
	}
};

void ShowPortfolioCollaborator(uint index)
{
	if (index >= _portfolio_collaborators.size()) return;
	AllocateWindowDescFront<PortfolioCollaboratorWindow>(_portfolio_collaborator_desc, index);
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
	/* Build de la version JavaScript : relevé de la carte (version native sans affichage). */
	if (_game_mode == GM_NORMAL && PortfolioExportRequested()) {
		PortfolioExportStart();
		return;
	}
	if (_game_mode != GM_NORMAL || !VideoDriver::GetInstance()->HasGUI()) return;

	/* Vue de départ : la ville centrale, un peu dézoomée. */
	Window *w = GetMainWindow();
	Town *center = TownOfProject(PORTFOLIO_CENTER_PROJECT);
	if (w != nullptr && w->viewport != nullptr) {
		while (w->viewport->zoom < ZoomLevel::Out2x && DoZoomInOutWindow(ZOOM_OUT, w)) {}
		ScrollMainWindowToTile(center != nullptr ? center->xy : TileXY(Map::SizeX() / 2, Map::SizeY() / 2), true);
	}
	ShowPortfolioWelcome();
}

/** Nom d'un type de widget (pour la version JavaScript). */
static const char *PortfolioWidgetTypeName(WidgetType type)
{
	switch (type & WWT_MASK) {
		case WWT_EMPTY: return "empty";
		case WWT_PANEL: return "panel";
		case WWT_INSET: return "inset";
		case WWT_CAPTION: return "caption";
		case WWT_CLOSEBOX: return "closebox";
		case WWT_STICKYBOX: return "stickybox";
		case WWT_SHADEBOX: return "shadebox";
		case WWT_TEXTBTN: return "textbtn";
		case NWID_VIEWPORT: return "viewport";
		default: return "other";
	}
}

/**
 * Mise en page exacte d'une fenêtre : chaque widget (type, couleur, numéro, rectangle,
 * infobulle), relevé point par point avec GetWidgetFromPos, dans l'ordre de dessin
 * (un widget est dessiné avant ceux qu'il contient).
 */
static void PortfolioExportWindowLayout(PortfolioJson &json, const char *name, Window *w)
{
	std::map<const NWidgetCore *, Rect> found;
	int step = std::max(1, _gui_scale / 100);
	for (int y = 0; y < w->height; y += step) {
		for (int x = 0; x < w->width; x += step) {
			const NWidgetCore *nw = w->nested_root->GetWidgetFromPos(x, y);
			if (nw != nullptr && found.find(nw) == found.end()) found[nw] = nw->GetCurrentRect();
		}
	}
	std::vector<std::pair<const NWidgetCore *, Rect>> list(found.begin(), found.end());
	std::sort(list.begin(), list.end(), [](const auto &a, const auto &b) {
		/* les plus grands (conteneurs) d'abord, puis de haut en bas et de gauche à droite */
		bool a_in_b = a.second.left >= b.second.left && a.second.right <= b.second.right && a.second.top >= b.second.top && a.second.bottom <= b.second.bottom;
		bool b_in_a = b.second.left >= a.second.left && b.second.right <= a.second.right && b.second.top >= a.second.top && b.second.bottom <= a.second.bottom;
		if (a_in_b != b_in_a) return b_in_a;
		if (a.second.top != b.second.top) return a.second.top < b.second.top;
		return a.second.left < b.second.left;
	});
	json.Key(name);
	json.Open('{');
	json.Key("width"); json.Num(w->width);
	json.Key("height"); json.Num(w->height);
	json.Key("left"); json.Num(w->left);
	json.Key("top"); json.Num(w->top);
	json.Key("widgets");
	json.Open('[');
	for (const auto &[nw, r] : list) {
		json.Open('{');
		json.Key("type"); json.Str(PortfolioWidgetTypeName(nw->type));
		json.Key("colour"); json.Num(nw->colour);
		json.Key("index"); json.Num(nw->GetIndex());
		json.Key("rect");
		json.Open('[');
		json.Num(r.left); json.Num(r.top); json.Num(r.right); json.Num(r.bottom);
		json.Close(']');
		json.Key("tooltip"); json.Str(nw->GetToolTip() != INVALID_STRING_ID && nw->GetToolTip() != STR_NULL ? GetString(nw->GetToolTip()) : std::string{});
		json.Key("push"); json.Bool((nw->type & WWB_PUSHBUTTON) != 0);
		json.Key("disabled"); json.Bool(nw->IsDisabled());
		json.Close('}');
	}
	json.Close(']');
	json.Close('}');
}

/** Ouvre chaque fenêtre du portfolio dans le moteur natif et relève sa mise en page. */
static void PortfolioExportWindowsAtScale(PortfolioJson &json)
{
	json.Key("gui_zoom"); json.Num(to_underlying(_gui_zoom));
	json.Key("font_zoom"); json.Num(to_underlying(_font_zoom));

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

	json.Key("fonts");
	json.Open('[');
	for (FontSize fs = FS_BEGIN; fs < FS_END; fs++) {
		json.Open('[');
		json.Num(GetCharacterHeight(fs)); json.Num(FontCache::Get(fs)->GetAscender());
		json.Close(']');
	}
	json.Close(']');

	json.Key("windows");
	json.Open('{');
	Window *sb = FindWindowById(WC_STATUS_BAR, 0);
	if (sb == nullptr) {
		ShowStatusBar();
		sb = FindWindowById(WC_STATUS_BAR, 0);
	}
	if (sb != nullptr) {
		sb->ReInit();
		PortfolioExportWindowLayout(json, "statusbar", sb);
	}

	Window *welcome = new PortfolioWelcomeWindow(_portfolio_welcome_desc);
	PortfolioExportWindowLayout(json, "welcome", welcome);
	welcome->Close();

	for (size_t i = 0; i < _portfolio_projects.size(); i++) {
		Town *t = TownOfProject(i);
		if (t == nullptr) continue;
		ShowPortfolioProject(t->index);
		Window *w = FindWindowById(WC_PORTFOLIO_PROJECT, t->index);
		if (w == nullptr) continue;
		PortfolioExportWindowLayout(json, fmt::format("project{}", i).c_str(), w);
		w->Close();
	}

	ShowPortfolioCollaborators();
	if (Window *w = FindWindowById(WC_PORTFOLIO_COLLABORATORS, 0); w != nullptr) {
		PortfolioExportWindowLayout(json, "collaborators", w);
		w->Close();
	}
	for (size_t i = 0; i < _portfolio_collaborators.size(); i++) {
		ShowPortfolioCollaborator(static_cast<uint>(i));
		Window *w = FindWindowById(WC_PORTFOLIO_COLLABORATOR, static_cast<WindowNumber>(i));
		if (w == nullptr) continue;
		PortfolioExportWindowLayout(json, fmt::format("collaborator{}", i).c_str(), w);
		w->Close();
	}
	Window::DeleteClosedWindows();
	json.Close('}');
}

/**
 * Mises en page à chaque échelle de l'interface : comme dans le navigateur, l'échelle
 * suit la taille de l'écran (UpdateGUIZoom : 100 % pour 640 × 480, par paliers de 25 %).
 */
static void PortfolioExportWindows(PortfolioJson &json)
{
	json.Key("scales");
	json.Open('{');
	int saved = _gui_scale_cfg;
	for (int scale = MIN_INTERFACE_SCALE; scale <= MAX_INTERFACE_SCALE; scale += 25) {
		_gui_scale_cfg = scale;
		if (AdjustGUIZoom(false)) ReInitAllWindows(true);
		json.Key(fmt::format("{}", scale));
		json.Open('{');
		PortfolioExportWindowsAtScale(json);
		json.Close('}');
	}
	_gui_scale_cfg = saved;
	_gui_scale_cfg = MIN_INTERFACE_SCALE;
	if (AdjustGUIZoom(false)) ReInitAllWindows(true);
	_gui_scale_cfg = saved;
	json.Close('}');
}

/**
 * Données du portfolio pour la version JavaScript : projets, collaborateurs (avec la liste
 * des sprites de leur visage, comme DrawCompanyManagerFace), ville de chaque projet, textes.
 */
void PortfolioExportData(PortfolioJson &json, std::set<uint32_t> &sprites, std::set<uint32_t> &palettes)
{
	PortfolioExportWindows(json);

	json.Key("portfolio");
	json.Open('{');
	json.Key("intro"); json.Str(PORTFOLIO_INTRO);
	json.Key("help"); json.Str(PORTFOLIO_HELP);
	json.Key("collaborators_intro"); json.Str(PORTFOLIO_COLLABORATORS_INTRO);
	json.Key("text_width"); json.Num(PORTFOLIO_TEXT_WIDTH);
	json.Key("center_project"); json.Num(PORTFOLIO_CENTER_PROJECT);

	json.Key("projects");
	json.Open('[');
	for (size_t i = 0; i < _portfolio_projects.size(); i++) {
		const PortfolioProject &p = _portfolio_projects[i];
		json.Open('{');
		json.Key("id"); json.Str(p.id);
		json.Key("title"); json.Str(p.title);
		json.Key("subtitle"); json.Str(p.subtitle);
		json.Key("type"); json.Str(p.type);
		json.Key("summary"); json.Str(p.summary);
		json.Key("highlights");
		json.Open('[');
		for (const auto &h : p.highlights) json.Str(h);
		json.Close(']');
		json.Key("stack"); json.Str(p.stack);
		json.Key("team"); json.Str(p.team);
		json.Key("links");
		json.Open('[');
		for (const auto &l : p.links) {
			json.Open('{');
			json.Key("label"); json.Str(l.label);
			json.Key("url"); json.Str(l.url);
			json.Close('}');
		}
		json.Close(']');
		json.Key("note"); json.Str(p.note);
		const Town *t = TownOfProject(i);
		json.Key("town"); json.Num(t != nullptr ? t->index.base() : -1);
		json.Close('}');
	}
	json.Close(']');

	json.Key("collaborators");
	json.Open('[');
	for (const PortfolioCollaborator &c : _portfolio_collaborators) {
		json.Open('{');
		json.Key("name"); json.Str(c.name);
		json.Key("projects");
		json.Open('[');
		for (size_t i : c.projects) json.Num(i);
		json.Close(']');

		/* Visage : fond (dégradé recolorié) puis pièces, comme DrawCompanyManagerFace(). */
		CompanyManagerFace face = PortfolioFace(c);
		PaletteID bg = GetColourPalette(PortfolioFaceColour(c.name));
		json.Key("face");
		json.Open('[');
		json.Num(SPR_GRADIENT); json.Num(bg);
		sprites.insert(SPR_GRADIENT);
		palettes.insert(bg);
		FaceVars vars = GetCompanyManagerFaceVars(face.style);
		uint64_t active_vars = GetActiveFaceVars(face, vars);
		std::unordered_map<uint8_t, PaletteID> face_palettes;
		for (auto var : SetBitIterator(active_vars)) {
			if (vars[var].type != FaceVarType::Palette) continue;
			PaletteID pal = PAL_NONE;
			switch (vars[var].GetBits(face)) {
				default: NOT_REACHED();
				case 0: pal = PALETTE_TO_BROWN; break;
				case 1: pal = PALETTE_TO_BLUE;  break;
				case 2: pal = PALETTE_TO_GREEN; break;
			}
			for (uint8_t affected_var : SetBitIterator(std::get<uint64_t>(vars[var].data))) face_palettes[affected_var] = pal;
		}
		for (auto var : SetBitIterator(active_vars)) {
			if (vars[var].type != FaceVarType::Sprite) continue;
			auto it = face_palettes.find(var);
			PaletteID pal = (it == std::end(face_palettes)) ? PAL_NONE : it->second;
			SpriteID spr = vars[var].GetSprite(face);
			json.Num(spr); json.Num(pal);
			sprites.insert(spr);
			if (pal != PAL_NONE) palettes.insert(pal);
		}
		json.Close(']');
		json.Close('}');
	}
	json.Close(']');
	json.Close('}');
}

