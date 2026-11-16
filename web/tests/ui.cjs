/* Browser checks for web/index.html (live capacity, encode/decode, strip, layout).
   Serves web/ on 127.0.0.1, drives Chromium with Playwright, writes screenshots to $SHOTS.
   Run: node web/tests/ui.cjs   (Playwright from NODE_PATH or a global install)
   STEGANO_URL=https://hamkee.net/stegano/ runs the same checks against the live page. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = process.env.SHOTS || path.join(require('os').tmpdir(), 'stegano-shots');
fs.mkdirSync(SHOTS, { recursive: true });
let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} ${detail}`); };

const server = http.createServer((req, res) => {
  const f = path.join(ROOT, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
  fs.createReadStream(f).pipe(res);
});

const words = n => Array.from({ length: n + 1 }, (_, i) => `w${i}`).join(' ');   // n boundaries

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = process.env.STEGANO_URL || `http://127.0.0.1:${server.address().port}/`;   // e.g. https://hamkee.net/stegano/
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1300 } });
  page.on('pageerror', e => check('no page error', false, e.message));
  await page.goto(url);

  const meter = async () => page.evaluate(() => ({
    cls: document.getElementById('enc-meter').className,
    figure: document.getElementById('enc-meter-figure').textContent,
    verdict: document.getElementById('enc-meter-verdict').textContent,
    detail: document.getElementById('enc-meter-detail').textContent,
    disabled: document.getElementById('enc-btn').disabled,
  }));
  const setFields = async (carrier, secret) => {
    await page.fill('#enc-carrier', carrier);
    await page.fill('#enc-secret', secret);
  };
  const encodeOk = (carrier, secret) => page.evaluate(([c, s]) => {
    try { Stegano.encode(c, s, ''); return true; } catch (e) { return false; }
  }, [carrier, secret]);

  // Empty states
  let m = await meter();
  check('no carrier: guidance, Encode disabled', m.disabled && /Paste a carrier/.test(m.verdict));
  await setFields(words(22), '');
  m = await meter();
  check('empty message: labelled estimate', m.disabled && /Room for up to 10 bytes/.test(m.verdict) && /Estimate/.test(m.verdict), m.verdict);

  // Capacity cases: [label, secret, expected graphemes, expected bytes]
  const cases = [
    ['ASCII', 'hello', 5, 5],
    ['Spanish accents', '¡Hola, señor Muñoz! ¿Qué tal?', 29, 34],
    ['emoji', '👍🙂', 2, 8],
    ['ZWJ family emoji', '👨‍👩‍👧', 1, 18],
    ['flag emoji', '🇪🇸', 1, 8],
    ['CJK', '漢字テスト', 5, 15],
    ['Arabic', 'مرحبا', 5, 10],
    ['combining accent', 'é', 1, 3],
  ];
  for (const [label, secret, chars, bytes] of cases) {
    const exact = words(2 + 2 * bytes);           // exactly 2 + 2n boundaries: exact fit
    await setFields(exact, secret);
    m = await meter();
    const fitsUI = !m.disabled && /Fits/.test(m.verdict) && /Exactly full/.test(m.verdict);
    const shows = m.verdict.includes(`${chars} character`) && m.verdict.includes(`${bytes} byte`);
    check(`${label}: exact fit (${chars} chars, ${bytes} B, ${2 + 2 * bytes} boundaries)`,
      fitsUI && shows && await encodeOk(exact, secret), m.verdict);
    const short = words(2 + 2 * bytes - 1);       // one boundary short: one byte over
    await setFields(short, secret);
    m = await meter();
    check(`${label}: one over refused before the click`,
      m.disabled && /Too long by 1 byte\b/.test(m.verdict) && /1 more word boundary/.test(m.detail) && !(await encodeOk(short, secret)),
      m.verdict + ' | ' + m.detail);
  }

  // Framing overhead: 2 boundaries hold 0 bytes, 3 still 0, 4 hold 1
  for (const [b, max] of [[1, 0], [2, 0], [3, 0], [4, 1], [5, 1]]) {
    await setFields(words(b), '');
    m = await meter();
    check(`framing: ${b} boundaries -> ${max} bytes`, m.figure === `0 / ${max} bytes`, m.figure);
  }

  // The 255-byte format cap, whatever the carrier
  const big = words(1000);
  await setFields(big, 'a'.repeat(255));
  m = await meter();
  check('255 bytes fit in a large carrier', !m.disabled && /Exactly full/.test(m.verdict) && await encodeOk(big, 'a'.repeat(255)));
  await setFields(big, 'a'.repeat(256));
  m = await meter();
  check('256 bytes refused with the format cap', m.disabled && /at most 255 bytes/.test(m.detail) && !(await encodeOk(big, 'a'.repeat(256))), m.detail);
  await setFields(big, 'ñ'.repeat(128));
  m = await meter();
  check('128 x ñ = 256 bytes refused (characters vs bytes)', m.disabled && /128 characters = 256 bytes/.test(m.verdict), m.verdict);

  // Normalisation: CRLF and trailing whitespace do not change capacity
  await setFields('a\r\nb\r\nc d e f   \n\n  ', '');
  m = await meter();
  const lf = await page.evaluate(() => Stegano.capacity('a\nb\nc d e f').boundaries);
  check('CRLF + trailing whitespace counted like Stegano', m.figure === `0 / ${Math.floor((lf - 2) / 2)} bytes`, `${m.figure} (lf ${lf})`);

  // Randomised agreement between the meter's verdict and encode()
  const agree = await page.evaluate(() => {
    const pool = ['a', 'é', 'ñ', '😀', '👨‍👩‍👧', '漢', ' ', 'z'];
    let bad = 0;
    for (let i = 0; i < 400; i++) {
      const b = Math.floor(Math.random() * 60);
      const carrier = Array.from({ length: b + 1 }, (_, k) => 'x' + k).join(Math.random() < .2 ? '\n' : ' ');
      let secret = '';
      const n = 1 + Math.floor(Math.random() * 30);
      for (let k = 0; k < n; k++) secret += pool[Math.floor(Math.random() * pool.length)];
      let ok; try { Stegano.encode(carrier, secret, ''); ok = true; } catch (e) { ok = false; }
      if (plan(carrier, secret).fits !== ok) bad++;
    }
    return bad;
  });
  check('meter verdict == encode() result on 400 random cases', agree === 0, `${agree} disagreements`);

  // Encode -> decode round trips through the UI, nothing truncated
  const carrier = Array(4).fill('The quick brown fox jumps over the lazy dog while the cat watches from the old wooden fence in the warm afternoon sun.').join('\n');
  for (const [secret, pass] of [['Nos vemos mañana a las 8 👍', ''], ['meet at noon', 'correct horse']]) {
    await page.click('[data-tab=encode]');
    await setFields(carrier, secret);
    await page.fill('#enc-pass', pass);
    await page.click('#enc-btn');
    const out = await page.inputValue('#enc-result');
    const st = await page.textContent('#enc-status');
    await page.click('[data-tab=decode]');
    await page.fill('#dec-input', out);
    await page.fill('#dec-pass', pass);
    await page.click('#dec-btn');
    const got = await page.inputValue('#dec-result');
    check(`round trip ${pass ? 'with' : 'without'} passphrase`, got === secret && /Encoded/.test(st), `${JSON.stringify(got)} | ${st}`);
    if (!pass) await page.screenshot({ path: path.join(SHOTS, 'decode.png'), fullPage: true });
    if (pass) {
      await page.fill('#dec-pass', 'wrong');
      await page.click('#dec-btn');
      const wrong = await page.inputValue('#dec-result');
      check('wrong passphrase does not return the message', wrong !== secret, await page.textContent('#dec-status'));
    }
  }

  // Error cases
  await page.click('[data-tab=decode]');
  await page.fill('#dec-input', 'plain'); await page.fill('#dec-pass', '');
  await page.click('#dec-btn');
  check('decode with no boundaries: error shown', /Not enough word boundaries/.test(await page.textContent('#dec-status')));

  // Remove hidden characters
  await page.click('[data-tab=encode]');
  await setFields(carrier, 'hi'); await page.fill('#enc-pass', '');
  await page.click('#enc-btn');
  const stego = await page.inputValue('#enc-result');
  await page.click('[data-tab=strip]');
  await page.fill('#strip-input', stego);
  await page.click('#strip-btn');
  check('remove hidden characters gives back the carrier', await page.inputValue('#strip-result') === carrier,
    await page.textContent('#strip-status'));
  await page.screenshot({ path: path.join(SHOTS, 'strip.png'), fullPage: true });
  await page.fill('#strip-input', carrier);
  await page.click('#strip-btn');
  check('clean text: says nothing was found', /No hidden characters found/.test(await page.textContent('#strip-status')));
  check('no Capacity tab', await page.locator('[data-tab=capacity]').count() === 0);

  // An earlier result is cleared as soon as an input changes
  await page.click('[data-tab=encode]');
  await setFields(carrier, 'hi'); await page.click('#enc-btn');
  const had = await page.inputValue('#enc-result');
  await page.fill('#enc-secret', 'hi!');
  check('stale result cleared on input', had.length > 0 && await page.inputValue('#enc-result') === '' &&
    await page.textContent('#enc-stats') === '');
  // Disabled Encode never looks primary, even under the mouse
  await setFields(words(3), 'too long');
  await page.hover('#enc-btn'); await page.waitForTimeout(300);
  const dis = await page.evaluate(() => getComputedStyle(document.getElementById('enc-btn')).backgroundColor);
  check('disabled Encode is not filled on hover', dis === 'rgba(0, 0, 0, 0)', dis);

  // Screenshots of the encode states
  await setFields(carrier, 'Nos vemos mañana 👍');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, 'encode-fits.png'), fullPage: true });
  await setFields(words(20), '¡Hola! Nos vemos mañana en la estación 🚉');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, 'encode-over.png'), fullPage: true });

  // Narrow / mobile layout
  const mob = await browser.newPage({ viewport: { width: 375, height: 800 }, isMobile: true, hasTouch: true });
  await mob.goto(url);
  await mob.fill('#enc-carrier', carrier);
  await mob.fill('#enc-secret', 'Nos vemos mañana 👍');
  const overflow = await mob.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('mobile: no horizontal overflow', overflow <= 0, `${overflow}px`);
  await mob.waitForTimeout(300);
  const mbg = await mob.evaluate(() => getComputedStyle(document.getElementById('enc-btn')).backgroundColor);
  check('mobile: Encode enabled, visible and primary', await mob.isEnabled('#enc-btn') && await mob.isVisible('#enc-btn') && mbg === 'rgb(76, 92, 150)', mbg);
  const tabsFit = await mob.evaluate(() => [...document.querySelectorAll('.tab')].every(t => t.getBoundingClientRect().right <= window.innerWidth));
  check('mobile: every tab label fully visible', tabsFit);
  await mob.screenshot({ path: path.join(SHOTS, 'mobile.png'), fullPage: true });

  await browser.close();
  server.close();
  console.log(`\nscreenshots: ${SHOTS}\n${fails ? `${fails} failed` : 'all as expected'}`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
