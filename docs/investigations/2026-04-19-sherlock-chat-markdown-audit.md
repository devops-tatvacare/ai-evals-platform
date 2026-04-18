# Post-Implementation Audit — Sherlock Chat Markdown Rendering

**Branch:** `fix/sherlock-chat-markdown`
**File touched:** [src/features/chat-widget/ChatMessages.tsx](../../src/features/chat-widget/ChatMessages.tsx) (one file, ~110 insertions, ~42 deletions)

## Bug summary

`ChatMessages.tsx` styled markdown via Tailwind arbitrary-child selectors (`[&_ul]:pl-4`, etc.) on a `prose prose-sm` container. Two compounding problems:

1. **`@tailwindcss/typography` is not installed.** `prose` classes did literally nothing. Every "the prose plugin handles it" assumption silently failed.
2. **Tailwind preflight resets** `ul, ol { list-style: none }`. Without `prose` defaults and with no explicit `list-disc`/`list-decimal` overrides, lists rendered as flat text.

Cascade: no bullets, no numbers, links unstyled, tables wrapped in a bordered box but cells without grid lines, `<em>`/`<del>` invisible, `<h4>`–`<h6>` unstyled, `<hr>` browser-default, paragraphs nested in list items stacked extra `mb-2` margin everywhere.

## Fix

Replaced the `PROSE_CLASSES` arbitrary-child string with a `markdownComponents` object passed to `<ReactMarkdown components={...}>`. Same pattern Kaira's chat already uses (and which works correctly there).

Component overrides for: `p, h1, h2, h3, h4, h5, h6, ul, ol, li, strong, em, del, a, code, pre, blockquote, hr, table, th, td, input` (GFM checkbox).

Key choices:
- **Lists:** explicit `list-disc` / `list-decimal pl-5` beats preflight via direct application, no specificity war.
- **Tables:** wrapping div now has only `overflow-x-auto`, no border. Table itself carries `border-collapse border border-[var(--border-default)]`. Cells get full grid borders + `even:bg-[var(--bg-secondary)]` zebra. Killed "tables inside boxes."
- **Links:** brand color + `target="_blank" rel="noopener noreferrer"` so links open externally and don't trap users in the widget.
- **`last:mb-0` on every block element:** kills cascading vertical bleed when blocks are nested in `<li>` or `<td>`. Solves "random spacing" complaint at the root.
- **GFM task list:** `li:has(>input[type=checkbox])` drops the bullet marker and pulls the checkbox left so it aligns visually with non-task list items.

## Verification (live browser, Sherlock dialog over voice-rx app)

Sent a kitchen-sink markdown prompt to Sherlock; confirmed every feature renders correctly:

| Feature | Before | After |
|---|---|---|
| H1 / H2 / H3 / H4 / H5 / H6 | only h1-h3 styled, h4-h6 default | full ladder, all six styled |
| Bullet list `<ul>` | flat text, no bullets | bullets visible (•) |
| Numbered list `<ol>` | flat text, no numbers | numbers visible (1. 2. 3.) |
| Task list `[x] / [ ]` | checkbox + extra bullet | checkbox only, no bullet, aligned |
| Bold `**` / Italic `*` / Strike `~~` | bold ok, italic missing, strike invisible | all three render |
| Inline `code` | chip ok | chip ok (kept) |
| Fenced code block | block ok | block ok (kept) |
| Link `[](url)` | unstyled, no target=_blank | brand color, opens external |
| Blockquote | barely visible | left border + italic + muted text |
| `<hr>` | thick browser default | thin design-system border |
| Table | wrapped in extra bordered box, cells flat | clean grid, header bg, zebra rows |
| Vertical spacing in nested blocks | wrong (margins stacked) | tight, `last:mb-0` kills bottom drift |

`npx tsc -b` clean. `npx eslint src/features/chat-widget/ChatMessages.tsx` clean.

## Non-goals (YAGNI)

- Did not extract a shared `markdownComponents` module between Kaira and Sherlock. Two callers don't justify a module yet; their per-element choices differ slightly. When a third caller appears, consolidate.
- Did not install `@tailwindcss/typography`. New dep + new mental model when the component-override path is already proven in this codebase.
- Did not add syntax highlighting for fenced code blocks. Separate ask.
- Did not touch any other markdown render points elsewhere in the app — confirmed `ChatMessages.tsx` is the only `react-markdown` user under `src/features/chat-widget/`.

## Decision

**GREEN — merge `fix/sherlock-chat-markdown` to `main`.**
