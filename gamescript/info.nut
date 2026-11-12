/*
 * OpenTTD Portfolio — script de jeu (GameScript) qui construit la carte du portfolio :
 * une ville par projet, des routes entre les villes et quelques lignes de bus.
 * Il ne tourne qu'une fois, pendant le build (génération de la sauvegarde) ;
 * ensuite il se contente de dormir.
 */
class PortfolioGS extends GSInfo {
	function GetAuthor()      { return "Jules ROGUE"; }
	function GetName()        { return "PortfolioGS"; }
	function GetShortName()   { return "PFGS"; }
	function GetDescription() { return "Carte du portfolio de Jules ROGUE : une ville par projet."; }
	function GetVersion()     { return 1; }
	function GetDate()        { return "2026-11-12"; }
	function CreateInstance() { return "PortfolioGS"; }
	function GetAPIVersion()  { return "15"; }
	function GetURL()         { return "https://github.com/JulesROGUE/openttd-portfolio"; }
	function GetSettings()    { }
}

RegisterGS(PortfolioGS());
