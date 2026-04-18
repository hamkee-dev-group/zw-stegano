#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <locale.h>

#define SYM_LEN 3
#define SYM_COUNT 16

/*
 * Symbol alphabet: 16 invisible Unicode chars, all 3-byte UTF-8.
 *
 * Tier 1 — survive everywhere (essential for real scripts / emoji):
 *   U+200B  ZW Space,  U+200C  ZW Non-Joiner,  U+200D  ZW Joiner
 *   U+200E  LTR Mark,  U+200F  RTL Mark,       U+2060  Word Joiner
 *
 * Tier 2 — survive most channels (invisible math operators):
 *   U+2061..U+2064
 *
 * Tier 3 — bidi controls (may be stripped by Trojan-Source mitigations):
 *   U+202A..U+202D
 *
 * Tier 4 — bidi isolates (Unicode 6.3+, widely deployed):
 *   U+2066  LTR Isolate,  U+2067  RTL Isolate
 *
 * NOT used (treated as whitespace by Python/JS runtimes):
 *   U+2028  Line Separator,  U+2029  Paragraph Separator
 */
static const char *symbols[SYM_COUNT] = {
    "\xE2\x80\x8B",  // 0x0  U+200B  Zero Width Space
    "\xE2\x80\x8C",  // 0x1  U+200C  Zero Width Non-Joiner
    "\xE2\x80\x8D",  // 0x2  U+200D  Zero Width Joiner
    "\xE2\x80\x8E",  // 0x3  U+200E  Left-to-Right Mark
    "\xE2\x80\x8F",  // 0x4  U+200F  Right-to-Left Mark
    "\xE2\x80\xAA",  // 0x5  U+202A  LTR Embedding
    "\xE2\x80\xAB",  // 0x6  U+202B  RTL Embedding
    "\xE2\x80\xAC",  // 0x7  U+202C  Pop Directional Formatting
    "\xE2\x80\xAD",  // 0x8  U+202D  LTR Override
    "\xE2\x81\xA0",  // 0x9  U+2060  Word Joiner
    "\xE2\x81\xA1",  // 0xA  U+2061  Function Application
    "\xE2\x81\xA2",  // 0xB  U+2062  Invisible Times
    "\xE2\x81\xA3",  // 0xC  U+2063  Invisible Separator
    "\xE2\x81\xA4",  // 0xD  U+2064  Invisible Plus
    "\xE2\x81\xA6",  // 0xE  U+2066  Left-to-Right Isolate
    "\xE2\x81\xA7",  // 0xF  U+2067  Right-to-Left Isolate
};

/* --- Portable PRNG: xorshift64 (deterministic, same output on all platforms) --- */

typedef struct { uint64_t s; } prng_t;

static uint64_t prng_next(prng_t *rng) {
    uint64_t x = rng->s;
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    rng->s = x;
    return x;
}

/* --- FNV-1a 64-bit hash --- */

static uint64_t fnv1a(const char *data, size_t len) {
    uint64_t h = 14695981039346656037ULL;
    for (size_t i = 0; i < len; i++) {
        h ^= (unsigned char)data[i];
        h *= 1099511628211ULL;
    }
    return h;
}

/* --- Fisher-Yates shuffle --- */

static void shuffle(size_t *arr, size_t n, prng_t *rng) {
    for (size_t i = n - 1; i > 0; i--) {
        size_t j = (size_t)(prng_next(rng) % (i + 1));
        size_t tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
    }
}

/* --- Helpers --- */

static size_t utf8_char_len(unsigned char c) {
    if (c < 0x80) return 1;
    if ((c & 0xE0) == 0xC0) return 2;
    if ((c & 0xF0) == 0xE0) return 3;
    if ((c & 0xF8) == 0xF0) return 4;
    return 1;
}

static char *read_file(const char *filename) {
    FILE *f = fopen(filename, "rb");
    if (!f) return NULL;

    if (fseek(f, 0, SEEK_END) != 0) { fclose(f); return NULL; }
    long len = ftell(f);
    if (len < 0) { fclose(f); return NULL; }
    rewind(f);

    char *buf = malloc((size_t)len + 1);
    if (!buf) { fclose(f); return NULL; }

    if (fread(buf, 1, (size_t)len, f) != (size_t)len) {
        free(buf);
        fclose(f);
        return NULL;
    }

    buf[len] = '\0';
    fclose(f);
    return buf;
}

static int decode_symbol(const char *p) {
    for (int i = 0; i < SYM_COUNT; i++) {
        if (memcmp(p, symbols[i], SYM_LEN) == 0)
            return i;
    }
    return -1;
}

static int is_word_boundary(char c) {
    return c == ' ' || c == '\t' || c == '\n' || c == '\r';
}

/* Normalize input in-place: CRLF → LF, then strip trailing whitespace.
   Makes encoder/decoder agree on boundary count regardless of platform
   line-ending conventions or tools that append newlines. */
static void normalize_input(char *text) {
    char *src = text, *dst = text;
    size_t len;

    while (*src) {
        if (src[0] == '\r' && src[1] == '\n') {
            src++;
        } else {
            *dst++ = *src++;
        }
    }
    *dst = '\0';

    len = (size_t)(dst - text);
    while (len > 0 && is_word_boundary(text[len - 1])) {
        text[--len] = '\0';
    }
}

static size_t count_word_boundaries(const char *text) {
    size_t count = 0;
    while (*text) {
        if (is_word_boundary(*text)) count++;
        text++;
    }
    return count;
}

/* --- Strip: remove all symbols to recover the original carrier --- */

static char *strip_hidden(const char *text) {
    size_t len = strlen(text);
    char *out = malloc(len + 1);
    if (!out) return NULL;
    char *dst = out;
    const char *end = text + len;

    while (*text) {
        char c = *text;
        *dst++ = *text++;
        if (is_word_boundary(c) && text + SYM_LEN <= end && decode_symbol(text) >= 0) {
            text += SYM_LEN;
        }
    }
    *dst = '\0';
    return out;
}

/* --- Encode: length-prefixed nibble encoding --- */

static char *secret_to_zw(const char *msg) {
    size_t len = strlen(msg);
    if (len > 255) return NULL;

    size_t needed = (len + 1) * 2 * SYM_LEN;  // +1 for length prefix byte
    char *out = calloc(needed + 1, 1);
    if (!out) return NULL;

    char *p = out;

    unsigned char lb = (unsigned char)len;
    memcpy(p, symbols[(lb >> 4) & 0x0F], SYM_LEN); p += SYM_LEN;
    memcpy(p, symbols[lb & 0x0F], SYM_LEN);         p += SYM_LEN;

    for (size_t i = 0; i < len; i++) {
        unsigned char ch = msg[i];
        memcpy(p, symbols[(ch >> 4) & 0x0F], SYM_LEN); p += SYM_LEN;
        memcpy(p, symbols[ch & 0x0F], SYM_LEN);         p += SYM_LEN;
    }

    return out;
}

/* --- Embed: scatter data symbols across PRNG-shuffled boundary positions --- */

static char *embed_scattered(const char *carrier, const char *zw_syms, uint64_t seed) {
    size_t carrier_len = strlen(carrier);
    size_t data_count = strlen(zw_syms) / SYM_LEN;
    size_t boundaries = count_word_boundaries(carrier);

    // Generate shuffled position order
    size_t *order = malloc(boundaries * sizeof(size_t));
    if (!order) return NULL;
    for (size_t i = 0; i < boundaries; i++) order[i] = i;
    prng_t rng = { .s = seed ? seed : 1 };
    shuffle(order, boundaries, &rng);

    // assignment[boundary_idx] = data symbol index, or -1 for filler
    int *assign = malloc(boundaries * sizeof(int));
    if (!assign) { free(order); return NULL; }
    for (size_t i = 0; i < boundaries; i++) assign[i] = -1;
    size_t to_place = data_count < boundaries ? data_count : boundaries;
    for (size_t i = 0; i < to_place; i++) {
        assign[order[i]] = (int)i;
    }

    // Build output: carrier bytes + one symbol per boundary
    size_t cap = carrier_len + boundaries * SYM_LEN + 1;
    char *out = calloc(cap, 1);
    if (!out) { free(order); free(assign); return NULL; }

    char *dst = out;
    const char *p = carrier;
    size_t bidx = 0;

    while (*p) {
        size_t clen = utf8_char_len((unsigned char)*p);
        memcpy(dst, p, clen);
        dst += clen;

        if (clen == 1 && is_word_boundary(*p)) {
            if (assign[bidx] >= 0) {
                memcpy(dst, zw_syms + assign[bidx] * SYM_LEN, SYM_LEN);
            } else {
                memcpy(dst, symbols[prng_next(&rng) % SYM_COUNT], SYM_LEN);
            }
            dst += SYM_LEN;
            bidx++;
        }

        p += clen;
    }

    free(order);
    free(assign);
    return out;
}

/* --- Decode: extract all symbols at boundaries, unshuffle, read message --- */

static char *decode_scattered(const char *text, uint64_t seed) {
    size_t text_len = strlen(text);
    const char *end = text + text_len;

    // Count boundaries
    size_t boundaries = 0;
    for (const char *p = text; *p; p++) {
        if (is_word_boundary(*p)) boundaries++;
    }
    if (boundaries < 2) return NULL;

    // Extract the nibble at each boundary (symbol sits right after the whitespace byte)
    int *nibbles = calloc(boundaries, sizeof(int));
    if (!nibbles) return NULL;
    size_t idx = 0;
    for (const char *p = text; *p; p++) {
        if (is_word_boundary(*p)) {
            if (p + 1 + SYM_LEN <= end) {
                int val = decode_symbol(p + 1);
                nibbles[idx] = (val >= 0) ? val : 0;
            }
            idx++;
        }
    }

    // Same shuffle as encoder
    size_t *order = malloc(boundaries * sizeof(size_t));
    if (!order) { free(nibbles); return NULL; }
    for (size_t i = 0; i < boundaries; i++) order[i] = i;
    prng_t rng = { .s = seed ? seed : 1 };
    shuffle(order, boundaries, &rng);

    // First byte in shuffled order = message length
    unsigned char hi = (unsigned char)nibbles[order[0]];
    unsigned char lo = (unsigned char)nibbles[order[1]];
    int length = (int)((hi << 4) | lo);
    fprintf(stderr, "%X%X [len=%d]\n", hi, lo, length);

    if (length == 0) {
        free(nibbles); free(order);
        return calloc(1, 1);
    }
    if ((size_t)(length + 1) * 2 > boundaries) {
        fprintf(stderr, "[ERROR] Declared length %d exceeds available data.\n", length);
        free(nibbles); free(order);
        return NULL;
    }

    char *msg = calloc((size_t)length + 1, 1);
    if (!msg) { free(nibbles); free(order); return NULL; }

    for (int i = 0; i < length; i++) {
        unsigned char h = (unsigned char)nibbles[order[2 + i * 2]];
        unsigned char l = (unsigned char)nibbles[order[2 + i * 2 + 1]];
        unsigned char ch = (h << 4) | l;
        msg[i] = (char)ch;
        fprintf(stderr, "%X%X [%c]\n", h, l, (ch >= 32 && ch < 127) ? ch : '?');
    }

    free(nibbles);
    free(order);
    return msg;
}

int main(int argc, char **argv) {
    setlocale(LC_ALL, "en_US.UTF-8");

    if (argc < 3) {
        fprintf(stderr,
            "Usage:\n"
            "  %s encode    <carrier> <secret> [passphrase]\n"
            "  %s decode    <stego>            [passphrase]\n"
            "  %s strip     <stego>\n"
            "  %s capacity  <carrier>\n",
            argv[0], argv[0], argv[0], argv[0]);
        return 1;
    }

    if (strcmp(argv[1], "encode") == 0 && (argc == 4 || argc == 5)) {
        char *carrier = read_file(argv[2]);
        char *secret = read_file(argv[3]);
        if (!carrier || !secret) {
            fprintf(stderr, "Failed to read input files.\n");
            free(carrier); free(secret);
            return 1;
        }
        if (strlen(secret) > 255) {
            fprintf(stderr, "[ERROR] Secret too long (%zu bytes, max 255).\n", strlen(secret));
            free(carrier); free(secret);
            return 1;
        }

        uint64_t seed = (argc == 5)
            ? fnv1a(argv[4], strlen(argv[4]))
            : fnv1a(carrier, strlen(carrier));

        size_t boundaries = count_word_boundaries(carrier);
        size_t data_syms = (strlen(secret) + 1) * 2;
        if (boundaries < data_syms) {
            fprintf(stderr, "[ERROR] Carrier has %zu boundaries, needs %zu. "
                    "Max secret: %zu bytes.\n",
                    boundaries, data_syms,
                    boundaries >= 2 ? (boundaries - 2) / 2 : (size_t)0);
            free(carrier); free(secret);
            return 1;
        }

        char *zw_syms = secret_to_zw(secret);
        if (!zw_syms) {
            fprintf(stderr, "Encoding failed.\n");
            free(carrier); free(secret);
            return 1;
        }

        char *stego = embed_scattered(carrier, zw_syms, seed);
        if (stego) {
            fwrite(stego, 1, strlen(stego), stdout);
            fprintf(stderr, "[INFO] Carrier: %zu bytes, output: %zu bytes (%.2fx)\n",
                    strlen(carrier), strlen(stego),
                    (double)strlen(stego) / (double)strlen(carrier));
            fprintf(stderr, "[INFO] %zu/%zu boundaries: data, %zu: filler\n",
                    data_syms, boundaries, boundaries - data_syms);
            free(stego);
        } else {
            fprintf(stderr, "Embedding failed.\n");
        }

        free(carrier); free(secret); free(zw_syms);
    }
    else if (strcmp(argv[1], "decode") == 0 && (argc == 3 || argc == 4)) {
        char *input = read_file(argv[2]);
        if (!input) {
            fprintf(stderr, "Failed to read stego file.\n");
            return 1;
        }

        normalize_input(input);

        uint64_t seed;
        if (argc == 4) {
            seed = fnv1a(argv[3], strlen(argv[3]));
        } else {
            char *carrier = strip_hidden(input);
            seed = fnv1a(carrier, strlen(carrier));
            free(carrier);
        }

        fprintf(stderr, "[DEBUG] Starting decode...\n");
        char *secret = decode_scattered(input, seed);
        if (secret) {
            printf("%s\n", secret);
            free(secret);
        } else {
            fprintf(stderr, "Decoding failed.\n");
        }

        free(input);
    }
    else if (strcmp(argv[1], "strip") == 0 && argc == 3) {
        char *input = read_file(argv[2]);
        if (!input) {
            fprintf(stderr, "Failed to read file.\n");
            return 1;
        }
        char *clean = strip_hidden(input);
        if (clean) {
            fwrite(clean, 1, strlen(clean), stdout);
            free(clean);
        }
        free(input);
    }
    else if (strcmp(argv[1], "capacity") == 0 && argc == 3) {
        char *carrier = read_file(argv[2]);
        if (!carrier) {
            fprintf(stderr, "Failed to read file.\n");
            return 1;
        }
        normalize_input(carrier);
        size_t boundaries = count_word_boundaries(carrier);
        size_t max_len = boundaries >= 2 ? (boundaries - 2) / 2 : 0;
        printf("Word boundaries: %zu\nMax secret: %zu bytes\n", boundaries, max_len);
        free(carrier);
    }
    else {
        fprintf(stderr, "Invalid arguments.\n");
        return 1;
    }

    return 0;
}
