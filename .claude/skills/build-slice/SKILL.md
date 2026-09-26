---
name: build-slice
description: Use when the owner asks to build a slice of the anchored shell spec (e.g. "/build-slice A", "build slice C of the anchored shell"). Orchestrates the shell-qa and shell-developer agents: QA writes failing tests from the spec, the Developer makes them pass without touching tests, QA verifies, and fixes loop until QA passes or three rounds run out.
---

# Build a slice of the anchored shell

You are the orchestrator. You start agents, pass their reports between them, enforce the boundaries and own git. **You write no product code and no tests yourself**, and you don't judge whether the slice works: QA does.

Argument: one slice letter, `A`, `B`, `C` or `D` (see "Slices" in `docs/specs/anchored-shell.md`). Build one slice per run. If none is given, ask which.

Create a task per step below and keep them updated.

## 0. Preflight

- The working tree must be clean (`git status --porcelain` empty). If not, stop and ask.
- The spec must exist at `docs/specs/anchored-shell.md` on the current branch.
- Slices build in order. For slice B, C or D, the previous slice's branch (`feat/shell-<prev>`) must exist; branch from it. For A, branch from the current branch.
- Create and switch to `feat/shell-<x>` (lowercase letter). If it exists, stop and ask whether to resume or start over.
- Make the evidence directory `.qa/slice-<x>/` (it is gitignored).
- Tell the owner in one line which branch you're on and that QA is writing tests.

## 1. QA writes the tests

Start `shell-qa` with: mode `author`, the slice letter. Wait for its report.

Boundary check: `git status --porcelain` must show changes only under `tests/`. Revert anything else (`git checkout -- <path>` / remove untracked files outside `tests/`) and note it.

Commit the tests on their own:

```
git add tests/
git commit -m "Add failing tests for anchored shell slice <X>"
```

Record this commit's SHA as `TESTS_SHA`. Every later check diffs against it.

## 2. Developer implements

Start `shell-developer` with: the slice letter, the test files from QA's report, QA's "Signature choices", and "Not covered by Node tests" so the Developer knows what QA will check by hand. Keep its agent ID; later rounds resume it with SendMessage so it keeps its context.

Boundary check after every Developer turn:

```
git diff --stat TESTS_SHA -- tests/ && git status --porcelain -- tests/
```

If anything shows, restore the tests (`git checkout TESTS_SHA -- tests/` and remove untracked files under `tests/`) and tell the Developer that the change was discarded. Count it as a failure for this round.

## 3. Test disputes

If the Developer report lists test disputes, send each one to `shell-qa` (a fresh start, mode "resolve dispute", with the Developer's text). Then:

- QA fixes the test → run the tests-only boundary check (QA changed only `tests/`), commit `Adjust slice <X> tests: <short reason>`, update `TESTS_SHA`, and tell the Developer.
- QA keeps the test → pass QA's spec quote to the Developer.
- If the Developer disputes the same test again, stop and ask the owner to decide. Show both positions with the spec text.

## 4. QA verifies, reviewers review

Start these in parallel (one message, several Agent calls):

- `shell-qa` with mode `verify`, the slice letter, round number, `TESTS_SHA`, the evidence directory `.qa/slice-<x>/round-<n>/`, and the Developer's report.
- `mobile-reviewer` if anything under `apps/mobile` changed.
- `api-reviewer` if anything under `apps/api` or `packages/types` changed.
- `security-reviewer` if the slice adds or changes an API route, a migration, env handling or logging (slices A, C and D do).

Check `git status --porcelain` afterwards: QA and reviewers must not have changed anything. Revert and note it if they did.

Combine the results. The slice fails the round if QA says FAIL **or** any reviewer reports a **Must fix**. Append reviewer Must-fix items to QA's numbered failure list, continuing its numbering and tagging each with the reviewer's name. Should-fix and Nit items go in the final summary; they don't block.

## 5. Loop

- **Fail, rounds 1 and 2:** resume the Developer (SendMessage to its ID) with the combined failure list, word for word, and "answer each by number". Run the step 2 boundary check, handle disputes (step 3), then go back to step 4 with the next round number. For QA, include the previous round's failure list so it rechecks those first.
- **Fail, round 3:** stop. Show the owner the remaining failures and the Developer's answers, and ask how to proceed. Don't commit.
- **Pass:** continue to step 6.

Between rounds, tell the owner one line: round number, verdict, how many failures.

## 6. Finish

1. Start `docs-keeper` with a summary of what the slice changed (from the Developer's reports) and the spec's "Changes to other specs" if this is slice A.
2. Run `pnpm fix`, then `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm format:check` yourself as a final gate. Revert `apps/api/next-env.d.ts` if typecheck rewrote it. If anything fails, go back to step 5 as a failed round.
3. Run `git status --porcelain` and check that every path is one the Developer or docs-keeper reported. Anything else (a stray `session.json`, scratch output) could hold a token: delete it, don't commit it. Then commit:

   ```
   git add -A
   git commit -m "Build anchored shell slice <X>: <one-line summary>"
   ```

   End the message with the attribution lines from the system reminder if there are any.

4. Don't push, open a PR or start the next slice. Report to the owner:
   - branch and commits (tests commit, implementation commit)
   - rounds taken and what failed along the way
   - migrations to apply with `pnpm db:push`
   - QA's "Check on device" list and "Can't tell" items
   - reviewers' Should-fix and Nit items
   - where the screenshots are (`.qa/slice-<x>/`)
   - the next command: `/build-slice <next letter>` after the owner has reviewed

## Rules for you

- Pass reports verbatim. Don't summarize failures for the Developer or soften them; don't add your own fixes.
- Never tell the Developer that the slice passes before QA says so.
- Never edit files in `apps/`, `packages/`, `supabase/` or `tests/` yourself. If a boundary check needs a revert, that's the only change you make.
- Smoke tests use the mock engine; never run `--provider jev` or anything that makes billed calls.
