import type { SnapshotFileEntry } from "../api/types";

/** Snapshot paths the drawer should not offer as a human preview. */
export function isPlatformSnapshotPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized === ".git" || normalized.startsWith(".git/")) return true;
  if (normalized.includes("/.git/")) return true;
  if (normalized === "repo" || normalized.startsWith("repo/")) return true;
  if (normalized === ".repo" || normalized.startsWith(".repo/")) return true;
  if (normalized === "AGENTS.md" || normalized.startsWith(".agent/")) return true;
  if (normalized === "git/branch.json") return true;
  return false;
}

/** Git patch plus artifacts; drop repo/.git/harness sidecars from the Changes tab. */
export function humanVisibleSnapshotFiles(files: SnapshotFileEntry[]): SnapshotFileEntry[] {
  return files.filter((file) => {
    if (isPlatformSnapshotPath(file.path)) return false;
    if (file.path === "git/changes.patch") return true;
    const group = file.group;
    if (group === "artifacts" || file.path.startsWith("artifacts/")) return true;
    return false;
  });
}
