#!/usr/bin/env bash
# Live e2e: board assign → Pi Docker run → review → follow-up → second Pi run → review.
# Requires: postgres (docker compose), built dist, OPENAI_API_KEY, docker worker image.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

PORT="${REMOTE_AGENT_API_PORT:-8787}"
BASE="http://127.0.0.1:${PORT}"
ACTOR="${REMOTE_AGENT_E2E_ACTOR:-user-dev}"
POLL_SEC="${REMOTE_AGENT_E2E_POLL_SEC:-5}"
MAX_WAIT_SEC="${REMOTE_AGENT_E2E_MAX_WAIT_SEC:-600}"
LOG_DIR="${REPO_ROOT}/runs/e2e-logs"
mkdir -p "$LOG_DIR"
API_LOG="$LOG_DIR/api-$(date +%Y%m%d-%H%M%S).log"
CONTROL_LOG="$LOG_DIR/control-$(date +%Y%m%d-%H%M%S).log"
WORKER_LOG="$LOG_DIR/worker-$(date +%Y%m%d-%H%M%S).log"

# Load .env without printing secrets (local, else sibling checkout).
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
elif [[ -f "${REPO_ROOT}/../dns-remote-agent/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/../dns-remote-agent/.env"
  set +a
fi
unset REMOTE_AGENT_GITLAB_TOKEN GITLAB_BASE_URL LINEAR_API_KEY LINEAR_API_URL || true
unset REMOTE_AGENT_PROJECTS_CONFIG || true

export DATABASE_URL="${REMOTE_AGENT_E2E_DATABASE_URL:-postgres://remote_agent@127.0.0.1:5433/remote_agent}"
export REMOTE_AGENT_BOARD_PROJECT_ID=sample/service
export REMOTE_AGENT_DRY_RUN="${REMOTE_AGENT_DRY_RUN:-false}"
export REMOTE_AGENT_DOCKER_BIN="${REMOTE_AGENT_DOCKER_BIN:-docker}"
export REMOTE_AGENT_WORKER_IMAGE="${REMOTE_AGENT_WORKER_IMAGE:-remote-sandbox-agents/pi-agent:local}"
export REMOTE_AGENT_WORKER_RUNTIME=sandbox-docker
export REMOTE_AGENT_SNAPSHOT_STORE=local
export REMOTE_AGENT_MIRROR_SOURCE="${REMOTE_AGENT_MIRROR_SOURCE:-${REPO_ROOT}/runs/seed/sample-service}"

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "ERROR: OPENAI_API_KEY is required for Pi Docker e2e" >&2
  exit 1
fi

cleanup() {
  if [[ -n "${API_PID:-}" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill -TERM "$API_PID" 2>/dev/null || true
  fi
  if [[ -n "${CONTROL_PID:-}" ]] && kill -0 "$CONTROL_PID" 2>/dev/null; then
    kill -TERM "$CONTROL_PID" 2>/dev/null || true
  fi
  if [[ -n "${WORKER_PID:-}" ]] && kill -0 "$WORKER_PID" 2>/dev/null; then
    kill -TERM "$WORKER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "== build =="
npm run build >/dev/null
npm run build:pi-runner >/dev/null

echo "== free port $PORT (scheduler only) =="
bash scripts/kill-local-service-port.sh "$PORT"

echo "== start api (HTTP-only) =="
node packages/scheduler/dist/index.js --role api >"$API_LOG" 2>&1 &
API_PID=$!
for i in $(seq 1 30); do
  if curl -sf --max-time 2 "$BASE/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -sf "$BASE/api/health" | tee /dev/stderr
echo

echo "== start control (board poll loop) =="
node packages/scheduler/dist/index.js --role control --control-id control-e2e >"$CONTROL_LOG" 2>&1 &
CONTROL_PID=$!
sleep 1

echo "== start worker =="
node packages/scheduler/dist/index.js --role worker --worker-id worker-e2e >"$WORKER_LOG" 2>&1 &
WORKER_PID=$!
sleep 2

wait_for_status() {
  local task_id="$1"
  local want="$2"
  local elapsed=0
  while [[ "$elapsed" -lt "$MAX_WAIT_SEC" ]]; do
    local status
    status="$(curl -sf "$BASE/api/tasks/$task_id" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).status')"
    echo "  task $task_id status=$status (want $want) elapsed=${elapsed}s"
    if [[ "$status" == "$want" ]]; then
      return 0
    fi
    sleep "$POLL_SEC"
    elapsed=$((elapsed + POLL_SEC))
  done
  echo "TIMEOUT waiting for status=$want" >&2
  tail -50 "$WORKER_LOG" >&2 || true
  return 1
}

echo "== create + assign task =="
TASK_JSON="$(curl -sf -X POST "$BASE/api/tasks" \
  -H 'content-type: application/json' \
  -H "x-remote-agent-actor: $ACTOR" \
  -d '{"title":"Pi follow-up e2e","description":"Append a line to README on first run. On follow-up append another line.","assigneeId":"agent-coder"}')"
TASK_ID="$(echo "$TASK_JSON" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).id')"
echo "task_id=$TASK_ID"

echo "== wait first run → review =="
wait_for_status "$TASK_ID" "review"

echo "== session state before follow-up =="
SESSION_ID="$(curl -sf "$BASE/api/tasks/$TASK_ID" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
    const t=JSON.parse(s);
    const id=t.runs?.[0]?.id;
    if(!id){console.error("no runs on task", t.id, "status="+t.status); process.exit(1);}
    process.stdout.write(id);
  });
')"
curl -sf "$BASE/api/sessions/$SESSION_ID" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
    const sess=JSON.parse(s);
    console.log(JSON.stringify({status:sess.status, attemptNumber:sess.metadata?.attemptNumber, lastSnapshotRef:!!sess.metadata?.lastSnapshotRef}, null, 2));
  });
'

echo "== follow-up =="
curl -sf -X POST "$BASE/api/tasks/$TASK_ID/follow-up" \
  -H 'content-type: application/json' \
  -H "x-remote-agent-actor: $ACTOR" \
  -d '{"bodyMarkdown":"Follow-up: append exactly `Follow-up pass by pi e2e.` as a new line to README.md using write_file.","resumeWorkspace":false}' \
  | node -pe 'const t=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("status="+t.status)'

echo "== wait second run → review =="
wait_for_status "$TASK_ID" "review"

echo "== verify session events =="
curl -sf "$BASE/api/sessions/$SESSION_ID" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
    const sess=JSON.parse(s);
    const channelInputs=sess.events.filter(e=>e.eventType==="channel.input");
    const assistants=sess.events.filter(e=>e.eventType==="assistant_message");
    const runSummaries=sess.events.filter(e=>e.eventType==="run.summary");
    if((sess.metadata?.attemptNumber ?? 1) < 2) { console.error("attemptNumber<2", sess.metadata?.attemptNumber); process.exit(1); }
    if(channelInputs.length < 2) { console.error("expected>=2 channel.input events, got", channelInputs.length); process.exit(1); }
    if(runSummaries.length < 1) { console.error("expected>=1 run.summary event, got", runSummaries.length); process.exit(1); }
    console.log(JSON.stringify({
      sessionStatus: sess.status,
      attemptNumber: sess.metadata?.attemptNumber,
      channelInputs: channelInputs.length,
      assistantMessages: assistants.length,
      runSummaries: runSummaries.length,
      lastSnapshotRef: !!sess.metadata?.lastSnapshotRef,
    }, null, 2));
  });
'

echo "== verify task runs view =="
curl -sf "$BASE/api/tasks/$TASK_ID/runs" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
    const body=JSON.parse(s);
    if((body.attempts?.length ?? 0) < 2) { console.error("expected>=2 attempts", body.attempts?.length); process.exit(1); }
    const second=body.attempts.find(a=>a.attemptNumber===2);
    if(!second?.priorSummary?.includes("Prior run")) { console.error("attempt 2 missing priorSummary"); process.exit(1); }
    // agent_runs ledger: at least one finalized attempt should carry sandbox/backend + agentSummary.
    const finalized=body.attempts.filter(a=>["succeeded","failed"].includes(a.status));
    if(finalized.length<1) { console.error("expected at least one finalized attempt"); process.exit(1); }
    const ledgerBacked=finalized.find(a=>a.sandboxSessionId && a.backend);
    if(!ledgerBacked) { console.error("expected agent_runs-derived fields (sandboxSessionId+backend) on a finalized attempt", finalized); process.exit(1); }
    console.log(JSON.stringify({
      attempts: body.attempts.length,
      attempt2HasPriorSummary: !!second?.priorSummary,
      ledgerBacked: { attempt: ledgerBacked.attemptNumber, backend: ledgerBacked.backend, hasAgentSummary: !!ledgerBacked.agentSummary },
    }, null, 2));
  });
'

echo "== verify snapshot files API =="
SNAP_REF="$(curl -sf "$BASE/api/tasks/$TASK_ID/runs" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const b=JSON.parse(s);const a=b.attempts.find(x=>x.snapshotRefEncoded);if(!a){process.exit(1);}process.stdout.write(a.snapshotRefEncoded);});')"
curl -sf "$BASE/api/snapshots/$SNAP_REF/files" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
    const body=JSON.parse(s);
    const files=body.files?.map(f=>f.path) ?? [];
    if(!files.some(p=>p.includes("changes.patch") || p==="git/changes.patch")) {
      console.error("expected git/changes.patch in snapshot files", files.slice(0,10)); process.exit(1);
    }
    console.log(JSON.stringify({ref: body.ref, fileCount: files.length}, null, 2));
  });
'

echo "== verify agent registry API =="
curl -sf "$BASE/api/agent-profiles" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const p=JSON.parse(s);if(!Array.isArray(p)||p.length<1)process.exit(1);console.log("profiles="+p.length);})'
curl -s -o /dev/null -X DELETE "$BASE/api/agents/agent-e2e-temp" \
  -H "x-remote-agent-actor: $ACTOR" || true
AGENT_JSON="$(curl -sf -X POST "$BASE/api/agents" \
  -H 'content-type: application/json' \
  -H "x-remote-agent-actor: $ACTOR" \
  -d '{"displayName":"E2E Temp Agent","profileId":"reviewer","id":"agent-e2e-temp"}')"
echo "$AGENT_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const a=JSON.parse(s);console.log("created="+a.id);})'
curl -s -o /dev/null -X DELETE "$BASE/api/agents/agent-e2e-temp" \
  -H "x-remote-agent-actor: $ACTOR" || true

echo "== PASS: Pi Docker follow-up loop completed =="
echo "logs: $API_LOG $WORKER_LOG"
