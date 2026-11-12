/*
 * OpenTTD Portfolio — script de jeu qui construit la carte du portfolio.
 *
 * Exécuté une seule fois, pendant le build, par une version native d'OpenTTD lancée
 * sans affichage (voir scripts/gen-map.sh). La carte obtenue est enregistrée et c'est
 * cette sauvegarde que charge la version WebAssembly. Étapes :
 *   1. une ville par projet (nom = titre du projet), à des emplacements fixes ;
 *   2. des routes entre les villes (A* maison sur les tuiles, ponts sur l'eau) ;
 *   3. une gare routière par ville et des bus entre la ville centrale et les autres.
 * Tout est déterministe : même graine de carte, mêmes données => même carte.
 */
require("projects.nut");

/* Emplacements des villes (fractions de la taille de la carte), dans l'ordre de
 * PROJECT_TOWNS : Cube 2, Mineport, Magic Shape, Portfolio OS (centre), Leboncoin. */
CENTER <- PROJECT_CENTER;
TOWN_SPOTS <- [[0.24, 0.24], [0.76, 0.22], [0.22, 0.76], [0.50, 0.50], [0.76, 0.76]];
TOWN_LAYOUTS <- [GSTown.ROAD_LAYOUT_BETTER_ROADS, GSTown.ROAD_LAYOUT_ORIGINAL, GSTown.ROAD_LAYOUT_2x2,
                 GSTown.ROAD_LAYOUT_BETTER_ROADS, GSTown.ROAD_LAYOUT_3x3];
TOWN_HOUSES <- [45, 35, 35, 70, 45];
/* Routes : chaque ville est reliée au centre, plus un anneau autour. */
ROADS <- [[3, 0], [3, 1], [3, 2], [3, 4], [0, 1], [1, 4], [4, 2], [2, 0]];

class PortfolioGS extends GSController {
	done = false;
	sx = 0;
	sy = 0;
	blocked = null;

	constructor() { this.blocked = {}; }

	function Save() { return { done = this.done }; }
	function Load(version, data) { if ("done" in data) this.done = data.done; }

	function Start();
}

function PortfolioGS::Start()
{
	/* Dans le navigateur, la carte est déjà construite : on ne fait plus rien. */
	if (!this.done && GSTownList().Count() >= PROJECT_TOWNS.len()) this.done = true;
	while (this.done) GSController.Sleep(100000);

	this.sx = GSMap.GetMapSizeX();
	this.sy = GSMap.GetMapSizeY();
	GSLog.Info("Construction de la carte du portfolio (" + this.sx + "x" + this.sy + ")");
	GSRoad.SetCurrentRoadType(GSRoad.ROADTYPE_ROAD);

	local towns = this.PlaceTowns();
	foreach (pair in ROADS) {
		local ok = this.ConnectTowns(towns[pair[0]], towns[pair[1]]);
		GSLog.Info("Route " + PROJECT_TOWNS[pair[0]] + " - " + PROJECT_TOWNS[pair[1]] + (ok ? " : OK" : " : ECHEC"));
	}
	this.BuildBusLines(towns);

	this.done = true;
	GSLog.Info("PORTFOLIO_MAP_DONE");
	while (true) GSController.Sleep(100000);
}

/* --- Villes ------------------------------------------------------------------ */

function PortfolioGS::Tile(x, y) { return GSMap.GetTileIndex(x, y); }

function PortfolioGS::GoodTownSpot(t)
{
	local x = GSMap.GetTileX(t), y = GSMap.GetTileY(t);
	if (x < 8 || y < 8 || x > this.sx - 9 || y > this.sy - 9) return false;
	if (GSTile.GetSlope(t) != GSTile.SLOPE_FLAT) return false;
	return GSTile.IsBuildableRectangle(this.Tile(x - 2, y - 2), 5, 5);
}

function PortfolioGS::PlaceTowns()
{
	local towns = array(PROJECT_TOWNS.len(), null);

	/* La ville créée par le générateur (au moins une est obligatoire) prend le nom
	 * du projet dont l'emplacement est le plus proche. */
	local existing = GSTownList();
	foreach (town, _ in existing) {
		local loc = GSTown.GetLocation(town);
		local best = -1, bestd = 1 << 30;
		foreach (i, spot in TOWN_SPOTS) {
			if (towns[i] != null) continue;
			local d = GSMap.DistanceManhattan(loc, this.Tile((spot[0] * this.sx).tointeger(), (spot[1] * this.sy).tointeger()));
			if (d < bestd) { bestd = d; best = i; }
		}
		GSTown.SetName(town, PROJECT_TOWNS[best]);
		towns[best] = town;
		GSLog.Info("Ville existante renommée : " + PROJECT_TOWNS[best]);
	}

	foreach (i, name in PROJECT_TOWNS) {
		if (towns[i] != null) continue;
		local cx = (TOWN_SPOTS[i][0] * this.sx).tointeger(), cy = (TOWN_SPOTS[i][1] * this.sy).tointeger();
		local founded = false;
		/* Recherche en spirale (carrés concentriques) d'un terrain plat et libre. */
		for (local r = 0; r <= 24 && !founded; r++) {
			for (local dx = -r; dx <= r && !founded; dx++) {
				for (local dy = -r; dy <= r && !founded; dy++) {
					if (abs(dx) != r && abs(dy) != r) continue;
					local t = this.Tile(cx + dx, cy + dy);
					if (!GSMap.IsValidTile(t) || !this.GoodTownSpot(t)) continue;
					if (GSTown.FoundTown(t, GSTown.TOWN_SIZE_MEDIUM, false, TOWN_LAYOUTS[i], name)) {
						founded = true;
						local list = GSTownList();
						list.Valuate(GSTown.GetLocation);
						list.KeepValue(t);
						if (list.Count() == 0) {
							/* le centre peut être décalé d'une tuile : on prend la plus proche */
							list = GSTownList();
							list.Valuate(GSTown.GetDistanceManhattanToTile, t);
							list.Sort(GSList.SORT_BY_VALUE, true);
						}
						towns[i] = list.Begin();
					}
				}
			}
		}
		GSLog.Info("Ville " + name + (founded ? " fondée" : " : AUCUN EMPLACEMENT"));
	}

	foreach (i, town in towns) {
		if (town == null) continue;
		GSTown.SetName(town, PROJECT_TOWNS[i]);
		/* croissance initiale, puis plus aucune : la carte reste telle quelle */
		local left = TOWN_HOUSES[i];
		while (left > 0) {
			GSTown.ExpandTown(town, left > 20 ? 20 : left);
			left -= 20;
		}
		GSTown.SetGrowthRate(town, GSTown.TOWN_GROWTH_NONE);
	}
	return towns;
}

/* --- Routes ------------------------------------------------------------------ */

function PortfolioGS::IsWater(t)
{
	return GSTile.IsWaterTile(t) || GSTile.IsRiverTile(t) || GSTile.IsCoastTile(t);
}

function PortfolioGS::Passable(t)
{
	if (!GSMap.IsValidTile(t) || (t in this.blocked)) return false;
	local x = GSMap.GetTileX(t), y = GSMap.GetTileY(t);
	if (x < 2 || y < 2 || x > this.sx - 3 || y > this.sy - 3) return false;
	if (GSRoad.IsRoadTile(t)) return !GSRoad.IsRoadStationTile(t) && !GSRoad.IsRoadDepotTile(t) && !GSBridge.IsBridgeTile(t);
	if (this.IsWater(t)) return false;
	return GSTile.IsBuildable(t) && !GSTile.IsSteepSlope(GSTile.GetSlope(t));
}

function PortfolioGS::StepCost(t)
{
	if (GSRoad.IsRoadTile(t)) return 4;
	return GSTile.GetSlope(t) == GSTile.SLOPE_FLAT ? 10 : 22;
}

/* Tas binaire minimal (priorité, valeur) pour l'A*. */
class Heap {
	items = null;
	constructor() { this.items = []; }
	function Len() { return this.items.len(); }
	function Push(p, v) {
		local a = this.items;
		a.push([p, v]);
		local i = a.len() - 1;
		while (i > 0) {
			local up = (i - 1) / 2;
			if (a[up][0] <= a[i][0]) break;
			local tmp = a[up]; a[up] = a[i]; a[i] = tmp;
			i = up;
		}
	}
	function Pop() {
		local a = this.items;
		local top = a[0];
		local last = a.pop();
		if (a.len() > 0) {
			a[0] = last;
			local i = 0, n = a.len();
			while (true) {
				local l = 2 * i + 1, r = l + 1, m = i;
				if (l < n && a[l][0] < a[m][0]) m = l;
				if (r < n && a[r][0] < a[m][0]) m = r;
				if (m == i) break;
				local tmp = a[m]; a[m] = a[i]; a[i] = tmp;
				i = m;
			}
		}
		return top[1];
	}
}

/* Pont routier possible de `from` (terre) vers la première tuile de terre après l'eau
 * dans la direction `d` ? Renvoie la tuile d'arrivée ou null. */
function PortfolioGS::BridgeEnd(from, d)
{
	local t = from + d;
	local len = 1;
	while (len <= 12 && GSMap.IsValidTile(t) && this.IsWater(t)) { t += d; len++; }
	if (len < 2 || len > 12 || !GSMap.IsValidTile(t) || !this.Passable(t) || GSRoad.IsRoadTile(t)) return null;
	local bridges = GSBridgeList_Length(len + 1);
	if (bridges.IsEmpty()) return null;
	local test = GSTestMode();
	if (!GSBridge.BuildBridge(GSVehicle.VT_ROAD, bridges.Begin(), from, t)) return null;
	return t;
}

function PortfolioGS::FindPath(start, goal)
{
	local dirs = [1, -1, this.sx, -this.sx];
	local gx = GSMap.GetTileX(goal), gy = GSMap.GetTileY(goal);
	local open = Heap();
	local g = {}, came = {}, bridge = {};
	g[start] <- 0;
	came[start] <- null;
	open.Push(0, start);
	local expanded = 0;
	while (open.Len() > 0) {
		local cur = open.Pop();
		if (cur == goal) break;
		if (++expanded > 40000) return null;
		local prev = came[cur];
		foreach (d in dirs) {
			local next = cur + d;
			local cost = 0, isBridge = false;
			if (this.Passable(next) || next == goal) {
				cost = this.StepCost(next);
				if (prev != null && cur - prev != d) cost += 6;   // virage
			} else if (GSMap.IsValidTile(next) && this.IsWater(next) && (prev == null || cur - prev == d) && !GSRoad.IsRoadTile(cur)) {
				local end = this.BridgeEnd(cur, d);
				if (end == null) continue;
				next = end;
				cost = 60 + 15 * GSMap.DistanceManhattan(cur, end);
				isBridge = true;
			} else {
				continue;
			}
			local ng = g[cur] + cost;
			if ((next in g) && g[next] <= ng) continue;
			g[next] <- ng;
			came[next] <- cur;
			if (isBridge) bridge[next] <- true; else if (next in bridge) delete bridge[next];
			local h = 8 * (abs(GSMap.GetTileX(next) - gx) + abs(GSMap.GetTileY(next) - gy));
			open.Push(ng + h, next);
		}
	}
	if (!(goal in came)) return null;
	local path = [];
	for (local t = goal; t != null; t = came[t]) path.push([t, (t in bridge)]);
	path.reverse();
	return path;
}

function PortfolioGS::BuildPath(path)
{
	for (local i = 1; i < path.len(); i++) {
		local a = path[i - 1][0], b = path[i][0];
		if (path[i][1]) {
			local bridges = GSBridgeList_Length(GSMap.DistanceManhattan(a, b) + 1);
			bridges.Valuate(GSBridge.GetMaxSpeed);
			bridges.Sort(GSList.SORT_BY_VALUE, false);
			if (!GSBridge.BuildBridge(GSVehicle.VT_ROAD, bridges.Begin(), a, b)) {
				GSLog.Warning("pont impossible " + a + " -> " + b + " : " + GSError.GetLastErrorString());
				this.blocked[a] <- true;
				return false;
			}
			continue;
		}
		if (GSRoad.AreRoadTilesConnected(a, b)) continue;
		if (!GSRoad.BuildRoad(a, b) && GSError.GetLastError() != GSError.ERR_ALREADY_BUILT) {
			GSLog.Warning("route impossible " + a + " -> " + b + " : " + GSError.GetLastErrorString());
			this.blocked[GSRoad.IsRoadTile(b) ? a : b] <- true;
			return false;
		}
	}
	return true;
}

function PortfolioGS::ConnectTowns(ta, tb)
{
	if (ta == null || tb == null) return false;
	local a = GSTown.GetLocation(ta), b = GSTown.GetLocation(tb);
	for (local attempt = 0; attempt < 8; attempt++) {
		local path = this.FindPath(a, b);
		if (path == null) return false;
		if (this.BuildPath(path)) return true;
	}
	return false;
}

/* --- Bus ---------------------------------------------------------------------- */

function PortfolioGS::FindStopTile(town)
{
	local c = GSTown.GetLocation(town);
	local cx = GSMap.GetTileX(c), cy = GSMap.GetTileY(c);
	for (local r = 1; r <= 8; r++) {
		for (local dx = -r; dx <= r; dx++) {
			for (local dy = -r; dy <= r; dy++) {
				if (abs(dx) != r && abs(dy) != r) continue;
				local t = this.Tile(cx + dx, cy + dy);
				if (!GSMap.IsValidTile(t) || !GSRoad.IsRoadTile(t) || GSRoad.IsRoadStationTile(t)) continue;
				if (GSTile.GetSlope(t) != GSTile.SLOPE_FLAT || GSBridge.IsBridgeTile(t)) continue;
				foreach (pair in [[1, this.sx], [this.sx, 1]]) {
					local d = pair[0], side = pair[1];
					if (GSRoad.AreRoadTilesConnected(t, t + d) && GSRoad.AreRoadTilesConnected(t, t - d)
							&& !GSRoad.AreRoadTilesConnected(t, t + side) && !GSRoad.AreRoadTilesConnected(t, t - side)) {
						if (GSRoad.BuildDriveThroughRoadStation(t, t + d, GSRoad.ROADVEHTYPE_BUS, GSStation.STATION_NEW)) return t;
					}
				}
			}
		}
	}
	return null;
}

function PortfolioGS::BuildDepot(town)
{
	local c = GSTown.GetLocation(town);
	local cx = GSMap.GetTileX(c), cy = GSMap.GetTileY(c);
	for (local r = 2; r <= 10; r++) {
		for (local dx = -r; dx <= r; dx++) {
			for (local dy = -r; dy <= r; dy++) {
				if (abs(dx) != r && abs(dy) != r) continue;
				local t = this.Tile(cx + dx, cy + dy);
				if (!GSMap.IsValidTile(t) || !GSTile.IsBuildable(t) || GSTile.GetSlope(t) != GSTile.SLOPE_FLAT) continue;
				foreach (d in [1, -1, this.sx, -this.sx]) {
					local front = t + d;
					if (!GSRoad.IsRoadTile(front) || GSRoad.IsRoadStationTile(front) || GSTile.GetSlope(front) != GSTile.SLOPE_FLAT) continue;
					if (GSRoad.BuildRoadDepot(t, front) && GSRoad.BuildRoad(t, front)) return t;
				}
			}
		}
	}
	return null;
}

function PortfolioGS::BuildBusLines(towns)
{
	/* Le script démarre pendant la génération du monde, avant la création de la
	 * compagnie du joueur : on l'attend. */
	local company = GSCompany.COMPANY_INVALID;
	for (local i = 0; i < 2000 && company == GSCompany.COMPANY_INVALID; i++) {
		company = GSCompany.ResolveCompanyID(GSCompany.COMPANY_FIRST);
		if (company == GSCompany.COMPANY_INVALID) GSController.Sleep(1);
	}
	if (company == GSCompany.COMPANY_INVALID) { GSLog.Warning("aucune compagnie : pas de bus"); return; }
	/* un capital confortable (affiché dans la barre d'état), sans emprunt */
	GSCompany.ChangeBankBalance(company, 2000000, GSCompany.EXPENSES_OTHER, GSMap.TILE_INVALID);
	local mode = GSCompanyMode(company);
	GSCompany.SetName("Portfolio Transport");
	GSCompany.SetLoanAmount(0);
	GSRoad.SetCurrentRoadType(GSRoad.ROADTYPE_ROAD);

	local stops = [];
	foreach (town in towns) stops.push(town == null ? null : this.FindStopTile(town));
	local depot = this.BuildDepot(towns[CENTER]);
	if (depot == null || stops[CENTER] == null) { GSLog.Warning("pas de dépôt ou d'arrêt central"); return; }

	local passengers = null;
	foreach (cargo, _ in GSCargoList()) if (GSCargo.HasCargoClass(cargo, GSCargo.CC_PASSENGERS)) { passengers = cargo; break; }
	local engines = GSEngineList(GSVehicle.VT_ROAD);
	engines.Valuate(GSEngine.IsBuildable);
	engines.KeepValue(1);
	engines.Valuate(GSEngine.GetCargoType);
	engines.KeepValue(passengers);
	engines.Valuate(GSEngine.GetRoadType);
	engines.KeepValue(GSRoad.ROADTYPE_ROAD);
	engines.Valuate(GSEngine.GetMaxSpeed);
	engines.Sort(GSList.SORT_BY_VALUE, false);
	if (engines.IsEmpty()) { GSLog.Warning("aucun modèle de bus disponible"); return; }
	local engine = engines.Begin();
	GSLog.Info("Bus : " + GSEngine.GetName(engine));

	foreach (i, stop in stops) {
		if (i == CENTER || stop == null) continue;
		for (local n = 0; n < 2; n++) {
			local v = GSVehicle.BuildVehicle(depot, engine);
			if (!GSVehicle.IsValidVehicle(v)) { GSLog.Warning("achat du bus impossible : " + GSError.GetLastErrorString()); continue; }
			local first = n == 0 ? stop : stops[CENTER], second = n == 0 ? stops[CENTER] : stop;
			GSOrder.AppendOrder(v, first, GSOrder.OF_NONE);
			GSOrder.AppendOrder(v, second, GSOrder.OF_NONE);
			GSVehicle.StartStopVehicle(v);
		}
		GSLog.Info("Ligne de bus " + PROJECT_TOWNS[CENTER] + " - " + PROJECT_TOWNS[i]);
	}
}
