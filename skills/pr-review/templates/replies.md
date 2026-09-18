# Replies report template

For the operator's own PR. The report scrolls beside GitHub's **Conversation** tab: threads in the order GitHub shows them (file order, then line), grouped by where the comment lives.

Flat by design. A thread is a heading with a permalink, the reviewer's words on one line, and the reply as a blockquote. No legend, no state table, no `Verdict:` / `Changed:` scaffolding: everything the operator needs to decide is inside the reply, and anything that isn't belongs in the intro line or the tail. The reply is the only thing they paste, so it is the only thing that gets a block.

````markdown
---
title: "PR #<n> replies: <k> threads, paste-ready, <what every claim was checked against>"
skill: pr-review
created: <ISO 8601 with offset>
summary: "<One sentence: whose threads, how many, that they are in the operator's voice, and what every \"done\" was verified against.>"
status: clean | findings | draft
tags: [<area>, pr-<n>, replies]
---
# PR #<n>: replies to <reviewer>

<One or two sentences. Paste each blockquote as the reply on the linked thread; order follows the PR. What "done" means: the branch and sha the fixes sit on, or "in the working tree, not committed". That outdated threads still get a reply so the record is complete.>

## Inline threads

### 1. <The reviewer's point in about five words> · [<comment id>](<comment url>)

<Reviewer> wrote: "<their words, quoted, trimmed with … where long>"

> <The reply, paste-ready, in the operator's voice. Answer in the first three words. Follows references/comment-style.md → "Replies on your own PR".>

### 2. …

## Top-level comment

### <The point in five words> · [issuecomment-<id>](<url>)

<Reviewer> wrote: "…"

> <Reply.>

## Review body

### <The point in five words> · [pullrequestreview-<id>](<url>)

<Reviewer> wrote: "…"

> <Reply.>

## Found on my own

*From the self-pass over the diff. Omit the section when empty.*

### <The defect in five words> · `<path>:<line>`

<Failure and evidence in two sentences, then what changed.>

> <Optional comment to leave on the line, so reviewers see you found it. Two sentences.>

## Suggested commits

*Omit when the run changed nothing. One per group of related fixes; the operator commits.*

```
<subject ≤ 72 chars>

<Why, two to five lines. Name the thread that asked for it.>
```

## Just needs Resolve

*Omit when empty. One line each, no table.*

- `<path>:<line>` <topic> — <answered on <date> / fixed in `<sha>` / reviewer confirmed>

## Still open

*Omit when empty.*

- <A claim needing a measurement that could not be run, a fix belonging in another PR and why, a check that did not run, a thread whose answer needs someone else's decision.>
````

## Notes for the writer

- **The link is the point.** Every heading ends with ` · [<id>](<url>)` using the comment's own `url` from `github_pr_comments`, and the link text is the fragment's comment id: `r4011695208` for an inline thread, `issuecomment-5686065667` for a conversation comment, `pullrequestreview-5214148394` for a review body. One click from the report to the box the reply goes in.
- Scroll order is the whole point of the layout. Sort by the file order GitHub uses (as `github_pr_view` lists `files`), then by line. Non-inline comments go in their own sections after.
- `<Reviewer> wrote:` is a plain line, not a blockquote, so the only `>` block on screen is the thing being pasted. Quote faithfully and trim with `…`; never paraphrase inside the quotes.
- The reply block never says "will fix". The fix is in the working tree before the reply is written, or the reply says what blocks it.
- One report per PR per run. A re-run supersedes; say so in the intro line and name the superseded path there.
