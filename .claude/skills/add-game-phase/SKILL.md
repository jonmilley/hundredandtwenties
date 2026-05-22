---
name: add-game-phase
description: Checklist for adding or changing a Phase in the 120s state machine. Use whenever introducing a new game phase, splitting an existing one, or changing the phase transition order, so no layer is left out of sync.
user-invocable: false
---

# Adding a game phase

The phase is a state machine driven across four layers. Skipping any one of these leaves the game broken in a way that often only shows up on page reload. Current order:

```
intro -> deal -> bid -> bid_on_kitty -> kitty -> discard -> play -> score -> (deal | gameOver)
```

When adding, renaming, or reordering a phase, touch every item below:

1. **`src/game/state.ts`** — add the value to the `Phase` union type. If `GameState` gains fields for the new phase, remember `loadState` does NO migration: either guard against the old shape or bump the `sessionStorage` key (`h120_game_state`).

2. **`src/game/flow.ts`** — add or update the mutator that enters/leaves the phase. Mutators change `GameState` in place and MUST bump `state.version`. Never return a new state object from `flow.ts`, the persistence layer will desync.

3. **`src/ui/render.ts`** — handle the new phase in `Renderer.render`. The renderer rebuilds `#app` from scratch each call, so add the branch that draws the phase's UI and any one-shot animation flags in `RenderOptions`.

4. **`src/main.ts` — the AI scheduler.** This is the step that is easiest to forget:
   - If the phase has AI turns, add a `scheduleAI<Phase>` async loop following the existing pattern: check `ph()` is still the expected phase, call the matching `ai/*` heuristic, call the `flow.ts` mutator, re-render, then re-check phase before recursing.
   - Wire the new scheduler into whatever UI callback or prior scheduler hands control to it.
   - **Update `resumeAI()`** so a page reload mid-hand resumes correctly from `sessionStorage`. Forgetting this is the classic bug: the game looks fine until reloaded in the new phase, then stalls.
   - Read phase via the `ph()` helper, not a captured variable, because TS narrowing sticks across mutations.

5. **Determinism** — if the phase consumes randomness, use `rngFromSeed`, never `Math.random`.

6. **Tests** — if the change alters rule semantics in `bidding.ts`, `play.ts`, `ranking.ts`, or `scoring.ts`, update the matching test in `test/` in lockstep.

After the change, reload the app mid-phase to confirm `resumeAI()` works, and run `npm test` plus `npm run build` (tsc typecheck).
