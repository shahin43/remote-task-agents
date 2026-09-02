# Done — Board SPA task view + listing (follow-on to Phase 4)

Not a numbered product phase. Shipped on top of Phase 4 so the board a human
lands on matches the artifact API: a document reader, a scannable status grid,
and a profile listing that separates templates from registered agents.

Live check: board at `/app/` after `npm run build:web` (also part of root
`npm run build`). Inspection e2e wipe+rerun 2026-08-29
(`runs/e2e-logs/live-board-e2e-20260829-160217.log`): author `SAM-0E97E6`
declared `artifacts/sandbox-agents.md`; coder→reviewer `SAM-82B4ED` `done`.

## Checklist

- [x] Artifacts tab is a document reader (chips + preview card), not stacked `<details>`
- [x] Markdown renderer (headings, lists, fences, tables) in `packages/web/src/lib/markdown-preview.ts`
- [x] Files tab renamed **Changes**; hide platform/harness paths (`.git/`, `repo/`, `.agent/`, `AGENTS.md`, …); keep `git/changes.patch`
- [x] Drawer landing: review/done + artifacts → Artifacts; else review/done → Changes; else Activity
- [x] Drawer widens on Changes/Artifacts
- [x] Six equal status columns (Backlog → Failed); status colour on header dots only
- [x] Cool field + terracotta accent (`#d4784e`); no rainbow column top-bars
- [x] Column wells: light stipple (small transparent dots), not graph-paper lines
- [x] Agents tab: profile-template grid + registered-agent card grid; repos/guardrails collapsed
- [x] Root `npm run build` includes `npm run build:web` so the API does not serve a stale SPA

## Out of this slice

- Git-diff viewer inside Changes (still later; list + patch file is enough)
- Phase 7 profile document editor, version history, `chat: true` (see
  [later/phase-7](../later/phase-7-agent-config-ui.md))
- Phase 5 chat UI
