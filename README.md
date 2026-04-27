# legal-researcher

A multi-agent Canadian legal research system, native to Claude Code, backed by the [A2AJ Canadian Legal Data API](https://api.a2aj.ca).

A practicing Canadian lawyer types `/research "<question>"` in their terminal. Eight specialist subagents plan, search, read, classify treatment, synthesize, and audit — producing an IRAC memo with grounded citations and paragraph-level quote verification.

## How it works

```
User question
    ↓
Planner (sonnet)              decompose, scope datasets, build search plan
    ↓
SecondarySource (haiku)  ┐
                         ├── parallel
Discovery (sonnet)       ┘    A2AJ search, ranked candidates
    ↓
Reader (sonnet)               A2AJ fetch, IRAC digest, citation extraction
    ↓
TreatmentClassifier (sonnet)  forward note-up, label each citing case
    ↓
Synthesizer (sonnet)          IRAC memo with claim-citation map
    ↓
Auditor (opus)                phase 1: deterministic verify.js per claim
                              phase 2: LLM critique
    ↓                         verdict: pass | revise | abort
   (revise: one revision round, then proceed)
    ↓
Finalizer (haiku)             write memo + sidecar JSON to runs/{ts}/
```

**Contamination prevention by design.** Each subagent runs in an isolated context window. The Planner cannot see the Auditor's reasoning. The Synthesizer cannot see the raw search results. Every handoff passes only what the next agent needs.

## Setup

### Prerequisites

- [Claude Code](https://docs.claude.com/claude-code) installed and authenticated (Claude Max or other paid tier — runs use your subscription, not an API key)
- Node.js 20+ and npm
- Git

### Install

```bash
git clone https://github.com/mathaissarrazin/legal-researcher.git
cd legal-researcher
npm install
npm run build      # compiles lib/*.ts to dist/*.js
npm test           # citation regex + verifier unit tests
```

To run the optional integration test that hits A2AJ live:

```bash
A2AJ_INTEGRATION=1 npm test
```

### Permissions (optional)

Claude Code prompts before running shell commands it hasn't seen before. The committed `.claude/settings.json` pre-allows the baseline a research run needs (curl, node, jq, common file utilities, `WebSearch`, `WebFetch`). For the broader Python / PDF / OCR / archive toolkit a typical run touches, drop the following into your **personal** `.claude/settings.local.json` (gitignored). Runs work without it — you'll just be asked to approve each unfamiliar command the first time it appears.

```json
{
  "permissions": {
    "allow": [
      "Bash(python *)",
      "Bash(python3 *)",
      "Bash(pip *)",
      "Bash(pip3 *)",
      "Bash(uv *)",
      "Bash(uvx *)",

      "Bash(wget *)",

      "Bash(pdftotext *)",
      "Bash(pdfinfo *)",
      "Bash(tesseract *)",
      "Bash(ocrmypdf *)",

      "Bash(find *)",
      "Bash(file *)",
      "Bash(which *)",
      "Bash(where *)",
      "Bash(diff *)",
      "Bash(rg *)",

      "Bash(env)",
      "Bash(printenv *)",

      "Bash(xxd *)",
      "Bash(hexdump *)",
      "Bash(base64 *)",
      "Bash(iconv *)",

      "Bash(gzip *)",
      "Bash(gunzip *)",
      "Bash(tar *)",
      "Bash(unzip *)",

      "Bash(md5sum *)",
      "Bash(sha256sum *)",

      "Bash(git status*)",
      "Bash(git log*)",
      "Bash(git diff*)",
      "Bash(git show*)",
      "Bash(git branch*)",
      "Bash(git rev-parse*)"
    ]
  }
}
```

These permissions are intentionally read/process-only. Anything that mutates the system globally (`sudo`, `apt`, `brew install`, `rm -rf /*`, `chmod -R`) will still prompt — by design.

## Usage

```bash
cd legal-researcher
claude
```

Then in the Claude Code prompt:

```
/research "Test for imputing income to a self-employed payor under section 19 of the Federal Child Support Guidelines"
```

The orchestrator will spawn each subagent in turn, streaming progress to the terminal. Final output is a memo file at `runs/<timestamp>/memo.md` with a `sidecar.json` capturing every stage's output for audit.

A typical run takes 5–10 minutes and consumes 500K–1.5M tokens against your Claude subscription.

## Architecture decisions

- **A2AJ over CanLII.** A2AJ is open, full-text, no auth, 1000 req/hr, ~210k decisions. CanLII's REST API has no full-text search and citator access requires permission for commercial use. See `runs/_verify/coverage-cases.json` for what A2AJ currently covers.
- **Claude Code subagents over a Node CLI.** No `@anthropic-ai/sdk`, no API key, no per-token billing. Auth is handled by Claude Code via your subscription. Subagent isolation is what gives us contamination prevention for free.
- **REST over MCP for v0.** A2AJ exposes an MCP server at `https://api.a2aj.ca/mcp`, but it's unverified at this build. Subagents call REST via `curl` from Bash. Swapping to MCP is a v1 ergonomics change, not a correctness change.
- **Self-built citator.** A2AJ has no formal citator. Forward note-up is done by full-text searching the neutral citation as a phrase. The TreatmentClassifier then reads each citing paragraph and labels treatment.

## Coverage

A2AJ covers (as of build):

| Court / tribunal | Documents | Range |
|---|---|---|
| SCC | 10,874 | 1877–present |
| BCSC | 50,919 | 2000– |
| BCCA | 14,479 | 1999– |
| ONCA | 23,772 | 1998– |
| FC / FCA | 43,126 | 2001– |
| TCC | 8,042 | 2003– |
| NS courts | ~17,000 | 1993/2001– |
| YKCA, CMAC | ~400 | various |
| Federal tribunals (CHRT, RAD, RPD, RLLR, SST) | ~40,000 | various |

Plus federal + BC + Ontario statutes and regulations.

**Gaps to be aware of:** Alberta, Quebec, Manitoba, Saskatchewan, Ontario trial courts (OSCJ/OCJ), and most provincial tribunals are NOT in the corpus. The Planner should not select datasets outside this list. If a question turns on those jurisdictions, the memo will say so honestly.

## Limits

- **Not legal advice.** Output is a research memo for a lawyer to verify and adapt. The Finalizer appends a one-line disclaimer.
- **Citations get verified deterministically;** quotes get substring-matched against A2AJ-fetched text. The system aborts a run if more than 2 citations are fabricated on the first audit pass.
- **The corpus has gaps.** Pre-2000 cases outside SCC are thin. Quebec, Alberta, Ontario trial level absent.
- **Treatment labels are LLM-classified.** Faster than humans, slower than a real citator, sometimes wrong. The label is always paired with an evidence quote so a lawyer can spot-check.

## Project layout

```
legal-researcher/
  .claude/
    agents/                  8 subagent definitions (Markdown + frontmatter)
    commands/research.md     /research slash command
  .mcp.json                  empty for v0 (REST-only)
  lib/
    citations.ts             regex extractor + CLI
    verify.ts                deterministic citation/quote verifier + CLI
    a2aj.ts                  thin REST client
    citations.test.ts        24 fixture-based tests
    verify.test.ts           paragraph extraction + quote matching tests
  evals/queries.json         5 evaluation questions
  runs/
    _verify/                 A2AJ verification artifacts (committed)
    {timestamp}/             per-run memo + sidecar (gitignored)
  package.json
  tsconfig.json
```

## Development

```bash
npm run build              # compile lib/ to dist/
npm test                   # run unit tests
npm run test:watch         # watch mode

# Manual smoke test of the verifier:
node dist/verify.js --citation "2014 SCC 71" --para 33 --quote "incremental steps"
# → exit 0, prints OK

# Manual citation extraction:
echo "See Bhasin v. Hrynew, 2014 SCC 71 at para 33." | node dist/citations.js
```

## Repo

Private: <https://github.com/mathaissarrazin/legal-researcher>
