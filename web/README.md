# Summit TPE -- website

A working Next.js frontend for the Summit TPE API. Verified end to end against real 2025-26 season data (not a
mockup) -- every page below was actually loaded against a running `api.py` + `summit_tpe_cache.sqlite` during
development.

## Pages

- **/** -- product intro plus a few live data snapshots (top team ratings, top scorers) pulled straight from the API.
- **/tpe** -- the TPE Engine. Find a player (search by name, or browse a team's roster), pick a target school,
  pick a role or set exact minutes, and see her current production side by side with the projection, plus
  background (strength gap, confidence, target team rating).
- **/team-fits** -- pick your team, then set what you're looking for: one or more stats, minimum games, level,
  and a role to fill (or exact minutes) -- returns the top 20 candidates ranked on a composite score.
- **/data** -- a configurable leaderboard (any stat, any level/division) plus a "standouts projected at P5"
  section for Low-Major and Mid-Major players. Explicitly does NOT claim to show opponent-tier performance
  splits (e.g. "P5 players who perform best against other P5 teams") -- that needs a per-game log with each
  opponent's level attached, which isn't part of the current data model. Says so on the page instead of faking it.
- **/players** and **/players/[id]** -- search/browse the player pool; the detail page shows the full stat line
  (per-game, per-40, shooting splits) plus season-by-season history with transfer seasons flagged.
- **/teams** and **/teams/[id]** -- browse teams; the detail page shows rotation minutes by role, biggest needs,
  and top transfer fits.
- **/about**, **/contact** -- product/founder blurb and contact info. Both have clearly marked placeholder
  sections (bio, additional contact channels) -- quick edits once there's real copy to drop in.

## Local development

```
npm install
cp .env.example .env.local     # then fill in SUMMIT_TPE_API_URL (and _API_KEY if the API requires one)
npm run dev
```

Requires the Summit TPE API running somewhere reachable -- either locally (`uvicorn api:app --reload --port 8000`
from the `HoopScoreImporter` folder) or the deployed instance, per the root `DEPLOY.md`.

## How it's put together

- Every page is a Server Component that fetches directly from the API via `lib/api.ts` -- no client-side
  JavaScript is needed for browsing, filtering, or the TPE/Team Fits flows; forms use plain GET requests that
  update the URL's query string, which Next.js re-renders server-side. This keeps `SUMMIT_TPE_API_KEY` out of the
  browser entirely (see the comment at the top of `lib/api.ts`, and the `server-only` import that makes the build
  fail if that file is ever imported into a Client Component) and means the site works even with JS disabled.
- `/tpe` is a 4-step flow (search or browse a roster -> pick a player -> pick a target + role/minutes -> see the
  comparison), each step just a different combination of URL query params.
- `/team-fits` mirrors the same GET-form pattern, including multiple checkboxes for `stats` (repeated query
  params, matching FastAPI's `list[str]` parsing).
- `app/error.tsx` catches API failures (backend not deployed yet, temporarily down, or -- as found during this
  build -- a real backend bug) and shows a retry button instead of a raw Next.js error screen.

## Known backend bug found and fixed during this build

`GET /teams/{id}/roles` was 500ing for every team (`dict() got multiple values for keyword argument 'team_id'`)
-- `api.py`'s route handler was passing `team_id` both explicitly and via `**roles`, and `team_roles()` in
`projection.py` already includes `team_id` in its return dict. One-line fix, verified against the live cache for
multiple teams. Delivered as part of this same update -- not something introduced by this frontend build, just
surfaced by actually exercising the endpoint instead of only reading the code.

## What's not here yet (deliberately left for a follow-up pass)

- Real visual design -- this uses one global stylesheet (`app/globals.css`) with a consistent but plain dark
  theme, not a considered design system.
- No search-as-you-type -- every search is a form submit, not a live-filtering client component. Would need a
  small client component + an API route to proxy the search without exposing the key -- a reasonable next step,
  not done here to keep the key-exposure story simple for a first pass.
- About/Contact pages have placeholder bio and contact-channel copy -- marked clearly in the source
  (`app/about/page.tsx`, `app/contact/page.tsx`).
- No auth/sign-in wall -- mentioned as a future need (once it's clear coaches will use this) but not built. When
  ready, this is a real addition (a real user/session system, likely via Supabase Auth per the hosting plan doc),
  not a quick toggle -- worth its own pass rather than scaffolding it now and leaving it unused.
