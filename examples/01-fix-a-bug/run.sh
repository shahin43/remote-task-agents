#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export E2E_LEGS=coder-reviewer
exec bash scripts/live-board-e2e.sh
