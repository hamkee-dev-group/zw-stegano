#!/bin/sh
set -e
cd "$(dirname "$0")/.."

gcc -O2 -o stegano stegano.c

WORK=$(mktemp -d)
trap "rm -rf $WORK" EXIT

printf 'a b \r\nc d\t\r\ne f \r\ng h\t\r\ni j \t\r\n' > "$WORK/carrier.txt"
printf 'X' > "$WORK/secret.txt"

./stegano encode "$WORK/carrier.txt" "$WORK/secret.txt" > "$WORK/stego.txt" 2> "$WORK/encode.err"
./stegano strip "$WORK/stego.txt" > "$WORK/recovered.txt"

cmp -s "$WORK/carrier.txt" "$WORK/recovered.txt" \
    || { echo "FAIL: carrier bytes changed after encode/strip"; exit 1; }

./stegano decode "$WORK/stego.txt" > "$WORK/decoded.txt" 2> "$WORK/decode.err"
decoded=$(od -An -t x1 "$WORK/decoded.txt" | tr -s ' \n' ' ' | sed -e 's/^ //' -e 's/ $//')
[ "$decoded" = "58 0a" ] \
    || { echo "FAIL: decode output mismatch: '$decoded'"; exit 1; }

echo PASS
