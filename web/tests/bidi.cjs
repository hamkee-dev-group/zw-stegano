/* The encoded result must LOOK like the carrier: same visible text, same order, same line breaks,
   in the page and after copy/paste into an independent plain-text renderer.
   2026-11-17: the old alphabet wrote unclosed bidi controls (RLE, LRE, LRO, RLI, LRI, RLM, ...),
   so the result showed words reordered and spaces moved ("doesUnicode").
   Renderers: Chromium (the page's own result box) and Firefox rendering a text/plain document.
   Run: node web/tests/bidi.cjs   (Playwright with chromium and firefox; screenshots in $SHOTS)
   STEGANO_URL=https://hamkee.net/stegano/ runs the page checks against the live site. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium, firefox } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = process.env.SHOTS || path.join(require('os').tmpdir(), 'stegano-bidi-shots');
fs.mkdirSync(SHOTS, { recursive: true });
// The codec as it was before the fix (761a158), to prove the rendering check catches the bug and
// that its messages still decode.
const LEGACY_JS = execFileSync('git', ['-C', ROOT, 'show', '761a158:web/stegano.js']).toString()
  .replace('const Stegano =', 'window.LegacyStegano =');
let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} ${detail}`); };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/plain') {                       // the "pasted" text as a plain document
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end(PLAIN[url.searchParams.get('k')] || '');
  }
  const f = path.join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
  fs.createReadStream(f).pipe(res);
});
const PLAIN = {};

const CARRIERS = {
  // synthetic, about the size of the owner's 512-byte carrier
  english: 'This short note is only a test of hidden text. It has ordinary words, some punctuation, ' +
    'and a few lines so that the result box wraps it like a real paragraph would wrap.\n' +
    'Second line: the quick brown fox jumps over the lazy dog, then rests in the warm afternoon sun ' +
    'while the old clock on the wall keeps ticking and nobody notices anything unusual at all.',
  accents_emoji: 'Él señor Muñoz llegó a la estación 🚉 con su perro 🐕 y un café ☕ para los niños. ' +
    'Después fueron juntos al parque 🌳 a ver las aves 🐦 y comieron helado 🍦 bajo el sol de la tarde.',
  arabic: 'مرحبا بكم في المدينة القديمة حيث الشوارع ضيقة والناس طيبون جدا ويحبون الضيوف ' +
    'ويقدمون لهم القهوة والتمر في الصباح الباكر قبل أن تبدأ الأسواق في العمل',
  hebrew: 'שלום לכולם וברוכים הבאים לעיר העתיקה שבה הרחובות צרים והאנשים נחמדים מאוד ' +
    'ואוהבים לארח אורחים עם קפה ועוגה בבוקר לפני שהשווקים נפתחים',
  mixed: 'The word مرحبا means hello, and שלום means peace; both appear in this English sentence ' +
    'together with numbers like 2026 and an emoji 👋 so the bidi algorithm has real work to do here.',
};
// each carrier twice over, so every secret fits (the meter disables Encode otherwise)
for (const k of Object.keys(CARRIERS)) CARRIERS[k] = CARRIERS[k] + '\n' + CARRIERS[k];
const SECRETS = { english: 'meet at nine', accents_emoji: 'Nos vemos mañana 👍', arabic: 'سر صغير',
  hebrew: 'סוד קטן', mixed: 'ok 👌' };

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 1200 },
    permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.on('pageerror', e => check('no page error', false, e.message));
  await page.goto(process.env.STEGANO_URL || base + '/');   // e.g. https://hamkee.net/stegano/
  await page.addScriptTag({ content: LEGACY_JS });
  const ff = await firefox.launch();
  const ffp = await ff.newPage({ viewport: { width: 900, height: 700 } });

  // The result box rendered with a given text, as pixels.
  // The result box's own rendering (font, size, width, padding, line height, wrapping), copied
  // onto a plain element with no fixed height: a 6-row textarea near overflow toggles its
  // scrollbar and gives a different picture of the same text.
  await page.evaluate(() => {
    const r = document.getElementById('enc-result'), cs = getComputedStyle(r), d = document.createElement('div');
    d.id = 'render';
    for (const k of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop',
      'paddingRight', 'paddingBottom', 'paddingLeft', 'color', 'backgroundColor', 'direction', 'textAlign'])
      d.style[k] = cs[k];
    d.style.width = r.clientWidth + 'px'; d.style.whiteSpace = 'pre-wrap'; d.style.overflowWrap = 'break-word';
    d.style.boxSizing = 'border-box'; d.style.position = 'absolute'; d.style.left = '0'; d.style.top = '0'; d.style.zIndex = '9';
    document.body.appendChild(d);
  });
  const boxShot = async (text) => {
    await page.evaluate(t => { document.activeElement && document.activeElement.blur(); document.getElementById('render').textContent = t; }, text);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    return page.locator('#render').screenshot();
  };
  const plainShot = async (key, text) => {            // Firefox, text/plain document
    PLAIN[key] = text;
    await ffp.goto(`${base}/plain?k=${encodeURIComponent(key)}`);
    return ffp.screenshot({ fullPage: true });
  };

  for (const [name, carrier] of Object.entries(CARRIERS)) {
    const secret = SECRETS[name];
    for (const pass of ['', 'pass-7']) {
      // encode through the UI, as a user does
      await page.click('[data-tab=encode]');
      await page.fill('#enc-carrier', carrier);
      await page.fill('#enc-secret', secret);
      await page.fill('#enc-pass', pass);
      await page.click('#enc-btn');
      const stego = await page.inputValue('#enc-result');
      const tag = `${name}${pass ? ' +pass' : ''}`;
      check(`${tag}: encoded and longer than the carrier`, stego.length > carrier.length);

      // 1. rendered in the page: identical pixels to the carrier
      const want = await boxShot(carrier);
      const got = await boxShot(stego);
      const again = await boxShot(carrier);            // the reference itself must be stable
      check(`${tag}: carrier renders the same twice (stable reference)`, want.equals(again));
      check(`${tag}: result box renders exactly like the carrier (Chromium)`, again.equals(got));
      if (!pass) {
        fs.writeFileSync(path.join(SHOTS, `${name}-carrier.png`), want);
        fs.writeFileSync(path.join(SHOTS, `${name}-result.png`), got);
      }

      // 2. copy with the page's button, then paste into Firefox as a plain-text document
      await page.evaluate(t => { document.getElementById('enc-result').value = t; }, stego);
      await page.click('#enc-copy');
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      check(`${tag}: clipboard holds exactly the result`, clip === stego);
      const ffWant = await plainShot(`${name}-c`, carrier);
      const ffGot = await plainShot(`${name}-s`, clip);
      check(`${tag}: pasted text renders exactly like the carrier (Firefox text/plain)`, ffWant.equals(ffGot));

      // 3. exact round trip through the UI
      await page.click('[data-tab=decode]');
      await page.fill('#dec-input', clip);
      await page.fill('#dec-pass', pass);
      await page.click('#dec-btn');
      check(`${tag}: decodes exactly`, await page.inputValue('#dec-result') === secret);
    }
  }

  // The check catches the bug: the old alphabet does NOT render like the carrier.
  await page.click('[data-tab=encode]');            // the result box is on the Encode panel
  const legacyEnglish = await page.evaluate(([c, s]) => window.LegacyStegano.encode(c, s, '').text,
    [CARRIERS.english, SECRETS.english]);
  const oldShot = await boxShot(legacyEnglish);
  fs.writeFileSync(path.join(SHOTS, 'english-result-761a158.png'), oldShot);
  check('control: the 761a158 alphabet visibly differs from the carrier (the bug this fixes)',
    !(await boxShot(CARRIERS.english)).equals(oldShot));

  // 4. legacy messages (encoded by 761a158) still decode in the new UI
  for (const [name, carrier] of Object.entries(CARRIERS)) {
    for (const pass of ['', 'old-pass']) {
      const old = await page.evaluate(([c, s, p]) => window.LegacyStegano.encode(c, s, p).text,
        [carrier, SECRETS[name], pass]);
      await page.click('[data-tab=decode]');
      await page.fill('#dec-input', old);
      await page.fill('#dec-pass', pass);
      await page.click('#dec-btn');
      check(`legacy ${name}${pass ? ' +pass' : ''}: 761a158 message decodes`,
        await page.inputValue('#dec-result') === SECRETS[name]);
    }
  }

  // 5. no bidi control or joiner is ever written
  const emitted = await page.evaluate((cs) => {
    const bad = new Set([0x200B, 0x200C, 0x200D, 0x200E, 0x200F, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069]);
    let n = 0;
    for (let i = 0; i < 50; i++) for (const c of cs) for (const ch of Stegano.encode(c, 'x'.repeat(5), '').text)
      if (bad.has(ch.codePointAt(0))) n++;
    return n;
  }, Object.values(CARRIERS));
  check('no bidi control, ZWSP, ZWNJ or ZWJ in 250 encodings', emitted === 0, `${emitted} found`);

  await ff.close();
  await browser.close();
  server.close();
  console.log(`\nscreenshots: ${SHOTS}\n${fails ? `${fails} failed` : 'all as expected'}`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
