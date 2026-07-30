# Changelog lane format

Every lane is append-only and most-recent-first.

```md
# Changelog — <surface>

> **Surface**: <one-line ownership statement>
>
> **Append rule**: Add entries at the top. Never rewrite historical entries.

## YYYY-MM-DD — Imperative title
State what changed, why it changed, and any user-visible effect.
**Commit**: `<7-char sha>`. **Author**: <name>.
**Touches**: `<related lane>`
```
