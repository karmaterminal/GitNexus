# WORKORDER — gitnexus large-repo support remediation

**Anchoring issue**: karmaterminal/GitNexus#1
**Branch**: silas/gitnexus-large-repo-support-20260529 (already pushed to origin)
**Worktree**: /tmp/silas-gitnexus-large-repo (on lothric)
**Host**: lothric (silas-seat, Intel i9-14900KS, 192GB DDR5, CachyOS rolling)
**Base**: origin/main @ 4bc86226 (rc.88-era)
**Workorder dispatcher**: silas (🌫)
**Tracking journal**: tmp-drop-me-claude.md (committed + pushed at each checkpoint)
**Outer budget**: 444m (claude_session non-sync)

## §0 figs verbatim workorder

> "remedy this following code walk and repo documentation examination. needs to support large size repo."

## §0a Discipline anchors (load-bearing)

- **READ-ONLY** on `/home/figs/flesh_beast_tmp/` (live openclaw runtime)
- **READ-ONLY** on `/home/figs/.openclaw/` workspace except for journal-files
- Remote-first push per RUNBOOKS/PRINCE-CODE-AGENT-RUNBOOK.md: branch is already pushed (step 1 done)
- Checkpoint pushes at every meaningful gate (§1 read done, §2 plan done, §3 implementation chunks, §4 tests)
- Webhook heartbeat to #sprites-of-thornfield via `WEBHOOK_SCRIBE_NOTIFY` (resolve: `gh variable get WEBHOOK_SCRIBE_NOTIFY -R karmaterminal/silas-likes-to-watch`)
- Journal at `tmp-drop-me-claude.md` committed + pushed per checkpoint
- GH issue comments on karmaterminal/GitNexus#1 at each §-completion
- NO PR-merge without explicit figs-sanction (open PR for cohort review only)

## §0b GH issue update discipline

Comment on karmaterminal/GitNexus#1 at:
1. After §1 reads complete
2. After §2 plan landed
3. After each substantive implementation chunk + tests green
4. On any blocker / ambiguity / hard-stop
5. Declare-done with PR link

Don't comment for every commit — comment for cohort-affordance moments.

## §1 Documentation + repo-structure read (BEFORE byte-work)

Read in order, file by file:

- `README.md` — project overview, claimed scope, architectural intent
- `CHANGELOG.md` — version history, especially recent RC chain (1.6.5 → 1.6.6-rc.88) to understand intentional architectural shifts
- `package.json` — top-level deps (especially storage backend: `@ladybugdb/core`, tree-sitter packages, V8 worker pool deps)
- `docs/` (any markdown files explaining architecture, ingestion pipeline, graph-build, deferred-profile phase)
- `src/core/ingestion/pipeline-phases/` — full directory walk, all files
- `src/core/ingestion/workers/` — worker-pool implementation
- `src/core/storage/` — storage layer (LadybugDB integration + any legacy KuzuDB code remaining)
- `src/cli/analyze.js` (or .ts) — the entry point invoked
- Any tests in `test/` or `__tests__/` related to ingestion/parse/graph-build/deferred-profile

Heartbeat after §1 completes. Comment on GitNexus#1 with file-count read + top-level architectural understanding in your own words.

## §2 Diagnosis of the wedge (the WHAT before the HOW)

Per the eval-substrate in GitNexus#1:

- 1.6.5 wedge: parse-phase at ~4.9GB RSS, structural, openclaw-scale (~16k ts/js/tsx files, 1.3GB working tree). FIXED in 1.6.6-rc chain (chunked 64-chunks + 7-worker pool).
- 1.6.6-rc.87/rc.88 wedge: deferred-profile phase at ~5.2GB, post `[deferred-profile] buildHeritageMap: skipped (no heritage records)` log emission. Frozen IO + spinning CPU + RSS plateau. No `.gitnexus/` artifact produced. Same wedge across rc.87 and rc.88 (verified: rc.88 has zero deferred-profile/graph-build/streaming changes).

Specific files to walk for the deferred-profile mechanism:
- Whatever entry-point invokes the deferred-profile band (search for `deferred-profile`, `buildHeritageMap`, `synthesizeWildcardImportBindings`, `deferred band start`)
- The synthesis phases (heritage/imports/calls/routes)
- Where the band would write to `.gitnexus/lbug` storage at completion

Specifically identify:
- What's the load shape during deferred-profile? (memory? CPU? in-memory data structures?)
- Why does it wedge specifically on monorepo-scale? (linear blow-up? recursion? worker-pool contention? in-memory all-pairs computation?)
- Is there a missing batch/stream/chunk pattern that the parse-phase got but graph-build didn't?

Heartbeat + GitNexus#1 comment after §2 with concrete mechanism-hypothesis.

## §3 Implementation

Propose a fix that:
- Doesn't break smaller-repo cases (regression-test against existing test suite)
- Scales to openclaw-class (~16k files)
- Doesn't require external infrastructure (no requirement for distributed storage, etc — keep it single-machine viable)
- Preferably: streams/chunks the deferred-profile work the same way parse-phase was rearchitected

Write code. Commit. Push at every meaningful gate.

## §4 Validation

- Run existing test suite in the fork (whatever `npm test` / `pnpm test` shape it uses)
- If possible, run end-to-end on the openclaw-class repo: target dir `/tmp/silas-gitnexus-main` (already-cloned openclaw worktree, ~16k ts/js/tsx). Should produce `.gitnexus/` artifact + clean exit.
- Performance: rough timing acceptable — primary goal is COMPLETES, secondary is FAST
- Memory: should not OOM at openclaw-scale (4.9GB / 5.2GB walls were the current ceilings)

## §5 Declare-done

- Open PR vs karmaterminal/GitNexus:main from your branch
- Comment final on GitNexus#1 with PR link + summary + test results
- Webhook final to #sprites with PR URL
- DO NOT merge; await figs-sanction

## §6 Reference substrate

- karmaterminal/openclaw-bootstrap#1076 (full eval)
- karmaterminal/silas-likes-to-watch#1039 (notes file `notes/gitnexus-eval-2026-05-29.md`)
- karmaterminal/silas-likes-to-watch#1041 (related V8_Fatal investigation on lothric, may share substrate-class)
- Original upstream: github.com/abhigyanpatwari/GitNexus (read-only reference; no PR-upstream per figs policy)

## §7 If stuck / design-question

Heartbeat with `DESIGN-BREAK:` prefix + comment on GitNexus#1 with the open question. Do NOT make architectural decisions unilaterally — surface them. Wait for cohort response (don't block on it; continue with whatever doesn't need the answer).
