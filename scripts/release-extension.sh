#!/bin/sh
# Publish the extension payload, minified, on its own branch, for consumers to vendor with
#   git subtree add --prefix=_extensions/Pat-Laub/scribble <repo> <tag> --squash
#
# `git subtree split` cannot be used here: this repo *contains* another subtree
# (Pat-Laub/slide-stage, for the fixture decks), and split dies on that
# subtree's squash commit with "no new revisions were found". Building the
# payload commit directly is simpler and immune to that, and --squash consumers
# never look at its history.
set -eu

PREFIX=_extensions/Pat-Laub/annotate
BRANCH=dist
TAG=${1:?usage: release-extension.sh <tag>}

version=$(git show "HEAD:$PREFIX/annotate.js" |
  sed -n "s/^  var VERSION = '\\(.*\\)';/\\1/p")
[ "annotate-dist-v$version" = "$TAG" ] || {
  echo "annotate.js says VERSION $version; bump it to match $TAG"; exit 1; }

# Consumers get minified scripts; main keeps the commented source.
export GIT_INDEX_FILE=$(mktemp)
trap 'rm -f "$GIT_INDEX_FILE"' EXIT
git read-tree "HEAD:$PREFIX"
for f in $(git ls-files -- '*.js' ':!*.min.js'); do
  blob=$(git show "HEAD:$PREFIX/$f" | npx terser --compress --mangle | git hash-object -w --stdin)
  git update-index --cacheinfo 100644 "$blob" "$f"
done
tree=$(git write-tree)
if parent=$(git rev-parse --verify --quiet "$BRANCH"); then
  [ "$(git rev-parse "$parent^{tree}")" = "$tree" ] && {
    echo "payload unchanged since $BRANCH; nothing to release"; exit 1; }
  commit=$(git commit-tree "$tree" -p "$parent" -m "$TAG")
else
  commit=$(git commit-tree "$tree" -m "$TAG")
fi
git branch -f "$BRANCH" "$commit"
git tag -f "$TAG" "$commit"
echo "$BRANCH -> $commit  ($TAG)"
git ls-tree --name-only "$commit"
