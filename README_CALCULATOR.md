# Summit TPE transfer calculator

A player's own season stats (PPG/RPG/APG/TS%/Hoop Score) are static --
computed once per season. What a coach wants is fluid: pick a player, pick
*any* target team, optionally type in exact minutes, get an instant
projection. Same player, run against as many schools as you want. That's
what this is -- not a spreadsheet of precomputed rows (the TransferProjection
scaffold sheet doesn't fit this and can be removed), but a small cache +
live calculator + REST API.

## Setup

```
pip install -r requirements_calculator.txt
```

## 1. Build the cache (once per season, or whenever box scores update)

```
python build_cache.py --path WomensSummitTPE.xlsx --out summit_tpe_cache.sqlite
```

Reads the workbook **read-only** (a few minutes, not the 10+ minutes a
write-mode round trip takes on this file) and writes a small SQLite file
(under 1MB for the current season) with two tables:

- `teams` -- team_id, name, division, conference, **tier**, current_rating, sos
- `players` -- team_id, position, class, season averages (PPG/RPG/APG/BPG/
  SPG/TOPG/TS%/FG%), per-40 rates for points/rebounds/assists/blocks/steals/
  turnovers, Hoop Score, hoop_score_raw -- everyone with >=5 games **and**
  >=100 total minutes in the most recent season found in the Games sheet
  (see "Bug fix" below for why the minutes floor is there)

Re-run this and the API immediately picks up the new file -- no restart
needed for the data, only if you change the code.

## Bug fix: tiny-minute games were distorting per-40 rates

An earlier version computed each player's per-40 rates (points/rebounds/
assists per 40 minutes -- what the projection math scales up or down by
minutes and team strength) by averaging every game's individual per-40
extrapolation. That breaks for very short stints: 3 points in 1 minute
extrapolates to a "120 PPG pace" for that one game, and it was getting
averaged in at full weight. The real case this caught: a player with only
21 total minutes across 7 games (some as short as 1 minute) ranked #1 in
the whole country on the old numbers.

Fixed in `summit_calc.py` / `build_cache.py`: per-40 rates are now season
totals divided by season total minutes (implicitly minutes-weighted)
instead of an average of per-game extrapolations; any single game's
extrapolation is capped at a 4x multiplier; and a 100-total-minutes floor
was added on top of the existing 5-games floor for eligibility. Player
count in the cache dropped from 4,485 to 3,887 as a result (598 excluded
for real but too-brief playing time). Also fixed a related bug in
`api.py`'s `/players` endpoint, which was sorting by the *displayed*
(30-99 clamped) Hoop Score instead of the underlying unclamped value --
several distinct elite seasons legitimately round to the same displayed
99.0, so sorting on the displayed number tied players who weren't actually
tied. If you have an older `summit_tpe_cache.sqlite` or `api.py`, replace
both with the versions in this package and re-run `build_cache.py`.

## 2. Tier classification (as specified)

- **P5** (yes, P5 not P4 -- Big East is counted in with the traditional P4
  since it plays like a power conference in women's hoops): ACC, Big Ten,
  Big 12, SEC, Big East, **plus** Gonzaga, South Dakota State, Princeton,
  and Florida Gulf Coast regardless of their actual conference.
- **Mid-Major**: American, Atlantic 10, Mountain West, WCC, Coastal (CAA),
  Missouri Valley -- minus Gonzaga, which is already in P5 above.
- **Low-Major**: everything else (205 of the 362 teams).

This is a hardcoded, explicit list in `summit_calc.py` (`P5_CONFERENCES`,
`MID_MAJOR_CONFERENCES`, `OUTLIER_P5_PROGRAMS`) -- not derived
statistically, so it won't silently drift as ratings move season to
season. Edit that list directly if a program's status should change.

**Important: tier is a display/filter label only, not part of the math.**
The projection always uses the target team's *exact* Current Rating, not
its tier's average -- confirmed with real data: Gonzaga is tagged "P5" but
its actual rating (17.1) is much closer to a mid-major than to UConn's
(55.0), and projecting a player to Gonzaga vs. UConn produces very
different results, as it should. Tier exists so a coach-facing UI can
filter/group a team picker ("show me Mid-Major schools"), not to average
anything away.

## Roles: how coaches set minutes now

Rather than typing in an exact number every time (or trusting an auto-
projection that has no idea what the target team's rotation actually looks
like), `/project` now takes an optional `role` instead of `minutes`:

- **`starter`** -- average minutes of the target team's own top 5 rotation
  players this season.
- **`sixth_man`** -- the target team's #6 player by minutes (highest-
  minute player outside the starting group).
- **`role_player`** -- 60-80% of that team's starter average (the
  midpoint of that range is used) -- this is defined as a fraction of
  starter minutes rather than a fixed roster rank, per how it was
  specified.
- **`depth_piece`** -- average of the target team's #7-#10 players by
  minutes.

Check `GET /teams/{team_id}/roles` first to see the actual computed
minutes for all 4 roles at a specific team (e.g. "Starter: 31.2 min,
Sixth Man: 18.4 min...") -- a coach-facing UI can show these as pickable
chips before running a projection. Then call `/project?...&role=starter`
(etc) instead of `&minutes=`. **Manual minutes always still work and
always take priority** -- pass `minutes=` and it's used exactly as
before, `role` is ignored if both are given.

Why roles instead of a strength-gap formula for minutes (like production_factor
uses): checking real transfer outcomes (see "Calibration update" below) showed
that auto-projecting minutes from the strength gap is badly confounded --
players who transfer aren't a random sample, they're disproportionately
players moving specifically to get more playing time, so a formula fit to
real transfer outcomes would overstate everyone's minutes bump. Tying
minutes to the target team's own actual roster shape sidesteps that
entirely -- "Starter minutes at Team X" is a real, observable fact about
that specific team's rotation this season, not a guess about why any
particular player transferred.

## Calibration update (pass 2): clamps were saturating too early, extreme-mismatch flag added

Reviewing real projections turned up a second issue, separate from the
per-40 bug above: `projection.py`'s production/minutes/TS clamps were so
tight that most non-trivial transfers were just returning the clamp
boundary instead of a real computed number. Concretely: Audi Crooks (elite
Iowa State scorer) projected to Prairie View A&M (one of the 4 worst-rated
teams in the dataset) only gained +3 PPG despite the enormous gap, and a
freshman bench player from a mediocre low-major projected to a strong P5
program only lost about 1 point on the same minutes -- both suspiciously
flat results, and both turned out to be clamp artifacts (the underlying
formula wanted to move much further in both cases but was capped).

Fixed by widening the bounds (`PRODUCTION_FACTOR_BOUNDS`,
`MINUTES_FACTOR_BOUNDS`, `HOOPSCORE_SHIFT_BOUNDS`, `TS_BOUNDS` at the top
of `projection.py`) so a realistic gap (up to ~2.5 SD) produces a genuine
computed value, and only the most extreme gaps in this dataset (~3 SD,
e.g. a top P5 team vs. one of the very worst low-majors) actually
saturate. Calibration anchor: Crooks -> Prairie View, same minutes, now
projects to ~33.6 PPG, in line with a "very good, not video-game" sanity
check (31-34 PPG) rather than the old +3.

Two new things ride along with this:

- **`extreme_mismatch` flag.** Every `/project` response now includes
  `strength_gap`, `gap_std` (the gap in standard deviations), and
  `extreme_mismatch` (true once `|gap_std|` passes 2.0 -- or 1.25 for
  freshmen/sophomores, since a smaller season sample deserves more
  caution at a smaller gap). When true, an `extreme_mismatch_note` field
  explains it in plain language ("Extreme mismatch — projection may be
  conservative..."). This doesn't change the numbers, it just labels the
  cases where you should treat them as a reasoned estimate rather than a
  precise forecast.
- **Confidence downgrade for underclassmen.** `confidence` (High/Medium/
  Low, previously driven only by games played) now drops one tier for
  FR/SO players, and drops to at most Medium whenever `extreme_mismatch`
  is true, regardless of class year or sample size -- a well-sampled
  junior season doesn't make an extreme strength-gap jump more
  predictable, since that uncertainty comes from the size of the jump
  itself, not from how many games she played. The projected stat numbers
  themselves are still computed identically regardless of class year --
  only the confidence label and mismatch threshold change.

If you have an older `projection.py`, replace it with the version in this
package -- no cache rebuild needed, this only changes how `projection.py`
interprets the same cached per-40 rates.

## Calibration update (pass 3): refit against ~1,359 REAL transfers, not guesses

Pass 2 above widened the clamps by hand-picking new numbers and sanity-
checking them against a couple of manual examples. This pass instead used
real data already sitting in the workbook: `PlayerSeasons` tracks each
player's team by season across all 3 years, so a player whose team
changes between two consecutive seasons is a genuine, real transfer with
a real before/after stat line. There are a lot of them -- 934 real
transfers between 2023-24 and 2024-25, 1,058 between 2024-25 and 2025-26.
1,359 of those had enough games/minutes in both seasons to trust the
comparison.

For each real transfer, the strength gap between her old team (rated in
the old season) and new team (rated in the new season) was computed, and
compared against what actually happened to her per-40 scoring the
following year:

| Strength gap | Real transfers | Old model predicted | What actually happened |
|---|---|---|---|
| Big step down (-2.0 SD+) | 99 | 1.26-1.30x | 1.35-1.46x (median-mean) |
| Moderate step down (-1.0 to -0.3 SD) | 307 | 1.12x | 1.14-1.24x |
| Lateral move (+/-0.3 SD) | 405 | 1.00x | 1.00-1.11x |
| Moderate step up (+0.3 to +1.0 SD) | 369 | 0.88x | 0.97-0.99x |
| Big step up (+1.0 SD+) | 179 | 0.57-0.74x | 0.80-0.84x |

Two things this confirmed: the model's *direction* was already right
(correlation between predicted and actual: 0.365 -- real, positive, not
nothing) -- but it was too conservative in literally every bucket, even
after pass 2's widening. Real transfers who stepped down gained more than
predicted; real transfers who stepped up lost less than predicted.

`production_factor` is now fit directly to this data: a straight line
through the *median* actual outcome in each bucket (median, not mean, so
one wild individual case -- a real player who jumped from 5.9 to 18.2
points-per-40 after transferring down, a 3.1x outlier -- doesn't dominate
a bucket of 98 real cases). That gives `PRODUCTION_FACTOR_INTERCEPT =
1.06` and `PRODUCTION_FACTOR_DENOM_STD = 5.85` (previously 1.00 / 5.0).
Bounds are set just past the actual observed range of real transfers in
this data (`PRODUCTION_FACTOR_BOUNDS = (0.65, 1.45)`, previously
`(0.55, 1.30)`) -- wide enough to cover realistic transfers well without
being shaped by the single most extreme outlier, per how this was scoped.

Honest caveat that doesn't go away with a bigger dataset: correlation of
0.365 means real transfer outcomes are also driven by normal year-over-
year player development, role/usage changes at the new school, and
single-season sample noise -- none of which this can see. This is now a
real, data-grounded curve instead of a guess, but still a reasoned
estimate, not a precise forecast, especially for gaps beyond what's
actually been observed (~+/-2.5 SD in this data) -- e.g. the single most
extreme matchup in the whole 362-team dataset (Iowa State's Audi Crooks
to Prairie View A&M, -2.96 SD) is slightly past the real observed range,
so it lands a bit higher post-refit (~37-38 PPG) than the earlier pass-2
manual sanity check (~31-34 PPG) -- that's the fitted line extrapolating
a hair past its own data, worth knowing if a projection that far out
looks high to your eye.

**Minutes were deliberately NOT refit the same way.** The equivalent fit
for real avg-minutes-per-game showed an enormous, obviously confounded
signal -- players who transferred down a tier saw minutes roughly 2.5x
their old average, even players who transferred to a similar-strength
team saw a 9% bump. That's not "how many minutes would this player earn
in this specific rotation" -- it's "players mostly transfer BECAUSE they
want more playing time, and mostly get it," which would badly overstate
minutes if baked into a formula. That confound is exactly why minutes now
default to the role-based system above (tied to the target team's real
current roster) instead of a strength-gap formula.

If you have an older `projection.py`, `api.py`, or `summit_calc.py`,
replace them with the versions in this package -- no cache rebuild
needed, this only changes how `projection.py` interprets the same cached
per-40 rates.

## Full stat line: blocks, steals, turnovers, FG%

`/project` (and a player's full profile at `/players/{player_id}`) now
include blocks per game, steals per game, turnovers per game, and FG% --
on top of PPG/RPG/APG/TS% that were already there. These come straight
from the same PlayerGameStats columns already being read for the Hoop
Score composite, so no new data source was needed -- `build_cache.py` now
also sums and per-40-rates blk/stl/tov/fgm the same season-totals way as
points/rebounds/assists (see "Bug fix" above for why totals-based, not an
average of per-game rates).

Blocks and steals scale the same direction as points/rebounds in the
projection -- a weaker target team means more/easier opportunities to
generate them, same logic as scoring. **Turnovers are the one stat that
moves the opposite direction on purpose**: a tougher, longer, faster
defense forces more turnovers, not fewer, so turnovers are scaled by
`2.0 - production_factor` instead of `production_factor` directly --
that mirrors the same bounded range around 1.0 but points the right way
(projecting a player up to a much stronger team raises her projected
turnovers; projecting her down to a much weaker one lowers them). You can
see this in the two calibration cases: Audi Crooks's turnovers project to
1.7/game at Prairie View A&M but 3.1/game at UConn, same player, same
minutes, only the target team changed.

If you have an older `summit_tpe_cache.sqlite`, `build_cache.py`,
`projection.py`, or `api.py`, replace all four with the versions in this
package and re-run `build_cache.py` -- the new stat columns won't be in an
old cache file until you do.

## 3. Run the API

```
uvicorn api:app --reload --port 8000
```

Interactive docs at `http://localhost:8000/docs` (auto-generated by
FastAPI -- try requests directly from the browser).

### Endpoints

- `GET /teams?tier=P5&search=&limit=` -- team picker list
- `GET /teams/{team_id}` -- one team's full record
- `GET /teams/{team_id}/roles` -- that team's Starter/Sixth Man/Role
  Player/Depth Piece minutes, computed from its own current roster (see
  "Roles" above)
- `GET /players?search=&team_id=&position=&limit=` -- player search/list
- `GET /players/{player_id}` -- one player's full season profile
- `GET /project?player_id=&target_team_id=&minutes=&role=` -- **the
  calculator**. Pass `minutes` for an exact coach-specified number, or
  `role` (one of `starter`/`sixth_man`/`role_player`/`depth_piece`) to use
  the target team's own roster-based minutes instead. `minutes` wins if
  both are given. Omit both to fall back to a conservative auto-projection
  from her current minutes.

Example:
```
GET /project?player_id=1546&target_team_id=320
GET /project?player_id=1546&target_team_id=320&minutes=32
GET /project?player_id=1546&target_team_id=320&role=starter
```
returns her current static profile, the target team's info, and the
projected line -- run it again with a different `target_team_id` for the
same player to compare schools, which is the whole point.

### CORS

`api.py` currently allows all origins (`allow_origins=["*"]`) so any
site/app can call it during development. Tighten that to your real
domain(s) before this goes anywhere public.

## Validated against the real data

- UConn/South Carolina/Texas/LSU top the P5 ratings; Niagara/Presbyterian/
  Bellarmine bottom out Low-Major -- matches reality.
- Tier counts: P5=83 (79 from the 5 conferences + 4 named outliers exactly),
  Mid-Major=74, Low-Major=205 -- adds up to all 362 teams.
- Same player (Emma Troxell, Abilene Christian) projected to UConn (P5,
  rating 55.0) drops sharply (18.5 min, 4.1 PPG); to Gonzaga (tagged P5 but
  actual rating 17.1, much closer to her own team's 6.9) barely moves
  (27.8 min, 7.9 PPG) -- confirms the math is using each team's real
  rating, not a flattened tier average.
- A minutes override (e.g. 32) replaces the auto-projected minutes exactly
  while still applying the target-team production adjustment to her rates.
- Invalid player/team IDs and out-of-range minutes return clean 404s
  instead of crashing.

## What's still a placeholder (same honesty as the original prototype)

Every constant in the production/minutes/hoop-score sensitivity curves
(the "how much does a stronger team compress her numbers" math) is a
hand-picked, sanity-checked estimate -- widened once (see "Calibration
update" above) against a couple of real spot-checks, but still not fit to
an actual labeled dataset of real transfer outcomes (there isn't one to
calibrate against). There's no pace/tempo adjustment (Teams has no
possessions column). Treat individual projections, especially ones flagged
`extreme_mismatch`, as reasoned estimates rather than precise forecasts,
and revisit the constants again if real transfer-portal outcomes start
looking systematically different from what this predicts.

## Files

- `summit_calc.py` -- shared math (position weights, team ratings, Hoop
  Score scaling, tier classification)
- `build_cache.py` -- run this once per season
- `projection.py` -- the `project_player()` function itself (also runnable
  standalone: `python projection.py --player-id 1546 --target-team-id 320`)
- `api.py` -- the REST layer
- `requirements_calculator.txt`
