# The PRODUCTION-AGENT gate

Runs **before any agent loop ships**, and again before deployment. It is the contract NodeKit uses
to make a driven coding agent carry the responsibilities of a senior agent engineer, rather than
the habits of a demo author.

Schema: `schemas/nodekit.production-agent.v1.schema.json`
Commands: `nodekit production-agent declare --application <slug> --out <file>` · `nodekit production-agent check --contract <file>`

## Why this exists

Adopted 2026-08-04 from the 26Agent competency breakdown
([26年Agent开发工程师需要什么能力](https://www.youtube.com/watch?v=oBy94l_48CQ)). Its opening
observation is the market's, not ours: companies cannot hire people who can fix a production agent,
because most candidates' experience is demos — and a demo never meets network jitter, a model
hallucinating under pressure, a third-party API timing out, a reasoning loop that never halts, or a
token bill with a comma in it. The gap between a demo and a production system is a specific list of
responsibilities, and a responsibility that lives in chat scrollback is one a driven agent will not
carry. This gate writes the list down as a refusable contract.

## The five responsibility areas

1. **Goal translation and human-in-the-loop.** The business goal is recorded in the stakeholder's
   words and translated into one quantified target clause (`metric` / `comparator` / `value` — the
   same grammar as a kill condition, for the same reason: prose gets argued with). Every action the
   agent can take is tiered: `low`-risk runs `auto`; `high`-risk is `suspend-approve` — the run
   pauses, the pending action surfaces where a human will see it, and execution resumes only after
   approval. The check refuses a high-risk tier that runs alone, and refuses a declaration with no
   suspension point unless `noHighRiskActions` is declared with a rationale — absence must be a
   decision, not an omission. Long-horizon goals declare their subtask decomposition, because a
   model pointed at a month-sized goal without waypoints guesses.

2. **Fault-tolerant tooling.** Three stages, all declared: raw errors are intercepted (they reach
   neither the user nor the agent's own reasoning as fact); retries are exponential with a base and
   a cap (the check refuses a cap below the base — that backoff shrinks); and a fallback is named —
   local rules, a cached answer, a degraded UI, or a queue for a human. "An error" is not a
   fallback. Tool contracts are part of this area: descriptions unambiguous, few-shot examples for
   complex parameter filling.

3. **Context control.** A named compression strategy (retrieval extraction, sliding window,
   summarization) and a token budget per run. `none` is accepted only alone and only with a
   rationale.

4. **Runtime guards and the three golden metrics.** SLOs are structured clauses and the floor is
   named exactly: `task-completion-rate` (suggested ≥ 0.95), `tool-call-error-rate` (suggested
   ≤ 0.001), `p99-latency-ms` (suggested ≤ 500). The check refuses a declaration missing any of the
   three by name, because swapping one for a flattering substitute is the same move the capability
   gate refuses — measuring only what passes. Guards: a loop breaker (max iterations and max
   reasoning depth — an agent loop without a counter is a bill), a circuit breaker with an error
   -rate threshold and a declared trip action, and a cost fuse in tokens per run or dollars per day.

5. **Release engineering.** Judge-backed regression (LLM-as-judge) named as a command and a
   trigger; a canary at a small traffic percent (the schema caps it at 50 — a 100% canary is a
   launch) with rollback clauses evaluated against the golden metrics and `rollbackMode:
   automatic` (a manual rollback at 3am is not a rollback); a pinned model id plus the eval command
   that runs before any model swap; and a trace id propagated end to end, so one request can be
   followed through every node it touched.

## Relation to the other gates

This gate declares the *runtime posture*; it deliberately does not re-implement its neighbours.
The quantified target settles through `nodekit capability declare / settle` — the bet-then-measure
mechanics live there. Multi-agent file ownership belongs to `nodekit sessions check`; the optional
`orchestration` block here records only the dispatcher/specialist split and points at the session
contract. Adversarial evidence stays with `nodekit journey verify`, and skill/model promotion
canaries stay with `nodekit skills promote` and `nodekit routing canary`. What this gate adds is
the one place a driven agent is forced to answer, before shipping a loop: what suspends for a
human, what happens when the tool call fails twice, what breaks the loop, what trips the spend,
and what rolls the release back without waking anyone.

## For QA

`nodekit-qa` treats the declared guards as testable claims: the loop breaker must be *seen firing*
in a test, the fallback path must be *exercised* (kill the provider, observe the declared degraded
behaviour), and one trace id must be followed from request to receipt. A guard that has never
fired in a test is reasoned-about, not verified.
