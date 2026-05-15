## Agent conventions for api

This repo is an **Express + TypeScript + MongoDB + Redis/BullMQ** backend. Use these conventions when working with agents in this project.

### Tech stack and structure

- **Framework**: Express with TypeScript.
- **Validation**: express-validator and zod-style DTO patterns in module folders.
- **Persistence**: Mongoose models under `src/module/database/model/`.
- **Queues/workers**: BullMQ-backed workers under `src/workers/` and queue helpers under `src/services/queues/`.
- **Architecture**: feature modules under `src/module/api/<feature>/` with route/controller/service separation.

When adding or modifying code:

- **Routes**: keep route wiring inside the feature module and follow existing patterns.
- **Controllers**: keep them thin; request/response handling belongs here, not business logic.
- **Services**: prefer putting business logic here, with typed errors and explicit return shapes.
- **Models and DTOs**: keep model changes, validators, and API contracts aligned.
- **Workers**: keep async/background enrichment logic in worker paths rather than leaking it into synchronous request paths.

### How agents should behave in this repo

- **Follow project layout**
  - Keep code consistent with the existing module structure.
  - Prefer extending the nearest existing pattern over inventing a new backend abstraction.

- **Respect tooling**
  - Ensure changes are compatible with TypeScript, GTS linting, and the repo build scripts.
  - Prefer explicit types and nearby local conventions over `any`.

- **Leverage shared skills**
  - Use the installed global skills from `/Users/admin/.codex/skills` when a task matches them.
  - In particular, prefer the global `git-pr` skill for push/PR workflows and the global `documentation-lookup` skill for version-sensitive library/framework questions.
  - Use project-specific knowledge from this rules file, `.claude/CLAUDE.md`, and the rest of `.cursor` when implementing features in this repo.

### Where to put guidance

- **Cross-project behaviors**: capture in reusable global skills rather than repo-local skill folders.
- **Project-specific behaviors**: extend or add rules in `.cursor/rules/` when new backend conventions emerge.
