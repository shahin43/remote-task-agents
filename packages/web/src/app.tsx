import { Route, Routes } from "react-router-dom";

import { AppShell } from "./components/app-shell";
import { AgentsPage } from "./pages/agents-page";
import { BoardPage } from "./pages/board-page";
import { PlaceholderPage } from "./pages/placeholder-page";
import { RunsPage } from "./pages/runs-page";

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<BoardPage />} />
        <Route path="/runs" element={<RunsPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route
          path="/repos"
          element={
            <PlaceholderPage
              title="Repos"
              summary="Connect and scope the repositories agents can work against."
              items={[
                "Register git repositories and default branches.",
                "Per-repo scope policy (target paths agents may touch).",
                "Mirror/cache configuration for fast sandbox checkouts.",
              ]}
            />
          }
        />
        <Route
          path="/context"
          element={
            <PlaceholderPage
              title="Context layers"
              summary="Curate the knowledge agents receive: Confluence docs, design notes, and provenance-labelled context files."
              items={[
                "Attach Confluence spaces / docs as context layers.",
                "Trust levels + provenance labels per source.",
                "Repo docs and ticket text as untrusted-by-default context.",
              ]}
            />
          }
        />
        <Route
          path="/memory"
          element={
            <PlaceholderPage
              title="Memory & skills"
              summary="Manage the persistent memory layer and the skill packs agents can load on demand."
              items={[
                "Agent memory (compaction / rollouts) configuration.",
                "Reusable SKILL.md packs available to profiles.",
                "Per-profile enable/disable of memory and skills.",
              ]}
            />
          }
        />
      </Routes>
    </AppShell>
  );
}
