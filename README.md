# Zero-Width Steganography

Hide secret messages in plain text using invisible Unicode characters.

Available as a **C command-line tool** and a **browser-based web UI** — both are fully cross-compatible (encode with one, decode with the other).

Check it out live: https://hamkee.net/stegano/

---

## Features

- 16-symbol invisible alphabet — 4 bits per insertion (vs 1-bit in naive approaches)
- Word-boundary-only placement — symbols inserted after whitespace, not per-character
- PRNG-scattered encoding — data nibbles are shuffled across positions via xorshift64 + Fisher-Yates
- Uniform filler — every boundary gets a symbol (data or random), eliminating pattern edges
- Passphrase support — optional passphrase seeds the PRNG scatter (no encryption, pure steganography)
- Length + integrity header — up to 255 bytes, self-delimiting with decode validation
- Channel survival — avoids U+2028/U+2029 (treated as whitespace by Python/JS runtimes)
- Input normalization — CRLF to LF + trailing whitespace strip for cross-platform robustness
- Strip command — remove all hidden symbols to recover the original carrier
- Capacity check — see how many bytes a carrier can hold before encoding
- 100% client-side web UI — your data never leaves your browser

---

## How It Works

The tool uses 16 invisible Unicode characters (all Category Cf — Format):

| Nibble | Character                | Code Point |
|--------|--------------------------|------------|
| 0x0    | Zero Width Space         | `U+200B`   |
| 0x1    | Zero Width Non-Joiner    | `U+200C`   |
| 0x2    | Zero Width Joiner        | `U+200D`   |
| 0x3    | Left-to-Right Mark       | `U+200E`   |
| 0x4    | Right-to-Left Mark       | `U+200F`   |
| 0x5    | LTR Embedding            | `U+202A`   |
| 0x6    | RTL Embedding            | `U+202B`   |
| 0x7    | Pop Directional Format   | `U+202C`   |
| 0x8    | LTR Override             | `U+202D`   |
| 0x9    | Word Joiner              | `U+2060`   |
| 0xA    | Function Application     | `U+2061`   |
| 0xB    | Invisible Times          | `U+2062`   |
| 0xC    | Invisible Separator      | `U+2063`   |
| 0xD    | Invisible Plus           | `U+2064`   |
| 0xE    | Left-to-Right Isolate    | `U+2066`   |
| 0xF    | Right-to-Left Isolate    | `U+2067`   |

Each byte of the secret message is split into two nibbles (4 bits each), and each nibble maps to one symbol. A 1-byte length prefix and 2-byte integrity check are prepended, so the decoder can validate the payload before printing it.

The encoding process:

1. **Normalize** the carrier (CRLF to LF, strip trailing whitespace)
2. **Count** word boundaries (spaces, tabs, newlines) in the carrier
3. **Compute seed** — FNV-1a 64-bit hash of the passphrase (if given) or the carrier text
4. **Shuffle** boundary positions using xorshift64 PRNG + Fisher-Yates
5. **Place** data nibbles at shuffled positions; fill remaining positions with random symbols
6. **Output** the carrier with one invisible symbol inserted after every whitespace character

The result looks identical to the original text. Every word boundary carries a symbol — data or filler — so there's no detectable "edge" where hidden content starts or stops.

---

## CLI Usage

### Build

```bash
gcc -O2 -o stegano stegano.c
```

No dependencies beyond a standard C compiler (gcc, clang, MSVC). Runs on Linux, macOS, Windows.

### Commands

**Encode** a secret message into a carrier file:

```bash
./stegano encode <carrier.txt> <secret.txt> [passphrase]
```

The encoded output is written to stdout. Redirect to save:

```bash
./stegano encode carrier.txt secret.txt > stego.txt
./stegano encode carrier.txt secret.txt "my passphrase" > stego.txt
```

**Decode** a hidden message from a stego file:

```bash
./stegano decode <stego.txt> [passphrase]
```

The passphrase must match the one used during encoding. If no passphrase was used, omit it:

```bash
./stegano decode stego.txt
./stegano decode stego.txt "my passphrase"
```

**Strip** all hidden symbols to recover the original carrier:

```bash
./stegano strip <stego.txt>
```

Output is written to stdout:

```bash
./stegano strip stego.txt > recovered_carrier.txt
```

**Capacity** — check how many bytes a carrier can hold:

```bash
./stegano capacity <carrier.txt>
```

Output example:

```
Word boundaries: 42
Max secret: 18 bytes
```

The formula: each byte needs 2 nibbles (2 boundary positions), plus 6 positions for the 1-byte length and 2-byte integrity header. So `max_secret = (boundaries - 6) / 2`.

### Example

```bash
# Create test files
echo -n "The quick brown fox jumps over the lazy dog near the river bank" > carrier.txt
echo -n "attack at dawn" > secret.txt

# Check capacity
./stegano capacity carrier.txt
# Word boundaries: 12
# Max secret: 3 bytes  ← "attack at dawn" (14 bytes) won't fit

# Use a longer carrier
echo -n "The quick brown fox jumps over the lazy dog near the river bank on a warm summer evening while birds sing in the tall oak trees and clouds drift across the blue sky above the peaceful meadow where flowers bloom and bees buzz collecting sweet nectar" > carrier.txt

./stegano capacity carrier.txt
# Word boundaries: 42
# Max secret: 18 bytes  ← 14 bytes fits

# Encode (no passphrase)
./stegano encode carrier.txt secret.txt > stego.txt

# Decode
./stegano decode stego.txt
# attack at dawn

# Encode with passphrase
./stegano encode carrier.txt secret.txt "s3cret" > stego_pw.txt

# Decode with same passphrase
./stegano decode stego_pw.txt "s3cret"
# attack at dawn

# Wrong passphrase fails
./stegano decode stego_pw.txt "wrong"
# [ERROR] Hidden data failed integrity check.

# Strip recovers the carrier
./stegano strip stego.txt > recovered.txt
diff carrier.txt recovered.txt  # no output = identical
```

---

## Web UI Usage

The interface has four tabs:

- **Encode** — paste carrier text and secret message, optionally enter a passphrase, click Encode. The result appears with copy-to-clipboard support and stats (bloat ratio, boundary usage).
- **Decode** — paste encoded text, enter the same passphrase (if one was used), click Decode.
- **Strip** — paste encoded text, click Strip to remove all hidden symbols and recover the carrier.
- **Capacity** — paste carrier text to see how many word boundaries it has and the max secret size.

The web UI uses `stegano.js`, a JavaScript port of the C algorithm using BigInt for 64-bit arithmetic. It produces identical output to the C tool — you can encode on the command line and decode in the browser, or vice versa.

---

## Security Model

This is **pure steganography, not encryption**. The security comes from the hiding itself — an observer sees ordinary text with no visible indication that anything is hidden.

- **No passphrase**: the PRNG seed is derived from the carrier text hash. Anyone with the tool can decode, but they need to know (or suspect) that a message is hidden.
- **With passphrase**: the PRNG seed comes from the passphrase hash. Even with the tool, decoding requires the correct passphrase — a wrong passphrase produces the wrong shuffle, and decode now fails the payload integrity check instead of printing garbage.

The passphrase controls scatter placement, not encryption. There is no ciphertext. If you need confidentiality guarantees beyond undetectability, encrypt the message before encoding it.

---

## Limitations

- **Max secret size**: 255 bytes (limited by the 1-byte length prefix)
- **Carrier requirement**: needs enough word boundaries — roughly `2 * secret_length + 6` whitespace characters
- **Channel survival**: works in any channel that preserves Unicode Cf characters. Will break in channels that actively strip non-printable Unicode (e.g., Python's `str.isprintable()` filter)
- **Bloat ratio**: approximately 1.50x for typical English text (each boundary adds one 3-byte UTF-8 symbol)
