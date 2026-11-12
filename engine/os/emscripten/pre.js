/*
 * OpenTTD Portfolio : remplace os/emscripten/pre.js d'OpenTTD.
 * Lance directement ProjectsLand, la carte du portfolio (sauvegarde /projectsland.sav), avec les
 * réglages /openttd.cfg, le son SDL (bruitages) et le pilote de musique Web Audio.
 * Pas de stockage persistant (IDBFS) ni de réseau : chaque visite repart de la carte.
 */
Module.arguments = Module.arguments || [];
Module.arguments.push('-vsdl', '-ssdl:samples=2048', '-memscripten', '-c', '/openttd.cfg', '-g', '/projectsland.sav');
Module.preRun = Module.preRun || [];

Module.preRun.push(function () {
    FS.mkdirTree('/home/web_user/.openttd');

    window.openttd_syncfs = function (callback) { if (callback) callback(); };
    window.openttd_exit = function () { if (Module.onExit) Module.onExit(); };
    window.openttd_abort = function () { if (Module.onAbort) Module.onAbort(); };
    window.openttd_bootstrap = function () {};
    window.openttd_bootstrap_failed = function () { if (Module.onAbort) Module.onAbort(); };
    window.openttd_bootstrap_reload = function () {};
    window.openttd_server_list = function () {};

    /* Ouverture d'un lien (bouton « Open link ») : on attend que le bouton de la
     * souris soit relâché, sinon il reste enfoncé dans le jeu (repris d'OpenTTD). */
    var leftButtonDown = false;
    document.addEventListener('mousedown', function (e) { if (e.button == 0) leftButtonDown = true; });
    document.addEventListener('mouseup', function (e) { if (e.button == 0) leftButtonDown = false; });
    window.openttd_open_url = function (url, url_len) {
        var url_string = UTF8ToString(url, url_len);
        if (!/^https?:\/\//.test(url_string)) return;
        function openWindow() {
            document.removeEventListener('mouseup', openWindow);
            window.open(url_string, '_blank', 'noopener');
        }
        if (leftButtonDown) document.addEventListener('mouseup', openWindow);
        else openWindow();
    };
});
