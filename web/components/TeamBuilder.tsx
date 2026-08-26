"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ROLE_NAMES,
  roleLabel,
  type BatchBuildResult,
  type BatchPlayerInput,
  type FreshmanArchetypeKey,
  type FreshmanArchetypes,
} from "@/lib/types";

const FRESHMAN_ARCHETYPE_KEYS: FreshmanArchetypeKey[] = ["day1_starter", "role_player", "depth_piece"];
const FRESHMAN_TIERS = ["High-Major", "Mid-Major", "Low-Major"] as const;

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
}

// Position/height/class/current Summit Score/school -- shown as a small
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
}

interface CustomEntry {
  kind: "custom";
  key: string;
  name: string;
  classYear: string;
  position: string;
  minutes: string;
  ppg: string;
  rpg: string;
  apg: string;
  bpg: string;
  spg: string;
  topg: string;
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
    classYear: "FR",
    position: "G",
    minutes: "",
    ppg: "",
    rpg: "",
    apg: "",
    bpg: "",
    spg: "",
    topg: "",
  };
}

/**
 * Roster Lab: pick one real team as the projection context (its rating
 * is what every real roster player's strength-gap and role-minutes are
 * resolved against, same as /project's target_team_id), then assemble a
 * roster against it -- start from that team's actual current players
 * (prefilled with their real classified role), remove/add freely, add any
 * other team's players, and/or add freeform "custom" slots for an
 * incoming freshman or anyone else with no real season in the cache. See
 * app/api/team-builder/route.ts and POST /project/batch's `custom`
 * support (projection.py's _custom_player_result) for how a custom slot's
 * coach-entered line flows through unmodeled, clearly labeled, alongside
 * every real player's actual model-backed projection.
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
  const [archetypes, setArchetypes] = useState<FreshmanArchetypes | null>(null);

  // Fetched once per sport, not per custom row -- this is season-aggregate
  // data (real freshman averages by team level x archetype), the same for
  // every custom entry a coach adds. See app/api/freshman-archetypes/
  // route.ts and freshman_archetypes() in projection.py.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/freshman-archetypes?sport=${sport}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setArchetypes(data as FreshmanArchetypes);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sport]);

  // team.sub is "<Tier> · <Conference>" (see app/api/search/route.ts) --
  // used only to default the archetype picker's team-level dropdown to the
  // target team's own level; the coach can still pick a different level.
  const targetTier = team?.sub?.split(" · ")[0];

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
        }) => ({
          kind: "real" as const,
          key: nextKey(),
          playerId: r.player_id,
          name: r.name,
          sub: r.role ?? "Unclassified",
          identity: {
            position: r.position, height: r.height, classYear: r.class_year,
            teamName: data.team_name, hoopScore: r.hoop_score,
          },
          role: r.role ? (CLASSIFIED_ROLE_TO_ROLE_NAME[r.role] ?? "") : "",
          minutes: "",
        })
      );
      setRoster(entries);
      setResult(null);
    } catch {
      setRosterError("Couldn't reach the site's search proxy -- try again.");
    } finally {
      setRosterLoading(false);
    }
  }

  function onPickTeam(p: Picked | null) {
    setTeam(p);
    setResult(null);
    if (p && roster.length === 0) {
      loadCurrentRoster(p.id);
    }
  }

  function addRealPlayer(p: Picked) {
    setRoster((prev) =>
      prev.some((e) => e.kind === "real" && e.playerId === p.id)
        ? prev
        : [
            ...prev,
            {
              kind: "real",
              key: nextKey(),
              playerId: p.id,
              name: p.label,
              sub: p.sub,
              identity: {
                position: p.position, height: p.height, classYear: p.classYear,
                teamName: p.teamName, hoopScore: p.hoopScore,
              },
              role: "",
              minutes: "",
            },
          ]
    );
    setAddKey((k) => k + 1);
    setResult(null);
  }

  function addCustom() {
    setRoster((prev) => [...prev, blankCustom()]);
    setResult(null);
  }

  function removeEntry(key: string) {
    setRoster((prev) => prev.filter((e) => e.key !== key));
    setResult(null);
  }

  function updateEntry(key: string, patch: Partial<RealEntry> | Partial<CustomEntry>) {
    setRoster((prev) => prev.map((e) => (e.key === key ? ({ ...e, ...patch } as Entry) : e)));
    setResult(null);
  }

  function clearRoster() {
    setRoster([]);
    setResult(null);
  }

  async function runBuild() {
    if (!team || roster.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    const players: BatchPlayerInput[] = roster.map((e) => {
      if (e.kind === "real") {
        const input: BatchPlayerInput = { player_id: e.playerId };
        if (e.minutes.trim() !== "") input.minutes = Number(e.minutes);
        else if (e.role) input.role = e.role;
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
        },
      };
    });
    try {
      const res = await fetch(`/api/team-builder?sport=${sport}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_team_id: team.id, players }),
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
            <button type="button" className="btn" onClick={clearRoster} disabled={roster.length === 0}>
              Clear roster
            </button>
          </div>
        )}
        {rosterError && <div className="error-box" style={{ marginTop: 12 }}>{rosterError}</div>}
        <p className="section-note" style={{ marginTop: 8, marginBottom: 0 }}>
          Loading a roster replaces everyone currently below with that team's actual current players (prefilled with
          their real role, e.g. Solidified Starter). You can remove any of them, add players from any other team, or
          clear the board entirely and build from scratch.
        </p>
      </div>

      {team && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Roster ({roster.length})</h2>
          {roster.length === 0 && (
            <p className="section-note">Nothing on the board yet -- load a current roster above, or start adding players below.</p>
          )}
          {roster.map((e) =>
            e.kind === "real" ? (
              <RealRow key={e.key} entry={e} onChange={(patch) => updateEntry(e.key, patch)} onRemove={() => removeEntry(e.key)} />
            ) : (
              <CustomRow
                key={e.key}
                entry={e}
                archetypes={archetypes}
                defaultTier={targetTier}
                onChange={(patch) => updateEntry(e.key, patch)}
                onRemove={() => removeEntry(e.key)}
              />
            )
          )}

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 16 }}>
            <div className="field" style={{ flex: "1 1 260px" }}>
              <label htmlFor="builder-player-search">Add a player from any team</label>
              <SearchOnly key={addKey} sport={sport} kind="players" inputId="builder-player-search" placeholder="Search a player to add..." onPick={addRealPlayer} />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button type="button" className="btn" onClick={addCustom}>
                + Add a freshman / custom entry
              </button>
            </div>
          </div>

          <button className="btn btn-primary" type="button" onClick={runBuild} disabled={roster.length === 0 || submitting} style={{ marginTop: 16 }}>
            {submitting ? "Building..." : "Build team"}
          </button>
          {submitError && <div className="error-box" style={{ marginTop: 12 }}>{submitError}</div>}
        </div>
      )}

      {result && <ResultsCard sport={sport} result={result} />}
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

function RealRow({ entry, onChange, onRemove }: { entry: RealEntry; onChange: (patch: Partial<RealEntry>) => void; onRemove: () => void }) {
  const idLine = identityLine(entry.identity);
  // Role and identity used to be two separate lines under the name (up to
  // 3 lines total per row before you even reach the controls) -- on a
  // phone-width screen where every row already wraps its select/input/
  // button onto their own line below, that meant 4+ lines per player and
  // only a couple of players visible without scrolling. Merged into one
  // "role · position · height · class · school · Summit" line so a roster
  // row is name + one subline, same info, roughly a third less height.
  const subLine = [entry.sub, idLine].filter(Boolean).join(" · ");
  return (
    <div className="roster-row" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 200px", minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{entry.name}</div>
        {subLine && (
          <div className="sub" style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>
            {subLine}
          </div>
        )}
      </div>
      <select value={entry.role} onChange={(ev) => onChange({ role: ev.target.value })} disabled={entry.minutes.trim() !== ""} style={{ minWidth: 160 }}>
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
        style={{ width: 90 }}
        title="Exact minutes overrides the role dropdown when set."
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
  defaultTier,
  onChange,
  onRemove,
}: {
  entry: CustomEntry;
  archetypes: FreshmanArchetypes | null;
  defaultTier?: string;
  onChange: (patch: Partial<CustomEntry>) => void;
  onRemove: () => void;
}) {
  const [presetArchetype, setPresetArchetype] = useState<FreshmanArchetypeKey>("role_player");

  // Team level is no longer a separate choice -- it's always the already-
  // picked target team's own tier (a coach picks a team before adding a
  // freshman to it, so there's nothing to ask here). If somehow no tier
  // can be resolved (defaultTier missing or not one of the 3 real tiers --
  // shouldn't happen once a team is picked, but guarded anyway), the
  // preset picker just has nothing to offer rather than falling back to a
  // silently-wrong league default.
  const presetTier = defaultTier && FRESHMAN_TIERS.includes(defaultTier as (typeof FRESHMAN_TIERS)[number]) ? defaultTier : undefined;
  const cell = presetTier ? archetypes?.tiers?.[presetTier]?.[presetArchetype] : undefined;
  const hasData = !!cell && cell.player_count > 0;

  function applyPreset() {
    if (!cell || !hasData) return;
    onChange({
      minutes: String(cell.minutes ?? 0),
      ppg: String(cell.ppg ?? 0),
      rpg: String(cell.rpg ?? 0),
      apg: String(cell.apg ?? 0),
      bpg: String(cell.bpg ?? 0),
      spg: String(cell.spg ?? 0),
      topg: String(cell.topg ?? 0),
    });
  }

  return (
    <div className="roster-row roster-row-custom">
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
        <span className="pill pill-warn">Custom / not modeled</span>
        <input
          type="text"
          placeholder="Name (e.g. incoming freshman)"
          value={entry.name}
          onChange={(ev) => onChange({ name: ev.target.value })}
          style={{ flex: "1 1 200px" }}
        />
        <select value={entry.classYear} onChange={(ev) => onChange({ classYear: ev.target.value })} style={{ width: 90 }}>
          {["FR", "SO", "JR", "SR"].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={entry.position} onChange={(ev) => onChange({ position: ev.target.value })} style={{ width: 80 }}>
          {["G", "F", "C"].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
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
          Start from a real {presetTier ?? ""} freshman archetype:
        </span>
        <select
          value={presetArchetype}
          onChange={(ev) => setPresetArchetype(ev.target.value as FreshmanArchetypeKey)}
          style={{ width: 150 }}
          aria-label="Freshman archetype"
          disabled={!presetTier}
        >
          {FRESHMAN_ARCHETYPE_KEYS.map((k) => (
            <option key={k} value={k}>
              {archetypes?.labels?.[k] ?? k}
            </option>
          ))}
        </select>
        <button type="button" className="btn" onClick={applyPreset} disabled={!hasData} style={{ padding: "4px 10px" }}>
          Use these averages
        </button>
        <span style={{ fontSize: "0.78rem", color: "var(--text-dim)" }}>
          {!presetTier
            ? "Pick a target team above to see real freshman averages for its level."
            : !archetypes
              ? "Loading real freshman averages..."
              : hasData
                ? `Real average of ${cell!.player_count} actual ${presetTier} freshmen this season: ${cell!.minutes} min, ${cell!.ppg} ppg, ${cell!.rpg} rpg, ${cell!.apg} apg.`
                : "No real freshmen in this tier/archetype yet this season -- enter a line by hand below."}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(["minutes", "ppg", "rpg", "apg", "bpg", "spg", "topg"] as const).map((field) => (
          <label key={field} style={{ display: "flex", flexDirection: "column", fontSize: "0.75rem", gap: 2, minWidth: "auto" }}>
            {field === "minutes" ? "Min" : field.toUpperCase()}
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
        This line is used exactly as entered -- no model, no Summit Score. The preset above fills in a real
        historical average as a starting point (still editable); it isn't a projection for this specific player
        either.
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

function ResultsCard({ sport, result }: { sport: string; result: BatchBuildResult }) {
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
              <th>Proj. line</th>
              <th>Current Summit</th>
              <th>Proj. Summit</th>
              <th>Previous Season</th>
              <th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {result.players.map((p, i) => {
              const prev = p.previous_season;
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
                    {[p.player.position, p.player.height, p.player.class_year].filter(Boolean).join(" / ") || "--"}
                  </td>
                  <td>{minutesSourceLabel(p)}</td>
                  <td>{p.projected.minutes?.toFixed?.(1) ?? p.projected.minutes}</td>
                  <td>
                    {p.projected.ppg ?? "--"} ppg, {p.projected.rpg ?? "--"} rpg, {p.projected.apg ?? "--"} apg
                  </td>
                  <td>{currentSummit != null ? currentSummit : "--"}</td>
                  <td>{p.projected.hoop_score != null ? p.projected.hoop_score : "--"}</td>
                  <td style={{ fontSize: "0.85rem" }}>
                    {prev ? (
                      <>
                        {prev.season} ({prev.team}): {prev.ppg ?? "--"}/{prev.rpg ?? "--"}/{prev.apg ?? "--"}, Summit{" "}
                        {prev.hoop_score ?? "--"}
                        {prev.thin_sample && <span> (limited sample)</span>}
                      </>
                    ) : (
                      "--"
                    )}
                  </td>
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
        &quot;Current Summit&quot; and &quot;Previous Season&quot; are this player&apos;s actual real production -- not
        projections. &quot;Proj. Summit&quot; is the only Summit Score number here that reflects the target team above;
        a custom/coach-entered entry has neither a current nor a previous real season on record.
      </p>
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
                  teamName: r.teamName, hoopScore: r.hoopScore,
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
