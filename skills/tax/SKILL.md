---
name: tax
description: >
  Bookkeeping and tax compliance for the operator's companies and personal return: what tax is
  owed right now, deadlines as dated tasks, receipt capture, monthly close, estimate planning, the
  accountant's requests. Triggers on "tax", "how much tax do I owe", "receipt", "bookkeeping",
  "close the month", "what's due", "my accountant asked".
allowed-tools:
  - AskUserQuestion
  - Bash
  - Glob
  - Read
  - Write
  - Edit
  - mcp__plugin_agent-kevin_kevin__task_create
  - mcp__plugin_agent-kevin_kevin__task_query
  - mcp__plugin_agent-kevin_kevin__task_get
  - mcp__plugin_agent-kevin_kevin__task_update
  - mcp__plugin_agent-kevin_kevin__task_close
  - mcp__plugin_agent-kevin_kevin__task_thread
---

# Tax

Keep every entity the operator files for (companies and their own return) ahead of its deadlines, with books a tax agent can work from. Kevin prepares, tracks, and drafts. The operator and their tax agent file, pay, and sign.

## Help

`/tax help` (or "what can tax do?") asks for the menu: reply with [help](references/help.md) exactly as written and stop.

## Start

1. Resolve the project: `PROJECTS=$(bun -e 'import { FOLDERS } from "'"${CLAUDE_SKILL_DIR}"'/../../mcp-server/src/config"; console.log(FOLDERS.PROJECTS)')`; the data lives in `$PROJECTS/tax/`. No `entities/` there yet means [setup](references/playbooks/setup.md) runs first, whatever was asked.
2. Read the profile of each entity the task touches (`entities/<slug>.md`) and the country reference it names (`references/countries/<country>.md`). Rules, rates, and dates come from that file, never from memory.
3. Match the task to a playbook and copy its steps into your todo list.

## Playbooks

| Task | Playbook |
|---|---|
| First run, a new entity, or a changed fact (FYE, payroll, SST) | [setup](references/playbooks/setup.md) |
| "What's due?", refresh deadlines, `/tax calendar` | [calendar](references/playbooks/calendar.md) |
| "How much tax do I owe?", "how much should I set aside?", "will I get a refund?" | [position](references/playbooks/position.md) |
| A receipt, invoice, or statement to record, `/tax capture` | [capture](references/playbooks/capture.md) |
| Close last month for the accountant, `/tax close` | [close](references/playbooks/close.md) |
| How much tax to estimate or revise, and the cash to set aside | [estimate](references/playbooks/estimate.md) |
| An email or request from the accountant or tax authority | [accountant](references/playbooks/accountant.md) |
| Ways to pay less, legally; what to ask the tax agent | [optimize](references/playbooks/optimize.md) |
| After the financial year ends: annual returns and filings | [year-end](references/playbooks/year-end.md) |

## Every time

- **Deadlines are tasks.** Every dated obligation lives as a task in the `tax` project with a `due` date and its `obl:<entity>:<obligation>:<period>` label, so it surfaces beside every other deadline. Never keep a deadline only in prose, and never edit an `obl:` label: it is the key that stops a deadline being created twice.
- **The engine does the math.** `bun "${CLAUDE_SKILL_DIR}/scripts/calendar.ts" plan` lists what is due and missing; `liability` prices what each entity owes right now from the ledger and the country's `## Rates` block; `render` regenerates `dashboard.html`. Playbooks call these *the engine's plan*, *liability*, and *render*. Never compute a statutory date or a tax figure by hand, and never edit the dashboard.
- **Every figure carries its source.** A number comes from a document (file path), the ledger, or the operator's words, and says which. An estimate is labelled an estimate.
- **Questions, not rulings.** Kevin drafts the question and the numbers; the tax agent decides the treatment. Never tell the operator a position is safe to file. On religious matters (zakat and the like), describe the tax effect only.
- **Nothing leaves without the operator.** Kevin never files, pays, or sends. Drafts are paste-ready, in the operator's voice.
- **Private by default.** Tax ids, amounts, and documents stay in the home. Nothing from an entity profile goes into a plugin file, a report shared outside the home, or a commit message. A residential address is never transcribed anywhere (profile, ledger, filename, task, draft); a company's registered or office address is fine. Ask before opening a personal document likely to carry one (payslips, employment statements, tenancy papers, utility bills, identity documents), since whatever is read goes to the model provider.

## Where things live

```
$PROJECTS/tax/
├── README.md
├── entities/<slug>.md                 flat facts (frontmatter) + a `## Obligations` yaml block
├── inbox/                             documents the operator drops in (dropping one is consent to read it)
├── receipts/<slug>/<YYYY-MM>/         filed documents
├── ledger/<slug>/<YYYY>.csv           one row per document or stated figure
├── closes/<slug>/<YYYY-MM>.md         monthly close records
├── estimates/<slug>/<YA>.md           estimate worksheets
├── reviews/<YYYY-MM-DD>-<topic>.md    optimize and year-end reviews
├── dashboard.html                     generated by scripts/calendar.ts
└── tasks/                             deadlines and one-off work
```

## Reply

Lead with what the operator has to do and by when, then what Kevin recorded (tasks, ledger rows, files) with paths. Money figures show currency and source. End with the drafted message when the playbook produces one.
