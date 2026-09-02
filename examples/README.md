# Examples gallery

Runnable scenarios for the Phase 1 showcase ([product spec §5.3](../docs/specs/2026-08-29-generic-open-source-service-spec.md)).

Requires Postgres (`docker compose up postgres -d`), a built guest image
(`npm run build:pi-agent-image`), and `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`
(local `.env` or sibling `dns-remote-agent/.env` sourced at runtime).

| Example | What it proves |
|---|---|
| [01-fix-a-bug](01-fix-a-bug/) | coder → reviewer → optional git-artifact approve on `sample/service` |
| [02-research-paper](02-research-paper/) | author, zero-repo, `artifacts/` paper |
| [03-follow-up](03-follow-up/) | second attempt on the same session |

`04-custom-agent-api` and `05-new-skill` wait on Phase 2 (config API).
