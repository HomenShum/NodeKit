# Generated copy is a proof surface

A rendered interface can pass every visual check while its text lies. The screenshot looks right,
the states render, the accessibility pass is clean, and the sentence on the screen says a task
completed that never ran.

## The split that makes this gateable

Two kinds of finding, and conflating them would have wrecked the check.

**Hard failures are objectively wrong statements.** Fabricated entities, capability claims nothing
evidences, a finished status with no receipt behind it, a claimed authority the agent does not hold,
required jargon left undefined, and a failure message that names no next action. These block.

**Style is advisory and can never block.** Em dashes, rule of three, Title Case, emoji, curly
quotes, rhythm. A supplied voice sample may legitimately require any of them. A checker that fails
a writer for an em dash is one people route around, and a checker people route around stops
catching the lies as well. Gate the lies, not the taste.

Fabrication is checked as a deterministic entity diff against approved source material: URLs, dates,
money and percentages present in the copy but absent from the source. When no source is supplied the
result says `fabrication-unchecked` rather than passing silently, because an unchecked property
reported as a pass is the failure this whole repository exists to prevent.

## The defect this work kept reproducing

Detecting a missing recovery action took three attempts, and all three failed the same way.

First, bare nouns were listed as recovery markers, so "Upload failed." matched its own subject as
its own remedy and stayed silent on the exact dead end the check exists to catch. Second, requiring
recovery to follow the failure by position accepted "We could not open the file", because the
recovery-looking phrase sits inside the failure clause. Third, requiring a separate sentence
rejected "Upload failed, try again", which is one sentence and two clauses with genuine recovery.

The rule that holds is clause granularity: recovery counts when a clause offers an action and does
not itself report the failure.

All three are one error. A word's presence is not its role. That is the fourth time this class has
appeared in this repository: annotations counted inside string literals, a scenario anchor read as
a file path, a guard matching its own search string, and now a noun read as its own remedy.

## Known limitations

- The audit checks whether claims are wrong. It cannot judge whether copy is good.
- Fabrication detection is conservative by design and covers URLs, dates, money and percentages.
  Invented prose claims that contain no such entity are not caught.
- Unsupported-claim detection is a pattern list, so it catches the common forms and not novel ones.
- Nothing here certifies any application. EASE_NOT_CERTIFIED stands.
