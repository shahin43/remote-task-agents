---
name: repo-orientation
description: >
  Orient yourself in an unfamiliar repository before changing anything: find the
  build/test commands, the conventions the project actually follows, and the
  smallest place your change belongs. Use at the start of any implementation task.
risk_class: shell
tags: [coding, orientation]
---

# Repo orientation

Goal: spend a few cheap tool calls buying certainty, so the edit itself is small and
correct. Do this before your first write.

## 1. Read the project's own instructions first

In `repo/`, read whichever of these exist, in this order, and treat them as binding:

- `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`
- `README.md` (build/run/test sections only)

If they specify commands, use exactly those commands. Do not invent your own.

## 2. Establish how the project is built and tested

Look for the manifest that matches the stack, then read its scripts rather than
guessing: `package.json`, `pyproject.toml`, `go.mod`, `Makefile`, `build.gradle`.

Prefer the narrowest test command that covers your change (a single package or file)
over a full-suite run — it is faster and its failure output is easier to act on.

## 3. Find the change site before editing

Search for the symbol or string the task names, not for a file you expect to exist.
Read the surrounding file fully before editing it: match its naming, error handling,
and comment density instead of importing a different style.

## 4. Verify, then report honestly

Run the narrow test command. If it fails for a reason unrelated to your change, say so
explicitly in your summary rather than presenting the run as clean.

## Checklist before you hand off

- [ ] Read the repo's own instruction files
- [ ] Used the project's declared build/test commands
- [ ] Change is confined to the smallest sensible surface
- [ ] Ran a verification command and reported its real outcome
