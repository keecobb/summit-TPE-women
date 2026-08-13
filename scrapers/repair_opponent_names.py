"""One-off: corrects opponent-name-resolution mistakes in the Games
sheet (task #46) -- two DIFFERENT kinds of fix, both discovered during
a full-workbook audit of the 5,742 unresolved/mismatched opponent-name
occurrences:

0. TEAM_NAME_CORRECTIONS -- two Teams-sheet rows have garbled names that
   never match how any opponent's schedule actually refers to them,
   confirmed live by their Roster URL/mascot (each fully scraped, 3
   seasons done, just unfindable by name):
     - Team ID 521 is really "Midwestern State" (Wichita Falls, TX,
       Lone Star Conference) but is on record as "Midwest Texas State"
       -- roster URL is msumustangs.com, Midwestern State's real
       mascot IS the Mustangs. This alone caused 43 SEPARATE "Midwestern
       St." occurrences to silently stay unresolved even after today's
       abbreviation fix (the abbreviation expanded correctly, there was
       just no real "Midwestern State" row to match against).
     - Team ID 398 is really "Cal Poly Pomona" but is on record as "Cal
       State Poly Pomona" -- roster URL is broncoathletics.com, Cal
       Poly Pomona's real mascot IS the Broncos. Caused 54 separate
       "Cal Poly Pomona" occurrences to stay unresolved.
   Renaming these first (before the backfill step below runs) lets both
   of those name-forms resolve naturally afterward, on top of fixing
   the display name itself.

1. KNOWN_BAD_MATCHES -- games that got resolved to the WRONG team
   entirely, confirmed live:
     - "Post University" (6 games) resolved to Boston University (Team
       ID 27) instead of the real match, "Post" (Team ID 565). Root
       cause: BEFORE the University/College suffix-stripping fix
       existed, "post university" and "boston university" scored 0.875
       on the fuzzy matcher (their shared "university" suffix inflated
       the ratio) -- just over the 0.87 cutoff -- while the correct
       match, "post university" vs "post", only scored 0.42 and was
       never even close. Self-healing for FUTURE scrapes now that
       University/College gets stripped before comparing, but these 6
       existing rows are still wrong right now.
     - "Midwestern State" (1 game, Tampa's 2023-24 schedule) resolved
       to Western State/Western Colorado (Team ID 648) instead of the
       real match -- Team ID 521, see TEAM_NAME_CORRECTIONS above.
       "midwestern state" vs "western state" scores 0.897, still above
       the 0.87 cutoff even with today's fixes, so this one was NOT
       going to self-heal on its own even after the rename (the rename
       fixes future/unresolved lookups via exact match, but this row
       already has a WRONG id sitting in it that a blank-only backfill
       would never touch).

2. Safe abbreviation backfill -- separately, ~1,311 occurrences across
   51 distinct opponent names use a standard NCAA state abbreviation
   ("N.M. Highlands", "Truman St.", "Cal St. Dom. Hills", etc.) that
   the scrapers didn't know how to expand until run_d2_scrape.py's
   STATE_ABBR_MAP was added today. Every one of those 51 matches was
   hand-verified correct. This script re-checks every Games row with a
   missing Home/Away Team ID against that SAME expansion logic and
   fills in the ID wherever it now resolves.

   Deliberately uses a NARROWER matcher than run_d2_scrape.py's full
   normalize_team_name() -- state-abbreviation expansion only, NOT the
   University/College suffix strip. That strip is exactly what caused
   the "Post University" mistake above, and separately would ALSO
   wrongly match "Georgia College" (a real, untracked D2 school) to
   "Georgia" (University of Georgia, D1, Team ID 100) if applied here --
   confirmed live: "Georgia College" already appears as an opponent
   name 52 times in the Games sheet, all still correctly unresolved
   today. Skipping the suffix-strip in THIS script's matcher means it
   can never introduce that mistake, even though it can't fix every
   backfillable row the way a University/College-aware matcher could.

My sandbox's full load+save of the live workbook times out before it
can finish writing, so this needs to run on your machine, same as every
other write against the real workbook.

Usage:
    python scrapers/repair_opponent_names.py
"""

import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from run_d2_scrape import expand_state_abbreviations, normalize_text
from scrapers.xlsx_io import header_map, open_workbook, save_with_retry

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "WomensSummitTPE.xlsx")

# (team_id, WRONG name currently on record, CORRECT real name)
TEAM_NAME_CORRECTIONS = [
    (521, "Midwest Texas State", "Midwestern State"),
    (398, "Cal State Poly Pomona", "Cal Poly Pomona"),
]

# (literal opponent name, WRONG team_id it's currently set to, CORRECT
# team_id or None to just leave it unresolved)
KNOWN_BAD_MATCHES = [
    ("Post University", 27, 565),       # -> "Post"
    ("Midwestern State", 648, 521),     # -> real "Midwestern State" (see TEAM_NAME_CORRECTIONS)
]


def narrow_normalize(value):
    """State-abbreviation expansion + basic normalize_text() ONLY -- no
    University/College suffix stripping. See module docstring for why."""
    return normalize_text(expand_state_abbreviations(value or ""))


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PATH
    print(f"Opening {path} ...")
    wb = open_workbook(path)

    # --- Step 0: correct garbled Teams-sheet names -------------------
    tws = wb["Teams"]
    th = header_map(tws)
    renamed = 0
    for row in range(2, tws.max_row + 1):
        team_id = tws.cell(row=row, column=th["Team ID"]).value
        current_name = tws.cell(row=row, column=th["Team"]).value
        for tid, wrong_name, correct_name in TEAM_NAME_CORRECTIONS:
            if team_id == tid and current_name == wrong_name:
                tws.cell(row=row, column=th["Team"], value=correct_name)
                renamed += 1
                print(f"  Renamed Team ID {tid}: {wrong_name!r} -> {correct_name!r}")
    print(f"\nStep 0 done: renamed {renamed} Teams-sheet row(s).")
    print("(Their OWN existing games in the Games sheet still show the old name as "
          "literal text -- cosmetic only, team_id is unaffected, and it'll self-correct "
          "next time either team's own site gets rescraped.)\n")

    gws = wb["Games"]
    gh = header_map(gws)

    # --- Step 1: correct the known-bad rows -------------------------
    corrected = 0
    for row in range(2, gws.max_row + 1):
        home_name = gws.cell(row=row, column=gh["Home Team"]).value
        away_name = gws.cell(row=row, column=gh["Away Team"]).value
        home_id = gws.cell(row=row, column=gh["Home Team ID"]).value
        away_id = gws.cell(row=row, column=gh["Away Team ID"]).value

        for literal, wrong_id, correct_id in KNOWN_BAD_MATCHES:
            if home_name == literal and home_id == wrong_id:
                gws.cell(row=row, column=gh["Home Team ID"], value=correct_id)
                corrected += 1
                print(f"  Corrected row {row}: Home {literal!r} {wrong_id} -> {correct_id}")
            if away_name == literal and away_id == wrong_id:
                gws.cell(row=row, column=gh["Away Team ID"], value=correct_id)
                corrected += 1
                print(f"  Corrected row {row}: Away {literal!r} {wrong_id} -> {correct_id}")

    print(f"\nStep 1 done: corrected {corrected} known-bad game-side occurrences.")

    # --- Step 2: safe abbreviation backfill --------------------------
    tws = wb["Teams"]
    th = header_map(tws)
    # Same collision-safe two-pass approach as run_d2_scrape.py's
    # _load_teams() fix -- see that file's comment for the full
    # rationale (Boston College / Boston University both stripping to
    # the same key was the confirmed live case).
    name_key_candidates = defaultdict(set)
    for row in range(2, tws.max_row + 1):
        name = tws.cell(row=row, column=th["Team"]).value
        team_id = tws.cell(row=row, column=th["Team ID"]).value
        if name and team_id is not None:
            name_key_candidates[normalize_text(name)].add(team_id)
            name_key_candidates[narrow_normalize(name)].add(team_id)
    name_to_id = {
        key: next(iter(team_ids))
        for key, team_ids in name_key_candidates.items()
        if len(team_ids) == 1
    }

    fixed = 0
    fixed_names = {}
    for row in range(2, gws.max_row + 1):
        home_id = gws.cell(row=row, column=gh["Home Team ID"]).value
        away_id = gws.cell(row=row, column=gh["Away Team ID"]).value

        if home_id is None:
            home_name = gws.cell(row=row, column=gh["Home Team"]).value
            if home_name:
                matched_id = name_to_id.get(narrow_normalize(home_name))
                if matched_id is not None:
                    gws.cell(row=row, column=gh["Home Team ID"], value=matched_id)
                    fixed += 1
                    fixed_names[home_name] = fixed_names.get(home_name, 0) + 1

        if away_id is None:
            away_name = gws.cell(row=row, column=gh["Away Team"]).value
            if away_name:
                matched_id = name_to_id.get(narrow_normalize(away_name))
                if matched_id is not None:
                    gws.cell(row=row, column=gh["Away Team ID"], value=matched_id)
                    fixed += 1
                    fixed_names[away_name] = fixed_names.get(away_name, 0) + 1

    print(f"\nStep 2 done: backfilled Team ID on {fixed} Home/Away game-side occurrences "
          f"across {len(fixed_names)} distinct opponent names:")
    for name, count in sorted(fixed_names.items(), key=lambda x: -x[1]):
        print(f"  {count:4d}  {name!r}")

    if corrected == 0 and fixed == 0:
        print("\nNothing changed -- no rows matched. Double-check nothing has regressed.")
    else:
        print("\nSaving ...")
        save_with_retry(wb, path)
        print("Done.")


if __name__ == "__main__":
    main()
