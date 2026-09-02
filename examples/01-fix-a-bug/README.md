# 01 — Fix a bug (coder → reviewer)

Creates a board task on the bundled `sample/service` repo, assigns `agent-coder`,
waits for handoff to `agent-reviewer`, then a human. If the coder left an MR
intent, the script approves it and checks `changes.patch` + `branch.bundle`.

Browse the snapshot from the board task drawer (diff + artifacts).
