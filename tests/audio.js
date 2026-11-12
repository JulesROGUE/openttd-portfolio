// Simule la règle d'autoplay d'un vrai navigateur (Chromium sans affichage l'accorde
// toujours) : tout AudioContext naît « suspended » et seul resume() le démarre.
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  await page.addInitScript(() => {
    const AC = window.AudioContext;
    window.AudioContext = function (...a) { const c = new AC(...a); c.suspend(); window.__ctxs = (window.__ctxs || []).concat([c]); return c; };
    window.AudioContext.prototype = AC.prototype;
  });
  page.on('console', (m) => { const t = m.text(); if (/\[(musique|son)\]|Bruitages/.test(t)) console.log('  console:', t.slice(0, 150)); });
  await page.goto(process.argv[2]);
  await page.waitForSelector('#loading.done', { state: 'attached', timeout: 180000 });
  await page.waitForTimeout(4000);
  const st = () => page.evaluate(() => JSON.stringify(Object.assign(pfAudioState(), { contexts: (window.__ctxs || []).map((c) => c.state) })));
  console.log('avant clic :', await st());
  await page.mouse.click(700, 500);
  await page.waitForTimeout(4000);
  console.log('après clic :', await st());
  await browser.close();
})();
