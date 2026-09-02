/**
 * Lightweight client-side auth/identity store for v1.
 *
 * - `actor` — which seed user/agent the operator is acting as. Sent on every
 *   request as `x-remote-agent-actor` (already honored by the api server) so
 *   board mutations are attributed correctly.
 * - `token` — the shared control password. Reuses the existing
 *   `REMOTE_AGENT_API_TOKEN` Bearer/Basic gate; only required for writes.
 *
 * Future: real per-user auth / SSO / social login (deferred — see plan).
 */

const ACTOR_KEY = "agentBoardActor";
const ACTOR_LABEL_KEY = "agentBoardActorLabel";
const TOKEN_KEY = "agentBoardToken";

export interface AuthState {
  actor: string | null;
  actorLabel: string | null;
  token: string | null;
}

type Listener = (state: AuthState) => void;
const listeners = new Set<Listener>();

export function getAuth(): AuthState {
  return {
    actor: sessionStorage.getItem(ACTOR_KEY),
    actorLabel: sessionStorage.getItem(ACTOR_LABEL_KEY),
    token: sessionStorage.getItem(TOKEN_KEY),
  };
}

export function setActor(actor: string | null, actorLabel: string | null): void {
  if (actor) {
    sessionStorage.setItem(ACTOR_KEY, actor);
    sessionStorage.setItem(ACTOR_LABEL_KEY, actorLabel ?? actor);
  } else {
    sessionStorage.removeItem(ACTOR_KEY);
    sessionStorage.removeItem(ACTOR_LABEL_KEY);
  }
  emit();
}

export function setToken(token: string | null): void {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
  emit();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  const state = getAuth();
  for (const listener of listeners) listener(state);
}
