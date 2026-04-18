#!/bin/sh
set -e
cd "$(dirname "$0")/.."

gcc -O2 -o stegano stegano.c

WORK=$(mktemp -d)
trap "rm -rf $WORK" EXIT

seq -f 'w%g' 1 120 | paste -sd' ' - | sed 's/$/ /' > "$WORK/carrier.txt"
printf 'a' > "$WORK/secret.txt"

./stegano encode "$WORK/carrier.txt" "$WORK/secret.txt" pass > "$WORK/stego.txt" 2> "$WORK/encode.err"

printf 'a\n' > "$WORK/expected.txt"
./stegano decode "$WORK/stego.txt" pass > "$WORK/decoded.txt" 2> "$WORK/decode.err"
cmp -s "$WORK/expected.txt" "$WORK/decoded.txt" \
    || { echo "FAIL: correct passphrase did not round-trip"; exit 1; }

if ./stegano decode "$WORK/stego.txt" wrong > "$WORK/wrong.out" 2> "$WORK/wrong.err"; then
    echo "FAIL: wrong passphrase decode unexpectedly succeeded"
    exit 1
fi
[ ! -s "$WORK/wrong.out" ] \
    || { echo "FAIL: wrong passphrase wrote secret bytes to stdout"; exit 1; }
grep -q 'integrity check' "$WORK/wrong.err" \
    || { echo "FAIL: wrong passphrase did not report integrity failure"; exit 1; }

size=$(wc -c < "$WORK/stego.txt")
head -c $((size - 3)) "$WORK/stego.txt" > "$WORK/corrupt.txt"

if ./stegano decode "$WORK/corrupt.txt" pass > "$WORK/corrupt.out" 2> "$WORK/corrupt.err"; then
    echo "FAIL: corrupted stego decode unexpectedly succeeded"
    exit 1
fi
[ ! -s "$WORK/corrupt.out" ] \
    || { echo "FAIL: corrupted stego wrote secret bytes to stdout"; exit 1; }
grep -Eq 'integrity check|incomplete' "$WORK/corrupt.err" \
    || { echo "FAIL: corrupted stego did not report validation failure"; exit 1; }

echo PASS
