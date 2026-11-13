// Test complet : une maison par ville ouvre sa fiche, puis la fenêtre des collaborateurs.
// Aucun son ne doit exister : ni AudioContext, ni élément <audio>.
const { chromium } = require('playwright-core');
const url = process.argv[2] || 'http://127.0.0.1:8084/openttd/';
const out = process.argv[3] || __dirname;
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  await page.addInitScript(() => {
    window.__audio = 0;
    const AC = window.AudioContext;
    if (AC) window.AudioContext = function () { window.__audio++; return new AC(); };
  });
  page.on('console', (m) => { const t = m.text(); if (/\[portfolio\]|rror/.test(t)) console.log('  console:', t.slice(0, 160)); });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(url);
  await page.waitForSelector('#loading.done', { state: 'attached', timeout: 60000 });
  await page.waitForTimeout(1500);
  const point = (i) => page.evaluate((i) => OT.testHousePoint(i), i);
  const windows = () => page.evaluate(() => OT.testProjectWindows());
  const names = ['Cube 2 Portfolio', 'Mineport', 'Magic Shape Generator', 'Portfolio OS', 'Leboncoin Auto'];
  // ligne i de la liste des projets (fenêtre d'accueil) : la carte va sur la ville
  const row = (i) => page.evaluate((i) => {
    const w = OT.findWindowById('welcome');
    const b = w.widgets.find((x) => x.index === 2);
    const lh = OT.getCharacterHeight(0) + OT.data.widget.matrix[1] + OT.data.widget.matrix[3];
    return { x: w.left + b.r.left + 30, y: w.top + b.r.top + OT.data.widget.framerect[1] + lh * i + (lh >> 1) };
  }, i);
  for (let i = 0; i < 5; i++) {
    const r = await row(i);
    await page.mouse.click(r.x, r.y);
    await page.waitForTimeout(1500);
    // on ferme les fiches (touche Suppr : fermer les fenêtres non épinglées) puis on clique une maison
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);
    const p = await point(i);
    if (!p) { console.log(names[i], ': maison hors écran'); continue; }
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(800);
    console.log(names[i], ': maison', p.x, p.y, '-> fiches ouvertes', await windows());
    await page.screenshot({ path: `${out}/ville-${i}.png` });
  }
  await page.evaluate(() => OT.showPortfolioCollaborators());
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/collaborateurs.png` });
  const audio = await page.evaluate(() => ({ contexts: window.__audio, elements: document.querySelectorAll('audio, video').length }));
  console.log('son :', JSON.stringify(audio));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
