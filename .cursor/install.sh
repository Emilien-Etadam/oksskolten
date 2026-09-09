#!/usr/bin/env bash
# Idempotent dependency refresh for the Cloud Agent environment.
# Runs after the repository is checked out; must terminate and stay safe to
# re-run against cached state.
set -euo pipefail

cd "$(dirname "$0")/.."

# Node dependencies, straight from the committed lockfile.
npm ci

# Meilisearch powers full-text search. Install a pinned binary once; the
# server rebuilds its index from SQLite on every boot, so nothing here needs
# to survive between runs.
MEILI_VERSION="v1.13.3"
MEILI_BIN="$HOME/bin/meilisearch"
if [ ! -x "$MEILI_BIN" ] || ! "$MEILI_BIN" --version 2>/dev/null | grep -q "${MEILI_VERSION#v}"; then
  mkdir -p "$HOME/bin"
  curl -fsSL "https://github.com/meilisearch/meilisearch/releases/download/${MEILI_VERSION}/meilisearch-linux-amd64" \
    -o "$MEILI_BIN"
  chmod +x "$MEILI_BIN"
fi
