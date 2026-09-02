#!/usr/bin/env bash
# Build the Pi agent guest image with digest-friendly tags and identity labels.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=lib/resolve-docker.sh
. "$ROOT/scripts/lib/resolve-docker.sh"
DOCKER="$(resolve_docker)"
IMAGE_NAME="${PI_AGENT_IMAGE:-remote-sandbox-agents/pi-agent}"
LOCAL_TAG="${PI_AGENT_IMAGE_TAG:-local}"

echo "building pi-runner bundle..."
npm run build:pi-runner

BUNDLE="$ROOT/packages/agent-engines/dist/pi-runner.bundle.cjs"
if [ ! -f "$BUNDLE" ]; then
  echo "missing $BUNDLE" >&2
  exit 1
fi

BUNDLE_SHA="$(shasum -a 256 "$BUNDLE" | awk '{print $1}')"
GIT_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
GIT_SHORT="$(git rev-parse --short=12 HEAD 2>/dev/null || echo unknown)"

STAGE="$ROOT/images/pi-agent"
cp "$BUNDLE" "$STAGE/pi-runner.bundle.cjs"

LABEL_KIND="com.remote-sandbox-agents.kind=pi-agent-guest"
LABEL_ENGINE="com.remote-sandbox-agents.engine=pi-agent"
LABEL_CONTRACT="com.remote-sandbox-agents.contract=runner-protocol-v1"
LABEL_BUNDLE="com.remote-sandbox-agents.bundle-sha256=${BUNDLE_SHA}"
LABEL_GIT="com.remote-sandbox-agents.git-sha=${GIT_SHA}"

echo "building ${IMAGE_NAME}:${LOCAL_TAG} and ${IMAGE_NAME}:${GIT_SHORT} with ${DOCKER}..."
"$DOCKER" build \
  -f "$STAGE/Dockerfile" \
  -t "${IMAGE_NAME}:${LOCAL_TAG}" \
  -t "${IMAGE_NAME}:${GIT_SHORT}" \
  --label "$LABEL_KIND" \
  --label "$LABEL_ENGINE" \
  --label "$LABEL_CONTRACT" \
  --label "$LABEL_BUNDLE" \
  --label "$LABEL_GIT" \
  "$STAGE"

rm -f "$STAGE/pi-runner.bundle.cjs"

echo "image ${IMAGE_NAME}:${LOCAL_TAG}"
"$DOCKER" inspect --format \
  '{{index .Config.Labels "com.remote-sandbox-agents.engine"}} {{index .Config.Labels "com.remote-sandbox-agents.bundle-sha256"}} {{.Id}}' \
  "${IMAGE_NAME}:${LOCAL_TAG}"
