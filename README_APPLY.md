# Summit TPE -- SeasonRankings / TeamRatings

This folder has the computed data for your scaffold sheets, plus a script to
merge it into your live WomensSummitTPE.xlsx.

**If you already ran an earlier version of this** (the first delivery,
before this fix): please re-run with these files. See "Bug fix" below --
the earlier SeasonRankings data has a real error in it that this corrects.

## Why a patch instead of the whole file

Your real workbook is ~40-58MB depending on how it's saved (PlayerGameStats
alone is ~9.4M cells). That's over both the chat upload limit and the
file-transfer limit back to your machine, so instead of round-tripping the
whole file, only the new data (under 1MB) came back, with a script to apply
it locally.

## Bug fix: tiny-minute games were distorting per-40 rates and rankings

The first version of this computed each player's per-40 rates (points/
rebounds/assists per 40 minutes) by averaging every game's individual
per-40 extrapolation. That breaks badly for very short stints -- a player
who scores 3 points in 1 minute extrapolates to a "120 PPG pace" for that
one game, and that number was getting averaged in at full weight.

The real, concrete case this caught: a player with only **21 total minutes
across 7 games** (some games as short as 1 minute) was ranked **#1 in the
entire country** in the SeasonRankings data from the first delivery. That's
wrong -- she barely played.

Fixed three ways in this version:
1. Per-40 rates are now `season totals / season total minutes * 40`
   (implicitly minutes-weighted) instead of an unweighted average of
   per-game extrapolations.
2. Any single game's extrapolation is capped at a 4x multiplier (minutes
   floored at 10 for the scale factor), so no one short stint can dominate.
3. Added a 100-total-minutes floor on top of the existing 5-games floor for
   a player to be eligible for ranking at all -- a real season-length
   sample, not just games appeared in.

Net effect: SeasonRankings dropped from 4,485 to **3,887 eligible players**
(598 excluded for having enough games but too little total playing time).
The leaderboard is now exclusively legitimate, high-minute performances --
spot-checked against real 2025-26 names (Audi Crooks, Sarah Strong, Ava
Heiden, Lauren Betts, Gracie Merkle at the very top).

**If your live workbook's SeasonRankings sheet was already filled by the
first delivery, it currently has this bug in it** -- re-run `apply_results.py`
with the CSVs in this package to overwrite it with the corrected data.

## TransferProjection is no longer part of this

Earlier, TransferProjection was going to be a precomputed sheet. Based on
how you actually want to use it -- pick a player, pick any target team,
optionally set exact minutes, get an instant projection, repeated across
many different schools for the same player -- a fixed sheet of rows doesn't
fit. That's now a live calculator instead (see `summit_tpe_calculator.zip`,
delivered separately). This script no longer touches that sheet at all;
delete the TransferProjection tab from your workbook if you haven't
already.

## How to run it

1. Put `apply_results.py`, `season_rankings.csv`, and `team_ratings.csv` in
   the same folder as `WomensSummitTPE.xlsx` (your `HoopScoreImporter`
   folder works fine).
2. Close the workbook in Excel if it's open.
3. From that folder:

   ```
   python apply_results.py
   ```

   This clears any existing rows in SeasonRankings / TeamRatings and writes
   in the computed data, matching columns by header name (safe even if
   you've reordered/added columns since). Takes a few minutes on the real
   file -- it has to load the whole workbook to write into a few sheets,
   same as your existing scrapers/ scripts.

4. Optional, when you're ready: `python apply_results.py --trim-bloat`
   also fixes something found along the way -- see "Bloat" below. Safe to
   run on its own later instead of combining it with the data merge.

Add `--dry-run` first if you want to see exactly what it'll do before it
touches the real file. `--path` and `--data-dir` let you point at different
locations if needed -- run `python apply_results.py --help`.

## What "Bloat" means

Teams and Players currently carry ~2.1 million empty-but-formatted trailing
rows (Teams' used range runs to row 1,047,979; Players' to Excel's hard
limit, 1,048,575, even though real data is only 362 and 8,718 rows). That's
why loading or saving this workbook currently takes several minutes even
for a one-cell change, and it's likely a chunk of the file's size. It came
up because it made this delivery slow enough to hit transfer limits -- not
something introduced by this run.

`--trim-bloat` deletes ONLY empty trailing rows -- it never touches a row
with any value in it, so real player/team data and the live Transfer
History / Schools Attended formulas on Players are untouched. One nuance
worth knowing: Players' real player rows end at row 8,719, but the trim
stops at row 21,423 instead, because the Schools Attended array formula has
scattered stray "1" values spilling out that far past the real data (rows
like 8,754, 8,843, 13,239, 18,994, 21,423 each have nothing but a lone `1`
in that column, no player). That's arguably worth a separate look at some
point -- it's very possibly a symptom of the same kind of leftover
corruption your own `detect_roster_contamination.py` / cleanup scripts have
caught before, just in the Schools Attended formula's range rather than in
the data itself. The trim script won't touch it since those cells aren't
empty; flagging it here so you have it.

## What's in the 2 sheets

**TeamRatings** (362 rows, 2025-26): a fresh iterative Off/Def/Rat solve run
the same way as `scrapers/compute_summit_ratings.py`'s Summit Rat -- Current
Rating should match that column closely as a cross-check. Initial Rating is
the same team's 2024-25 Rat (blank if they weren't in the data last season).
Strength of Schedule is the games-weighted average opponent Rat (matches
Summit SoS's definition); Average Opponent Rating is the same but weighted
by unique opponents instead, so the two columns say slightly different
things rather than duplicating each other. Home/Away Rating are each team's
performance in home-only or away-only games, adjusted by opponent quality
using the season's overall ratings as a fixed reference (an earlier version
of this literally computed the same number for both columns by accident --
fixed, and Home now runs consistently a few points above Away across the
board, which is the home-court-advantage signal you'd expect if it's
working).

**SeasonRankings** (3,887 players with >=5 games AND >=100 total minutes,
2025-26): adapts `summit_tpe/pdi.py`'s position-weighted, opponent-adjusted,
close-game-weighted composite to the real columns (single Rebound field
instead of oreb/dreb, 3 position buckets instead of 5, opponent strength
calibrated to Summit Rat's actual scale instead of the prototype's
placeholder Elo constants). Average Hoop Score is season-level; Highest/
Lowest/Standard Deviation come from every individual game's Hoop Score. The
very top of the scale compresses on purpose (several distinct elite seasons
round to the same displayed 99.0) -- Overall Rank still orders them
correctly underneath that display cap, sorting on the true unclamped value
rather than the displayed one. Top of the list checks out by eye: Audi
Crooks, Sarah Strong, Ava Heiden, Lauren Betts, Gracie Merkle, and other
players who were genuinely elite in 2025-26. Projected Level is just each
player's real Division right now -- there's no sub-D1 player data in this
workbook for it to flag outliers against.

## Files

- `apply_results.py` -- run this
- `season_rankings.csv`, `team_ratings.csv` -- the computed data it reads
- `compute_derived_sheets.py` (sent separately) -- the actual computation,
  if you want to re-run it yourself after this season's data updates, or
  adjust any of the assumptions above. Reads the real workbook read-only
  (fast, no bloat penalty) and writes both sheets + does the full
  computation in one pass.
