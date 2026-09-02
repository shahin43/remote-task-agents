# Later — Phase 8+ product leftovers

Spec §5.1 skill upload, §5.7 channels, §5.8 hygiene, §6 Phase 8+ (was 6+ before
the 2026-08-29 reorder). Not started. Sandbox **hosts** are listed separately in
[sandbox-provider-extensions.md](sandbox-provider-extensions.md).

## Checklist

- [ ] Skill upload API (`POST /api/skills`, size cap, secret scan, hash pin)
- [ ] `examples/05-new-skill`
- [ ] Channel/notification plugins (stub only in v0.x; Slack/email not shipped)
- [ ] CI nightly e2e behind a repo secret (spec P1.16)
- [ ] Tenancy enforcement (columns exist; no tenant UI in v0.x)
- [ ] Optional task budget stop from usage rollup
