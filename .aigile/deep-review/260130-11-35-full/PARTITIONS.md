# Partition Plan

| ID | Scope | Est. Lines | Focus |
|----|-------|------------|-------|
| P1 | Core Infrastructure | ~2000 | index.ts, router.ts, process-pool.ts, sqlite-logger.ts |
| P2 | Backend Adapters | ~1500 | All adapter files in src/lib/backends/ |
| P3 | Auth Pool Core | ~1200 | allocation-balancer, session-store, subscription-manager |
| P4 | Auth Pool Utils | ~800 | logger, security, config-validator, notification-manager |
| P5 | Validation & Types | ~1000 | schemas.ts, api.ts, claude.ts, claude-cli.ts |
| P6 | Tests Quality | ~3000 | Review test coverage and mock quality |
