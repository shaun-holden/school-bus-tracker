# Learnings — SchoolBusTracker

A running log of process lessons, gotchas, and discipline that the multi-agent
workflow has produced. Append; do not rewrite. New entries at the top.

---

## 2026-05-17 — Phase A offline-readiness ship

### Multi-agent workflow paid off twice

**Planner caught a stale premise that would have shipped a broken fix.**
The original splash-screen task started with my assumption that
`launchShowDuration: 2000` was the problem. The planner read Capacitor v8's
actual plugin typings and discovered: (a) `launchShowDuration` is ignored
when `launchAutoHide: false`, and (b) `@capacitor/splash-screen` wasn't
installed at all. The fix I would have made without planning was wrong twice
over. Plans informed by typings > plans informed by docs > plans informed by
memory.

**Reviewer caught a real production bug the builder couldn't see on its own.**
The first splash-fix builder ran the plan faithfully. Reviewer flagged that
`launchShowDuration: 5000` with `launchAutoHide: false` is dead config — no
actual native failsafe. If auth ever hangs (Railway cold start, captive portal,
TCP black-hole), the splash would never dismiss. Builder did its job; reviewer
saved the ship. **This is the multi-agent value prop in practice. Don't skip
reviewer because the build is green.**

**Two-pass review caught regressions in the fix-to-the-fix.**
After applying the fix from review round 1, I ran reviewer round 2 on the
patched diff. Round 2 caught small new findings (`apiBase.ts` double-slash
edge case, `Capacitor.isNativePlatform` tree-shake guard) and confirmed the
round-1 fixes resolved cleanly. **Quick second pass on a small surface is
cheap. Worth it whenever round 1 surfaces non-trivial findings.**

### Scope discipline needs constant reinforcement

The react-builder agent did an unsolicited layout cleanup
(`justify-between` → `justify-center` + removed an inner `<div>`) while
implementing the Phase A `OfflineBanner.tsx` changes. Builder was honest
about it ("One minor layout touch you didn't explicitly ask for") and offered
to revert. **Reverting was the right call.** The principle matters more than
the specific change — accepting "while I'm in there" cleanup teaches agents
that scope creep is fine. The agent saved that lesson to its memory for
future sessions.

### Two-phase split for risky work, validated

Phase A intentionally split server-side and client-side work into two commits
with a verification step between. Concrete benefit: when reviewer flagged the
"plan was wrong about a failsafe" bug, only the splash-screen surface was
exposed. Phase A's wider blast radius (CORS, sessions, all fetch sites) never
collided with that finding. **Phasing work along risk lines isolates failures
before they compound.**

---

## 2026-05-17 — The wrong-directory incidents

### Renaming stale clones is not safe enough — delete them

I had two copies of `school-bus-tracker`:
- `~/Desktop/school-bus-tracker` (active, where all real work happens)
- `~/Documents/Projects/school-bus-tracker` (stale clone from March)

To "protect" myself, I renamed the stale clone to
`...school-bus-tracker.STALE-DELETE-AFTER-MAY-31`. **This was insufficient.**
Claude Code agents and zsh both happily `cd` into renamed folders. Twice in
one session, agent work landed in the wrong tree:

1. First incident — caught before damage by running `git status`. Clean
   recovery.
2. Second incident — Phase A client work landed entirely in the stale tree
   before I noticed. Recovery via `git diff > patch && git apply` in the
   real tree. Took ~15 minutes.

**Rule: delete stale clones immediately. Don't rename. The rename "safety net"
backfires because the folder is still navigable.**

### Verify `pwd` before every session

Before any Claude Code session work, the first command should be `pwd`.
The expected output is `/Users/deshaunholden/Desktop/school-bus-tracker`.
If anything else, stop and re-`cd`. The two wrong-directory incidents both
happened because I started Claude Code without verifying where the terminal
actually was. **30 seconds of paranoia prevents 15 minutes of patch-and-apply
recovery.**

### When an agent says a file is missing, check `pwd` before assuming it's wrong

During Phase A, an agent reported "Plan + CLAUDE.md absent on disk." I
initially dismissed this as a "session visibility issue" — the agent must
just not see them. **The agent was right. It was reporting truth about the
wrong directory.** The plan and CLAUDE.md were absent *from the stale tree*
because they'd only ever existed in the real tree. The agent was telling
me a fact; I was wrong to override it.

**Rule: when an agent contradicts your assumption about file presence,
verify with `ls` and `pwd` before dismissing.**

---

## 2026-05-17 — Claude Code session quirks

### `.claude/agents/` loads at session start, not dynamically

If I `cd` into a different directory mid-session, or if I start Claude Code
from the wrong directory and then `cd` to the right one, the agents from
`.claude/agents/` don't load. Symptom: `/agents` shows only built-in agents.

**Fix: exit Claude Code (`Ctrl+C` twice or `/exit`), `cd` to the project root,
then start `claude` fresh.**

Worth verifying with `/agents` immediately after restart — the four project
agents (`planner`, `react-builder`, `express-api`, `reviewer`) should appear.

### `git status` is the truth, agents are a layer above it

Twice in one session, I trusted an agent's summary of git state over the
literal output of `git status` in plain shell. Both times the agent's summary
was correct *for its current working directory*, which wasn't the directory I
thought it was in. **Always run `git status` in plain zsh before committing.**

---

## Standing rules

- Before any session: `pwd` must show `/Users/deshaunholden/Desktop/school-bus-tracker`.
- Never `cd` between codebases in the same terminal. Open a new terminal instead.
- Never `git add -A` or `git add .`. Always stage by explicit path.
- Always run `git status` after `git add`, before `git commit`.
- One agent writing at a time per codebase. Reads can be parallel.
- Reviewer runs before every commit, no exceptions. Even when "build is green."
- For risky changes: planner → human review → builder → reviewer → human review → commit → verify.
