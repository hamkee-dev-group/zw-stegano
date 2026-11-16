#!/usr/bin/env bash
# Deploy web/ to hamkee.net/stegano (webserver /var/www/html/stegano), or roll back.
#   web/deploy.sh                 deploy the committed web/ files of HEAD (refuses a dirty web/)
#   web/deploy.sh rollback DIR    put back an archive made by a deploy (DIR on the webserver)
# Every deploy first archives the live files to ~/backups/stegano-<UTC time>/ on the webserver,
# outside the public web root, then checks the public URL serves exactly the new bytes.
set -euo pipefail
HOST=${STEGANO_HOST:-crypto@34.69.22.14}
DEST=/var/www/html/stegano
URL=https://hamkee.net/stegano
SSH=(ssh -F /dev/null -o BatchMode=yes "$HOST")
cd "$(dirname "$0")"

if [[ ${1:-} == rollback ]]; then
  dir=${2:?usage: deploy.sh rollback ~/backups/stegano-TIME}
  "${SSH[@]}" "set -e; test -f $dir/index.html -a -f $dir/stegano.js; sudo -n install -o nginx -g nginx -m 664 $dir/index.html $DEST/index.html; sudo -n install -o nginx -g nginx -m 644 $dir/stegano.js $DEST/stegano.js; sha256sum $DEST/index.html $DEST/stegano.js"
  echo "rolled back to $dir"
  exit 0
fi

[[ -z $(git status --porcelain -- index.html stegano.js) ]] || { echo "web/ has uncommitted changes; commit first" >&2; exit 1; }
rev=$(git rev-parse --short HEAD)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
archive="~/backups/stegano-$stamp"
"${SSH[@]}" "set -e; mkdir -p $archive; cp -p $DEST/index.html $DEST/stegano.js $archive/; echo $rev > $archive/REPLACED_BY"
stage=$("${SSH[@]}" 'mktemp -d /tmp/stegano-deploy.XXXXXX')
git archive HEAD index.html stegano.js | "${SSH[@]}" "tar -x -C $stage"
"${SSH[@]}" "set -e; sudo -n install -o nginx -g nginx -m 664 $stage/index.html $DEST/index.html; sudo -n install -o nginx -g nginx -m 644 $stage/stegano.js $DEST/stegano.js; rm -rf $stage"
for f in index.html stegano.js; do
  want=$(git show HEAD:web/$f | sha256sum | cut -d' ' -f1)
  got=$(curl -fsS "$URL/$f?v=$stamp" | sha256sum | cut -d' ' -f1)
  [[ $want == "$got" ]] || { echo "$f: public bytes differ ($got != $want); rolling back" >&2; "$0" rollback "$archive"; exit 1; }
done
echo "deployed web/ at $rev to $URL; rollback: web/deploy.sh rollback $archive"
