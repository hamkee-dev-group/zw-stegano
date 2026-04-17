#!/bin/sh
set -e
cd "$(dirname "$0")/.."

gcc -O2 -o stegano stegano.c

WORK=$(mktemp -d)
trap "rm -rf $WORK" EXIT

printf 'x' > "$WORK/secret.txt"

# Case 1: U+200F (RTL Mark) mid-word
printf 'ab\342\200\217cd ef gh ij kl mn op qr st' > "$WORK/carrier1.txt"
./stegano encode "$WORK/carrier1.txt" "$WORK/secret.txt" > "$WORK/stego1.txt" 2>/dev/null
./stegano strip "$WORK/stego1.txt" > "$WORK/out1.txt"
cmp -s "$WORK/carrier1.txt" "$WORK/out1.txt" \
    || { echo "FAIL: U+200F mid-word mangled by strip"; exit 1; }

carrier_cnt=$(od -An -c "$WORK/carrier1.txt" | grep -c '342 200 217')
out_cnt=$(od -An -c "$WORK/out1.txt" | grep -c '342 200 217')
[ "$carrier_cnt" = "$out_cnt" ] \
    || { echo "FAIL: U+200F count mismatch carrier=$carrier_cnt out=$out_cnt"; exit 1; }

# Case 2: U+202B (RTL Embedding) mid-word
printf 'ab\342\200\253cd ef gh ij kl mn op qr st' > "$WORK/carrier2.txt"
./stegano encode "$WORK/carrier2.txt" "$WORK/secret.txt" > "$WORK/stego2.txt" 2>/dev/null
./stegano strip "$WORK/stego2.txt" > "$WORK/out2.txt"
cmp -s "$WORK/carrier2.txt" "$WORK/out2.txt" \
    || { echo "FAIL: U+202B mid-word mangled by strip"; exit 1; }

echo PASS
