---
name: hello-fixture
description: Tiny custom-skill stand-in for guest-image e2e. Read this file if present.
risk_class: readonly
tags: [e2e, fixture]
---

# Hello fixture

This is a mocked tenant/workspace skill. If you can read this path, custom-skill
staging into the guest worked.

## Guest-loop deliverable

When this run's task asks you to complete the greeting fixture, write
`repo/GREETING.md` with **exactly** this content and nothing else (including
the trailing newline):

```
hello-fixture: ping
```

Do not edit other files. After the file exists, stop.
