# 06 — Say that the fork is now its own project

Read `00-context.md` first. Docs only; no code.

## Goal

The repository no longer tracks babarot/oksskolten as a merge source. Say so
where a reader looks, and turn `FORK.md` into a dated record instead of a live
promise. Keep the credit to upstream prominent.

## Edits

### `README.md`

- The blockquote under the language switch (starts `> This is a fork of`) becomes:

  > Oksskolten started as a fork of [babarot/oksskolten](https://github.com/babarot/oksskolten)
  > and diverged from it in September 2026 (upstream base `bdb22ac`). It is
  > maintained independently; upstream fixes are ported by hand when they apply.
  > [`FORK.md`](FORK.md) records what had been added on top of upstream at the
  > point of divergence.

- In "Fork additions", the first sentence (`Additions live in new files, with
  only small insertion points in upstream ones, so syncing with upstream stays
  cheap.`) becomes: `Everything below was added on top of upstream before the
  two projects diverged; it is now simply part of Oksskolten.`
- The Docker note (`> The published image is upstream's and contains none of the
  fork additions. To run this fork, build locally.`) stays; it is still true.

### `README.fr.md`

The same three edits, in French. Read the file to find the equivalent lines.

### `FORK.md`

- Replace the intro paragraph with a dated note:

  > This file is a record of what the fork had added on top of
  > [babarot/oksskolten](https://github.com/babarot/oksskolten) when the two
  > projects diverged (September 2026, upstream base `bdb22ac`). It is no longer
  > maintained as a sync guide; the code has since been reorganised by domain
  > (see `docs/refactor/`). The "Upstream files touched" table at the end
  > remains useful for porting an upstream fix by hand.

- In "Upstream files touched", the "Syncing with upstream" subsection: keep the
  three commands, replace the sentence before them with `To port an upstream
  change by hand:` and add `git cherry-pick <sha>` as a fourth line. Drop the
  sentence `Everything else is additive, so an upstream merge should only ever
  conflict inside the files below.` — after phase 2 the file paths in the table
  are historical, so add one line above the table: `Paths are those at the
  point of divergence; see \`docs/spec/30_ingestion.md\` and \`docs/refactor/\`
  for where the code lives now.`

### `CLAUDE.md`

Nothing to change.

## Acceptance

- `grep -n "fork of" README.md README.fr.md FORK.md` shows only the new wording.
- `grep -n "syncing with upstream stays cheap\|keeps divergence minimal" README.md README.fr.md FORK.md` → empty.
- Markdown renders (no broken links: `FORK.md`, `docs/refactor/`).

Commit: `docs: record the divergence from upstream and retire FORK.md as a sync guide`.
