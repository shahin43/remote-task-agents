import { test } from "node:test";
import assert from "node:assert/strict";
import { humanVisibleSnapshotFiles, isPlatformSnapshotPath } from "./board-files.js";
import type { SnapshotFileEntry } from "../api/types";

test("platform paths include repo, git internals, and harness sidecars", () => {
  assert.equal(isPlatformSnapshotPath("repo/src/index.js"), true);
  assert.equal(isPlatformSnapshotPath(".repo/HEAD"), true);
  assert.equal(isPlatformSnapshotPath("repo/.git/HEAD"), true);
  assert.equal(isPlatformSnapshotPath(".agent/handoff.json"), true);
  assert.equal(isPlatformSnapshotPath("AGENTS.md"), true);
  assert.equal(isPlatformSnapshotPath("git/branch.json"), true);
  assert.equal(isPlatformSnapshotPath("git/changes.patch"), false);
  assert.equal(isPlatformSnapshotPath("artifacts/paper.md"), false);
});

test("humanVisibleSnapshotFiles keeps patch and artifacts only", () => {
  const files: SnapshotFileEntry[] = [
    { path: "AGENTS.md", group: "key" },
    { path: ".agent/handoff.json", group: "key" },
    { path: "git/changes.patch", group: "git" },
    { path: "git/branch.json", group: "git" },
    { path: "repo/README.md", group: "repo" },
    { path: "artifacts/paper.md", group: "artifacts" },
  ];
  assert.deepEqual(
    humanVisibleSnapshotFiles(files).map((f) => f.path),
    ["git/changes.patch", "artifacts/paper.md"],
  );
});
