# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A browser implementation of **120s** (also known as "Hundred and Twenties"), the Irish/Newfoundland 4-player trick-taking card game. The human plays seat 0 (south); the other three seats are AI. Vite + TypeScript, vanilla DOM (no framework). Deployed as a static SPA on Cloudflare Workers.

## Commands

- `npm run dev` — Vite dev server (default port 5173, but the user often references 5174 if 5173 is taken).
- `npm run build` — `tsc` typecheck (no emit) followed by `vite build` to `dist/`.
- `npm test` — full Vitest run (`vitest run`).
- `npm run test:watch` — watch mode.
- Run a single test file: `npx vitest run test/bidding.test.ts`.
- Run a single test by name: `npx vitest run -t "must bid if hand has a 5"`.
- `npm run preview` — build + run via `wrangler dev` (matches production behavior incl. SPA fallback).
- `npm run deploy` — build + `wrangler deploy` to Cloudflare Workers.

Vitest uses `environment: 'node'` with `globals: true`, so tests can `import { describe, it, expect } from 'vitest'` or rely on globals. TS config has `strict`, `noUnusedLocals`, and `noUnusedParameters` on — unused imports/vars will fail the build.

## Architecture

### Layered, mutation-based core

`src/` is split into four cooperating layers; dependencies flow downward only.

```
main.ts        ← composition root: owns `state`, wires Renderer + AI scheduler
  │
  ├── ui/render.ts      ← Renderer class; pure DOM generation per render(state, options)
  ├── ai/index.ts       ← stateless heuristics: aiBid, pickBestTrump, aiBidderDiscard,
  │                       aiNonBidderDiscard, aiPickCard
  └── game/             ← rules engine
        flow.ts         ← public mutators: dealHand, submitBidAction, setTrumpAndTakeKitty,
                          discardAndDraw, playCard, resolveScorePhase
        state.ts        ← GameState, Phase, Seat/Team types, sessionStorage persistence
        bidding.ts      ← startBidding, submitBid (incl. dealer-take loop), legalBidOptions
        play.ts         ← legalPlayIndices (renege rules on trump leads)
        ranking.ts      ← trumpPower, nonTrumpPower, trickWinnerIndex, bestTrumpPlayer
        scoring.ts      ← scoreHand, applyEndgameRule (bid-to-go-out), isGameOver
        cards.ts        ← Suit/Rank types, deck, shuffle (deterministic via seeded RNG)
```

Important conventions:

- **`flow.ts` mutates `GameState` in place** and bumps `state.version` on every change. Don't return new states from these functions or the persistence layer will desync.
- **`bidding.ts` is pure/immutable** by contrast (returns new `BiddingState`). The mutator wrapper lives in `flow.ts::submitBidAction`.
- **Phase is a state machine**: `intro → deal → bid → bid_on_kitty → kitty → discard → play → score → (deal | gameOver)`. The renderer and `main.ts` AI scheduler dispatch off `state.phase`. Read it via the `ph()` helper in `main.ts` because TS narrowing sticks across mutations otherwise.
- **Determinism**: `rngFromSeed` (mulberry32) seeded with `state.rngSeed + handsPlayed * 1000003` makes each hand reproducible from `(seed, handsPlayed)`. Don't call `Math.random` in game logic.

### AI turn scheduling

`main.ts` runs `scheduleAIBid / scheduleAIBidOnKitty / scheduleAIKitty / scheduleAIDiscard / scheduleAIPlay` as async loops with `setTimeout` delays (`AI_BID_DELAY_MS`, `AI_CARD_DELAY_MS`, etc.). Each loop:

1. Checks `ph()` is still the expected phase (the user may have navigated, or state may have been reloaded).
2. Calls the matching `ai/*` heuristic to produce an action.
3. Calls a `flow.ts` mutator and re-renders.
4. Re-checks phase before recursing into the next scheduler.

After every UI callback that could hand control back to the AI, `main.ts` is responsible for kicking off the right `scheduleAI*`. When adding a new phase or branch, update `resumeAI()` too — it runs on page load to resume mid-hand from `sessionStorage`.

### Persistence

`saveState` / `loadState` use `sessionStorage` under key `h120_game_state`. Every render persists. `clearSavedState()` is called on hard restart. `loadState` does no migration — if `GameState` shape changes, bump the storage key or guard against bad shapes.

### Rendering

`Renderer.render(state, options)` rebuilds `#app` from scratch each call (`innerHTML = ''`), so there's no virtual DOM diff. Animations are CSS transitions on the new DOM nodes; `RenderOptions.trickWinner` and `dealAnimation` flags trigger one-shot effects. The renderer also owns `currentView` (`HOME | GAME | STATS`) driven by hash routing in `main.ts::handleRouting`.

### Domain rules worth knowing before editing

These are easy to get wrong because they are 120s-specific:

- **Trump order (highest first):** 5 of trump > J of trump > A♥ (always trump) > A of trump > K of trump > Q of trump > pip cards. Red-trump pip cards: high-pip wins. Black-trump pip: low-pip wins. See `ranking.ts::trumpPower`.
- **Renege:** 5T, JT, A♥ may be withheld when trump is led, only if no strictly-higher trump is on the table (`play.ts::legalPlayIndices`).
- **No must-follow-suit on non-trump leads.**
- **Dealer "take":** dealer can match (not raise) the standing bid; action loops back to the original high bidder for one chance to raise. See `bidding.ts::submitBid`.
- **5-rule:** if a player holds any 5 in their dealt hand and no one has bid yet, they cannot pass — they must open bidding. `legalBidOptions` enforces this by stripping `'pass'`, so pass `hand` whenever you call it.
- **Bid-30:** opponents must lead trump on the first trick (enforced both in `flow.ts::playCard` and `ai/index.ts::chooseLead`). 30 scores +60 if made, -30 if failed; requires winning all 5 tricks.
- **Bid to go out:** defending team is capped at 115 if they would otherwise reach 120 — you must win a bid to win the game (`scoring.ts::applyEndgameRule`). The `inHoleVariant` setting waives this when the opposing team is below 0.
- **Bid on the kitty:** bidder may keep only 1 card from their hand, then take the kitty and pick trump. Tracked via `state.bidOnKitty`.

## Tests

Vitest tests live in `test/` (mirroring src layout: `bidding.test.ts`, `play.test.ts`, `ranking.test.ts`). They exercise the pure rule modules — there are no UI or AI tests. When changing rule semantics in `bidding.ts`, `play.ts`, or `ranking.ts`, update the tests in lockstep.
