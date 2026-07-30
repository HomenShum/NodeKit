# Changelog format

Each reviewable NodeKit surface gets an append-only file at
`CHANGELOG/<category>/<slug>.md`. New entries go at the top so current behavior is
visible first. Old entries are never deleted or rewritten.

Before recording history for an existing source file, inspect:

```sh
git log --follow --date=short --format="%h %ad %an %s" -- <source-path>
```

Only record commits that actually touched the surface, using the commit and diff
as the authoritative evidence.

## Lane template

````md
# Changelog — <relative/path/to/file-or-surface>

> **Surface**: <one-line description of what this surface does>
>
> **Append rule**: New entries go at the TOP. Date format: `YYYY-MM-DD`. Use the entry template at the bottom of this file. Never delete old entries — they are the audit trail.

## YYYY-MM-DD — Short imperative title
Explain what changed and why in one to three sentences. Include the observable
effect or the safety boundary a maintainer must preserve.
**Commit**: `abc1234`. **Author**: Name.
**Touches**: `CHANGELOG/<category>/<other-lane>.md`

---

## Entry template

```md
## YYYY-MM-DD — Short imperative title
What and why in one to three sentences. Note observable effects and invariants.
**Commit**: `<7-char sha>`. **Author**: <name>.
**Touches**: <other CHANGELOG files affected>
```
````

Omit `**Touches**:` only when no other changelog lane was affected by the same
change.

