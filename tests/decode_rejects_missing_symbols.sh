#!/bin/sh
set -e
cd "$(dirname "$0")/.."

gcc -O2 -Wall -Wextra -o /tmp/stegano_test stegano.c

expected_err='[ERROR] No hidden message found.'

# Case 1: plain carrier with no hidden symbols.
printf "alpha beta gamma" >/tmp/plain.txt
rc=0
/tmp/stegano_test decode /tmp/plain.txt >/tmp/out 2>/tmp/err || rc=$?
[ "$rc" = "1" ] \
    || { echo "FAIL: case 1 expected exit 1, got $rc"; exit 1; }
[ ! -s /tmp/out ] \
    || { echo "FAIL: case 1 /tmp/out not empty"; cat /tmp/out; exit 1; }
[ "$(cat /tmp/err)" = "$expected_err" ] \
    || { echo "FAIL: case 1 stderr mismatch:"; cat /tmp/err; exit 1; }

# Case 2: encode then strip leaves boundaries but no hidden symbols.
# Carrier has 19 words (18 boundaries) so encoding a 6-byte secret succeeds.
printf "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen" >/tmp/carrier.txt
printf "secret" >/tmp/secret.txt
/tmp/stegano_test encode /tmp/carrier.txt /tmp/secret.txt pass >/tmp/stego.txt 2>/dev/null
/tmp/stegano_test strip /tmp/stego.txt >/tmp/stripped.txt
rc=0
/tmp/stegano_test decode /tmp/stripped.txt pass >/tmp/out 2>/tmp/err || rc=$?
[ "$rc" = "1" ] \
    || { echo "FAIL: case 2 expected exit 1, got $rc"; exit 1; }
[ ! -s /tmp/out ] \
    || { echo "FAIL: case 2 /tmp/out not empty"; cat /tmp/out; exit 1; }
[ "$(cat /tmp/err)" = "$expected_err" ] \
    || { echo "FAIL: case 2 stderr mismatch:"; cat /tmp/err; exit 1; }

echo PASS
