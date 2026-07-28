# From idea to judge-ready — the measured gap

The NodeKit thread moved past the design council on 2026-07-28 with a re-scope, prompted by the
owner: *"nodekit is more about the overall ease of building and distributing from idea to getting
the grant or getting in front of the judges."*

The thread's reply opens by conceding its own framing: **"Correct. I narrowed NodeKit too far. The
Agent Regression Gate is a useful NodeKit subsystem. It is not the main product."**

That correction lands on this repository harder than it lands on the thread, and it lands hardest
on the day this document was written — which was spent almost entirely inside Build→Prove, building
gates. Gates are a subsystem.

## The product definition it settled on

    Motto              From idea to judge-ready.
    Product statement  NodeKit helps you research an opportunity, build the product with your
                       coding agent, prove that it works, create the deck and video, and submit it
                       to the people who can fund, judge, or use it.
    Judge statement    Most coding-agent products stop when code appears. NodeKit continues until
                       the application works, the claims have evidence, the presentation is ready,
                       and the submission is complete.

Seven stages: Discover → Decide → Build → Prove → Present → Submit → Learn. And the sentence that
makes it actionable:

> **Build→Prove, Prove→Present, Present→Submit, Submit→Learn. These handoffs are not secondary
> features. They are the NodeKit product.**

## The measurement

Not accepted — checked against the repository:

| journey artifact | schema | source refs | status |
|---|---|---|---|
| `OpportunityContract` | **1** | 9 | **implemented** (J0/J1) |
| `BuildEvidencePack` | 0 | 1 | named only |
| `StoryPack` | 0 | 1 | named only |
| `LaunchManifest` | 0 | 1 | named only |
| `ObservationPack` | 0 | 1 | named only |

The builder-case schema declares all five stages — `decide`, `build`, `explain`, `launch`, `learn`.
Four of the five handoff artifacts exist **as names in a contract and nowhere else**.

Launch adapters for the Submit stage — grant, YC, hackathon, Devpost, Convex — returned only
incidental substring hits in `scaffold.mjs` and `agent-definition.mjs`. **There is no submission
adapter.**

So the honest statement of NodeKit's current reach:

    Decide → Build     implemented, gated, and heavily tested
    Build → Prove      strong engine, no packaged handoff artifact
    Prove → Present    nothing
    Present → Submit   nothing
    Submit → Learn     nothing

## This is the day's own bug class, one level up

A stage that is declared in a contract and has no implementation is exactly the shape catalogued in
`VACUOUS_PASS.md` — *declared is not installed*, *a name's presence is not its role*. The journey
contract passes its own validation with four empty stages, because what it validates is that the
names are present.

That is not a defect in the contract. It is the reason the gap survived this long without anything
failing: **nothing measures whether a declared stage can actually be traversed.**

## What follows, sequenced

The thread's own first-release test is one complete journey, not a better gate:

> one researcher · one current opportunity · one approved product · one deployed vertical slice ·
> one proof package · one deck · one video · one live demo · one completed submission ·
> one monitored result

Against the measurement, the cheapest ordered path:

1. **`BuildEvidencePack` schema + producer.** The evidence already exists — receipts, certifications,
   the boot proof, the port audit. Nothing packages it into one handoff artifact. This is assembly,
   not new capability, and it is the shortest of the four.
2. **`StoryPack` → NodeSlide.** NodeSlide is the most developed product in the family and has spent
   the day being ported and gated. It has no defined input from Prove. A StoryPack that compiles a
   BuildEvidencePack into deck source is the Prove→Present handoff.
3. **`LaunchManifest` + one launch adapter.** One target, not five. Pick the one with a real
   deadline; the others are copies once the seam exists.
4. **`ObservationPack`.** The Evolution Ledger already accepts records; this is the loop closing,
   and it is last because it needs something to observe.

**A journey-traversal gate belongs alongside item 1**, and it is the piece this repository would
otherwise skip: assert that each declared stage can be entered, produce its artifact, and hand it
to the next — failing on the *first* stage that only exists as a name. Without it, the next audit
of this file will read five declared stages and report the journey complete.

## What this does not say

It does not say the gate work was wasted. Build→Prove is the stage every other stage's evidence
flows through, and the receipts, envelopes, and trust surfaces built today are what a
BuildEvidencePack would contain. It says the *ordering* was wrong: four stages have nothing while
one has depth, and the next increment belongs where there is nothing.
