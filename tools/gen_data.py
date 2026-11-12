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

    lines = [
        '/* Fichier généré par tools/gen_data.py à partir de data/projects.json : ne pas modifier. */',
        '',
        '#ifndef PORTFOLIO_DATA_H',
        '#define PORTFOLIO_DATA_H',
        '',
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
        '/** Un collaborateur, tel que cité dans le champ « team » d\'un projet. */',
        'struct PortfolioCollaborator {',
        '\tstd::string_view name;',
        '\tsize_t project;              ///< indice dans _portfolio_projects',
        '};',
        '',
        'static const std::vector<PortfolioProject> _portfolio_projects = {',
    ]
    collabs = []
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
            collabs.append((name, i))
    lines.append('};')
    lines.append('')
    lines.append('static const std::vector<PortfolioCollaborator> _portfolio_collaborators = {')
    for name, i in collabs:
        lines.append(f'\t{{ {cstr(name)}, {i} }},')
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

    print(f'{len(projects)} projets, {len(collabs)} collaborateur(s) : {", ".join(n for n, _ in collabs) or "aucun"}')


if __name__ == '__main__':
    main()
