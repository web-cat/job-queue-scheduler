# Task 2: CLAUDE.md + /docs Setup

**Status:** Completed
**Assignee:** Tomas
**Priority:** HIGH — gives all teammates' Claude Code sessions full context
**Dependencies:** None (can be done in parallel with Task 1)

## Context

Every teammate will use Claude Code to implement their tasks. Claude Code automatically reads `CLAUDE.md` from the repo root at the start of every session. The `/docs` folder contains detailed reference documents. The `/tasks` folder contains individual task specs.

## What to Build

### 1. Copy documentation files into the repo

The following files have been pre-written and are ready to be placed in the repo:

- `CLAUDE.md` → repo root
- `docs/ARCHITECTURE.md`
- `docs/DATABASE.md`
- `docs/API_ENDPOINTS.md`
- `docs/CONVENTIONS.md`

### 2. Copy task files into the repo

All 16 task files go in the `/tasks` directory:

- `tasks/task-01-update-schema.md` through `tasks/task-16-k8s-manifests.md`

### 3. Update README.md

Update the repo's README.md to include:
- Project overview (one paragraph)
- Tech stack
- How to run locally (docker-compose)
- Link to `/docs` for detailed documentation
- Link to `/tasks` for the task list
- Team members

### 4. Add a TASKS.md at repo root

A quick-reference checklist linking to each task file:

```markdown
# Task Tracker

## Foundation
- [ ] [Task 1: Update Database Schema](tasks/task-01-update-schema.md)
- [ ] [Task 2: Documentation Setup](tasks/task-02-docs-setup.md)

## API Endpoints
- [ ] [Task 3: Job Submission](tasks/task-03-job-submission.md)
...
```

## Acceptance Criteria

- [ ] `CLAUDE.md` exists at repo root and gives Claude Code full project context
- [ ] All docs files are in `/docs/`
- [ ] All task files are in `/tasks/`
- [ ] README.md is updated with project overview and setup instructions
- [ ] TASKS.md provides a quick-reference checklist
