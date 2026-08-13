# Summit TPE -- Prototype

A working, runnable prototype of the Summit TPE core pipeline: a SQLite
data model, a team strength "competition network," and the Projection
Data Index (PDI) engine described in the product spec, plus a first-pass
transfer translation projector.

**The data is 100% synthetic.** Team names for real D1 programs (South
Carolina, UConn, LSU, Tennessee, Colorado State, Drake, Northern Arizona,
UIC, Utah Valley, Middle Tennessee) are used only as recognizable
stand-ins -- the same schools referenced as examples in the product
brief itself. The D2 teams and every player, game score, and box stat
are procedurally generated from a fixed random seed. Nothing here is a
claim about any real team's or player's actual season.

## Run it

```
python main.py
```

Run it from this folder (the one containing `main.py` and the
`summit_tpe/` package).

No `pip install` needed -- everything is Python standard library
(`sqlite3`, `math`, `random`, `statistics`). Any Python 3.9+ works,
including the `.venv` already in this folder.

Each run rebuilds `summit_tpe_demo.db` from scratch and prints:

1. Computed team strength ratings, D1 and D2 on one scale.
2. A PDI leaderboard for the 9 sample players (PDI, per-40 pts/reb/ast, MPG).
3. A transfer-translation projection for a D2 point guard against five
   candidate D1 destinations (projected MPG/PPG/RPG/APG/PDI, starter %).

## What's implemented

- **Data model** (`summit_tpe/db.py`): `team`, `player`, `game`,
  `player_game_stat` tables matching the spec's four core tables.
- **Competition network** (`summit_tpe/ratings.py`): margin-of-victory
  Elo-style rating, run over every game including D1-D2 crossovers, so
  a D2 team's rating is informed by its connections into the D1 graph
  -- the "D2 school loses to X, X loses to Y, Y beats Z" chain from the
  spec.
- **Close-game weighting** (`summit_tpe/weighting.py`): full weight for
  games decided by 12 or fewer, decaying to a 0.25 floor by a 30-point
  margin. This is an approximation from final score only -- true
  garbage-time detection needs play-by-play data, which isn't modeled here.
- **PDI engine** (`summit_tpe/pdi.py`): per-40 normalization, a
  position-weighted box-score composite (guards and bigs use different
  stat weights), opponent-strength adjustment from the rating network,
  a small experience adjustment, and a non-linear 30-99 scaling curve
  (z-score plus a convex bonus above average, so gaps widen near the top).
- **Transfer translation** (`summit_tpe/transfer.py`): projects MPG,
  PPG, RPG, APG, PDI, and starter probability at a destination school
  from pace and team-strength deltas.

## What's simplified or stubbed (by design, for this pass)

- **Every numeric constant is a placeholder.** Position weights,
  opponent-factor scale, experience multipliers, and the PDI curve
  were hand-picked to be directionally sensible, not fit to data.
  Before this touches real evaluations, these need to be calibrated
  against multiple seasons of actual results.
- **Transfer projection is a transparent heuristic**, not a trained
  model. The spec's long-term vision calls for this to learn from
  actual transfer outcomes once that history exists.
- **No home court rating, recruit ranking, transfer history, or
  handedness fields** -- columns are commented in `db.py` as future work.
- **No defensive box-score-independent metrics** (on/off, rim
  protection, deflections, charges) -- spec flags these as "if available."
- **No real data ingestion.** There's no scraper or API connector yet;
  `seed_data.py` generates synthetic games instead of pulling real
  box scores.
- **No web UI, auth, or free/paid tier split** -- this is a backend
  logic prototype only, run from the command line.

## Design notes for the real translation model (from real-data scraping work)

- **Class/experience should be a formula input** -- it does two separate
  jobs: (1) a development-curve adjustment (a freshman transferring in
  has more expected growth ahead than a senior at the same current
  per-40 production, so her translated projection should be higher),
  and (2) a sample-reliability weight (more career games = more
  trustworthy read on true talent, same spirit as the close-game
  weighting already in `weighting.py`).
- **Only the player's CURRENT-season class matters for this** -- it's
  what determines her trajectory going forward, which is what a
  translation is projecting. Historical class labels for past seasons
  are not needed and (from real ESPN data) aren't reliably available
  anyway -- ESPN has no historical roster snapshots, only a
  current-roster snapshot at scrape time.
- **"Years of experience" should come from counting a player's rows in
  PlayerSeasons**, not from a class label per row. A player with 3
  PlayerSeasons rows (3 years of real games-played data) is a more
  reliable sample regardless of what her class was labeled in each of
  those years -- so the reliability weighting can be built directly off
  row counts once the real workbook is fully scraped, no extra field
  needed.
- **Per-40 needs shrinkage, not a raw ratio.** `stat / MP * 40` blows up
  at low minutes (1 minute / 3 points is not a 120-point pace). Convert
  using `rate = (stat + prior_rate * k) / (MP + k) * 40`, where
  `prior_rate` is a position+class baseline and `k` is a pseudo-minutes
  constant tuned per stat (turnover rate stabilizes faster than
  three-point rate, so needs a smaller `k`). Applies to every efficiency
  ratio (TS%, AST/TO, usage), not just raw production. Below a minimum
  season-minutes floor (~40-80), a player gets no individual composite
  at all -- she's represented by the positional/class baseline until she
  clears it, so a garbage-time cameo can't produce a headline number.
  The reliability weight this feeds into (see above) should key off
  **total minutes played**, not games or seasons -- two players with the
  same games-played count can have very different real sample sizes.
- **Competition adjustment needs a continuous per-opponent rating, not a
  D1/D2 flag** -- 20 points against the #5 team and 20 against the #200
  team must weight very differently even though both are nominally the
  same division. `ratings.py`'s margin-of-victory rating already does
  this in the prototype; the real-data version should do the same,
  computed post-season on the full completed game graph rather than
  live in-season (this product is used mostly after the season closes).
  We've now pulled Massey rankings per team per level (D1/D2) into the
  workbook -- use those as a prior/regularizer in the rating solve
  rather than a substitute for it: a D2 team with only one D1 crossover
  game shouldn't have its composite swing entirely on that one result,
  so anchor it to its intra-division Massey rank and let crossover games
  nudge it from there proportional to how many connections it actually
  has. Before building this, count actual D1-vs-D2 games in the `Games`
  sheet and check whether they're spread across enough D2 teams or
  clustered around a handful of programs -- D2 teams with no direct or
  indirect (opponent-of-opponent) path to a D1 game are mathematically
  unanchored to the D1 scale and need a flat level-offset fallback.
  During the season (secondary use case), skip a live version of this
  entirely and just use the per-level Massey ranks directly as a proxy
  until the season closes and the full crossover graph exists.
- **D1 needs a tier below it (HM/MM/LM), tagged manually per team.**
  Add a separate `Tier` column to the `Teams`/`D1` sheet -- do **not**
  overwrite the existing `Division` value ("D1"/"D2") with tier labels.
  `team_match.py` (line 109) and `run_d1_scrape.py` both filter on
  `division == "D1"` literally; changing that field breaks team
  matching and the scrape loop. `Tier` is a pure addition, safe to add
  without touching either script. `TransferProjection`'s
  `Current Division`/`Target Division` fields are already free-text, so
  they can hold a division+tier combination ("D1" + "LM") without a
  schema change. Note `Division`/`Tier` are single static values per
  team today, while `PlayerSeasons` spans three seasons (2024-2026) --
  if a team's tier realistically shifts within that window, older
  transfer rows would inherit today's tag. Small risk over a 3-year
  window, but a conscious simplification, not an accidental one.
- **Transfer-pair training data is selection-biased for the
  competition-level effect, and needs a two-layer fix.** Players who
  move HM D1 -> LM D1 (or any downward move) are disproportionately the
  ones who weren't producing at the higher level -- that's usually why
  they're leaving. A star averaging 15 PPG at a HM program essentially
  never makes that jump in reality, so there will never be real
  transfer examples to fit that corner of the model, and a regression
  trained only on observed transfer pairs would badly extrapolate (or
  get the direction wrong) for that case. Fix: don't use transfer pairs
  as the primary mechanism for the competition-level effect at all.
  - **Layer A -- opponent-strength elasticity.** Fit on every game in
    `PlayerGameStats`, not just transfers: how does a given player's
    shrunk per-40 rate move as her opponent's composite rating moves?
    Every player already has this variation within her own single-season
    schedule (a HM team's non-conference slate includes weak buy games
    alongside strong conference games), so this is a huge, unbiased
    sample that has real support even for a 15 PPG HM performer -- her
    own weak-opponent games already show what her rate looks like
    against lesser competition, no transfer needed. This is also where
    "games are harder in the Big 12 than the PacWest" gets captured
    directly: it's not a manual conference boost, it's the natural
    output of the composite team rating (component 3) already being
    driven by wins/losses and margins against known-strength opponents
    -- a Big 12 team's rating is higher than a PacWest D2 team's because
    it's actually beating (or competing with) higher-rated opponents,
    and that rating is what Layer A's opponent-strength input uses.
  - **Layer B -- role/usage adjustment.** This is what real transfer
    pairs remain legitimately good for: minutes/usage change after an
    actual transfer. Less selection-biased than raw production, since
    most transfers (star or bench player) are chasing a bigger role.
  - Final projection = Layer A's opponent-strength-driven rate, adjusted
    by Layer B's role/minutes shift.
  - Layer A can be validated without any transfer data at all: hold out
    each player's toughest few games, fit the elasticity on the rest of
    her schedule, and check whether it predicts the held-out tough
    games. Real validation, sidesteps the rare-event problem entirely.
- **HM<->LM D1 volume is actually the best-covered transfer segment**
  (reportedly 50+ players/year each direction), which is good news for
  Layer B specifically -- once tiers are tagged and a season or two of
  data exists, that segment's role/usage adjustment can be fit on real,
  plentiful examples rather than shrunk toward a league baseline. The
  thinner segments (true HM D1 <-> D2 jumps) are where the confidence
  shrinkage still matters most.
- **PDI is not a single stored number per player -- it's a function of
  (player, target team, search).** A projection can't exist without a
  destination (translation always needs a `strength_gap`), so "her PDI"
  in isolation isn't well-defined. What's precomputed once and stored
  are the destination-independent layers: the season composite (Hoop
  Score), the Team Rating Engine's ratings, and the opponent-elasticity
  model. PDI itself gets computed live per query:
  - **Roster-search mode:** coach selects their own team (supplies the
    real `destination_strength` from the Team Rating Engine, not just a
    tier bucket) and search criteria (position, role need, stat
    thresholds), which re-weights which stats matter in the composite,
    same logic as the prototype's position-weighted composite, just
    generalized from "position" to "whatever the coach specified."
  - **Single-player mode:** coach picks one player and one destination
    and enters the target minutes directly. Minutes are mandatory input
    here -- that removes the need to infer a role/MPG change from
    historical transfer patterns; `Projected Production` is just the
    opponent-elasticity-adjusted per-40 rate re-expressed at the given
    MPG. Simpler and more precise than the roster-search case, which
    still has to estimate MPG.
  - Both modes need this architecturally: PDI moves from a batch
    scraping-pipeline output (a `SeasonRankings` column written once a
    season) to a query-time calculation, which points toward eventually
    needing a real query/app layer over the workbook data, not just
    static spreadsheet cells.
  - 0-100 scaling should be a percentile against a **reference
    population scoped to the search**, not the whole national pool --
    otherwise a narrow search trivially inflates every result, and two
    coaches' searches aren't comparable to each other. Position (G/F/C)
    and a comparable level band are the two things that should always
    scope that reference population.
  - Single-player mode maps the same percentile onto qualitative bands
    instead of (or alongside) the raw number: Great fit (~80th
    percentile+), Good fit (~55th-80th), Moderate fit (~30th-55th), No
    fit (below ~30th). These cutoffs are a product call, not a fixed
    technical one -- treat them the same as the PDI 0-100 bands, tunable
    as more data comes in.
  - **"No fit" needs to mean one specific thing.** A player who's the
    wrong position for the search entirely (a post evaluated against a
    point guard search) isn't a real result and should be filtered out
    before scoring, not returned as a low-scoring "No fit." Keep
    exclusion (wrong position/role) and a real low score (right
    position, just not productive enough for the role) as two separate
    outcomes.
  - Show `Transfer Confidence` alongside the fit label, not folded into
    it -- a "Great fit" built on a thin sample (low minutes, thin data
    for that specific tier jump) should read differently from a "Great
    fit" backed by a full season of good data, even if both land in the
    same band.
- **Position bucketing should be G/F/C everywhere, not 5 positions.**
  Checked the real `Players` sheet: 4,955 of ~5,002 tagged players are
  already exactly G/F/C; only ~47 have finer ESPN labels (PG, SG, SF,
  PF, ATH), too thin a slice to support a real 5-bucket model. This
  updates the "Add the position model formally" item under Suggested
  next steps below -- the 5-bucket prototype hardcode isn't what the
  real data supports. Normalize the ~47 finer labels down into G/F/C
  rather than keeping them as their own buckets, and use G/F/C as the
  standing reference-population scope everywhere above (percentile
  scaling, fit bands, the elasticity model's peer comparisons).

## Suggested next steps

1. Swap `seed_data.py` for a real ingestion pipeline against an actual
   box score source, keeping the same `db.py` schema.
2. Persist `ratings.compute_team_ratings()` output back onto the
   `team.rating` column after each day's games, instead of recomputing
   the whole season in memory every run.
3. Once several seasons of data (and, ideally, real transfer outcomes)
   exist, replace the hand-tuned constants in `pdi.py` and `transfer.py`
   with values fit to that data.
4. Add the position model formally as G/F/C (not 5 buckets -- real data
   doesn't support finer granularity at meaningful volume; see design
   notes above), used as the reference-population scope for PDI
   percentile scaling, fit bands, and the elasticity model's peer
   comparisons.
5. Build the coach-facing report format described in the spec ("12.7
   PPG, 5.4 RPG, 29 MPG, 82% starter probability at Colorado State")
   as a thin presentation layer over `transfer.project_transfer()`.
