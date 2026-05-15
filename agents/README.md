# AI Config Map

This folder is the human-readable map for AI tooling in `api`.

The goal is simple:
- keep reusable skills global
- keep backend-specific rules local
- avoid duplicate skill trees inside the repo

## What Lives Where

### Global reusable skills

Reusable skills are installed globally in:

- `/Users/admin/.codex/skills`

Use the project index here for the current installed list:

- [global skills index](/Users/admin/Codebase/projects/Memento%20AI/.agents/skills/README.md)

These are the right place for things like:
- git / PR workflow help
- documentation lookups
- code review workflows
- reusable testing workflows

### Project-local config that should stay in this repo

These files are tied to `api` and should remain local:

- [.claude/CLAUDE.md](/Users/admin/Codebase/projects/Memento%20AI/api/.claude/CLAUDE.md)
- `.claude/settings.local.json`
- [.cursor/AGENTS.md](/Users/admin/Codebase/projects/Memento%20AI/api/.cursor/AGENTS.md)
- [.cursor/rules/](/Users/admin/Codebase/projects/Memento%20AI/api/.cursor/rules)

These are not generic skills. They are project-specific tool configuration and backend guidance.

## Cleanup Decision

This repo does **not** currently need local skill trees like:

- `api/.agents/skills/`
- `api/.cursor/skills/`
- `api/.claude/skills/`

If reusable behavior is needed, install it globally instead of recreating local copies here.

## Rule of Thumb

- If it is reusable across projects, install it globally.
- If it depends on this repo’s backend architecture, routes, workers, or data flow, keep it local.
- If it is empty, duplicated, or only there because of older experiments, remove it.
