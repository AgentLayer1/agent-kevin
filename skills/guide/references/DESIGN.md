# Guide Design System

`references/template.html` is a complete worked example (a new teammate's first week). It is the **aesthetic contract**: a sidebar of numbered sections, a serif headline, calm cards, light and dark, print-ready. Copy it, replace the content, and compose the modules this guide needs. Don't redesign it from scratch.

## What stays fixed

- **The shell.** Sidebar with the brand line, the progress bar, the numbered table of contents (built from each `section.phase`'s `data-title`), the theme slot and the reset button; the hero (eyebrow, headline, lede, chips); numbered sections, each opening with a one-line `.phase-why`; the footer. On narrow screens the sidebar folds above the page.
- **The theme.** The Auto / Light / Dark control is the shared block between `<!-- theme:start -->` and `<!-- theme:end -->` in `<head>`, mounted into `#theme-slot`. Copy both verbatim and never edit the block. The palette keys on `html[data-theme="light" | "dark"]`; paper always prints light.
- **The script.** It builds the contents, saves ticked steps per page (keyed on the file's path), fills the progress bar and the per-section counts, wires the copy buttons and the screenshot zoom. Keep it whole; a module the guide doesn't use simply finds nothing to wire.
- **Actors have one colour each**, used by every module that names who acts: `c-you` amber (the reader), `c-agent` blue, `c-team` green, `c-other` violet. A guide with two people plus agents maps them once and keeps that mapping everywhere.
- **Restraint.** No new colours, fonts or shadows. A new need composes existing modules first.

## Module catalog

| Module | Use when | Markup |
|---|---|---|
| Who does what | The reader works with other people or agents | `.who` with one `div.c-*` per actor: name, role line, 2–4 bullets |
| Steps | Anything the reader does in order | `ol.steps` of `li` with a checkbox, `strong` title, `.sub` line; add `.who-tag.c-*` when someone else does the step, `.status.soon` / `.status.ready` for what isn't built yet |
| Code | A command to paste | `.code` with `.label-row` (where to paste it) and a `.copy` button; one command per block |
| Figure | A real screenshot helps | `figure > img + figcaption`; click zooms. Only real screenshots of the reader's screen, never stock art |
| Swimlane | A process passes between actors | `.lanes` with `--lanes: N`; a header row, one `.lane-row` per step with a `.card.c-*` in the actor's column; `.lane-sep` before a branch, `.lane-row.branch` for steps that only sometimes happen |
| Journey | A worked example makes the process concrete | `.journey` of `.jstep.c-*`, each with a `.mock` of what the reader will actually see (`.mock.note` for a private draft, `dl` for a card's fields) |
| Say | The reader talks to an agent | `.say` cards with `data-kicker="you say"`, the phrase and what it does |
| Labels | The reader meets statuses or tags | `.label.l-*` pills, explained in a table: tag · what it means · what you do |
| Rules | A few lines the reader must never break | `.rules` cards: bold rule, one-line reason |
| Two-up | Four cards in `.who`, `.rules` or `.say` that would wrap three-and-one | add `.two-up`: two by two, one column on a phone |
| Callout | One thing worth stopping for | `.callout` (amber), `.blue` for context, `.green` for a promise, `.rose` for a warning; a `b.t` kicker |
| Questions | Objections the reader will have | `details.more`, one per question, answer in two or three sentences |

## Content rules

- **Write for the reader named in the eyebrow.** Plain words; a term that needs a gloss gets renamed ("bug card", not "issue"). A guide for one person doing one job speaks to them in the second person. A process shared by several people uses **names** throughout (Sarah, Sarah's agent, Basem), never "you", "your agent" and "me", which blur who does what, and opens with the boundary: who owns which side, and the one thing that crosses it.
- **The guide stays about its reader.** The reader's own flow names only the people and agents they deal with. Someone else's part of the process (how the team takes it from there) gets one short section of its own: what happens, in order, and that the reader does nothing there. Point to it from the reader's flow ("see Development") instead of weaving its actors through every section. Within that section, name each person and agent plainly, one sentence each.
- **Every step is one action** with what the reader will see when it worked. A step that needs a value says where the value comes from.
- **Order is dependency order.** A step uses only what an earlier step installed or created.
- **Mocks and examples are invented** (made-up ids, names and amounts) and look like the real screen. Say so once ("a made-up example").
- **Honest status.** What isn't built or decided yet is labelled (`.status.soon`, "we'll decide together"), never presented as live.
- **Specifics are verified.** A command, URL, menu path or setting comes from this session's reading or a source the operator gave; anything unverified stays out or is marked.
