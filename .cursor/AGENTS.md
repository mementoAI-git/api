## Agent workflows for this repo

This file describes the main AI/agent workflows you’re expected to use **across projects** vs **specific to this repo**.

### Cross-project (generic) workflows

These do **not** depend on this repository’s particular stack or folder layout. They should be implemented as reusable global skills you can apply in many projects:

- **General code review**
  - Review a diff, service, route, or worker for correctness, maintainability, and risk.

- **Targeted refactorings**
  - Simplify a function/module, extract helpers, reduce duplication, or tighten types.

- **Documentation and comments**
  - Improve backend docs, API notes, and inline explanations for non-obvious behavior.

- **Code exploration and explanation**
  - Explain how data flows through controllers, services, models, queues, and workers.

### Project-specific workflows (`api`)

These **do** depend on this repo’s backend stack and conventions, and should be configured via this repository’s local rules and docs:

- **Express + TypeScript API work**
  - Follow the controller -> service -> model flow already used in `src/module/api/*`.
  - Keep validation, DTOs, and route wiring consistent with nearby modules.

- **Background jobs and workers**
  - Respect queue/worker boundaries in `src/workers/` and `src/services/queues/`.
  - Avoid mixing request-time code with worker-only behavior unless the architecture clearly calls for it.

- **Persistence and contracts**
  - Keep model changes, service behavior, and API responses aligned.
  - Prefer small, explicit contract changes over hidden shape drift.

- **Project-specific quality checks**
  - Respect this repo’s TypeScript and GTS lint/build setup from `package.json`.

The **generic workflows** above should be handled by reusable global skills, while the **project-specific workflows** should be guided by `.cursor/rules`, `.claude/CLAUDE.md`, and the conventions documented in this repo.

### Recommended global skills

These are the main reusable skills this repo expects agents to lean on without you having to name them every time:

- **Push / PR work** -> `git-pr`
- **Library/framework documentation lookups** -> `documentation-lookup`
- **Code review and review quality** -> `code-review-excellence`
