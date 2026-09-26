---
name: build-spec
description: Use when the owner asks to implement a spec or implementation plan, or one unit of it (e.g. "/build-spec docs/specs/anchored-shell.md A", "build phase 2 of the integrations spec", "implement task 3 of this plan"). Orchestrates the qa and developer agents: QA writes failing tests from the document, the Developer makes them pass without touching tests, QA and the reviewers verify, and fixes loop until QA passes or three rounds run out. One unit per run.
---

# Build a spec or plan, one unit at a time

You are the orchestrator. You start agents, pass their reports between them, enforce the boundaries and own git. **You write no product code and no tests yourself**, and you don't judge whether the work is correct: QA does.

Arguments: the document path (a spec in `docs/specs/`, a plan such as `docs/superpowers/plans/…`), and optionally the unit to build. If the path is missing, ask for it.

Create a task per step below and keep them updated.

## 0. Preflight

1. The working tree must be clean (`git status --porcelain` empty). If not, stop and ask: the unit's worktree starts from committed files only, so uncommitted edits wouldn't reach it.
2. Read the document and **find its units**: the headings or numbered items it tells you to build in order, such as "Slice A", "Phase 2", "Task 4", "Step 3", or the entries of a "Slices", "Order of work" or "Phases" section (each entry is a unit, and the sections it names are its scope). A document with no units is one unit, "whole document".
   - Unit given: match it to one unit (accept "A", "slice a", "2", "task 2"). If it doesn't match, list the units and ask.
   - Unit not given: list the units with one line each and ask which to build. Suggest the first one that has no `feat/<doc>-<unit>` branch yet.
   - If a unit is too big for one Developer run (more than about 25 files, or several independent subsystems), say so and ask whether to build it as is.
3. **Order.** If the document says units build in order, check that every earlier unit is merged into the current branch or has its branch. Branch from the latest earlier unit's branch if it isn't merged; otherwise from the current branch.
4. Names. `<doc>` is the document's file name without extension and date prefix (`anchored-shell`, `integrations`). `<unit>` is the unit in lowercase kebab case (`a`, `phase-2`, `task-4`, `all`).
5. **Worktree.** Each unit builds in its own worktree, so several `/build-spec` sessions can run at once without sharing a checkout. Let `ROOT` be the main checkout (`dirname "$(git rev-parse --path-format=absolute --git-common-dir)"`) and `WT` be `$ROOT/.claude/worktrees/<doc>-<unit>` (gitignored).
   - If the branch `feat/<doc>-<unit>` or the directory `WT` already exists, stop and ask whether to resume or start over. To resume, enter the existing worktree (add it first with `git worktree add "$WT" feat/<doc>-<unit>` if only the branch exists) and continue from the first step that has no commit yet.
   - Otherwise run `git worktree add "$WT" -b feat/<doc>-<unit> <base>`, where `<base>` comes from step 3.
   - Switch this session into it with `EnterWorktree` and `path: WT`. Every command and agent from here on works in `WT`; the main checkout stays on its own branch.
   - Copy the gitignored env files from the main checkout: `cp "$ROOT/apps/api/.env.local" "$WT/apps/api/.env.local"` and `cp "$ROOT/apps/mobile/.env" "$WT/apps/mobile/.env"`. If either is missing in `ROOT`, say so: QA can then only run checks that need no sign-in.
   - Run `pnpm install --frozen-lockfile` in `WT`.
6. **Ports.** Other units' QA may be running dev servers, so pick this unit's pair instead of 3000 and 8081:

   ```
   off=$(( $(printf '%s' '<doc>-<unit>' | cksum | cut -d' ' -f1) % 90 + 10 ))
   API_PORT=$((3000 + off)); WEB_PORT=$((8100 + off))
   ```

   If `lsof -nP -iTCP:<port> -sTCP:LISTEN` shows either port in use, add 1 to `off` and try again. Write the pair to `.qa/<doc>/<unit>/ports` and reuse it when resuming.

7. Make the evidence directory `.qa/<doc>/<unit>/` in `WT` (gitignored).
8. Tell the owner in one line: document, unit, branch, worktree path, ports, and that QA is writing tests.

Every agent prompt below includes the document path, the unit by its heading in the document, and the worktree path with "work only inside this directory".

## 1. QA writes the tests

Start `qa` with mode `author`. Wait for its report.

Boundary check: `git status --porcelain` must show changes only under `tests/`. Revert anything else (`git checkout -- <path>`, remove untracked files outside `tests/`) and note it.

If QA reports ambiguities in the document, show them to the owner and ask before continuing: the Developer would otherwise guess.

Commit the tests on their own, if there are any:

```
git add tests/
git commit -m "Add failing tests for <doc> <unit>"
```

Record this commit's SHA as `TESTS_SHA` (with no tests, record the current HEAD). Every later check diffs against it.

## 2. Developer implements

Start `developer` with the test files from QA's report, QA's "Signature choices", and "Not covered by Node tests" so the Developer knows what QA will check by hand. Keep its agent ID; later rounds resume it with SendMessage so it keeps its context.

Boundary check after every Developer turn:

```
git diff --stat TESTS_SHA -- tests/
git status --porcelain -- tests/
```

If anything shows, restore the tests (`git checkout TESTS_SHA -- tests/`, remove untracked files under `tests/`) and tell the Developer the change was discarded. Count it as a failure for this round.

## 3. Test disputes

If the Developer report lists test disputes, start `qa` with mode `resolve dispute` and the Developer's text. Then:

- QA fixes the test → boundary check (only `tests/` changed), commit `Adjust <doc> <unit> tests: <short reason>`, update `TESTS_SHA`, and tell the Developer.
- QA keeps the test → pass QA's quote to the Developer.
- If the Developer disputes the same test again, stop and ask the owner to decide. Show both positions with the document text.

## 4. QA verifies, reviewers review

Start these in parallel (one message, several Agent calls):

- `qa` with mode `verify`, round number, `TESTS_SHA`, evidence directory `.qa/<doc>/<unit>/round-<n>/`, `API_PORT` and `WEB_PORT`, and the Developer's report.
- `mobile-reviewer` if anything under `apps/mobile` changed.
- `api-reviewer` if anything under `apps/api` or `packages/types` changed.
- `security-reviewer` if the change touches auth, env, logging, an API route, a migration or the decision engine.
- `intent-evaluator` if the change touches the decision-engine prompt, candidates or model settings.

Check `git status --porcelain` afterwards: QA and the reviewers must not have changed anything outside `.qa/`. Revert and note it if they did.

Combine the results. The round fails if QA says FAIL **or** any reviewer reports a **Must fix**. Append reviewer Must-fix items to QA's numbered failure list, continuing its numbering and tagging each with the reviewer's name. Should-fix and Nit items go in the final summary; they don't block.

## 5. Loop

- **Fail, rounds 1 and 2:** resume the Developer (SendMessage to its ID) with the combined failure list, word for word, and "answer each by number". Run the step 2 boundary check, handle disputes (step 3), then go back to step 4 with the next round number. Give QA the previous round's failure list so it rechecks those first.
- **Fail, round 3:** stop. Show the owner the remaining failures and the Developer's answers, and ask how to proceed. Don't commit.
- **Pass:** continue to step 6.

Between rounds, tell the owner one line: round number, verdict, how many failures.

## 6. Finish

1. Start `docs-keeper` with a summary of what the unit changed (from the Developer's reports), plus any section of the document that lists doc updates due at this unit (such as "Changes to other specs").
2. Run `pnpm fix`, then `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm format:check` yourself as a final gate. Revert `apps/api/next-env.d.ts` if typecheck rewrote it. If anything fails, go back to step 5 as a failed round.
3. Run `git status --porcelain` and check that every path is one the Developer or docs-keeper reported. Anything else (a stray `session.json`, scratch output) could hold a token: delete it, don't commit it. Then commit:

   ```
   git add -A
   git commit -m "Build <doc> <unit>: <one-line summary>"
   ```

   End the message with the attribution lines from the system reminder, if any.

4. Don't push, open a PR, start the next unit or remove the worktree. Report to the owner:
   - branch, worktree path and commits (tests commit, implementation commit)
   - rounds taken and what failed along the way
   - migrations to apply with `pnpm db:push`
   - QA's "Check on device" list and "Can't tell" items
   - reviewers' Should-fix and Nit items
   - where the screenshots are (`.qa/<doc>/<unit>/`)
   - the next command, e.g. `/build-spec <path> <next unit>`, once the owner has reviewed
   - cleanup once the branch is merged: `git worktree remove .claude/worktrees/<doc>-<unit>`

## Rules for you

- Pass reports verbatim. Don't summarize failures for the Developer or soften them; don't add your own fixes.
- Never tell the Developer the unit passes before QA says so.
- Never edit files in `apps/`, `packages/`, `supabase/` or `tests/` yourself. A boundary revert is the only change you make.
- Smoke tests use the mock engine; never run `--provider jev` or anything else that makes billed calls.
