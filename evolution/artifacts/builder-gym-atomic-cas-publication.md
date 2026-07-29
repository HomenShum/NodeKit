# Builder Gym publishes complete content-addressed bytes atomically

The complete repository suite exposed a false immutable-address conflict under
parallel load. A winner opened the final path with `wx`; a loser received
`EEXIST` immediately and read the path while the winner was still writing.
Equal content could therefore appear to differ.

Writers now create, write, fsync, and close a private same-directory temporary
inode before attempting to publish the final content address with an atomic
create-if-absent hard link. An `EEXIST` observer can only see a complete
winner. The temporary inode is removed on success, conflict, or error.

The scenario test retains the hostile pre-created-address case and adds a
32-writer burst plus five sustained rounds of eight writers. Every idempotent
writer resolves the same address and the stored bytes equal the canonical
trajectory JSON.

Evidence:

- `evidence/builder-gym-cas-publication-race/before.txt`
- `evidence/builder-gym-cas-publication-race/after.txt`
- `test/builder-gym.test.mjs`

Boundary: the publication primitive requires a filesystem that supports
same-volume hard links. Unsupported filesystems fail honestly; there is no
partial-write fallback.
