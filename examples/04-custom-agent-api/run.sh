#!/usr/bin/env bash
# Create changelog-writer via API, register agent, assign a short author-style task.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
PORT="${REMOTE_AGENT_API_PORT:-8787}"
BASE="http://127.0.0.1:${PORT}"
ACTOR="${REMOTE_AGENT_E2E_ACTOR:-user-dev}"
POLL_SEC="${REMOTE_AGENT_E2E_POLL_SEC:-8}"
MAX_WAIT_SEC="${REMOTE_AGENT_E2E_MAX_WAIT_SEC:-1200}"

if [[ -f .env ]]; then set -a; source .env; set +a
elif [[ -f "${ROOT}/../dns-remote-agent/.env" ]]; then set -a; source "${ROOT}/../dns-remote-agent/.env"; set +a
fi
unset REMOTE_AGENT_GITLAB_TOKEN GITLAB_BASE_URL LINEAR_API_KEY LINEAR_API_URL || true

if ! curl -sf "$BASE/api/health" >/dev/null; then
  echo "API is not running at $BASE. Start: node packages/scheduler/dist/index.js --role api --with-worker" >&2
  exit 1
fi

curl -sf -X POST "$BASE/api/agent-profiles" \
  -H 'content-type: application/json' \
  -H "x-remote-agent-actor: $ACTOR" \
  -d '{
    "id":"changelog-writer",
    "soul":"You write a short changelog note in artifacts/changelog.md and hand off to a human.",
    "basePrompt":"Use the business-paper skill. Do not edit a git repo.",
    "skills":{"names":["business-paper"]},
    "capabilities":["filesystem","shell","handoff"],
    "scopePolicy":{"allowedRepos":[]}
  }' | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); if(!j.version) process.exit(1); console.log("profile", j);});' \
  || curl -sf -X PUT "$BASE/api/agent-profiles/changelog-writer" \
    -H 'content-type: application/json' \
    -H "x-remote-agent-actor: $ACTOR" \
    -d '{
      "soul":"You write a short changelog note in artifacts/changelog.md and hand off to a human.",
      "basePrompt":"Use the business-paper skill. Do not edit a git repo.",
      "skills":{"names":["business-paper"]},
      "capabilities":["filesystem","shell","handoff"],
      "scopePolicy":{"allowedRepos":[]}
    }' >/dev/null

curl -sf -X POST "$BASE/api/agents" \
  -H 'content-type: application/json' \
  -H "x-remote-agent-actor: $ACTOR" \
  -d '{"id":"agent-changelog-writer","displayName":"Changelog writer","profileId":"changelog-writer"}' \
  >/dev/null || true

TASK="$(curl -sf -X POST "$BASE/api/tasks" \
  -H 'content-type: application/json' \
  -H "x-remote-agent-actor: $ACTOR" \
  -d '{
    "title":"Write a one-paragraph changelog",
    "description":"Write artifacts/changelog.md (five sentences max) then hand off to a human.",
    "assigneeId":"agent-changelog-writer",
    "repos":[]
  }')"
TASK_ID="$(echo "$TASK" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).id')"
echo "task_id=$TASK_ID"

elapsed=0
while [[ "$elapsed" -lt "$MAX_WAIT_SEC" ]]; do
  payload="$(curl -sf "$BASE/api/tasks/$TASK_ID")"
  echo "$payload" | WAIT_ELAPSED="$elapsed" node -e '
    let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
      const t=JSON.parse(s);
      const a=t.assignee && t.assignee.id ? t.assignee.id : t.assigneeId;
      const k=t.assignee && t.assignee.kind ? t.assignee.kind : t.assigneeKind;
      process.stdout.write("  status="+t.status+" assignee="+String(a)+" kind="+String(k)+" elapsed="+process.env.WAIT_ELAPSED+"s\n");
    });
  '
  if echo "$payload" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
      const t=JSON.parse(s);
      const k=t.assignee && t.assignee.kind ? t.assignee.kind : t.assigneeKind;
      process.exit(k==="user" || k==="human" ? 0 : 1);
    });
  '; then
    echo "custom agent handed off to a human"
    exit 0
  fi
  sleep "$POLL_SEC"
  elapsed=$((elapsed + POLL_SEC))
done
echo "TIMEOUT waiting for human assignee" >&2
exit 1
