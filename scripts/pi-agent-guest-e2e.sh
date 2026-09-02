#!/usr/bin/env bash
# Independent Pi guest e2e (no control plane). Requires the guest image.
# Layout/identity: sandbox pi-agent-guest.e2e
# Fake loop (always): scheduler guest-loop-fixture
# Live loop: set REMOTE_AGENT_GUEST_E2E_LIVE=1 and OPENAI_API_KEY
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=lib/resolve-docker.sh
. "$ROOT/scripts/lib/resolve-docker.sh"
export DOCKER_BIN="$(resolve_docker)"

npm run build:pi-agent-image
npx tsc -b packages/sandbox packages/scheduler --pretty false
node --test \
  packages/sandbox/dist/providers/pi-agent-guest.e2e.test.js \
  packages/scheduler/dist/wiring/guest-loop-fixture.test.js \
  packages/scheduler/dist/wiring/guest-loop.docker.test.js
