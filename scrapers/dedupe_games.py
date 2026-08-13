"""One-time cleanup: de-duplicates Games/PlayerGameStats/PlayerSeasons
rows created when the SAME real-world game got scraped independently
from BOTH participating teams' own sites -- each site produces its own
opaque Game ID for the same real event, so the existing games_seen
dedup (keyed by Game ID) can't catch it. Confirmed live via a full scan
of the Games sheet: 936 duplicate groups in the D2 dataset (e.g. Grand
Valley State, a Sidearm-only team scraped in the original 278-team
batch with no Presto involvement at all, showing 4-6 rows against a
single conference opponent in one season where a real double
round-robin schedule should show 2), plus 20 in D1 (root cause
probably different there, but the same fingerprint catches them too).
See run_d2_scrape.py and run_d2_presto_scrape.py's Context.
games_by_score_key for the live-code prevention fix that stops this
from recurring going forward -- this script only cleans up data already
written before that fix existed.

Dedup key: (season, sorted team ID pair, sorted final scores). Team IDs
are canonical across the whole workbook (not site-specific), and two
DIFFERENT real games between the same pair in one season landing on the
exact same final score is implausible -- an exact score match is a very
reliable "this is the same real game" fingerprint.

For each duplicate group, keeps ONE row (preferring a real, non-None
Game ID over a None one; among real IDs, keeps whichever was scraped
first / appears earlier in the sheet -- arbitrary but deterministic,
since both copies represent identical underlying data). Removes the
rest, drops every PlayerGameStats row tied to a removed Game ID, then
recomputes Games Played / Games Started in PlayerSeasons for every
(Player ID, Season) that had at least one row removed, using the
now-cleaned PlayerGameStats data (same counting logic finalize() in
both scrapers already uses).

Rebuilds Games and PlayerGameStats via wipe-and-rebuild (see
xlsx_io.wipe_data_rows's docstring for why -- ws.delete_rows() on a
sheet this size is extremely slow). PlayerSeasons is NOT rebuilt --
only the specific affected rows' Games Played/Started cells are updated
in place, since only a small subset of ~24,868 rows need to change.

Usage:
    python scrapers/dedupe_games.py --dry-run
    python scrapers/dedupe_games.py
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from scrapers.xlsx_io import (
    append_rows, header_map, iter_data_rows, open_workbook,
    save_with_retry, wipe_data_rows,
)

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "WomensSummitTPE.xlsx")


def build_score_key(season, home_id, away_id, home_score, away_score):
    if home_id is None or away_id is None or home_score is None or away_score is None:
        return None
    if home_id <= away_id:
        pair, scores = (home_id, away_id), (home_score, away_score)
    else:
        pair, scores = (away_id, home_id), (away_score, home_score)
    return (season, pair, scores)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", default=DEFAULT_PATH)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print(f"Opening {args.path} ...")
    wb = open_workbook(args.path)

    games_ws = wb["Games"]
    gh = header_map(games_ws)

    all_game_rows = []  # (row_idx, values) in sheet order
    groups = {}  # score key -> [(row_idx, game_id), ...]
    for row_idx, values in iter_data_rows(games_ws, gh):
        all_game_rows.append((row_idx, values))
        key = build_score_key(
            values.get("Season"), values.get("Home Team ID"), values.get("Away Team ID"),
            values.get("Home Score"), values.get("Away Score"),
        )
        if key is None:
            continue
        groups.setdefault(key, []).append((row_idx, values.get("Game ID")))

    drop_row_idx = set()
    remove_game_ids = set()
    for key, rows in groups.items():
        if len(rows) <= 1:
            continue
        rows_sorted = sorted(rows, key=lambda r: (r[1] is None, r[0]))
        for row_idx, gid in rows_sorted[1:]:
            drop_row_idx.add(row_idx)
            if gid is not None:
                remove_game_ids.add(str(gid))

    dup_group_count = sum(1 for rows in groups.values() if len(rows) > 1)
    print(f"Total Games rows: {len(all_game_rows)}")
    print(f"Duplicate groups (>1 row, same season/team-pair/score): {dup_group_count}")
    print(f"Games rows to remove: {len(drop_row_idx)}")

    if args.dry_run:
        print("Dry run -- no changes made.")
        return

    kept_game_rows = [values for row_idx, values in all_game_rows if row_idx not in drop_row_idx]
    print(f"Rebuilding Games sheet: {len(kept_game_rows)} kept, {len(drop_row_idx)} removed ...")
    new_games_ws = wipe_data_rows(wb, "Games", keep_header=True)
    new_gh = header_map(new_games_ws)
    append_rows(new_games_ws, new_gh, kept_game_rows)

    # BUG FIXED HERE: the first version of this script materialized
    # kept_pgs_rows as a full Python list of ~20-key dicts (one per kept
    # row) BEFORE rebuilding the sheet, while the OLD sheet object
    # (pgs_ws) and the freshly-created NEW sheet were ALSO both fully
    # resident in memory at the same time -- three simultaneous full
    # copies of a ~615,000-row, ~20-column sheet. Confirmed live: this
    # ran for 90+ minutes without finishing (almost certainly memory
    # thrashing, not genuine compute time -- 615k rows through a normal
    # Python loop should take low single-digit minutes at most). Fixed
    # by streaming: read each row from the OLD sheet as a plain value
    # tuple (iter_rows(values_only=True), far cheaper than the dict-
    # per-row approach used elsewhere in this codebase for smaller
    # sheets) and immediately append it to the NEW sheet in the same
    # pass, never holding more than one row at a time in between. The
    # OLD sheet stays alive only because this script's local `pgs_ws`
    # variable still references it (openpyxl's `del wb[name]` inside
    # wipe_data_rows removes it from the WORKBOOK's sheet list, not the
    # underlying object a live reference still points to) -- so the
    # generator below still works after wipe_data_rows() has already
    # created the new, empty sheet.
    pgs_ws = wb["PlayerGameStats"]
    ph = header_map(pgs_ws)
    gid_col = ph["Game ID"] - 1
    pid_col = ph["Player ID"] - 1
    season_col = ph["Season"] - 1
    team_col = ph["Team ID"] - 1
    gs_col = ph["GS"] - 1
    old_row_iter = pgs_ws.iter_rows(min_row=2, values_only=True)

    new_pgs_ws = wipe_data_rows(wb, "PlayerGameStats", keep_header=True)

    removed_pgs_count = 0
    kept_pgs_count = 0
    affected_keys = set()  # (Player ID, Season) that had >=1 row removed
    # Per-key counts built from every KEPT row encountered, for every
    # key (not just already-known-affected ones -- in a single forward
    # pass we can't know in advance whether a LATER row for the same
    # key will turn out to be a duplicate, so this stays small (one
    # entry per real player-season pair, not one per PGS row) and gets
    # filtered down to affected_keys after the full pass completes.
    counts = {}
    for row in old_row_iter:
        if row is None or all(v is None for v in row):
            continue
        gid = row[gid_col]
        if gid is not None and str(gid) in remove_game_ids:
            removed_pgs_count += 1
            affected_keys.add((row[pid_col], row[season_col]))
            continue
        new_pgs_ws.append(row)
        kept_pgs_count += 1
        key = (row[pid_col], row[season_col])
        entry = counts.setdefault(key, {"games": 0, "starts": 0, "team_id": None})
        entry["team_id"] = row[team_col]
        entry["games"] += 1
        if row[gs_col] == "Yes":
            entry["starts"] += 1

    print(f"Rebuilt PlayerGameStats sheet: {kept_pgs_count} kept, {removed_pgs_count} removed.")
    print(f"Recomputing Games Played/Started for {len(affected_keys)} affected (Player, Season) pair(s) ...")

    seasons_ws = wb["PlayerSeasons"]
    sh = header_map(seasons_ws)
    updated = 0
    zeroed = 0
    for row_idx, values in iter_data_rows(seasons_ws, sh):
        key = (values.get("Player ID"), values.get("Season"))
        if key not in affected_keys:
            continue
        entry = counts.get(key)
        if entry is None:
            # Every PlayerGameStats row for this (player, season) got
            # removed as a duplicate -- shouldn't normally happen (would
            # mean the player's ENTIRE season was a duplicate copy), but
            # handle it safely rather than crash: zero it out.
            seasons_ws.cell(row=row_idx, column=sh["Games Played"], value=0)
            seasons_ws.cell(row=row_idx, column=sh["Games Started"], value=0)
            zeroed += 1
            continue
        seasons_ws.cell(row=row_idx, column=sh["Games Played"], value=entry["games"])
        seasons_ws.cell(row=row_idx, column=sh["Games Started"], value=entry["starts"])
        updated += 1
    print(f"PlayerSeasons: {updated} row(s) updated, {zeroed} zeroed out (entire season was duplicate copies).")

    print("Final save ...")
    save_with_retry(wb, args.path)
    print("Done.")


if __name__ == "__main__":
    main()
