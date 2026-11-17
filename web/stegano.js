/**
 * stegano.js — Zero-width Unicode steganography
 *
 * Browser codec. It began as a port of stegano.c; the C tool has since moved to a 3-byte
 * header, so the two are not compatible.
 *
 * Alphabet:  16 invisible Unicode symbols (4 bits per insertion); the decoder also reads
 *            the legacy symbols (see LEGACY below)
 * Placement: word boundaries only (after whitespace)
 * Format:    1-byte length prefix + message (nibble-encoded)
 * Scatter:   xorshift64 PRNG + Fisher-Yates shuffle
 * Seed:      FNV-1a 64-bit hash of passphrase or carrier
 * Filler:    random symbols at unused positions (uniform cover)
 */
const Stegano = (() => {
    'use strict';

    const SYM_COUNT = 16;
    const MASK64 = (1n << 64n) - 1n;

    /*
     * Symbol alphabet: 16 invisible, default-ignorable Unicode chars (Cf and Mn),
     * none of them a bidi control, a joiner or a line-break character.
     *
     * NOT used (treated as whitespace by Python/JS runtimes):
     *   U+2028 Line Separator, U+2029 Paragraph Separator
     */
    const SYMBOLS = [
        '\uFE00',  // 0x0  Variation Selector-1
        '\uFE01',  // 0x1  Variation Selector-2
        '\uFE02',  // 0x2  Variation Selector-3
        '\uFE03',  // 0x3  Variation Selector-4
        '\uFE04',  // 0x4  Variation Selector-5
        '\uFE05',  // 0x5  Variation Selector-6
        '\uFE06',  // 0x6  Variation Selector-7
        '\uFE07',  // 0x7  Variation Selector-8
        '\uFE08',  // 0x8  Variation Selector-9
        '\u2060',  // 0x9  Word Joiner
        '\u2061',  // 0xA  Function Application
        '\u2062',  // 0xB  Invisible Times
        '\u2063',  // 0xC  Invisible Separator
        '\u2064',  // 0xD  Invisible Plus
        '\uFE09',  // 0xE  Variation Selector-10
        '\uFE0A',  // 0xF  Variation Selector-11
    ];

    /*
     * LEGACY: what 0x0-0x8, 0xE and 0xF were until 2026-11-17. Eight are bidi controls
     * (LRM, RLM, LRE, RLE, PDF, LRO, LRI, RLI): embeddings and isolates were opened and
     * never closed, so the encoded text visibly reordered words and moved spaces. ZWSP,
     * ZWNJ and ZWJ changed how Arabic and Hebrew render (measured in Chromium; ZWJ also
     * in Firefox). Each symbol above was chosen because, inserted after every space,
     * it leaves Latin, accented/emoji, Arabic, Hebrew and mixed text pixel-identical in
     * Chromium and Firefox. The old symbols are no longer written, only read: each means
     * the same nibble as its replacement, so text encoded with the old alphabet decodes
     * unchanged and no message is ambiguous.
     */
    const LEGACY = {
        '\u200B': 0x0,  // Zero Width Space
        '\u200C': 0x1,  // Zero Width Non-Joiner
        '\u200D': 0x2,  // Zero Width Joiner
        '\u200E': 0x3,  // Left-to-Right Mark
        '\u200F': 0x4,  // Right-to-Left Mark
        '\u202A': 0x5,  // LTR Embedding
        '\u202B': 0x6,  // RTL Embedding
        '\u202C': 0x7,  // Pop Directional Formatting
        '\u202D': 0x8,  // LTR Override
        '\u2066': 0xE,  // Left-to-Right Isolate
        '\u2067': 0xF,  // Right-to-Left Isolate
    };

    /* Reverse lookup: symbol char → nibble value (current and legacy symbols) */
    const SYM_TO_VAL = new Map();
    SYMBOLS.forEach((s, i) => SYM_TO_VAL.set(s, i));
    Object.entries(LEGACY).forEach(([s, v]) => SYM_TO_VAL.set(s, v));

    /* ── xorshift64 PRNG ─────────────────────────────────────────── */

    function prngNext(state) {
        let x = state.s;
        x ^= (x << 13n) & MASK64;
        x ^= x >> 7n;
        x ^= (x << 17n) & MASK64;
        x &= MASK64;
        state.s = x;
        return x;
    }

    /* ── FNV-1a 64-bit hash ──────────────────────────────────────── */

    function fnv1a(bytes) {
        let h = 14695981039346656037n;
        for (let i = 0; i < bytes.length; i++) {
            h ^= BigInt(bytes[i]);
            h = (h * 1099511628211n) & MASK64;
        }
        return h;
    }

    /* ── Fisher-Yates shuffle ────────────────────────────────────── */

    function shuffle(arr, rng) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Number(prngNext(rng) % BigInt(i + 1));
            const tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
        }
    }

    /* ── Helpers ─────────────────────────────────────────────────── */

    function isWordBoundary(ch) {
        return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
    }

    /** Normalize: CRLF → LF, then strip trailing whitespace.
     *  Makes encoder/decoder agree on boundary count regardless of
     *  platform line-endings or tools that append newlines. */
    function normalizeInput(text) {
        text = text.replace(/\r\n/g, '\n');
        let end = text.length;
        while (end > 0 && isWordBoundary(text[end - 1])) end--;
        return text.slice(0, end);
    }

    function countBoundaries(text) {
        let n = 0;
        for (const ch of text) {
            if (isWordBoundary(ch)) n++;
        }
        return n;
    }

    function decodeSymbol(ch) {
        const v = SYM_TO_VAL.get(ch);
        return v !== undefined ? v : -1;
    }

    /** Compute PRNG seed: FNV-1a of passphrase (if given) or text. */
    function computeSeed(text, passphrase) {
        const enc = new TextEncoder();
        return (passphrase && passphrase.length > 0)
            ? fnv1a(enc.encode(passphrase))
            : fnv1a(enc.encode(text));
    }

    /* ── Strip: remove all hidden symbols ────────────────────────── */

    function strip(text) {
        let out = '';
        for (const ch of text) {
            if (!SYM_TO_VAL.has(ch)) out += ch;
        }
        return out;
    }

    /* ── Capacity ────────────────────────────────────────────────── */

    function capacity(carrier) {
        carrier = normalizeInput(carrier);
        const b = countBoundaries(carrier);
        return {
            boundaries: b,
            maxSecret: b >= 2 ? Math.floor((b - 2) / 2) : 0,
        };
    }

    /* ── Encode ──────────────────────────────────────────────────── */

    function encode(carrier, secret, passphrase) {
        const enc = new TextEncoder();
        carrier = normalizeInput(carrier);

        const secretBytes = enc.encode(secret);
        if (secretBytes.length > 255) {
            throw new Error(
                `Secret too long (${secretBytes.length} bytes, max 255).`
            );
        }

        /* Nibble array: 1-byte length prefix + message bytes */
        const nibbles = [];
        nibbles.push((secretBytes.length >> 4) & 0x0F);
        nibbles.push(secretBytes.length & 0x0F);
        for (const b of secretBytes) {
            nibbles.push((b >> 4) & 0x0F);
            nibbles.push(b & 0x0F);
        }

        const boundaries = countBoundaries(carrier);
        if (boundaries < nibbles.length) {
            const maxSec = boundaries >= 2
                ? Math.floor((boundaries - 2) / 2) : 0;
            throw new Error(
                `Carrier has ${boundaries} word boundaries, needs ` +
                `${nibbles.length}. Max secret: ${maxSec} bytes.`
            );
        }

        /* Seed: FNV-1a of passphrase or carrier */
        const seed = computeSeed(carrier, passphrase);

        /* Fisher-Yates shuffle → scattered placement order */
        const order = Array.from({ length: boundaries }, (_, i) => i);
        const rng = { s: seed || 1n };
        shuffle(order, rng);

        /* assign[boundary_index] = nibble index, or -1 → random filler */
        const assign = new Int32Array(boundaries).fill(-1);
        for (let i = 0; i < Math.min(nibbles.length, boundaries); i++) {
            assign[order[i]] = i;
        }

        /* Walk carrier, insert one symbol after every whitespace char */
        let result = '';
        let bidx = 0;
        for (const ch of carrier) {
            result += ch;
            if (isWordBoundary(ch)) {
                result += (assign[bidx] >= 0)
                    ? SYMBOLS[nibbles[assign[bidx]]]
                    : SYMBOLS[Math.floor(Math.random() * SYM_COUNT)];
                bidx++;
            }
        }

        const carrierBytes = enc.encode(carrier).length;
        const outputBytes  = enc.encode(result).length;

        return {
            text: result,
            stats: {
                carrierBytes,
                outputBytes,
                bloat: (outputBytes / carrierBytes).toFixed(2),
                boundaries,
                dataSymbols: nibbles.length,
                fillerSymbols: boundaries - nibbles.length,
            },
        };
    }

    /* ── Decode ──────────────────────────────────────────────────── */

    function decode(stegoText, passphrase) {
        stegoText = normalizeInput(stegoText);

        /* Seed: hash passphrase, or hash the stripped carrier */
        const seed = computeSeed(strip(stegoText), passphrase);

        /* Extract nibble value at each word boundary.
         * In the stego text, every whitespace char is followed by
         * exactly one hidden symbol (data or filler). */
        const chars = [...stegoText];
        const nibbles = [];
        for (let i = 0; i < chars.length; i++) {
            if (isWordBoundary(chars[i])) {
                let val = 0;
                if (i + 1 < chars.length) {
                    const sv = decodeSymbol(chars[i + 1]);
                    if (sv >= 0) val = sv;
                }
                nibbles.push(val);
            }
        }

        if (nibbles.length < 2) {
            throw new Error('Not enough word boundaries to decode.');
        }

        /* Regenerate the same shuffle as encoder */
        const order = Array.from({ length: nibbles.length }, (_, i) => i);
        const rng = { s: seed || 1n };
        shuffle(order, rng);

        /* First two shuffled nibbles = message length byte */
        const msgLen = (nibbles[order[0]] << 4) | nibbles[order[1]];
        if (msgLen === 0) return '';
        if ((msgLen + 1) * 2 > nibbles.length) {
            throw new Error(
                `Declared length ${msgLen} exceeds available data ` +
                `(${nibbles.length} boundaries, need ${(msgLen + 1) * 2}).`
            );
        }

        /* Reconstruct message bytes from nibble pairs */
        const bytes = new Uint8Array(msgLen);
        for (let i = 0; i < msgLen; i++) {
            bytes[i] = (nibbles[order[2 + i * 2]] << 4)
                     | nibbles[order[2 + i * 2 + 1]];
        }

        return new TextDecoder().decode(bytes);
    }

    /* ── Public API ──────────────────────────────────────────────── */

    return { encode, decode, strip, capacity };
})();
