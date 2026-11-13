/*
 * This file is part of OpenTTD Portfolio, a modified version of OpenTTD.
 * OpenTTD is free software; you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, version 2.
 * OpenTTD is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details. You should have received a copy of the GNU General Public License along with OpenTTD. If not, see <https://www.gnu.org/licenses/old-licenses/gpl-2.0>.
 */

/** @file portfolio_export.h Extraction des données de la carte pour la version JavaScript. */

#ifndef PORTFOLIO_EXPORT_H
#define PORTFOLIO_EXPORT_H

#include <string>
#include <string_view>
#include <vector>
#include <set>
#include <cstdint>

/** Petit écrivain JSON (les virgules sont gérées par l'appelant via Sep()). */
struct PortfolioJson {
	std::string out;
	std::vector<bool> first{true};

	void Sep()
	{
		if (!this->first.back()) this->out += ',';
		this->first.back() = false;
	}
	void Key(std::string_view k)
	{
		this->Sep();
		this->Str(k, false);
		this->out += ':';
		this->first.back() = true; // la valeur suit sans virgule
	}
	void Str(std::string_view s, bool sep = true)
	{
		if (sep) this->Sep();
		this->out += '"';
		for (unsigned char c : s) {
			switch (c) {
				case '"': this->out += "\\\""; break;
				case '\\': this->out += "\\\\"; break;
				case '\n': this->out += "\\n"; break;
				default:
					if (c < 0x20) {
						char buf[8];
						snprintf(buf, sizeof(buf), "\\u%04x", c);
						this->out += buf;
					} else {
						this->out += static_cast<char>(c);
					}
			}
		}
		this->out += '"';
		if (!sep) return;
	}
	void Num(int64_t v)
	{
		this->Sep();
		this->out += std::to_string(v);
	}
	void Bool(bool v)
	{
		this->Sep();
		this->out += v ? "true" : "false";
	}
	void Open(char c)
	{
		this->Sep();
		this->out += c;
		this->first.push_back(true);
	}
	void Close(char c)
	{
		this->out += c;
		this->first.pop_back();
	}
	void Raw(std::string_view s)
	{
		this->Sep();
		this->out += s;
	}
};

extern bool _pf_export_active;

bool PortfolioExportRequested();
void PortfolioExportStart();
void PortfolioExportTileDirty(uint32_t tile);
void PortfolioExportTextEffect(int kind, unsigned id, int mode, int center, int top, int width_normal, int width_small, int duration, const std::string &text);

/* portfolio_gui.cpp */
void PortfolioExportData(PortfolioJson &json, std::set<uint32_t> &sprites, std::set<uint32_t> &palettes);

#endif /* PORTFOLIO_EXPORT_H */
