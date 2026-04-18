#!/bin/sh
set -e
cd "$(dirname "$0")/.."

gcc -O2 -o stegano stegano.c

WORK=$(mktemp -d)
trap "rm -rf $WORK" EXIT

./stegano encode tests/repro/carrier_inline_wj.txt tests/repro/secret_X.txt > "$WORK/stego.txt" 2>/dev/null
./stegano strip "$WORK/stego.txt" > "$WORK/recovered.txt"

cmp -s tests/repro/carrier_inline_wj.txt "$WORK/recovered.txt" \
    || { echo "FAIL: strip did not restore carrier"; exit 1; }

expected='70 72 65 e2 81 a0 6d 69 64 20 6f 6e 65 20 74 77 6f 20 74 68 72 65 65 20 66 6f 75 72 20 66 69 76 65 20 73 69 78 20 73 65 76 65 6e 20 65 69 67 68 74 0a'
actual=$(od -An -t x1 "$WORK/recovered.txt" | tr -s ' \n' ' ' | sed -e 's/^ //' -e 's/ $//')
[ "$actual" = "$expected" ] \
    || { echo "FAIL: recovered hex mismatch"; echo "  expected: $expected"; echo "  actual:   $actual"; exit 1; }

./stegano decode "$WORK/stego.txt" > "$WORK/decoded.txt" 2> "$WORK/decode.err"
decoded=$(od -An -t x1 "$WORK/decoded.txt" | tr -s ' \n' ' ' | sed -e 's/^ //' -e 's/ $//')
[ "$decoded" = "58 0a" ] \
    || { echo "FAIL: decode output mismatch: '$decoded'"; exit 1; }

if grep -q 'Declared length' "$WORK/decode.err"; then
    echo "FAIL: decode.err contains 'Declared length'"
    exit 1
fi

echo PASS
