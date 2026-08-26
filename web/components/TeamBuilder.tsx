"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ROLE_NAMES,
  roleLabel,
  type BatchBuildResult,
  type BatchPlayerInput,
  type ClassArchetypeCell,
  type ClassArchetypes,
  type ClassYearKey,
  type FreshmanArchetypeKey,
  type PriorSeasonLine,
  type ProductionTierKey,
  type ScoutingReport,
} from "@/lib/types";

const ARCHETYPE_KEYS: FreshmanArchetypeKey[] = ["day1_starter", "role_player", "depth_piece"];
const PRODUCTION_TIER_KEYS: ProductionTierKey[] = ["great", "good", "average"];
const TEAM_TIERS = ["High-Major", "Mid-Major", "Low-Major"] as const;
const POSITIONS = ["G", "F", "C"] as const;

// NCAA women's/men's D1 basketball rosters are capped at 15 -- a coach
// building a hypothetical roster shouldn't be able to assemble something
// that couldn't legally exist. A redshirted entry still occupies a real
// roster spot (she's on the team, just not playing) so she still counts
// against this cap even though she's excluded from every build/report
// computation below.
const ROSTER_CAP = 15;

// The 3 ways a custom roster slot can be grounded in real production (all
// backed by the SAME class_archetypes() real-data grid, just pointed at a
// different class year -- see class-archetypes/route.ts). "Freshman" is
// locked to FR (a true incoming freshman). "JUCO Transfer" models a 1-2
// year junior-college transfer, who typically enters with a class jump
// already earned (locked to SO/JR, not FR -- she's not a true freshman by
// eligibility). "Lower-Level Transfer" (D2/NAIA, etc.) can enter at any
// class, since those transfers aren't on a fixed JUCO clock.
const ENTRY_TYPES = [
  { key: "freshman", label: "Freshman", classYears: ["FR"] as ClassYearKey[] },
  { key: "juco_transfer", label: "JUCO Transfer", classYears: ["SO", "JR"] as ClassYearKey[] },
  { key: "lower_transfer", label: "Lower-Level Transfer (D2/NAIA)", classYears: ["FR", "SO", "JR", "SR"] as ClassYearKey[] },
] as const;
type EntryTypeKey = (typeof ENTRY_TYPES)[number]["key"];

// Short label for a custom entry's origin, shown next to her class year in
// the Roster Breakdown table (e.g. "FR (Freshman)" vs. "SO (JUCO
// Transfer)") so a coach-entered slot is correctly identified rather than
// just showing a bare class-year letter indistinguishable from a real
// player's. "Transfer" (not the full "Lower-Level Transfer (D2/NAIA)"
// label used in the picker) since table space is tight.
const ENTRY_TYPE_TABLE_LABEL: Record<EntryTypeKey, string> = {
  freshman: "Freshman",
  juco_transfer: "JUCO Transfer",
  lower_transfer: "Transfer",
};

// A real player's class_year on a build result is her actual, current
// 2025-26 status -- Team Builder projects the 2026-27 season, one year
// later, so the Roster Breakdown table advances it by one class rather
// than showing a stale year. A custom/preset entry's class_year is never
// advanced: a coach picking "FR" for a Freshman entry already means "an
// incoming freshman in 2026-27," not "currently a freshman in 2025-26."
// (A redshirted real player's class wouldn't advance either, since a
// redshirt year doesn't use a season of eligibility -- but a redshirted
// entry never reaches this table at all, see runBuild()'s activeRoster
// filter, so that case can't actually occur here.)
const CLASS_YEAR_ADVANCE: Record<string, string> = { FR: "SO", SO: "JR", JR: "SR", SR: "GR" };
function advanceClassYear(cy: string | null | undefined): string {
  if (!cy) return "--";
  return CLASS_YEAR_ADVANCE[cy] ?? cy;
}

interface Picked {
  id: number;
  label: string;
  sub?: string;
  // Present only for a player-search pick (kind="players", see
  // app/api/search/route.ts) -- absent (undefined) for a team pick. Lets
  // addRealPlayer carry the same identity info onto the roster row that a
  // roster-loaded player already gets from /teams/{id}/roles, without a
  // second round trip.
  position?: string | null;
  height?: string | null;
  classYear?: string | null;
  teamName?: string | null;
  hoopScore?: number | null;
  games?: number | null;
}

// Position/height/class/2025-26 Summit Score/school -- shown as a small
// identity line under a roster row's name, and (for a roster-loaded
// player) sourced straight from /teams/{id}/roles' roster_roles; for a
// player added via search, from the search proxy's structured fields.
// Left entirely undefined fields just render as "--" rather than being
// required, since not every player has a recorded position (see
// ARCHITECTURE_HOSTING_PLAN.md's phase 19 note on position sourcing gaps).
interface PlayerIdentity {
  position?: string | null;
  height?: string | null;
  classYear?: string | null;
  teamName?: string | null;
  hoopScore?: number | null;
  games?: number | null;
}

interface RealEntry {
  kind: "real";
  key: string;
  playerId: number;
  name: string;
  sub?: string;
  identity?: PlayerIdentity;
  role: string; // "" = Auto
  minutes: string; // "" = not set, wins over role when filled
  // Redshirted this season -- she's on the roster (still counts against
  // the 15-player cap) but won't play, so she's excluded entirely from
  // the build payload sent to /project/batch: no minutes, no stat line,
  // no contribution to the combined total, the position mix, or the
  // scouting report. Purely a frontend filter -- no backend involvement.
  redshirt?: boolean;
}

interface CustomEntry {
  kind: "custom";
  key: string;
  // Set when this slot is a real player already in the cache with no
  // 2025-26 production to project from -- see convertToOverride() below.
  // Purely a display/link passthrough; doesn't change how this slot is
  // computed.
  linkedPlayerId?: number;
  name: string;
  entryType: EntryTypeKey;
  classYear: ClassYearKey;
  position: (typeof POSITIONS)[number];
  // Free-text, coach-entered (e.g. 6' 2") -- display only, same as every
  // other custom field. See CustomPlayerRequest.height in api.py.
  height: string;
  archetype: FreshmanArchetypeKey;
  productionTier: ProductionTierKey;
  minutes: string; // always derived from the preset -- never hand-typed
  ppg: string;
  rpg: string;
  apg: string;
  bpg: string;
  spg: string;
  topg: string;
  // See RealEntry.redshirt -- same meaning, same build-time exclusion.
  redshirt?: boolean;
  // Collapses this row to a one-line summary once a coach has entered/
  // applied data -- a fully expanded custom row is the tallest thing on
  // the board (name/type/class/position/height controls, the preset
  // picker, then 6 stat inputs), and a roster with several of them left
  // open gets hard to scan against the compact real-player rows next to
  // them. Purely a display toggle -- doesn't touch what gets built.
  collapsed?: boolean;
}

type Entry = RealEntry | CustomEntry;

// Solidified Starter/Sixth Man/Role Player/Depth Piece (from /teams/{id}/
// roles' roster_roles, see components/RoleCheckboxGroup.tsx's ROLE_NAMES
// for the reverse of this mapping) -> the role_name value /project/batch
// expects. A player with role: null there (not enough data to classify --
// see team_roles()'s docstring) prefills to "" (Auto) instead of guessing.
const CLASSIFIED_ROLE_TO_ROLE_NAME: Record<string, string> = {
  "Solidified Starter": "starter",
  "Sixth Man": "sixth_man",
  "Role Player": "role_player",
  "Depth Piece": "depth_piece",
};

let keySeq = 0;
function nextKey() {
  keySeq += 1;
  return `e${keySeq}`;
}

function blankCustom(): CustomEntry {
  return {
    kind: "custom",
    key: nextKey(),
    name: "",
    entryType: "freshman",
    classYear: "FR",
    position: "G",
    height: "",
    archetype: "role_player",
    productionTier: "good",
    minutes: "",
    ppg: "",
    rpg: "",
    apg: "",
    bpg: "",
    spg: "",
    topg: "",
    collapsed: false,
  };
}

// Turns a flagged real player (loaded/searched but with zero 2025-26
// games -- see RealRow's "no 2025-26 stats" pill) into a custom slot
// pre-filled with her real identity, keeping her player_id as a display
// link (linked_player_id, see _custom_player_result()'s docstring in
// projection.py) even though her actual stat line now comes from a
// preset instead of the model. Defaults entryType by her real class year
// when known (FR -> freshman, anything else -> lower_transfer, the
// broadest bucket) since there's no way to know from the data alone
// whether she's a true incoming freshman or an already-enrolled transfer
// who simply redshirted/sat out -- the coach can change it either way.
function convertToOverride(entry: RealEntry): CustomEntry {
  const cy = (entry.identity?.classYear as ClassYearKey | undefined) ?? "FR";
  const entryType: EntryTypeKey = cy === "FR" ? "freshman" : "lower_transfer";
  return {
    ...blankCustom(),
    linkedPlayerId: entry.playerId,
    name: entry.name,
    entryType,
    classYear: cy,
    position: (entry.identity?.position as (typeof POSITIONS)[number] | undefined) ?? "G",
    height: entry.identity?.height ?? "",
  };
}

// Resolves the real-data class_archetypes cell a custom entry's current
// selectors point at, falling back from a position-specific slice to the
// position-blind cell when the position slice isn't offered (see
// class_archetypes()'s docstring in projection.py -- position coverage is
// genuinely sparse site-wide, so this fallback is the common case, not an
// edge case).
function resolveCell(archetypes: ClassArchetypes | null, entry: CustomEntry): ClassArchetypeCell | undefined {
  const tierCell = archetypes?.classes?.[entry.classYear]?.[teamTierFor(entry) ?? ""]?.[entry.archetype];
  if (!tierCell) return undefined;
  const posCell = tierCell.positions?.[entry.position];
  return posCell && posCell.player_count > 0 ? posCell : tierCell;
}

// Placeholder replaced by the real target-team tier at call sites below --
// kept as a small helper so resolveCell's signature doesn't need the tier
// threaded through separately everywhere it's used.
let _teamTierForCurrentBuild: string | undefined;
function teamTierFor(_entry: CustomEntry): string | undefined {
  return _teamTierForCurrentBuild;
}

function presetLine(cell: ClassArchetypeCell | undefined, tier: ProductionTierKey) {
  if (!cell) return undefined;
  return cell.tiers?.[tier] ?? cell;
}

/**
 * Team Builder: pick one real team as the projection context (its rating
 * is what every real roster player's strength-gap and role-minutes are
 * resolved against, same as /project's target_team_id), then assemble a
 * roster against it for a projected 2026-27 season -- start from that
 * team's actual current players (prefilled with their real classified
 * role), remove/add freely, add any other team's players, and/or add
 * freeform slots for an incoming freshman, a JUCO transfer, a lower-level
 * (D2/NAIA) transfer, or anyone else with no real 2025-26 season in the
 * cache. Every real player's stats shown are their actual 2025-26
 * production (2026-27 hasn't happened yet) -- see app/api/team-builder/
 * route.ts and POST /project/batch's `custom`/`normalize_minutes` support
 * (projection.py's _custom_player_result/project_batch) for how a custom
 * slot's preset/coach-entered line flows through unmodeled, clearly
 * labeled, alongside every real player's actual model-backed projection,
 * and how the whole roster's minutes get rescaled to a real game's 200
 * team-minutes.
 */
export default function TeamBuilder({ sport }: { sport: string }) {
  const [team, setTeam] = useState<Picked | null>(null);
  const [roster, setRoster] = useState<Entry[]>([]);
  const [addKey, setAddKey] = useState(0);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<BatchBuildResult | null>(null);
  const [archetypes, setArchetypes] = useState<ClassArchetypes | null>(null);
  const [report, setReport] = useState<ScoutingReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  // Which of the 4 role buckets (starter/sixth_man/role_player/depth_piece)
  // the currently-picked TARGET team's own real roster can actually
  // resolve real calibrated minutes for -- team_roles() returns a null
  // `minutes` for a bucket a thin/unusual roster can't fill (e.g. no
  // player started 65%+ of the team's games this season), and picking
  // that role for a real player makes project_player() raise a clean but
  // hard error ("not enough rotation players on record for that role").
  // autoRoleAssignments() below reads this to only rank-assign a bucket
  // it knows will actually resolve, so a data gap on the TARGET team
  // can't turn into a build-breaking error for an Auto player who never
  // asked for that specific role -- she just falls back to her own real
  // minutes (the original Auto behavior) instead.
  const [roleBucketsAvailable, setRoleBucketsAvailable] = useState<Record<string, boolean>>({});

  // Fetched whenever the target team changes, independent of whether the
  // roster board itself gets auto-loaded from this team's current roster
  // (loadCurrentRoster only fires when the board is empty) -- this needs
  // the role-availability block on every team pick, not just the first
  // one, since a coach can clear the board and keep building against the
  // same team.
  useEffect(() => {
    if (!team) {
      setRoleBucketsAvailable({});
      return;
    }
    let cancelled = false;
    fetch(`/api/team-roster?sport=${sport}&team_id=${team.id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setRoleBucketsAvailable({
          starter: data.starter?.minutes != null,
          sixth_man: data.sixth_man?.minutes != null,
          role_player: data.role_player?.minutes != null,
          depth_piece: data.depth_piece?.minutes != null,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sport, team]);

  // Fetched once per sport, not per custom row -- this is season-aggregate
  // data (real averages by class year x team level x archetype x
  // position), the same for every custom/preset entry a coach adds. See
  // app/api/class-archetypes/route.ts and class_archetypes() in
  // projection.py.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/class-archetypes?sport=${sport}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setArchetypes(data as ClassArchetypes);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sport]);

  // team.sub is "<Tier> · <Conference>" (see app/api/search/route.ts) --
  // used to resolve which tier's real-data grid a custom/preset entry
  // pulls from, and to default the preset picker's label. A coach picks a
  // target team before adding a freshman/transfer to it, so there's
  // nothing extra to ask here.
  const targetTier = team?.sub?.split(" · ")[0];
  _teamTierForCurrentBuild = targetTier;

  async function loadCurrentRoster(teamId: number) {
    setRosterLoading(true);
    setRosterError(null);
    try {
      const res = await fetch(`/api/team-roster?sport=${sport}&team_id=${teamId}`);
      const data = await res.json();
      if (!res.ok) {
        setRosterError(data?.error ?? "Couldn't load that team's roster.");
        return;
      }
      const entries: RealEntry[] = (data.roster_roles ?? []).map(
        (r: {
          player_id: number;
          name: string;
          role: string | null;
          position: string | null;
          height: string | null;
          class_year: string | null;
          hoop_score: number | null;
          games: number | null;
        }) => ({
          kind: "real" as const,
          key: nextKey(),
          playerId: r.player_id,
          name: r.name,
          sub: r.role ?? "Unclassified",
          identity: {
            position: r.position, height: r.height, classYear: r.class_year,
            teamName: data.team_name, hoopScore: r.hoop_score, games: r.games,
          },
          role: r.role ? (CLASSIFIED_ROLE_TO_ROLE_NAME[r.role] ?? "") : "",
          minutes: "",
        })
      );
      setRoster(entries);
      setResult(null);
      setReport(null);
    } catch {
      setRosterError("Couldn't reach the site's search proxy -- try again.");
    } finally {
      setRosterLoading(false);
    }
  }

  function onPickTeam(p: Picked | null) {
    setTeam(p);
    setResult(null);
    setReport(null);
    if (p && roster.length === 0) {
      loadCurrentRoster(p.id);
    }
  }

  function addRealPlayer(p: Picked) {
    setRoster((prev) =>
      prev.length >= ROSTER_CAP || prev.some((e) => e.kind === "real" && e.playerId === p.id)
        ? prev
        : [
            ...prev,
            {
              kind: "real",
              key: nextKey(),
              playerId: p.id,
              name: p.label,
              // NOT p.sub here: the search proxy's `sub` string is
              // "{team} · {position}" (useful in the search dropdown
              // itself, before a player's added), and `identity` below
              // already carries position/height/class/team/Summit
              // separately -- RealRow's subLine joins [entry.sub, idLine],
              // so reusing p.sub here rendered position twice on the
              // roster row ("Team · G" then "G · Height · Class · Team ·
              // Summit" right after it). Leaving sub blank for a
              // search-added player lets subLine fall back to idLine
              // alone. Roster-loaded players (loadCurrentRoster above)
              // are unaffected -- their sub is a real role classification
              // ("Solidified Starter" etc.), not position, so it's
              // genuinely distinct info and stays.
              sub: "",
              identity: {
                position: p.position, height: p.height, classYear: p.classYear,
                teamName: p.teamName, hoopScore: p.hoopScore, games: p.games,
              },
              role: "",
              minutes: "",
            },
          ]
    );
    setAddKey((k) => k + 1);
    setResult(null);
    setReport(null);
  }

  function addCustom() {
    setRoster((prev) => (prev.length >= ROSTER_CAP ? prev : [...prev, blankCustom()]));
    setResult(null);
    setReport(null);
  }

  function removeEntry(key: string) {
    setRoster((prev) => prev.filter((e) => e.key !== key));
    setResult(null);
    setReport(null);
  }

  function updateEntry(key: string, patch: Partial<RealEntry> | Partial<CustomEntry>) {
    setRoster((prev) => prev.map((e) => (e.key === key ? ({ ...e, ...patch } as Entry) : e)));
    setResult(null);
    setReport(null);
  }

  // Converts a flagged real entry (no 2025-26 games) into a preset-backed
  // custom slot in place, same position in the roster list.
  function overrideEntry(key: string) {
    setRoster((prev) =>
      prev.map((e) => (e.key === key && e.kind === "real" ? convertToOverride(e) : e))
    );
    setResult(null);
    setReport(null);
  }

  function clearRoster() {
    setRoster([]);
    setResult(null);
    setReport(null);
  }

  // "Reset roles": every real player's role/exact-minutes override clears
  // back to Auto (rank-assigned into a starter/sixth-man/role-player/
  // depth-piece shape by the pool below, normalized into the 200-team-
  // minute build) -- a quick way to see what this exact group of players
  // would put up in a realistic minutes shape, before hand-tuning anyone's
  // role individually.
  function resetRoles() {
    setRoster((prev) =>
      prev.map((e) => (e.kind === "real" ? { ...e, role: "", minutes: "" } : e))
    );
    setResult(null);
    setReport(null);
  }

  // Auto used to mean "use this player's own real per-game minutes from
  // her actual current team, then proportionally rescale into the 200-
  // team-minute build" -- correct for one player in isolation, but on a
  // built-from-scratch roster it produces a flat, unrealistic shape: if
  // every real player added happened to average, say, 15-20 minutes on
  // her OWN real team, the whole "Auto" group comes out bunched in that
  // same range with no true starter (28-32 min) or true deep bench player
  // (under 10) -- reported directly against a GCU build where only one
  // Auto player cleared 20 minutes. A real team never looks like that
  // (see any team's live Stats Breakdown tab: a clear starting five, one
  // go-to bench player, then a taper to single digits -- team_roles() in
  // projection.py already models this exact shape for one real team's own
  // roster). This resolves it the same way a coach manually picking a
  // role per player already does -- by sending an explicit role string
  // per Auto player instead of leaving it blank -- just chosen
  // automatically by rank within the Auto pool (highest real Summit Score
  // first, since that's the best single signal on hand for "who should
  // start" among players pulled from different real teams) rather than
  // requiring the coach to assign each one by hand. The backend then
  // resolves each role to the TARGET team's own real calibrated minutes
  // for that bucket (team_roles(target_team_id) via role_translation,
  // the exact same real-data path an explicitly-picked role already
  // uses) -- no new backend logic, no fabricated numbers.
  //
  // Scoped to the Auto pool only: a player with an explicit role or exact
  // minutes override is left untouched, and this doesn't look at custom/
  // preset entries (their minutes already come from an explicitly-picked
  // entry-type/archetype tier, never Auto) -- so a custom "Day 1 Starter"
  // freshman and an Auto-ranked real starter aren't reconciled against
  // each other's slot; each pool gets a sensible shape on its own terms.
  //
  // A rank that lands on a bucket the TARGET team can't itself resolve
  // (roleBucketsAvailable above) is deliberately left unassigned rather
  // than sent anyway -- that player's request just carries no role, which
  // is exactly the original Auto behavior (her own real minutes), so a
  // thin/unusual target roster degrades one player's minutes shape
  // instead of failing her out of the build entirely.
  const ROLE_ORDER = ["starter", "sixth_man", "role_player", "depth_piece"] as const;
  function autoRoleAssignments(activeRoster: Entry[]): Map<string, (typeof ROLE_ORDER)[number]> {
    const pool = activeRoster.filter(
      (e): e is RealEntry => e.kind === "real" && !e.role && e.minutes.trim() === ""
    );
    const ranked = [...pool].sort(
      (a, b) => (b.identity?.hoopScore ?? -Infinity) - (a.identity?.hoopScore ?? -Infinity)
    );
    const assignments = new Map<string, (typeof ROLE_ORDER)[number]>();
    const starterCount = Math.min(5, ranked.length);
    const sixthManCount = ranked.length > starterCount ? 1 : 0;
    const remaining = ranked.length - starterCount - sixthManCount;
    const rolePlayerCount = Math.ceil(remaining / 2);
    ranked.forEach((e, i) => {
      let role: (typeof ROLE_ORDER)[number];
      if (i < starterCount) role = "starter";
      else if (i < starterCount + sixthManCount) role = "sixth_man";
      else if (i < starterCount + sixthManCount + rolePlayerCount) role = "role_player";
      else role = "depth_piece";
      if (roleBucketsAvailable[role]) assignments.set(e.key, role);
    });
    return assignments;
  }

  async function runBuild() {
    if (!team || roster.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    setReport(null);
    // Redshirted entries stay on the board (they still occupy a real
    // roster spot, see ROSTER_CAP above) but never reach the build --
    // they won't play this season, so they shouldn't touch the combined
    // total, the position mix, or the scouting report.
    const activeRoster = roster.filter((e) => !e.redshirt);
    const autoRoles = autoRoleAssignments(activeRoster);
    const players: BatchPlayerInput[] = activeRoster.map((e) => {
      if (e.kind === "real") {
        const input: BatchPlayerInput = { player_id: e.playerId };
        if (e.minutes.trim() !== "") input.minutes = Number(e.minutes);
        else if (e.role) input.role = e.role;
        else {
          const autoRole = autoRoles.get(e.key);
          if (autoRole) input.role = autoRole;
        }
        return input;
      }
      return {
        custom: {
          name: e.name.trim() || "Custom entry",
          class_year: e.classYear || undefined,
          position: e.position || undefined,
          minutes: Number(e.minutes) || 0,
          ppg: Number(e.ppg) || 0,
          rpg: Number(e.rpg) || 0,
          apg: Number(e.apg) || 0,
          bpg: e.bpg.trim() !== "" ? Number(e.bpg) : undefined,
          spg: e.spg.trim() !== "" ? Number(e.spg) : undefined,
          topg: e.topg.trim() !== "" ? Number(e.topg) : undefined,
          linked_player_id: e.linkedPlayerId,
          height: e.height.trim() || undefined,
          entry_type: e.entryType,
        },
      };
    });
    if (players.length === 0) {
      setSubmitError("Everyone on the board is marked as a redshirt -- add at least one active player before building.");
      setSubmitting(false);
      return;
    }
    try {
      const res = await fetch(`/api/team-builder?sport=${sport}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_team_id: team.id, players, normalize_minutes: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data?.error ?? "Couldn't build that roster.");
        return;
      }
      setResult(data as BatchBuildResult);
    } catch {
      setSubmitError("Couldn't reach the site's build proxy -- try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function runScoutingReport() {
    if (!team || !result) return;
    setReportLoading(true);
    setReportError(null);
    try {
      const res = await fetch(`/api/team-builder/scouting-report?sport=${sport}&target_team_id=${team.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.combined),
      });
      const data = await res.json();
      if (!res.ok) {
        setReportError(data?.error ?? "Couldn't build a scouting report for this roster.");
        return;
      }
      setReport(data as ScoutingReport);
    } catch {
      setReportError("Couldn't reach the site's scouting-report proxy -- try again.");
    } finally {
      setReportLoading(false);
    }
  }

  return (
    <div>
      <div className="card card-prose" style={{ maxWidth: 640 }}>
        <div className="field">
          <label htmlFor="builder-team-search">Target team (projection context -- schedule/rating this roster is judged against)</label>
          {team ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "8px 10px",
                background: "var(--bg-panel-2)",
              }}
            >
              <span style={{ fontWeight: 600 }}>{team.label}</span>
              <button
                type="button"
                onClick={() => onPickTeam(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-dim)", fontSize: "0.85rem" }}
              >
                Change ✕
              </button>
            </div>
          ) : (
            <SearchOnly sport={sport} kind="teams" inputId="builder-team-search" placeholder="e.g. Baylor" onPick={onPickTeam} />
          )}
        </div>

        {team && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <button type="button" className="btn" onClick={() => loadCurrentRoster(team.id)} disabled={rosterLoading}>
              {rosterLoading ? "Loading..." : `Load ${team.label}'s current roster`}
            </button>
            <button type="button" className="btn" onClick={resetRoles} disabled={roster.length === 0}>
              Reset roles to Auto
            </button>
            <button type="button" className="btn" onClick={clearRoster} disabled={roster.length === 0}>
              Clear roster
            </button>
          </div>
        )}
        {rosterError && <div className="error-box" style={{ marginTop: 12 }}>{rosterError}</div>}
        <p className="section-note" style={{ marginTop: 8, marginBottom: 0 }}>
          Team Builder projects this roster for the <strong>2026-27 season</strong>. Every real player&apos;s stats
          shown are their actual <strong>2025-26</strong> production (and earlier seasons on record, when available) --
          2026-27 hasn&apos;t happened yet. Loading a roster replaces everyone currently below with that team&apos;s
          actual current players (prefilled with their real role, e.g. Solidified Starter). &quot;Reset roles to
          Auto&quot; clears every role/exact-minutes override back to each player&apos;s own real usage. You can
          remove any of them, add players from any other team, or clear the board entirely and build from scratch.
          Class years shown after a build reflect the projected <strong>2026-27</strong> season (a real player&apos;s
          class advances one year from her current record; a Freshman/JUCO/Lower-Level Transfer entry is already
          entered at the class she&apos;d be entering as).
        </p>
      </div>

      {team && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>
            Roster ({roster.length}/{ROSTER_CAP})
            {roster.length >= ROSTER_CAP && (
              <span className="pill pill-warn" style={{ marginLeft: 8, fontSize: "0.7rem", verticalAlign: "middle" }}>
                Roster full
              </span>
            )}
          </h2>
          {roster.length === 0 && (
            <p className="section-note">Nothing on the board yet -- load a current roster above, or start adding players below.</p>
          )}
          {roster.some((e) => e.redshirt) && (
            <p className="section-note" style={{ marginTop: -4 }}>
              {roster.filter((e) => e.redshirt).length} player{roster.filter((e) => e.redshirt).length === 1 ? "" : "s"} marked
              redshirt -- still on the roster (counts toward the 15 cap) but excluded from the build, the position
              mix, and the scouting report since they won&apos;t play this season.
            </p>
          )}
          {roster.map((e) =>
            e.kind === "real" ? (
              <RealRow
                key={e.key}
                entry={e}
                onChange={(patch) => updateEntry(e.key, patch)}
                onRemove={() => removeEntry(e.key)}
                onOverride={() => overrideEntry(e.key)}
              />
            ) : (
              <CustomRow
                key={e.key}
                entry={e}
                archetypes={archetypes}
                teamTier={targetTier}
                onChange={(patch) => updateEntry(e.key, patch)}
                onRemove={() => removeEntry(e.key)}
              />
            )
          )}

          {roster.length >= ROSTER_CAP ? (
            <p className="section-note" style={{ marginTop: 16 }}>
              Roster is full ({ROSTER_CAP}/{ROSTER_CAP}) -- remove a player above to add another.
            </p>
          ) : (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 16 }}>
              <div className="field" style={{ flex: "1 1 260px" }}>
                <label htmlFor="builder-player-search">Add a player from any team</label>
                <SearchOnly key={addKey} sport={sport} kind="players" inputId="builder-player-search" placeholder="Search a player to add..." onPick={addRealPlayer} />
              </div>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <button type="button" className="btn" onClick={addCustom}>
                  + Add a freshman / transfer / custom entry
                </button>
              </div>
            </div>
          )}

          <button className="btn btn-primary" type="button" onClick={runBuild} disabled={roster.length === 0 || submitting} style={{ marginTop: 16 }}>
            {submitting ? "Building..." : "Build team"}
          </button>
          {submitError && <div className="error-box" style={{ marginTop: 12 }}>{submitError}</div>}
        </div>
      )}

      {result && (
        <ResultsCard
          sport={sport}
          result={result}
          onRunReport={runScoutingReport}
          reportLoading={reportLoading}
        />
      )}
      {reportError && <div className="error-box" style={{ marginTop: 12 }}>{reportError}</div>}
      {report && <ScoutingReportCard report={report} />}
      {result && <RosterMixCard result={result} />}
    </div>
  );
}

// "G · 5' 11" · SR · UConn · 98.1 Summit" -- built from whatever identity
// fields are actually available (a roster-loaded player has all of them
// from /teams/{id}/roles; a search-added player has whatever the search
// proxy returned; position specifically is null for a real chunk of the
// cache -- see ARCHITECTURE_HOSTING_PLAN.md's phase 19 note -- so this
// just skips any field that's missing rather than showing a row of
// "--"s). Returns "" (render nothing) when nothing at all is known.
function identityLine(identity?: PlayerIdentity): string {
  if (!identity) return "";
  const parts: string[] = [];
  if (identity.position) parts.push(identity.position);
  if (identity.height) parts.push(identity.height);
  if (identity.classYear) parts.push(identity.classYear);
  if (identity.teamName) parts.push(identity.teamName);
  if (identity.hoopScore != null) parts.push(`${identity.hoopScore} Summit`);
  return parts.join(" · ");
}

function RealRow({
  entry,
  onChange,
  onRemove,
  onOverride,
}: {
  entry: RealEntry;
  onChange: (patch: Partial<RealEntry>) => void;
  onRemove: () => void;
  onOverride: () => void;
}) {
  const idLine = identityLine(entry.identity);
  // Role and identity used to be two separate lines under the name (up to
  // 3 lines total per row before you even reach the controls) -- on a
  // phone-width screen where every row already wraps its select/input/
  // button onto their own line below, that meant 4+ lines per player and
  // only a couple of players visible without scrolling. Merged into one
  // "role · position · height · class · school · Summit" line so a roster
  // row is name + one subline, same info, roughly a third less height.
  const subLine = [entry.sub, idLine].filter(Boolean).join(" · ");
  // A real player already in the cache but with zero 2025-26 games (an
  // already-loaded signee/transfer with no production yet) can't be
  // projected by the model at all -- flag it and offer to convert this
  // row into a preset-backed slot instead of letting "Build team" fail on
  // her with an opaque error.
  const missingStats = entry.identity?.games === 0;
  return (
    <div
      className="roster-row"
      style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", opacity: entry.redshirt ? 0.6 : 1 }}
    >
      <div style={{ flex: "1 1 200px", minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{entry.name}</div>
        {subLine && (
          <div className="sub" style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>
            {subLine}
          </div>
        )}
        {missingStats && !entry.redshirt && (
          <div style={{ marginTop: 4, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span className="pill pill-warn">No 2025-26 stats</span>
            <button type="button" className="btn" onClick={onOverride} style={{ padding: "2px 8px", fontSize: "0.78rem" }}>
              Set a class/role average instead
            </button>
          </div>
        )}
        {entry.redshirt && (
          <div style={{ marginTop: 4 }}>
            <span className="pill pill-warn">Redshirt -- won&apos;t play, not counted</span>
          </div>
        )}
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.78rem", color: "var(--text-dim)" }}>
        <input type="checkbox" checked={!!entry.redshirt} onChange={(ev) => onChange({ redshirt: ev.target.checked })} />
        Redshirt
      </label>
      <select
        value={entry.role}
        onChange={(ev) => onChange({ role: ev.target.value })}
        disabled={entry.minutes.trim() !== "" || entry.redshirt}
        style={{ minWidth: 160 }}
      >
        <option value="">Auto (current minutes, scaled)</option>
        {ROLE_NAMES.map((r) => (
          <option key={r} value={r}>
            {roleLabel(r)}
          </option>
        ))}
      </select>
      <input
        type="number"
        min={0}
        max={40}
        step={0.5}
        placeholder="Exact min."
        value={entry.minutes}
        onChange={(ev) => onChange({ minutes: ev.target.value })}
        disabled={entry.redshirt}
        style={{ width: 90 }}
        title="Exact minutes overrides the role dropdown when set, and is kept fixed when the team's minutes get normalized to 200."
      />
      <button type="button" onClick={onRemove} className="btn" style={{ padding: "4px 10px" }} aria-label={`Remove ${entry.name}`}>
        Remove
      </button>
    </div>
  );
}

function CustomRow({
  entry,
  archetypes,
  teamTier,
  onChange,
  onRemove,
}: {
  entry: CustomEntry;
  archetypes: ClassArchetypes | null;
  teamTier?: string;
  onChange: (patch: Partial<CustomEntry>) => void;
  onRemove: () => void;
}) {
  const presetTier = teamTier && TEAM_TIERS.includes(teamTier as (typeof TEAM_TIERS)[number]) ? teamTier : undefined;
  const cell = presetTier ? resolveCell(archetypes, entry) : undefined;
  const line = presetLine(cell, entry.productionTier);
  const hasData = !!line && (line.player_count ?? 0) > 0;
  const positionMatched = !!cell && !!archetypes?.classes?.[entry.classYear]?.[presetTier ?? ""]?.[entry.archetype]
    ?.positions?.[entry.position];

  const entryTypeDef = ENTRY_TYPES.find((t) => t.key === entry.entryType) ?? ENTRY_TYPES[0];

  function applyPreset() {
    if (!line || !hasData) return;
    onChange({
      minutes: String(line.minutes ?? 0),
      ppg: String(line.ppg ?? 0),
      rpg: String(line.rpg ?? 0),
      apg: String(line.apg ?? 0),
      bpg: String(line.bpg ?? 0),
      spg: String(line.spg ?? 0),
      topg: String(line.topg ?? 0),
      // A preset click is the clearest "data has been entered" signal for
      // this row -- collapse it down to a one-line summary automatically
      // so a roster with several custom entries doesn't stay full of open
      // forms once they're filled in. Still just one click to expand and
      // fine-tune afterward.
      collapsed: true,
    });
  }

  // Minutes is never hand-typed for a preset-backed slot -- always follows
  // whatever the coach's selectors currently resolve to, so it can't drift
  // out of sync with a role/production tier picked afterward. Recomputed
  // whenever the resolved line changes (including the very first render,
  // so a freshly-added row isn't left at "Min: --" until a button click).
  useEffect(() => {
    if (line && hasData) {
      onChange({ minutes: String(line.minutes ?? 0) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line?.minutes, hasData]);

  function onEntryTypeChange(key: EntryTypeKey) {
    const def = ENTRY_TYPES.find((t) => t.key === key) ?? ENTRY_TYPES[0];
    const classYear = def.classYears.includes(entry.classYear) ? entry.classYear : def.classYears[0];
    onChange({ entryType: key, classYear });
  }

  const redshirtCheckbox = (
    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.78rem", color: "var(--text-dim)" }}>
      <input type="checkbox" checked={!!entry.redshirt} onChange={(ev) => onChange({ redshirt: ev.target.checked })} />
      Redshirt
    </label>
  );

  // Collapsed to a one-line summary (see CustomEntry.collapsed) -- a
  // full-height custom row is the tallest thing on the board, and this
  // reads roughly like a real-player row's density once the coach is done
  // entering/applying data. Click the chevron (or "Use these averages",
  // which auto-collapses) to get here; click it again to expand and edit.
  if (entry.collapsed) {
    const bits: string[] = [entryTypeDef.label, entry.classYear, entry.position];
    if (entry.height) bits.push(entry.height);
    if (entry.minutes) bits.push(`${entry.minutes} min`);
    if (entry.ppg || entry.rpg || entry.apg) bits.push(`${entry.ppg || 0}/${entry.rpg || 0}/${entry.apg || 0} ppg/rpg/apg`);
    return (
      <div className="roster-row roster-row-custom" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", opacity: entry.redshirt ? 0.6 : 1 }}>
        <button
          type="button"
          className="btn"
          onClick={() => onChange({ collapsed: false })}
          style={{ padding: "2px 8px" }}
          aria-label={`Expand ${entry.name || "custom entry"}`}
          title="Expand to edit"
        >
          ▸
        </button>
        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {entry.name || "Custom entry"}{" "}
            <span className="pill pill-warn" style={{ fontSize: "0.7rem", verticalAlign: "middle" }}>
              {entry.redshirt ? "Redshirt" : entry.linkedPlayerId ? "Preset override" : "Custom"}
            </span>
          </div>
          <div className="sub" style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>{bits.join(" · ")}</div>
        </div>
        {redshirtCheckbox}
        <button type="button" onClick={onRemove} className="btn" style={{ padding: "4px 10px" }} aria-label={`Remove ${entry.name || "custom entry"}`}>
          Remove
        </button>
      </div>
    );
  }

  return (
    <div className="roster-row roster-row-custom" style={{ opacity: entry.redshirt ? 0.6 : 1 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
        <span className="pill pill-warn">
          {entry.redshirt ? "Redshirt -- not counted" : entry.linkedPlayerId ? "Preset override" : "Custom / not modeled"}
        </span>
        {redshirtCheckbox}
        <input
          type="text"
          placeholder="Name (e.g. incoming freshman)"
          value={entry.name}
          onChange={(ev) => onChange({ name: ev.target.value })}
          style={{ flex: "1 1 200px" }}
          disabled={!!entry.linkedPlayerId}
        />
        <select
          value={entry.entryType}
          onChange={(ev) => onEntryTypeChange(ev.target.value as EntryTypeKey)}
          style={{ width: 200 }}
          aria-label="Entry type"
        >
          {ENTRY_TYPES.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
        <select
          value={entry.classYear}
          onChange={(ev) => onChange({ classYear: ev.target.value as ClassYearKey })}
          style={{ width: 90 }}
          aria-label="Entering class"
        >
          {entryTypeDef.classYears.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={entry.position} onChange={(ev) => onChange({ position: ev.target.value as (typeof POSITIONS)[number] })} style={{ width: 80 }}>
          {POSITIONS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Height (e.g. 6' 2&quot;)"
          value={entry.height}
          onChange={(ev) => onChange({ height: ev.target.value })}
          style={{ width: 120 }}
          aria-label="Height"
        />
        <button type="button" className="btn" onClick={() => onChange({ collapsed: true })} style={{ padding: "4px 10px" }}>
          Collapse
        </button>
        <button type="button" onClick={onRemove} className="btn" style={{ padding: "4px 10px" }} aria-label={`Remove ${entry.name || "custom entry"}`}>
          Remove
        </button>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 8,
          padding: "8px",
          background: "var(--bg-panel-2)",
          borderRadius: 6,
        }}
      >
        <span style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>
          Real {presetTier ?? ""} {entry.classYear} average:
        </span>
        <select
          value={entry.archetype}
          onChange={(ev) => onChange({ archetype: ev.target.value as FreshmanArchetypeKey })}
          style={{ width: 150 }}
          aria-label="Role/archetype"
          disabled={!presetTier}
        >
          {ARCHETYPE_KEYS.map((k) => (
            <option key={k} value={k}>
              {archetypes?.archetype_labels?.[k] ?? k}
            </option>
          ))}
        </select>
        <select
          value={entry.productionTier}
          onChange={(ev) => onChange({ productionTier: ev.target.value as ProductionTierKey })}
          style={{ width: 170 }}
          aria-label="Production tier"
          disabled={!presetTier || !cell?.tiers}
          title={!cell?.tiers ? "Not enough real players in this exact bucket to split into tiers -- using one blended average instead." : undefined}
        >
          {PRODUCTION_TIER_KEYS.map((k) => (
            <option key={k} value={k}>
              {archetypes?.production_tier_labels?.[k] ?? k}
            </option>
          ))}
        </select>
        <button type="button" className="btn" onClick={applyPreset} disabled={!hasData} style={{ padding: "4px 10px" }}>
          Use these averages
        </button>
        <span style={{ fontSize: "0.78rem", color: "var(--text-dim)" }}>
          {!presetTier
            ? "Pick a target team above to see real averages for its level."
            : !archetypes
              ? "Loading real averages..."
              : hasData
                ? `Real average of ${line!.player_count} actual ${entry.classYear}${
                    positionMatched ? ` ${entry.position}` : ""
                  } ${presetTier} players this season: ${line!.minutes} min, ${line!.ppg} ppg, ${line!.rpg} rpg, ${line!.apg} apg.${
                    !positionMatched ? " (no position-specific sample -- any position, same class/tier/role.)" : ""
                  }`
                : "No real players in this class/tier/archetype yet this season -- enter a line by hand below."}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", fontSize: "0.75rem", gap: 2 }}>
          Min
          <span style={{ fontWeight: 600, padding: "6px 4px" }} title="Minutes always follow the role/production tier picked above -- not hand-entered.">
            {entry.minutes || "--"}
          </span>
        </div>
        {(["ppg", "rpg", "apg", "bpg", "spg", "topg"] as const).map((field) => (
          <label key={field} style={{ display: "flex", flexDirection: "column", fontSize: "0.75rem", gap: 2, minWidth: "auto" }}>
            {field.toUpperCase()}
            <input
              type="number"
              min={0}
              step={0.1}
              value={entry[field]}
              onChange={(ev) => onChange({ [field]: ev.target.value } as Partial<CustomEntry>)}
              style={{ width: 64 }}
            />
          </label>
        ))}
      </div>
      <p className="section-note" style={{ marginTop: 6, marginBottom: 0 }}>
        This line is used exactly as entered -- no model, no Summit Score. Minutes always come from the role/
        production tier picked above; the other stat fields start from that same real average (still editable) and
        aren&apos;t a projection for this specific player.
      </p>
    </div>
  );
}

// "role:starter" -> "Starter" (via roleLabel, same helper the role
// dropdown uses, so this always matches the label a coach actually
// picked), "auto_projected" -> "Auto", "coach_override" -> "Exact
// minutes", "custom_entry" -> "Coach-entered" -- covers every
// minutes_source _core_projection()/_custom_player_result() can return.
function minutesSourceLabel(p: { is_custom?: boolean; minutes_source: string; role_applied?: { role: string } }): string {
  if (p.is_custom) return "Coach-entered";
  if (p.minutes_source.startsWith("role:") && p.role_applied) return roleLabel(p.role_applied.role);
  if (p.minutes_source === "coach_override") return "Exact minutes";
  if (p.minutes_source === "auto_projected") return "Auto";
  return p.minutes_source;
}

// Compact "2025-26: 14.8/3.1/2.2, Summit 65.3 · 2024-25: ... · 2023-24: ..."
// rendering of a real player's season history for the "Earlier Seasons"
// column. Two sources feed this, stitched together here rather than in
// the backend: career_history (projection.py's _career_prior_seasons(),
// every season STRICTLY BEFORE the site's current built season -- i.e.
// 2024-25 and earlier) is the fuller multi-year history, but on its own
// it skipped the player's actual most recent real season (2025-26) --
// that season is real production too, and now that Team Builder frames
// everything around projecting forward to 2026-27 (phase 26), 2025-26
// reads as an "earlier" season relative to that target, not "current."
// The player's 2025-26 line lives in the `current` block (ppg/rpg/apg/
// hoop_score, the same source "2025-26 Summit" already reads from), so
// it's synthesized into a leading PriorSeasonLine-shaped entry here and
// prepended -- no backend change needed, since every field this needs
// (season, current) is already on the batch result.
function careerHistoryLine(
  season: string | null | undefined,
  current: (Record<string, number> & { hoop_score?: number | null }) | null | undefined,
  history?: PriorSeasonLine[]
): string {
  const entries: PriorSeasonLine[] = [];
  if (season && current) {
    // team/games/bpg/spg/topg/ts_pct aren't rendered by the map below --
    // filled with placeholders only to satisfy PriorSeasonLine's shape.
    entries.push({
      season,
      team: "",
      games: 0,
      ppg: current.ppg ?? null,
      rpg: current.rpg ?? null,
      apg: current.apg ?? null,
      bpg: current.bpg ?? null,
      spg: current.spg ?? null,
      topg: current.topg ?? null,
      ts_pct: current.ts_pct ?? null,
      hoop_score: current.hoop_score ?? null,
      thin_sample: false,
    });
  }
  entries.push(...(history ?? []));
  if (entries.length === 0) return "--";
  return entries
    .map((s) => `${s.season}: ${s.ppg ?? "--"}/${s.rpg ?? "--"}/${s.apg ?? "--"}, Summit ${s.hoop_score ?? "--"}${s.thin_sample ? " (ltd)" : ""}`)
    .join(" · ");
}

function ResultsCard({
  sport,
  result,
  onRunReport,
  reportLoading,
}: {
  sport: string;
  result: BatchBuildResult;
  onRunReport: () => void;
  reportLoading: boolean;
}) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>Combined Team Total</h2>
      <p className="section-note">
        Projected against <strong>{result.target.team}</strong> ({result.target.tier}, {result.target.current_rating.toFixed(1)} rating).{" "}
        {result.combined.total_minutes_note}
      </p>
      {result.errors.length > 0 && (
        <div className="error-box" style={{ marginBottom: 12 }}>
          {result.errors.length} entr{result.errors.length === 1 ? "y" : "ies"} couldn&apos;t be projected:{" "}
          {result.errors.map((e) => e.error).join(" ")}
        </div>
      )}
      <div className="stat-grid">
        <div className="stat-tile">
          <div className="value">{result.combined.total_minutes}</div>
          <div className="label">Total Minutes</div>
        </div>
        {(["ppg", "rpg", "apg", "bpg", "spg", "topg"] as const).map((k) =>
          result.combined[k] != null ? (
            <div className="stat-tile" key={k}>
              <div className="value">{result.combined[k]}</div>
              <div className="label">{k.toUpperCase()}</div>
            </div>
          ) : null
        )}
      </div>

      <h2 style={{ marginTop: 20 }}>Roster Breakdown</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Pos / Ht / Class</th>
              <th>Minutes source</th>
              <th>Proj. minutes</th>
              <th>Proj. line (2026-27)</th>
              <th>2025-26 Summit</th>
              <th>Proj. Summit</th>
              <th>Earlier Seasons</th>
              <th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {result.players.map((p, i) => {
              const currentSummit = (p.current as { hoop_score?: number | null } | null)?.hoop_score;
              return (
                <tr key={p.player.id ?? `custom-${i}`}>
                  <td>
                    {p.player.id ? (
                      <Link href={`/${sport}/players/${p.player.id}`}>{p.player.name}</Link>
                    ) : (
                      <>
                        {p.player.name} <span className="pill pill-warn">custom</span>
                      </>
                    )}
                    {p.player.current_team && <div className="sub" style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>{p.player.current_team}</div>}
                  </td>
                  <td>
                    {(() => {
                      const parts = [p.player.position, p.player.height].filter(Boolean) as string[];
                      const classText = p.is_custom
                        ? p.player.class_year
                          ? `${p.player.class_year}${
                              p.player.entry_type && ENTRY_TYPE_TABLE_LABEL[p.player.entry_type as EntryTypeKey]
                                ? ` (${ENTRY_TYPE_TABLE_LABEL[p.player.entry_type as EntryTypeKey]})`
                                : ""
                            }`
                          : null
                        : advanceClassYear(p.player.class_year) !== "--"
                          ? advanceClassYear(p.player.class_year)
                          : null;
                      if (classText) parts.push(classText);
                      return parts.length ? parts.join(" / ") : "--";
                    })()}
                  </td>
                  <td>{minutesSourceLabel(p)}</td>
                  <td>{p.projected.minutes?.toFixed?.(1) ?? p.projected.minutes}</td>
                  <td>
                    {p.projected.ppg ?? "--"} ppg, {p.projected.rpg ?? "--"} rpg, {p.projected.apg ?? "--"} apg
                  </td>
                  <td>{currentSummit != null ? currentSummit : "--"}</td>
                  <td>{p.projected.hoop_score != null ? p.projected.hoop_score : "--"}</td>
                  <td style={{ fontSize: "0.85rem" }}>{careerHistoryLine(p.player.season, p.current, p.career_history)}</td>
                  <td>
                    <span className={p.extreme_mismatch ? "pill pill-warn" : "pill pill-good"}>{p.confidence}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="section-note" style={{ marginTop: 8, marginBottom: 0 }}>
        &quot;2025-26 Summit&quot; and &quot;Earlier Seasons&quot; are this player&apos;s actual real production, not
        projections -- there&apos;s no 2026-27 data yet. &quot;Proj. Summit&quot; is the only Summit Score number here
        that reflects the target team above; a custom/preset entry has neither. A real player&apos;s class year is
        advanced one year from her current record to match the 2026-27 season this roster is built for; a Freshman/
        JUCO/Lower-Level Transfer entry&apos;s class is shown exactly as entered (already her entering class), with
        the entry type noted alongside it.
      </p>
      <button type="button" className="btn btn-primary" onClick={onRunReport} disabled={reportLoading} style={{ marginTop: 12 }}>
        {reportLoading ? "Building scouting report..." : "Generate scouting report"}
      </button>
    </div>
  );
}

// A typical starting 5 splits roughly 2 guards / 2 forwards / 1 center --
// 40% / 40% / 20% of the floor. Used as the reference point for the
// Roster Mix report below: not a hard rule (plenty of real, successful
// lineups deviate from it), just a plain-language baseline for "guard
// heavy" / "forward heavy" / "thin at center" framing. A share within 8
// points of its target reads as balanced; further off reads as heavy or
// thin.
const POSITION_MIX_TARGET: Record<(typeof POSITIONS)[number], number> = { G: 40, F: 40, C: 20 };
const POSITION_MIX_TOLERANCE = 8;

// Position-balance check for a just-built roster ("guard heavy," "thin at
// center," etc.) plus a couple of plain suggestions -- computed entirely
// client-side from data the build result already carries (`p.player.
// position`, `p.projected.minutes`), no extra fetch needed. Weighted by
// projected minutes rather than a flat headcount, since a true center who
// plays 4 minutes a game doesn't offset a real shortage of center
// minutes the way one who plays 28 does. Real position data is a known
// sparse column site-wide (see class_archetypes()'s docstring in
// projection.py) -- any player with no position on record is counted and
// shown separately rather than silently dropped or guessed at.
function RosterMixCard({ result }: { result: BatchBuildResult }) {
  const minutesByPos: Record<(typeof POSITIONS)[number], number> = { G: 0, F: 0, C: 0 };
  const countByPos: Record<(typeof POSITIONS)[number], number> = { G: 0, F: 0, C: 0 };
  let unknownCount = 0;
  for (const p of result.players) {
    const rawPos = p.player.position;
    const pos = rawPos && (POSITIONS as readonly string[]).includes(rawPos) ? (rawPos as (typeof POSITIONS)[number]) : null;
    const minutes = typeof p.projected.minutes === "number" ? p.projected.minutes : 0;
    if (pos) {
      minutesByPos[pos] += minutes;
      countByPos[pos] += 1;
    } else {
      unknownCount += 1;
    }
  }
  const totalKnownMinutes = POSITIONS.reduce((sum, pos) => sum + minutesByPos[pos], 0);

  if (totalKnownMinutes <= 0) {
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <h2>Roster Mix</h2>
        <p className="section-note">
          No player on this build has a recorded position, so a guard/forward/center mix can&apos;t be computed for
          this roster.
        </p>
      </div>
    );
  }

  const rows = POSITIONS.map((pos) => {
    const share = (minutesByPos[pos] / totalKnownMinutes) * 100;
    const diff = share - POSITION_MIX_TARGET[pos];
    const status: "heavy" | "thin" | "balanced" =
      diff > POSITION_MIX_TOLERANCE ? "heavy" : diff < -POSITION_MIX_TOLERANCE ? "thin" : "balanced";
    return { pos, share, status, count: countByPos[pos] };
  });

  const posLabel: Record<(typeof POSITIONS)[number], string> = { G: "Guards", F: "Forwards", C: "Centers" };
  const thin = rows.filter((r) => r.status === "thin");
  const heavy = rows.filter((r) => r.status === "heavy");
  const suggestions: string[] = [];
  for (const r of thin) {
    suggestions.push(
      `Thin at ${posLabel[r.pos].toLowerCase()} (${r.share.toFixed(0)}% of known-position minutes, vs. a typical ~${
        POSITION_MIX_TARGET[r.pos]
      }%) -- consider adding a ${r.pos} via search, or a Freshman/JUCO/Lower-Level Transfer entry set to that position.`
    );
  }
  if (heavy.length > 0 && thin.length > 0) {
    suggestions.push(
      `${heavy.map((r) => posLabel[r.pos]).join(" and ")} ${
        heavy.length === 1 ? "is" : "are"
      } carrying more of the floor than usual -- some of that could shift toward ${thin
        .map((r) => posLabel[r.pos].toLowerCase())
        .join(" and ")} if a better-balanced rotation is the goal.`
    );
  }
  if (thin.length === 0 && heavy.length === 0) {
    suggestions.push("This roster's guard/forward/center minutes split is close to a typical balanced rotation.");
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>Roster Mix</h2>
      <p className="section-note">
        Guard/forward/center split of this build&apos;s projected minutes, weighted by playing time (not just a
        headcount) -- compared against a typical ~40/40/20 starting-lineup baseline.
        {unknownCount > 0 &&
          ` ${unknownCount} player${unknownCount === 1 ? " has" : "s have"} no position on record and ${
            unknownCount === 1 ? "isn't" : "aren't"
          } counted here.`}
      </p>
      <div className="stat-grid">
        {rows.map((r) => (
          <div className="stat-tile" key={r.pos}>
            <div className="value">{r.share.toFixed(0)}%</div>
            <div className="label">
              {posLabel[r.pos]} ({r.count})
              {r.status !== "balanced" && (
                <>
                  {" "}
                  <span className={r.status === "thin" ? "pill pill-warn" : "pill pill-good"} style={{ fontSize: "0.65rem" }}>
                    {r.status === "thin" ? "Thin" : "Heavy"}
                  </span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <ul style={{ marginTop: 12, marginBottom: 0, paddingLeft: 20 }}>
        {suggestions.map((s, i) => (
          <li key={i} className="section-note" style={{ marginBottom: 4 }}>
            {s}
          </li>
        ))}
      </ul>
    </div>
  );
}

// A minimal 3-series (built roster / national average / target team)
// horizontal bar per category -- each bar's width is relative to the
// largest of the 3 values in that row, so every category is readable
// regardless of its own scale (points vs. turnovers vs. blocks). Every
// row carries its own series name and a color swatch (not just a color),
// so a row is identifiable on its own -- the original version left the
// national-average/target-team rows unlabeled and relied entirely on a
// separate legend line above the whole chart, whose manual pixel-margin
// alignment to the category-label column broke as soon as a label was a
// different width, and even lined up correctly it asked a reader to hold
// 3 colors in mind across a dozen category groups.
function CategoryBar({ seriesLabel, value, max, color }: { seriesLabel: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.78rem" }}>
      <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} aria-hidden="true" />
      <div
        style={{ width: 108, color: "var(--text-dim)", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        title={seriesLabel}
      >
        {seriesLabel}
      </div>
      <div style={{ flex: 1, background: "var(--bg-panel-2)", borderRadius: 4, height: 10, position: "relative" }}>
        <div style={{ width: `${pct}%`, background: color, height: "100%", borderRadius: 4 }} />
      </div>
      <div style={{ width: 44, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function ScoutingReportCard({ report }: { report: ScoutingReport }) {
  const pr = report.projected_record;
  // Round wins and losses for display (a coach wants "15-14", not
  // "14.9-14.1") -- losses is derived as games minus rounded wins rather
  // than independently rounded, so the two always add back up to the real
  // games-considered count instead of occasionally landing a game off
  // (e.g. 14.9 + 14.1 independently rounding to 15 + 14 = 29 is fine, but
  // 14.5 + 14.5 would round to 15 + 15 = 30, one more game than was
  // actually played).
  const roundedWins = pr ? Math.round(pr.projected_wins) : 0;
  const roundedLosses = pr ? pr.games_considered - roundedWins : 0;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>Scouting Report</h2>
      <p className="section-note">{report.note}</p>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h3 style={{ marginBottom: 6 }}>Strengths</h3>
          {report.strengths.map((c) => (
            <div key={c.stat} className="pill pill-good" style={{ marginRight: 6, marginBottom: 6, display: "inline-block" }}>
              {c.label} ({c.z != null && c.z > 0 ? "+" : ""}{c.z})
            </div>
          ))}
        </div>
        <div>
          <h3 style={{ marginBottom: 6 }}>Needs</h3>
          {report.weaknesses.map((c) => (
            <div key={c.stat} className="pill pill-warn" style={{ marginRight: 6, marginBottom: 6, display: "inline-block" }}>
              {c.label} ({c.z != null && c.z > 0 ? "+" : ""}{c.z})
            </div>
          ))}
        </div>
      </div>

      <h3>vs. 2025-26 National Average &amp; {report.target_team}</h3>
      <p className="section-note" style={{ marginTop: -2 }}>
        Each category below shows three bars: this built roster, the 2025-26 national average, and{" "}
        {report.target_team}&apos;s own real production.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {report.categories.map((c) => {
          const values = [c.built_value, c.national_mean ?? 0, c.target_team_value ?? 0];
          const max = Math.max(...values, 1);
          return (
            <div
              key={c.stat}
              style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px" }}
            >
              <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: 8 }}>{c.label}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <CategoryBar seriesLabel="This roster" value={c.built_value} max={max} color="var(--green-light)" />
                {c.national_mean != null && (
                  <CategoryBar seriesLabel="National avg" value={c.national_mean} max={max} color="var(--text-dim)" />
                )}
                {c.target_team_value != null && (
                  <CategoryBar seriesLabel={report.target_team} value={c.target_team_value} max={max} color="var(--gold)" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {pr && (
        <>
          <h3 style={{ marginTop: 20 }}>Projected Record ({pr.season_used} schedule)</h3>
          <div className="stat-grid">
            <div className="stat-tile">
              <div className="value">{roundedWins}</div>
              <div className="label">Proj. Wins</div>
            </div>
            <div className="stat-tile">
              <div className="value">{roundedLosses}</div>
              <div className="label">Proj. Losses</div>
            </div>
            <div className="stat-tile">
              <div className="value">{pr.games_considered}</div>
              <div className="label">Games</div>
            </div>
          </div>
          <p className="section-note" style={{ marginTop: 8 }}>{pr.note}</p>
        </>
      )}
    </div>
  );
}

// Typeahead's "select" mode is built around a <form>'s hidden field, which
// this page doesn't have -- reimplements just the query/results/pick
// interaction against the same /api/search proxy, but calls back
// directly. Same pattern as BatchBuilder.tsx's SearchOnly (kept as a
// separate copy rather than a shared export -- both are small and each
// page's onPick shape differs slightly).
function SearchOnly({
  sport,
  kind,
  inputId,
  placeholder,
  onPick,
}: {
  sport: string;
  kind: "players" | "teams";
  inputId: string;
  placeholder: string;
  onPick: (p: Picked) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    {
      id: number;
      label: string;
      sub: string;
      position?: string | null;
      height?: string | null;
      classYear?: string | null;
      teamName?: string | null;
      hoopScore?: number | null;
      games?: number | null;
    }[]
  >([]);
  const [open, setOpen] = useState(false);

  async function onChange(v: string) {
    setQuery(v);
    if (v.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    try {
      const res = await fetch(`/api/search?sport=${sport}&kind=${kind}&q=${encodeURIComponent(v.trim())}`);
      const data = await res.json();
      setResults(data.results ?? []);
      setOpen(true);
    } catch {
      setResults([]);
    }
  }

  return (
    <div className="typeahead" style={{ position: "relative" }}>
      <input
        id={inputId}
        type="text"
        placeholder={placeholder}
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        autoComplete="off"
        style={{ width: "100%" }}
      />
      {open && results.length > 0 && (
        <div className="typeahead-results">
          {results.map((r) => (
            <button
              type="button"
              key={r.id}
              className="typeahead-option"
              onMouseDown={(e) => {
                e.preventDefault();
                onPick({
                  id: r.id, label: r.label, sub: r.sub,
                  position: r.position, height: r.height, classYear: r.classYear,
                  teamName: r.teamName, hoopScore: r.hoopScore, games: r.games,
                });
                setQuery("");
                setResults([]);
                setOpen(false);
              }}
            >
              {r.label}
              <div className="sub">{r.sub}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
