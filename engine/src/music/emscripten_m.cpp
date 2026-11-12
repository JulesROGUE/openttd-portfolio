/*
 * This file is part of OpenTTD Portfolio, a modified version of OpenTTD.
 * OpenTTD is free software; you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, version 2.
 * OpenTTD is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details. You should have received a copy of the GNU General Public License along with OpenTTD. If not, see <https://www.gnu.org/licenses/old-licenses/gpl-2.0>.
 */

/** @file emscripten_m.cpp Pilote de musique pour le navigateur (Emscripten). */

#include "../stdafx.h"
#include "../debug.h"
#include "../base_media_base.h"
#include "../base_media_music.h"
#include "midifile.hpp"
#include "emscripten_m.h"

#include <emscripten.h>

#include "../safeguards.h"

static FMusicDriver_Emscripten iFMusicDriver_Emscripten;

std::optional<std::string_view> MusicDriver_Emscripten::Start(const StringList &)
{
	EM_ASM({ if (window.openttd_music) window.openttd_music.init(); });
	return std::nullopt;
}

void MusicDriver_Emscripten::Stop()
{
	this->StopSong();
}

/**
 * Format transmis au synthé : une suite de blocs
 *   [temps en ms depuis le début : 4 octets LE][longueur : 2 octets LE][messages MIDI bruts]
 */
void MusicDriver_Emscripten::PlaySong(const MusicSongInfo &song)
{
	MidiFile midi;
	if (!midi.LoadSong(song)) {
		Debug(driver, 0, "emscripten_m: impossible de lire {}", song.filename);
		this->StopSong();
		return;
	}

	std::vector<uint8_t> buf;
	for (const auto &block : midi.blocks) {
		if (block.data.empty()) continue;
		uint32_t ms = static_cast<uint32_t>(block.realtime / 1000);
		size_t len = std::min<size_t>(block.data.size(), 0xFFFF);
		for (int i = 0; i < 4; i++) buf.push_back(static_cast<uint8_t>(ms >> (8 * i)));
		buf.push_back(static_cast<uint8_t>(len));
		buf.push_back(static_cast<uint8_t>(len >> 8));
		buf.insert(buf.end(), block.data.begin(), block.data.begin() + len);
	}
	Debug(driver, 1, "emscripten_m: {} ({} blocs)", song.songname, midi.blocks.size());
	EM_ASM({
		if (window.openttd_music) window.openttd_music.play(HEAPU8.slice($0, $0 + $1), UTF8ToString($2));
	}, buf.data(), buf.size(), song.songname.c_str());
}

void MusicDriver_Emscripten::StopSong()
{
	EM_ASM({ if (window.openttd_music) window.openttd_music.stop(); });
}

bool MusicDriver_Emscripten::IsSongPlaying()
{
	return EM_ASM_INT({ return window.openttd_music ? (window.openttd_music.isPlaying() ? 1 : 0) : 0; }) != 0;
}

void MusicDriver_Emscripten::SetVolume(uint8_t vol)
{
	EM_ASM({ if (window.openttd_music) window.openttd_music.setVolume($0 / 127); }, vol);
}
