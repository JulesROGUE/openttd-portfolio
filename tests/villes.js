// Test complet : audio bloqué avant le premier clic, une maison par ville, collaborateurs.
const { chromium } = require('playwright-core');
const url = process.argv[2] || 'http://127.0.0.1:8094/openttd/';
const out = process.argv[3] || __dirname;
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',
    ignoreDefaultArgs: ['--autoplay-policy=no-user-gesture-required'],
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  page.on('console', (m) => { const t = m.text(); if (/\[(musique|son|portfolio)\]|Bruitages|rror/.test(t) && !/missing|incomplete/.test(t)) console.log('  console:', t.slice(0, 160)); });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(url);
  await page.waitForSelector('#loading.done', { state: 'attached', timeout: 180000 });
  await page.waitForTimeout(3000);
  const audio = () => page.evaluate(() => JSON.stringify(window.pfAudioState()));
  console.log('audio avant tout clic :', await audio());
  const point = (i) => page.evaluate((i) => Module.ccall('pf_test_house_point', 'number', ['number'], [i]), i);
  const windows = () => page.evaluate(() => Module.ccall('pf_test_project_windows', 'number', [], []));
  const names = ['Cube 2 Portfolio', 'Mineport', 'Magic Shape Generator', 'Portfolio OS', 'Leboncoin Auto'];
  for (let i = 0; i < 5; i++) {
    // ligne i de la liste des projets (fenêtre d'accueil) : la carte va sur la ville
    await page.mouse.click(60, 97 + 16 * i);
    await page.waitForTimeout(1500);
    // on ferme les fiches (touche Suppr : fermer les fenêtres non vitales) puis on clique une maison
    await page.keyboard.press('Delete');
    await page.waitForTimeout(500);
    const p = await point(i);
    if (p < 0) { console.log(names[i], ': maison hors écran'); continue; }
    await page.mouse.click(p >> 16, p & 0xffff);
    await page.waitForTimeout(1200);
    console.log(names[i], ': maison', p >> 16, p & 0xffff, '-> fiches ouvertes', await windows());
    await page.screenshot({ path: `${out}/ville-${i}.png` });
  }
  console.log('audio après les clics :', await audio());
  await page.keyboard.press('Delete');
  // ouvrir la fenêtre d'accueil n'est plus possible après Suppr ? on passe par une fiche
  const p = await point(4);
  await page.mouse.click(p >> 16, p & 0xffff);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/fiche-leboncoin.png` });
  await page.waitForTimeout(6000);
  console.log('audio 6 s plus tard :', await audio());
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
