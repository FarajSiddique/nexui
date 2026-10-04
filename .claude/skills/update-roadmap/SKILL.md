---
name: update-roadmap
description: Use when the Nexui roadmap in Notion may be behind merged work — after a batch of PRs lands, before planning the next phase, or when asked whether the roadmap is current.
argument-hint: '[ISO time to start from, if not the last Progress entry]'
disable-model-invocation: true
allowed-tools: Bash(gh pr list:*), Bash(gh pr view:*), Bash(git log:*), mcp__claude_ai_Notion__notion-fetch, mcp__claude_ai_Notion__notion-query-data-sources, mcp__claude_ai_Notion__notion-update-page, mcp__claude_ai_Notion__notion-create-pages
---

# Update the roadmap

Bring the Notion roadmap in line with merged PRs. Facts go in without asking; anything that changes the plan waits for the user.

## Where things live

- Page: https://app.notion.com/p/3ef5237bb57d8141a672f72299a71abe. It holds a `## Progress` log (newest first), Timeline, Decisions, Risks, Open questions and the inline items database.
- Items: `collection://66f22efa-270d-4df3-b9e8-26fec7dd2ac1`. Fetch it for the schema before writing. Properties: Item, Phase (`1 · Finish slice 1` … `6 · After launch`), Status (`Not started` / `In progress` / `Done`), Priority (`Must` / `Should` / `Stretch` / `By demand`), Size (`S` / `M` / `L`), Area (multi-select, written as `["Mobile","Backend"]`), Target (`date:Target:start`), Notes.
- A pending new preview build, and the device checks that wait on it, belong to the item "Smoke test on a real device, mock then live", not to each feature.
- Before editing page text, read `notion://docs/enhanced-markdown-spec`.
- When project memory and Notion disagree about the roadmap, Notion is current. Fix the memory.

## Steps

1. **Read** the page, and query every item with SQL: `url`, `Item`, `Phase`, `Status`, `Priority`, `Notes`.
2. **Find the window.** The newest Progress entry ends with "Covers PRs merged through #N (YYYY-MM-DD HH:MM:SS UTC)". List what merged after that time, or after `$ARGUMENTS` when given:

   ```bash
   gh pr list --state merged --search "merged:>YYYY-MM-DDTHH:MM:SSZ" --limit 100 --json number,title,mergedAt
   ```

   The time sets the window, not the PR number: PRs don't merge in number order. If nothing merged, say the roadmap is current and stop.

3. **Gather evidence.** Read each PR body (`gh pr view <n> --json body`) and note its unticked "Still to do" items. Check project memory for state git doesn't show: device checks, prod pushes, new builds. When a PR touches an open item, check the code for partial progress.
4. **Sort** every PR and finding with the table below. A finding can match an auto row and an ask row: apply the auto change, and ask too.
5. **Apply the auto rows.** Notes describe the item as it stands now: keep its context sentence, replace sentences that are no longer true, and add the new evidence with PR numbers and dates, in short plain sentences like the existing ones.
6. **Ask about the rest in one message:** a numbered table with your proposal and reason for each row. Wait for one reply, then apply what the user approves.
7. **Write the Progress entry** as the first bullet under `## Progress`. In the status line, set "Updated <date mention>" to today, adding it after the first date if it's missing.
8. **Re-fetch the page** to check nesting, then report what was applied, approved and declined, with the page link.

## Auto or ask

| Finding                                                                                     | Change                                                | Rule |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---- |
| A merged PR delivers what the item's title says, and its Notes name nothing else left       | Status Done; Notes add "Merged in PR #N on <Mon D>."  | auto |
| Work merged, but a step other than a device check remains (a live run, a prod push)         | Status In progress; Notes say what's left             | auto |
| A merged feature's device checks wait on a new preview build                                | Notes on the smoke-test item; the feature can be Done | auto |
| Evidence for an existing item: partial progress, a moved code reference, a follow-up for it | Notes                                                 | auto |
| You can't tell from PRs, code or memory whether a step is done (a live run, an env var)     | Ask                                                   | ask  |
| Something users can now see or do with no item, or a follow-up no item covers               | New item: propose Phase, Priority, Size, Area, Target | ask  |
| Any Phase, Priority, Size or Target change; deleting an item                                | Propose it                                            | ask  |
| Timeline, Decisions, Risks or Open questions, including a risk whose premise a PR changed   | Propose the new text                                  | ask  |
| Engineering-only PRs: refactors, lint, scripts, specs, docs, bug fixes                      | None; name them in the Progress entry                 | skip |

When proposing an item for work that already shipped: Status Done, or In progress if a non-device step remains; Notes starting "Not on the original roadmap."; the Phase where it belongs on the plan; Target set to the merge date if Done, otherwise that phase's end date. Group small related PRs into one item.

## Progress entry

```
- **<mention-date start="YYYY-MM-DD"/>: <headline: where the current phase stands>.**
	- Done: <items marked Done, with PRs>.
	- Left in phase <n>: <its open "Done when" checks>.
	- Shipped but not planned: <items added for unplanned work>.
	- Added: <new not-started items>.
	- Watch: <a phase running ahead or behind, the next phase not started, a risk to revisit>.
	- Not roadmap items: <engineering-only PRs>.
	- Covers PRs merged through #N (YYYY-MM-DD HH:MM:SS UTC).
```

Leave out lines with nothing to say. The "Covers" line is required: the next run starts from it. #N is the PR with the latest `mergedAt`, and the time is that `mergedAt` to the second.

## Common mistakes

- Marking an item Done because its PR merged while a non-device step is still open, such as a live eval nobody has judged.
- Keeping a feature In progress only for its device checks. Those go on the smoke-test item.
- Creating items, or choosing their phase and priority, without asking, even when the answer looks obvious.
- Re-adding work: search item Notes for the PR number before proposing an item.
- Moving dates because a phase is ahead or behind. Put it under "Watch" and ask.
