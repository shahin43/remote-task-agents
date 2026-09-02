import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "../api/client";
import { getAuth, setActor, setToken, subscribe } from "../auth/session";

/**
 * Top-bar identity + control gate.
 *
 * - The dropdown lists seed users/agents; selecting one sets the acting actor
 *   (`x-remote-agent-actor`) for board mutations.
 * - The password field maps to the shared `REMOTE_AGENT_API_TOKEN` gate and is
 *   only needed when the server requires control auth.
 *
 * SSO / social login is an explicit future enhancement (see plan).
 */
export function LoginControl() {
  const [auth, setAuth] = useState(getAuth());
  useEffect(() => subscribe(setAuth), []);

  const assignees = useQuery({ queryKey: ["assignees"], queryFn: api.assignees });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health });

  const controlAuthRequired = health.data?.controlAuthRequired ?? false;
  const online = health.isSuccess;

  return (
    <div className="login-control">
      <span className={`login-dot ${online ? "online" : ""}`} title={online ? "API online" : "API unavailable"} />
      <select
        className="login-select"
        aria-label="Acting user"
        value={auth.actor ?? ""}
        onChange={(event) => {
          const id = event.target.value || null;
          const label =
            assignees.data?.find((principal) => principal.id === id)?.displayName ?? id;
          setActor(id, label);
        }}
      >
        <option value="">Sign in as…</option>
        {(assignees.data ?? []).map((principal) => (
          <option value={principal.id} key={principal.id}>
            {principal.displayName}
            {principal.kind === "agent" ? " (agent)" : ""}
          </option>
        ))}
      </select>
      {controlAuthRequired ? (
        <input
          className="login-password"
          type="password"
          autoComplete="off"
          placeholder="Password"
          value={auth.token ?? ""}
          onChange={(event) => setToken(event.target.value || null)}
        />
      ) : (
        <span className="login-hint">No password required</span>
      )}
    </div>
  );
}
