---
name: visual-check
description: Launch the 120s dev server and capture the game UI across mobile, tablet, and desktop viewports using Playwright MCP, so a UI change can be verified visually. Use when asked to screenshot the app, check the layout, verify a UI/CSS change, or compare mobile vs desktop.
---

# Visual check

Capture the 120s UI at the standard viewports and report what you see.

## Steps

1. **Start the dev server** (if not already running):
   - `npm run dev` in the background. Vite serves on `http://localhost:5173` (the user sometimes uses `5174` if 5173 is taken, so check the startup log for the actual port).

2. **Capture each route at each viewport.** Use the Playwright MCP tools (`browser_resize`, `browser_navigate`, `browser_take_screenshot`). Routes are hash-based:
   - `/` — home / splash (HOME view)
   - `/#/play` — the game table (GAME view); state persists in `sessionStorage`, so this resumes any in-progress hand
   - `/#/stats` — stats (STATS view)

   Standard viewports:
   - **Mobile**: 390 x 844
   - **Tablet**: 768 x 1024
   - **Desktop**: 1440 x 900

   For UI changes, prioritize the route and viewport the change actually affects. A CSS/layout change to the game table needs `/#/play` at mobile AND desktop at minimum (the game view stacks vertically on mobile). A splash change needs `/`.

3. **Save screenshots to `.playwright-mcp/`** (already gitignored) or pass an explicit filename. Do not write screenshots to the repo root, that directory is meant to stay clean.

4. **To exercise a fresh hand**, navigate to `/` and click the new-game control, then go to `/#/play`. To inspect a specific phase, take a `browser_snapshot` (accessibility tree) so you can read the rendered text and confirm the right phase is showing.

## Report

For each viewport, describe what rendered and whether the change looks correct. Call out anything clipped, overflowing, misaligned, or off-color. Reference the saved screenshot paths so the user can open them.
