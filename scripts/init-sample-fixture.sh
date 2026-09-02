#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/fixtures/sample-service"
DEST="${1:-$ROOT/runs/seed/sample-service}"
mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$SRC/." "$DEST/"
git -C "$DEST" init -q
git -C "$DEST" config user.email "dev@example.com"
git -C "$DEST" config user.name "Sample Dev"
git -C "$DEST" add .
git -C "$DEST" commit -qm "initial sample service"
echo "seeded $DEST"
