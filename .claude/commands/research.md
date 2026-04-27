---
description: Run the multi-agent legal research pipeline on a question
argument-hint: "<legal question in quotes>"
---

You are the orchestrator for a multi-agent Canadian legal research pipeline. The user has invoked `/research` with a legal question. Your job is to spawn specialist subagents in the correct order, pass each one only what it needs, and produce a grounded IRAC memo.

The user's question is in `$ARGUMENTS`.

**Contamination prevention is a design principle.** Each subagent has an isolated context. Pass only the inputs that subagent needs — do not dump the entire pipeline state into every spawn.

**Progress visibility is required.** The user is watching this run in their terminal. **Before** spawning any subagent, print a one-line "starting" announcement to the user (visible terminal output, not a tool call). **After** the subagent returns, print a one-line "completed" line that includes the agent's `progressSummary` field. Use this format:

```
▶ planner — decomposing the question…
✓ planner: <progressSummary from the agent's output>

▶ secondary-source + discovery (parallel) — finding seed cases and running A2AJ search…
✓ secondary-source: <progressSummary>
✓ discovery: <progressSummary>

▶ reader (Phase 1) — fetching and digesting top candidates + legislation…
✓ reader: <progressSummary>

(... and so on through every stage)
```

Print these as plain text in your assistant response between Agent tool calls. They are how the user follows what the system is doing in real time.

## Pipeline

### Step 1 — Planner

Spawn the `planner` subagent. Input: just the user's question.

Use the Agent tool with `subagent_type: "planner"`. The planner returns JSON with `issues`, `datasets`, `queries`, `depth`, and `crossStatuteScope`. Capture this; you'll route pieces of it to later agents.

### Step 2 — SecondarySource and Discovery in PARALLEL

Spawn both subagents in a single message with two Agent tool calls.

- **secondary-source:** input is the user's question and the planner's `issues`. Returns seed citations and doctrinal framing.
- **discovery:** input is the planner's `queries` and `datasets`. Returns ranked candidates.

After both return, merge the candidate set: discovery's candidates plus any secondary-source seed citations that discovery confirmed exist in A2AJ. Dedupe by citation.

### Step 3 — Reader (Phase 1) — PARALLEL

The Reader processes ONE item per invocation. Build the input list:
- All `legislation` hits from Discovery (typically 1–2 statutes; always digest them)
- The top `depth` `candidates` (cases) from Discovery, where `depth` came from the planner

Spawn one `reader` subagent **per item, in a single message with multiple Agent tool calls** so they run in parallel. Each Reader fetches its assigned item, self-verifies its `keyParagraphs` via `verify.js`, and returns a single digest object (`{ digestType, ... }`).

Collect the per-item digests into a `digests: [...]` array. This is the canonical Phase 1 digest pool.

Statute digests have shape `digestType: "legislation"` (sections + sectionCitatorQueries); case digests have `digestType: "case"` (keyParagraphs + internalCitations).

### Step 3a — Section-citator search (only if legislation digests exist)

Scan the Phase 1 digest pool for entries with `digestType: "legislation"`. Each carries a `sectionCitatorQueries` array — forward note-up for the statutory provisions: "find cases applying section X of this Act."

If `sectionCitatorQueries` is non-empty across the legislation digests:

1. Flatten the queries into a single list (cap at ~6 total).
2. Spawn `discovery` subagent again with these queries. It returns additional case candidates.
3. Take the top `min(depth, 5)` new candidates that weren't already in Phase 1, and spawn one `reader` subagent **per case in parallel** (single message, multiple Agent calls).
4. Merge Phase 2 digests into the Phase 1 digest pool.

If no legislation digests, or `sectionCitatorQueries` is empty, skip this step.

### Step 4 — TreatmentClassifier — PARALLEL

Identify the strong on-point cases from the digest pool — typically 2–4 leading authorities the Synthesizer will rely on heavily.

Spawn one `treatment-classifier` subagent **per target case, in parallel** (single message, multiple Agent calls). Each returns a `treatments[]` array for its one target. Concatenate the arrays into a single combined treatments list.

### Step 5 — Synthesizer (round 1)

Spawn the `synthesizer` subagent. Input: planner output (including `crossStatuteScope`), reader digests **including any statute digests** (the Synthesizer should open the Rule section with the statute when present), treatment classifications, secondary-source doctrinal framing.

Returns `{ memo, claimCitationMap, unmetNeeds }`.

### Step 6 — Auditor (round 1)

Spawn the `auditor` subagent. Input: synthesizer's `memo` and `claimCitationMap`.

Returns audit report with `verdict: pass | revise | abort`.

### Step 7 — Branch on audit verdict

The auditor returns `verdict` AND `routeBack`. Branch on the pair:

- `verdict: "pass"` → go to Step 8 (Finalizer).
- `verdict: "abort"` → skip the Finalizer. Print to user: the question, the audit's `fabricatedCitations`, and a one-line "Draft failed audit; not finalized — too many fabricated citations to recover." Then stop.
- `verdict: "revise"`, `routeBack: "reader"` → go to Step 7a (Reader-redo path).
- `verdict: "revise"`, `routeBack: "synthesizer"` → go to Step 7b (Synthesizer-revise path).

### Step 7a — Reader-redo (paragraph mismatches / misquotes) — PARALLEL

This path exists because most "verification failures" aren't fabrication — they're paragraph-numbering mismatches between A2AJ's text and the Synthesizer's memory. The fix is to re-read the source.

1. For each citation in `auditor.failingCitationsForReader`, spawn one `reader` subagent **in parallel** (single message, multiple Agent calls). Each re-fetches its citation, extracts fresh `keyParagraphs` (self-verified via `verify.js`), and returns a corrected digest.

2. Spawn `synthesizer` again. Input: original synthesizer inputs WITH the failing case digests **replaced** by the corrected ones from step (1), PLUS the auditor's `revisionNotes`, PLUS any `unmetNeeds` the synthesizer flagged in the first draft.

3. Spawn `auditor` once more on the revised draft. This is the **second and final** audit pass.

4. Whatever the second audit says, proceed to Step 8 unless `verdict: "abort"`. If it's still `revise`, the Finalizer writes the memo with a "Caveats" section listing the unresolved audit issues at the top.

### Step 7b — Synthesizer-revise (Phase 1 clean, Phase 2 substantive issues)

1. Spawn `synthesizer` again. Input: original inputs PLUS the auditor's `phase2` issue lists, `revisionNotes`, and any `unmetNeeds` from the prior draft. (No reader-redo needed — Phase 1 was clean.)

2. Spawn `auditor` once more. **Second and final** audit pass.

3. Same termination rule as Step 7a step (4).

### Step 7c — Maximum 2 audit rounds, total

Under no circumstances run a third audit. After Step 7a or 7b's final audit, the result is final.

### Step 8 — Finalizer

Spawn the `finalizer` subagent. Input: the original question, all stage outputs, all draft versions, all audit reports, and the final memo.

Returns the `MEMO_PATH`, `SIDECAR`, `VERDICT`, `ROUNDS` lines.

### Step 9 — Report to user

Print to the user:
- The memo path and sidecar path
- The verdict and number of audit rounds
- The first 3 lines of the memo (title and "Issues" header) as a preview
- One-line summary: "Memo written. Open with: `cat <path>` or your editor."

## Rules of orchestration

- **Spawn each subagent through the Agent tool, with `subagent_type` matching the agent's `name` field.**
- **Pass minimal context.** Each subagent gets only what its prompt expects.
- **Parallelize where possible.** Multiple Agent tool calls in a single message run in parallel:
  - Step 2: `secondary-source` + `discovery` in parallel.
  - Step 3 (Reader Phase 1): one `reader` per item (case or legislation) — N parallel calls.
  - Step 3a (Reader Phase 2): one `reader` per section-citator-discovered case — parallel.
  - Step 4 (TreatmentClassifier): one `treatment-classifier` per target case — parallel.
  - Step 7a (Reader-redo): one `reader` per failing citation — parallel.
- **Capture all stage outputs** so the finalizer can write the sidecar.
- **Maximum 2 audit rounds total.** No third try.
- **If any subagent's output is malformed JSON or missing required fields, treat that single spawn as failed. Other parallel spawns continue. If discovery itself fails or all readers fail, abort the run.**

## What you do NOT do

- Do not call A2AJ yourself. The subagents do that.
- Do not write the memo yourself. The synthesizer does.
- Do not skip the auditor. Even on a clean-looking draft, audit deterministically.
- Do not paraphrase or summarize the memo for the user beyond the 3-line preview.
