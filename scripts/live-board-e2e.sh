#!/usr/bin/env bash
# Live e2e: sample/service coder → reviewer, then author zero-repo paper.
# Requires: Postgres, Docker (for sandbox-docker), OPENAI_API_KEY or ANTHROPIC_API_KEY.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

PORT="${REMOTE_AGENT_API_PORT:-8787}"
BASE="http://127.0.0.1:${PORT}"
ACTOR="${REMOTE_AGENT_E2E_ACTOR:-user-dev}"
POLL_SEC="${REMOTE_AGENT_E2E_POLL_SEC:-8}"
MAX_WAIT_SEC="${REMOTE_AGENT_E2E_MAX_WAIT_SEC:-1200}"
LOG_DIR="${REPO_ROOT}/runs/e2e-logs"
mkdir -p "$LOG_DIR"
API_LOG="$LOG_DIR/live-board-e2e-$(date +%Y%m%d-%H%M%S).log"

load_env_file() {
  local file="$1"
  if [[ -f "$file" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$file"
    set +a
    return 0
  fi
  return 1
}

load_env_file "${REPO_ROOT}/.env" || load_env_file "${REPO_ROOT}/../dns-remote-agent/.env" || true
# Never pass org host-git or ticket tokens into the generic worker.
unset REMOTE_AGENT_GITLAB_TOKEN GITLAB_BASE_URL LINEAR_API_KEY LINEAR_API_URL || true

# Sibling .env may set cloud snapshot stores, MicroVM runtime, a different
# DATABASE_URL, board project id, or REMOTE_AGENT_PROJECTS_CONFIG pointing at
# the org catalog. This repo only supports local Postgres + local snapshots +
# docker/unix-local + the bundled sample catalog.
unset REMOTE_AGENT_PROJECTS_CONFIG || true
export DATABASE_URL="${REMOTE_AGENT_E2E_DATABASE_URL:-postgres://remote_agent@127.0.0.1:5433/remote_agent}"
export REMOTE_AGENT_BOARD_PROJECT_ID=sample/service
export REMOTE_AGENT_BOARD_TENANT_ID="${REMOTE_AGENT_BOARD_TENANT_ID:-default}"
export REMOTE_AGENT_DOCKER_BIN="${REMOTE_AGENT_DOCKER_BIN:-docker}"
export REMOTE_AGENT_WORKER_IMAGE="${REMOTE_AGENT_WORKER_IMAGE:-remote-sandbox-agents/pi-agent:local}"
export REMOTE_AGENT_WORKER_RUNTIME=sandbox-docker
export REMOTE_AGENT_SNAPSHOT_STORE=local
export REMOTE_AGENT_PI_STORE_REQUESTS="${REMOTE_AGENT_PI_STORE_REQUESTS:-true}"
export REMOTE_AGENT_AUTOBOUNCE_HUMAN="${REMOTE_AGENT_AUTOBOUNCE_HUMAN:-user-dev}"

if [[ -z "${OPENAI_API_KEY:-}" && -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "ERROR: OPENAI_API_KEY or ANTHROPIC_API_KEY is required" >&2
  exit 1
fi

cleanup() {
  if [[ -n "${API_PID:-}" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill -TERM "$API_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "== seed sample fixture =="
bash scripts/init-sample-fixture.sh

echo "== build =="
npm run build >/dev/null

echo "== free port $PORT =="
bash scripts/kill-local-service-port.sh "$PORT" || true

echo "== start api --with-worker =="
node packages/scheduler/dist/index.js --role api --with-worker >"$API_LOG" 2>&1 &
API_PID=$!
for _ in $(seq 1 90); do
  if curl -sf --max-time 2 "$BASE/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -sf "$BASE/api/health" >/dev/null || {
  echo "ERROR: api health failed; last log:" >&2
  tail -120 "$API_LOG" >&2 || true
  exit 1
}
echo "api up"

echo "== catalog includes sample/service =="
curl -sf "$BASE/api/projects/repos" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
    const repos=JSON.parse(s);
    const hit=repos.find(r=>r.slug==="sample/service");
    if(!hit){ console.error("sample/service missing from catalog", repos); process.exit(1); }
    console.log("catalog slug="+hit.slug+" dest="+hit.dest);
  });
'

wait_task() {
  local task_id="$1"
  local want="$2"
  local elapsed=0
  while [[ "$elapsed" -lt "$MAX_WAIT_SEC" ]]; do
    local payload
    payload="$(curl -sf "$BASE/api/tasks/$task_id")"
    echo "$payload" | WAIT_ELAPSED="$elapsed" node -e '
      let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
        const t=JSON.parse(s);
        const a=t.assignee && t.assignee.id ? t.assignee.id : t.assigneeId;
        const k=t.assignee && t.assignee.kind ? t.assignee.kind : t.assigneeKind;
        process.stdout.write("  task status="+t.status+" assignee="+String(a)+" kind="+String(k)+" elapsed="+process.env.WAIT_ELAPSED+"s\n");
      });
    '
    if echo "$payload" | WAIT_FOR="$want" node -e '
      let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
        const t=JSON.parse(s);
        const a=t.assignee && t.assignee.id ? t.assignee.id : t.assigneeId;
        const k=t.assignee && t.assignee.kind ? t.assignee.kind : t.assigneeKind;
        if (process.env.WAIT_FOR==="reviewer") {
          if (a==="agent-reviewer") process.exit(0);
          if (k==="user" || k==="human") process.exit(2);
          process.exit(1);
        }
        process.exit(k==="user" || k==="human" ? 0 : 1);
      });
    '; then
      return 0
    else
      local rc=$?
      if [[ "$rc" -eq 2 ]]; then
        echo "ERROR: coder handed off to a human before reviewer" >&2
        return 1
      fi
    fi
    sleep "$POLL_SEC"
    elapsed=$((elapsed + POLL_SEC))
  done
  echo "TIMEOUT waiting for $want" >&2
  tail -80 "$API_LOG" >&2 || true
  return 1
}

LEGS="${E2E_LEGS:-all}"

if [[ "$LEGS" == "all" || "$LEGS" == "coder-reviewer" ]]; then
echo "== create coder task on sample/service =="
TASK_JSON="$(curl -sf -X POST "$BASE/api/tasks" \
  -H 'content-type: application/json' \
  -H "x-remote-agent-actor: $ACTOR" \
  -d '{
    "title":"sample-service coder-reviewer e2e",
    "description":"Work only in the mounted repo under repo/. Make the smallest safe change (prefer a one-line README note, or create repo/E2E_GREETING.md with exactly `sample-e2e\\n` if README is huge). Run no long builds. You MUST finish by calling request_mr if you changed repo files, then handoff to agent-reviewer (not a human).",
    "assigneeId":"agent-coder",
    "repos":["sample/service"],
    "primaryRepo":"sample/service"
  }')"
TASK_ID="$(echo "$TASK_JSON" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).id')"
echo "task_id=$TASK_ID"

echo "== wait until assignee is agent-reviewer =="
wait_task "$TASK_ID" reviewer

echo "== wait until reviewer hands back to a human =="
wait_task "$TASK_ID" human

echo "== approve mrRequest if present =="
curl -sf "$BASE/api/tasks/$TASK_ID" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
    const t=JSON.parse(s);
    const mr=t.mrRequest;
    if(!mr){ console.log("no mrRequest (coder may have skipped request_mr)"); process.exit(0); }
    console.log("mr status="+mr.status);
  });
'
MR_STATUS="$(curl -sf "$BASE/api/tasks/$TASK_ID" | node -pe 'const t=JSON.parse(require("fs").readFileSync(0,"utf8")); t.mrRequest&&t.mrRequest.status||""')"
if [[ "$MR_STATUS" == "pending_approval" || "$MR_STATUS" == "failed" ]]; then
  curl -sf -X POST "$BASE/api/tasks/$TASK_ID/mr-request/approve" \
    -H 'content-type: application/json' \
    -H "x-remote-agent-actor: $ACTOR" \
    -d '{"targetBranch":"main"}' >/tmp/rsa-mr-approve.json
  node -e '
    const t=JSON.parse(require("fs").readFileSync("/tmp/rsa-mr-approve.json","utf8"));
    const mr=t.mrRequest||{};
    if(mr.status!=="opened"){ console.error("approve did not open", mr); process.exit(1); }
    if(!mr.patchArtifact || !mr.bundleArtifact){ console.error("missing git artifacts", mr); process.exit(1); }
    console.log("promotion patch="+mr.patchArtifact+" bundle="+mr.bundleArtifact);
  '
fi

echo "== verify coder then reviewer runs =="
curl -sf "$BASE/api/tasks/$TASK_ID" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
    const t=JSON.parse(s);
    const providers=(t.runs||[]).map(r=>r.provider);
    if(providers.length<2){
      console.error("expected >=2 runs on the task", providers);
      process.exit(1);
    }
    if(!providers.includes("coder")) { console.error("missing coder run", providers); process.exit(1); }
    if(!providers.includes("reviewer")) { console.error("missing reviewer run", providers); process.exit(1); }
    console.log(JSON.stringify({ runCount: providers.length, providers, repos: t.repos, status: t.status }, null, 2));
  });
'

echo "== coder-reviewer artifacts must not be falsely declared =="
curl -sf "$BASE/api/tasks/$TASK_ID/artifacts" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
    const v=JSON.parse(s);
    const arts=v.artifacts||[];
    const falseDecl=arts.filter(a=>a.declared===true);
    if(falseDecl.length){ console.error("coder-reviewer must not declare preview artifacts", arts); process.exit(1); }
    console.log(JSON.stringify({ count: arts.length, declared: false }, null, 2));
  });
'
fi

if [[ "$LEGS" == "all" || "$LEGS" == "author" ]]; then
echo "== create author zero-repo task =="
AUTHOR_JSON="$(curl -sf -X POST "$BASE/api/tasks" \
  -H 'content-type: application/json' \
  -H "x-remote-agent-actor: $ACTOR" \
  -d '{
    "title":"author paper e2e",
    "description":"Research a short note on why isolated sandboxes help remote coding agents. Write artifacts/sandbox-agents.md using the business-paper skill. Include one simple chart if useful. Before handoff, write .agent/artifacts.json with this exact JSON shape (top-level key artifacts, not another name): {\"artifacts\":[{\"path\":\"artifacts/sandbox-agents.md\",\"title\":\"Isolated sandboxes\",\"primary\":true}]} plus any chart under artifacts/. Hand off with targetKind user and targetId user-dev when done. Do not mount or edit a git repo.",
    "assigneeId":"agent-author",
    "repos":[]
  }')"
AUTHOR_ID="$(echo "$AUTHOR_JSON" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).id')"
echo "author_task_id=$AUTHOR_ID"

echo "== wait until author hands back to a human =="
wait_task "$AUTHOR_ID" human
echo "author_task=$AUTHOR_ID"

echo "== author artifacts preview =="
ART_JSON="$(curl -sf "$BASE/api/tasks/$AUTHOR_ID/artifacts")"
echo "$ART_JSON" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
    const v=JSON.parse(s);
    const arts=v.artifacts||[];
    if(arts.length<1){ console.error("expected >=1 artifact", v); process.exit(1); }
    const declared=arts.filter(a=>a.declared===true);
    if(declared.length<1){ console.error("expected >=1 declared artifact", arts); process.exit(1); }
    for (const a of arts) {
      if(!a.previewUrl){ console.error("missing previewUrl", a); process.exit(1); }
    }
    console.log(JSON.stringify(arts.map(a=>({path:a.path,declared:a.declared,previewUrl:a.previewUrl})),null,2));
  });
'
echo "$ART_JSON" | node -e '
  let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{
    const v=JSON.parse(s);
    for (const a of v.artifacts||[]) process.stdout.write(a.previewUrl+"\n");
  });
' | while read -r p; do
  [[ -z "$p" ]] && continue
  hdr="$(curl -sS -D - -o /tmp/rsa-art-preview "$BASE$p" | tr -d "\r")"
  code="$(printf "%s" "$hdr" | awk "NR==1{print \$2}")"
  ctype="$(printf "%s" "$hdr" | awk -F": " "tolower(\$1)==\"content-type\"{print \$2; exit}")"
  if [[ "$code" != "200" ]]; then echo "preview $p -> $code"; exit 1; fi
  echo "preview_ok $p $ctype"
done
fi

echo "== PASS: e2e legs=$LEGS =="
echo "logs=$API_LOG"
