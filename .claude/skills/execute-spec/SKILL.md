---
name: execute-spec
description: Execute a spec from specs/ with a hub-and-spoke team. You orchestrate; worker subagents build; reviewer subagents verify. Use when asked to execute, implement or build a spec.
argument-hint: <spec path, e.g. specs/2026-11-19-micro-frontend-host.spec.md>
---

# Execute a spec (hub-and-spoke)
A spec that follows the spec driven development process. 

You are the **orchestrator (hub)**. Workers and reviewers are spokes (subagents). They never talk to each other; everything goes through you. Their prompts must be self-contained.

## Roles
- **Orchestrator (you):** read the spec, plan, dispatch, decide. Don't write feature code.
- **Worker:** implements one task within a given file scope, writes and runs tests, reports files changed, test results, deviations and open questions. No commits (the orchestrator commits), no spec edits.
- **Reviewer:** fresh, read-only. Checks the diff against the spec, runs tests, lint and build itself. Returns `APPROVE` or `CHANGES_REQUESTED` with findings (`file:line`, spec clause, severity: blocker/should-fix/nit).

## Procedure
1. **Intake:** read `$ARGUMENTS` spec and linked docs. If it is empty, stop and tell the user. Note scope markers (v1, `[Deferred]`, Non-goals). Ask about real ambiguities once.
2. **Plan:** write `docs/plans/<spec>.plan.md` with tasks, spec sections, file scopes, dependencies, acceptance criteria. Mark tasks parallel only if file scopes are disjoint. Get user go-ahead.
3. **Per task:** dispatch worker → check `git status` for out-of-scope edits → dispatch reviewer → `APPROVE` → **commit that task** (see Commits) and mark done; otherwise send findings to a worker for rework. Max 3 rounds, then escalate to the user.
4. **Integrate:** run the full tests, lint and build. One final reviewer checks the whole diff against the whole spec.
5. **Report:** tasks done, test results, deviations, open items. One commit per task is already made; don't push.

## Rules
- The spec is the source of truth. Building `[Deferred]` or Non-goal items is a blocker.
- No task is done without reviewer `APPROVE` and passing tests. Report failures plainly.
- Quote spec text in prompts rather than paraphrasing. Never edit the spec.

## Commits
- One commit per approved task, made by you, never by workers. Stage only that task's files by explicit path (no `git add -A`), so unrelated changes and parallel tasks stay out.
- Message: `<type>(<scope>): <task title>` plus a body line naming the spec and task id. Follow the repo's attribution rules.
- Commit only after reviewer `APPROVE` and passing tests. Rework fixes go into the same commit. Final-integration fixes get their own commit.
- Never commit secrets, never amend or force-push, never push.
