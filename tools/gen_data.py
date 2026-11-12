#!/usr/bin/env python3
"""
Génère les données du portfolio pour le moteur et le script de jeu, à partir de
data/projects.json (copie des données de l'application « Projets » du portfolio).

  python3 tools/gen_data.py data/projects.json <dossier src d'OpenTTD> <dossier du script de jeu>

Sorties :
  <src>/src/portfolio_data.h   tableau C++ des projets et des collaborateurs
  <gs>/projects.nut            noms des villes (un projet = une ville), dans l'ordre

Seul le champ « team » sert à trouver les collaborateurs : « … réalisé avec Prénom Nom ».
Aucune autre information sur une personne n'est ajoutée.
"""
import json
import os
import re
import sys

# Les polices « sprite » d'OpenGFX couvrent le Latin-1 : on remplace les rares
# caractères typographiques qui n'y figurent pas.
REPLACEMENTS = {
    '’': "'", '‘': "'", '“': '"', '”': '"',
    '—': '-', '–': '-', '…': '...', 'œ': 'oe', 'Œ': 'OE',
    ' ': ' ', ' ': ' ',
}


# Projet placé au centre de la carte : le portfolio lui-même.
CENTER_ID = 'portfolio'


def clean(text):
    for a, b in REPLACEMENTS.items():
        text = text.replace(a, b)
    bad = [c for c in text if ord(c) > 0xFF]
    if bad:
        raise SystemExit(f'caractère hors Latin-1 dans les données : {bad!r} ({text!r})')
    return text


def cstr(text):
    """Littéral C++ (octets UTF-8 échappés)."""
    out = []
    for ch in clean(text):
        if ch in '\\"':
            out.append('\\' + ch)
        elif ch == '\n':
            out.append('\\n')
        elif ord(ch) < 0x80:
            out.append(ch)
        else:
            out.append(''.join(f'\\x{b:02x}' for b in ch.encode('utf-8')) + '""')
    return '"' + ''.join(out) + '"'


# --- Visages des collaborateurs (data/collaborators.json) -------------------------
# Chaque collaborateur peut avoir un champ « face » qui impose certaines pièces de son
# avatar (visage de président d'OpenTTD) ; tout le reste est tiré de la graine du nom.
# Clés reconnues :
#   gender   : « male » (style default/face1) ou « female » (default/face2) ;
#   style    : style d'OpenTTD exact (default/face1 à default/face4), prioritaire ;
#   glasses  : true / false (verres clairs) ;
#   hair, jacket, collar, chin, tie, eyebrows, nose, lips, eyecolour, moustache :
#              numéro de variante (0, 1, 2...) ou nom lisible (FACE_NAMED) ;
#   build    : « large » = veste sombre, col ouvert, menton large (carrure costaude,
#              au plus près : le portrait ne montre que la tête et les épaules).
# Les variantes nommées ont été repérées sur les sprites d'OpenGFX (planche dans le README).
FACE_GENDER = {'male': 'default/face1', 'female': 'default/face2'}
FACE_PARTS = {'hair': 'STR_FACE_HAIR', 'jacket': 'STR_FACE_JACKET', 'collar': 'STR_FACE_COLLAR',
              'chin': 'STR_FACE_CHIN', 'tie': 'STR_FACE_TIE', 'eyebrows': 'STR_FACE_EYEBROWS',
              'nose': 'STR_FACE_NOSE', 'lips': 'STR_FACE_LIPS', 'eyecolour': 'STR_FACE_EYECOLOUR',
              'moustache': 'STR_FACE_MOUSTACHE', 'glasses': 'STR_FACE_GLASSES'}
FACE_NAMED = {
    'default/face1': {
        'hair': {'black': 0, 'bald': 1, 'grey': 2, 'brown': 6, 'auburn': 5, 'red': 8},
        'jacket': {'dark': 0, 'maroon': 1, 'navy': 2},
        'collar': {'blue': 0, 'white': 1, 'checked': 2, 'open': 3},
        'chin': {'narrow': 0, 'square': 2, 'stubble': 3},
    },
}
FACE_BUILD = {'default/face1': {'large': {'jacket': 'dark', 'collar': 'open', 'chin': 'square'}}}


def face_constraints(spec, name):
    """Style imposé et liste (pièce, valeur) pour le moteur."""
    if not spec:
        return '', []
    spec = dict(spec)
    style = spec.pop('style', None) or FACE_GENDER.get(spec.pop('gender', ''), '')
    spec.pop('gender', None)
    build = spec.pop('build', None)
    if build is not None:
        extra = FACE_BUILD.get(style, {}).get(build)
        if extra is None:
            raise SystemExit(f'{name} : carrure « {build} » inconnue pour le style {style}')
        spec = {**extra, **spec}
    parts = []
    for key, value in spec.items():
        if key not in FACE_PARTS:
            raise SystemExit(f'{name} : pièce de visage inconnue « {key} »')
        if key == 'glasses':
            # option (toggle) ; verres clairs (variante 0) si elles sont demandées
            parts.append((FACE_PARTS[key], 1 if value else 0))
            continue
        if isinstance(value, str):
            named = FACE_NAMED.get(style, {}).get(key, {})
            if value not in named:
                raise SystemExit(f'{name} : « {key}: {value} » inconnu pour le style {style} ({", ".join(named) or "numéros seulement"})')
            value = named[value]
        parts.append((FACE_PARTS[key], int(value)))
    return style, parts


def collaborators(project):
    """Noms cités dans le champ team (« réalisé avec X et Y »)."""
    m = re.search(r'réalisé avec (.+)$', project.get('team', ''))
    if not m:
        return []
    names = re.split(r',\s*| et ', m.group(1).strip().rstrip('.'))
    return [n.strip() for n in names if n.strip()]


def main():
    data_path, src_dir, gs_dir = sys.argv[1:4]
    with open(data_path, encoding='utf-8') as f:
        projects = json.load(f)
    faces_path = os.path.join(os.path.dirname(data_path), 'collaborators.json')
    faces = {}
    if os.path.exists(faces_path):
        with open(faces_path, encoding='utf-8') as f:
            faces = json.load(f)

    lines = [
        '/* Fichier généré par tools/gen_data.py à partir de data/projects.json : ne pas modifier. */',
        '',
        '#ifndef PORTFOLIO_DATA_H',
        '#define PORTFOLIO_DATA_H',
        '',
        '#include "table/strings.h"',
        '#include <string_view>',
        '#include <vector>',
        '',
        '/** Un projet du portfolio, représenté par une ville. */',
        'struct PortfolioProject {',
        '\tstd::string_view id;         ///< identifiant (illustrations : /images/projects/<id>/)',
        '\tstd::string_view title;      ///< titre, aussi nom de la ville',
        '\tstd::string_view subtitle;',
        '\tstd::string_view type;',
        '\tstd::string_view summary;',
        '\tstd::vector<std::string_view> highlights;',
        '\tstd::string_view stack;',
        '\tstd::string_view team;',
        '\tstd::string_view link_label;',
        '\tstd::string_view link_url;',
        '\tstd::string_view note;',
        '};',
        '',
        '/** Contrainte sur une pièce du visage (nom de la pièce dans OpenTTD, valeur). */',
        'struct PortfolioFacePart {',
        '\tStringID part;               ///< STR_FACE_HAIR, STR_FACE_GLASSES...',
        '\tint value;                    ///< variante (0..n-1), ou 0/1 pour une option',
        '};',
        '',
        '/** Un collaborateur, tel que cité dans le champ « team » des projets (un seul par nom). */',
        'struct PortfolioCollaborator {',
        '\tstd::string_view name;',
        '\tstd::vector<size_t> projects; ///< indices dans _portfolio_projects',
        '\tstd::string_view face_style; ///< style de visage imposé (« default/face1 »...), ou vide',
        '\tstd::vector<PortfolioFacePart> face_parts; ///< pièces imposées ; le reste vient du nom',
        '};',
        '',
        'static const std::vector<PortfolioProject> _portfolio_projects = {',
    ]
    collabs = {}
    for i, p in enumerate(projects):
        if len(clean(p['title'])) > 32:
            raise SystemExit(f"titre trop long pour un nom de ville : {p['title']}")
        link = p['links'][0] if p.get('links') else {'label': '', 'url': ''}
        lines.append('\t{')
        lines.append(f"\t\t{cstr(p['id'])},")
        lines.append(f"\t\t{cstr(p['title'])},")
        lines.append(f"\t\t{cstr(p.get('subtitle', ''))},")
        lines.append(f"\t\t{cstr(p.get('type', ''))},")
        lines.append(f"\t\t{cstr(p.get('summary', ''))},")
        lines.append('\t\t{' + ', '.join(cstr(h) for h in p.get('highlights', [])) + '},')
        lines.append(f"\t\t{cstr(', '.join(p.get('stack', [])))},")
        lines.append(f"\t\t{cstr(p.get('team', ''))},")
        lines.append(f"\t\t{cstr(link['label'])},")
        lines.append(f"\t\t{cstr(link['url'])},")
        lines.append(f"\t\t{cstr(p.get('note', ''))},")
        lines.append('\t},')
        for name in collaborators(p):
            collabs.setdefault(name, []).append(i)
    lines.append('};')
    lines.append('')
    lines.append('static const std::vector<PortfolioCollaborator> _portfolio_collaborators = {')
    for name, idx in collabs.items():
        style, parts = face_constraints(faces.get(name, {}).get('face', {}), name)
        parts_c = ', '.join(f'{{ {k}, {v} }}' for k, v in parts)
        lines.append(f'\t{{ {cstr(name)}, {{ {", ".join(str(i) for i in idx)} }}, {cstr(style)}, {{ {parts_c} }} }},')
    lines.append('};')
    lines.append('')
    center = next((i for i, p in enumerate(projects) if p['id'] == CENTER_ID), 0)
    lines.append(f'/** Projet de la ville centrale (vue de départ). */')
    lines.append(f'static const size_t PORTFOLIO_CENTER_PROJECT = {center};')
    lines.append('')
    lines.append('#endif /* PORTFOLIO_DATA_H */')
    with open(f'{src_dir}/src/portfolio_data.h', 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')

    # Script de jeu : noms des villes (texte brut passé à GSTown.FoundTown / SetName)
    nut = ['/* Fichier généré par tools/gen_data.py à partir de data/projects.json : ne pas modifier. */',
           'PROJECT_TOWNS <- [']
    for p in projects:
        nut.append('\t"' + clean(p['title']).replace('\\', '\\\\').replace('"', '\\"') + '",')
    nut.append('];')
    nut.append(f'PROJECT_CENTER <- {center};')
    with open(f'{gs_dir}/projects.nut', 'w', encoding='utf-8') as f:
        f.write('\n'.join(nut) + '\n')

    print(f'{len(projects)} projets, {len(collabs)} collaborateur(s) : {", ".join(collabs) or "aucun"}')


if __name__ == '__main__':
    main()
