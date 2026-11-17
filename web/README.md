# zw-stegano browser UI

The page at https://hamkee.net/stegano/: `index.html` (UI) and `stegano.js` (the JavaScript
encoder/decoder). Everything runs in the browser.

- **Live capacity.** As the carrier or the message changes, the Encode tab shows how many
  bytes fit, how many the message uses (user-perceived characters and UTF-8 bytes) and, when it
  does not fit, by how much and what to change. Encode is enabled only when it fits.
  `Stegano.encode()` still validates and never truncates. The browser's rule mirrors
  `stegano.js`: a message of n bytes needs 2 + 2n word boundaries (a 1-byte length plus 2 symbols
  per byte), at most 255 bytes, counted after CRLF→LF and dropping trailing whitespace.
- **Remove hidden characters** (`Stegano.strip`) deletes every symbol of the alphabet and gives
  back the plain text. It does not decode.
- `stegano.js` frames with a 1-byte header. The C tool now uses a 3-byte header with an integrity
  check, so the two are no longer cross-compatible.
- **Alphabet (2026-11-17).** The encoder writes only variation selectors U+FE00–FE0A and
  U+2060–2064. The earlier alphabet included bidi controls (LRM, RLM, LRE, RLE, PDF, LRO, LRI, RLI)
  that it opened and never closed, so encoded text visibly reordered words and moved spaces; ZWSP,
  ZWNJ and ZWJ also changed how Arabic and Hebrew render. Those 11 symbols are still read: each
  means the same nibble as its replacement, so older messages decode unchanged. Header, framing,
  seeding and capacity did not change.

Tests: `node web/tests/ui.cjs` (Playwright and Chromium) and `node web/tests/bidi.cjs` (Chromium and
Firefox: the result renders pixel-identical to the carrier, in the page and pasted as plain text;
legacy messages decode). Screenshots in `$SHOTS`.
Deploy: `web/deploy.sh` (archives the live files on the webserver, installs HEAD's `web/`, checks
the public bytes). Roll back: `web/deploy.sh rollback ~/backups/stegano-<time>`.
