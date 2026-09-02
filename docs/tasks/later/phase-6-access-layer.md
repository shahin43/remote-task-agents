# Later — Phase 6: access layer v1

Spec §5.4 (was Phase 4 before the 2026-08-29 reorder; no work had started).

Exit: no client-supplied identity anywhere (`x-remote-agent-actor` dies).

## Checklist

- [ ] Server-side identity resolution (session/cookie or OIDC)
- [ ] Pluggable providers: `local`, `oidc`, `token`
- [ ] Roles: viewer / operator / admin enforced in the API
- [ ] Role split for snapshots: `viewer` = task artifacts API only; whole-workspace browse = `operator`+ (surface shaped in Phase 4)
- [ ] Swap the chat actor-resolution helper (Phase 5) to the server-derived actor
- [ ] CORS allowlist + CSRF for the SPA
- [ ] Profile/agent writes are admin actions even under `local`

## Note

This phase is **identity**, not sandbox hosts. Cloud/self-hosted sandboxes stay
in [`sandbox-provider-extensions.md`](sandbox-provider-extensions.md).
Whole-repo progress: [DEVELOPMENT.md](../../../DEVELOPMENT.md).
