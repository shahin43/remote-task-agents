#!/usr/bin/env bash
# Kill remote-sandbox-agents local API/worker processes bound to a port or matching
# the scheduler entrypoint. Only targets this repo's scheduler processes —
# never blanket-kills node or unrelated listeners.
set -euo pipefail

PORT="${1:-${REMOTE_AGENT_API_PORT:-8787}}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCHEDULER_MARKER="packages/scheduler/dist/index.js"

is_our_scheduler() {
  local pid="$1"
  local cmd
  cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$cmd" == *"$SCHEDULER_MARKER"* ]]
}

kill_pid_if_ours() {
  local pid="$1"
  local role="${2:-}"
  if ! is_our_scheduler "$pid"; then
    echo "skip pid=$pid (not $SCHEDULER_MARKER)"
    return 0
  fi
  if [[ -n "$role" ]] && ! ps -p "$pid" -o command= | grep -q -- "--role $role"; then
    echo "skip pid=$pid (not --role $role)"
    return 0
  fi
  echo "kill pid=$pid $(ps -p "$pid" -o command= 2>/dev/null | head -c 120)"
  kill -TERM "$pid" 2>/dev/null || true
}

echo "== remote-sandbox-agents port cleanup (port=$PORT) =="

# Listeners on the API port — API role only.
for pid in $(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | sort -u); do
  [[ -z "$pid" ]] && continue
  kill_pid_if_ours "$pid" "api"
done

# Also stop any stopped (T) or stray worker processes from prior local runs.
while read -r pid; do
  [[ -z "$pid" ]] && continue
  kill_pid_if_ours "$pid" "worker"
done < <(pgrep -f "$SCHEDULER_MARKER --role worker" 2>/dev/null || true)

sleep 1

# Force-kill survivors that are still our scheduler processes.
for pid in $(pgrep -f "$SCHEDULER_MARKER" 2>/dev/null || true); do
  if is_our_scheduler "$pid"; then
    if kill -0 "$pid" 2>/dev/null; then
      echo "force kill pid=$pid"
      kill -KILL "$pid" 2>/dev/null || true
    fi
  fi
done

# Verify port is free (or only non-our processes remain — we do not touch those).
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  remaining="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null)"
  if echo "$remaining" | grep -q "$SCHEDULER_MARKER"; then
    echo "ERROR: port $PORT still held by remote-sandbox-agents process" >&2
    echo "$remaining" >&2
    exit 1
  fi
  echo "WARN: port $PORT still in use by a non-scheduler process (left untouched):"
  echo "$remaining"
else
  echo "port $PORT is free"
fi

echo "done"
