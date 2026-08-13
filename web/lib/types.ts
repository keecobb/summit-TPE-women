// Mirrors claude/API_REFERENCE.md. Kept intentionally close to the raw
// API response shapes rather than remapped/renamed, so this file stays
// easy to diff against the API docs as the backend evolves.

// Canonical tier values (mirrors summit_calc.py's TIERS/TIER_ABBREV) --
// renamed from "P5" to "High-Major" at the user's request. The backend
// still accepts "P5" as a query-param alias, but every stored/returned
// tier value and every place this site sends a tier as a filter uses the
// canonical form below.
export const TIERS = ["High-Major", "Mid-Major", "Low-Major"] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_ABBREV: Record<string, string> = {
  "High-Major": "HM",
  "Mid-Major": "MM",
  "Low-Major": "LM",
  // Old data/links may still say "P5" -- display it the same as High-Major
  // rather than showing a raw, unrecognized abbreviation.
  P5: "HM",
};

// Short abbreviation (HM/MM/LM) for a tier string, for compact display in
// tables/pills. Falls back to the raw value for anything unrecognized.
export function tierAbbrev(tier: string | null | undefined): string {
  if (!tier) return "--";
  return TIER_ABBREV[tier] ?? tier;
}

export interface Team {
  team_id: number;
  name: string;
  division: string;
  conference: string;
  tier: string;
  current_rating: number;
  sos: number;
}

export interface Player {
  player_id: number;
  name: string;
  height?: string | null;
  team_id: number;
  team_name?: string;
  tier?: string;
  position: string;
  class_year: string;
  games: number;
  ppg: number;
  rpg: number;
  apg: number;
  bpg: number;
  spg: number;
  topg: number;
  hoop_score: number;
  total_minutes?: number | null;
  // 1 when this player's season fell below the games/minutes floor for a
  // full profile (see build_cache.py) -- she's still shown (that's the
  // whole point: every rostered player is findable), but the numbers are a
  // small, noisier sample and the UI should say so rather than presenting
  // them at face value.
  thin_sample?: number | boolean;
}

// Full row from GET /players/{id} -- ts_pct/fg_pct here are raw fractions
// (0-1), unlike the list endpoint and /project where they're already *100.
export interface PlayerDetail extends Player {
  division: string;
  season: string;
  avg_minutes: number;
  ts_pct: number;
  fg_pct: number;
  per40_pts: number;
  per40_reb: number;
  per40_ast: number;
  per40_blk: number;
  per40_stl: number;
  per40_tov: number;
  hoop_score_raw: number;
  in_transfer_portal: number | null;
  team_tier?: string;
  // "Top X%" nationally by hoop_score_raw -- see API_REFERENCE.md.
  national_percentile?: number | null;
}

export interface TeamRoles {
  team_id: number;
  team_name: string;
  roster_size: number;
  starter: { minutes: number; player_count: number } | null;
  sixth_man: { minutes: number } | null;
  role_player: { minutes: number; range: [number, number]; note?: string } | null;
  depth_piece: { minutes: number; player_count: number } | null;
}

export interface TeamNeedCategory {
  stat: string;
  label: string;
  team_value: number;
  league_mean: number;
  z: number;
  conference_mean: number | null;
}

export interface TeamNeeds {
  team_id: number;
  team_name: string;
  roster_size: number;
  level: string | null;
  teams_compared: number | null;
  comparison_group: string;
  conference: string | null;
  teams_in_conference: number;
  weaknesses: TeamNeedCategory[];
  full_profile: TeamNeedCategory[];
}

export interface FitCandidate {
  player_id: number;
  name: string;
  position: string;
  class_year: string;
  current_team: string;
  current_division: string;
  current_tier: string;
  level: string;
  in_transfer_portal: boolean | null;
  projected: Record<string, number>;
  hoop_score: number;
  confidence: string;
  extreme_mismatch: boolean;
}

export interface FitStatInfo {
  stat: string;
  label: string;
  lower_is_better: boolean;
}

export interface TeamFits {
  team_id: number;
  team_name: string;
  stat: string | null;
  stat_label: string | null;
  lower_is_better: boolean | null;
  stats: FitStatInfo[];
  role_applied: { role: string; minutes: number } | null;
  minutes_applied: number | null;
  transfer_portal_only: boolean;
  level_filter: string | null;
  candidates: (FitCandidate & { fit_score: number })[];
  candidates_considered: number;
}

export const FIT_STATS = [
  "per40_pts",
  "per40_reb",
  "per40_ast",
  "per40_blk",
  "per40_stl",
  "per40_tov",
  "ts_pct",
  "fg_pct",
] as const;

export const FIT_STAT_LABELS: Record<string, string> = {
  per40_pts: "Scoring",
  per40_reb: "Rebounding",
  per40_ast: "Playmaking / assists",
  per40_blk: "Shot blocking",
  per40_stl: "Perimeter defense / steals",
  per40_tov: "Ball security (fewer turnovers)",
  ts_pct: "Scoring efficiency (TS%)",
  fg_pct: "Field goal %",
};

export interface LeaderboardPlayer {
  player_id: number;
  name: string;
  team_id: number;
  team_name: string;
  tier: string;
  division: string;
  position: string;
  class_year: string;
  games: number;
  ppg: number;
  rpg: number;
  apg: number;
  bpg: number;
  spg: number;
  topg: number;
  ts_pct: number;
  fg_pct: number;
  hoop_score: number;
  stat_value: number;
}

export interface PlayerLeaderboard {
  stat: string;
  stat_label: string;
  lower_is_better: boolean;
  level_filter: string | null;
  division_filter: string | null;
  conference_filter?: string | null;
  min_games: number;
  players: LeaderboardPlayer[];
}

export const LEADERBOARD_STATS = [
  "hoop_score",
  "ppg",
  "rpg",
  "apg",
  "spg",
  "bpg",
  "topg",
  "ts_pct",
  "fg_pct",
  "per40_pts",
  "per40_reb",
  "per40_ast",
  "per40_blk",
  "per40_stl",
] as const;

export const LEADERBOARD_STAT_LABELS: Record<string, string> = {
  hoop_score: "Summit Score",
  ppg: "Points per game",
  rpg: "Rebounds per game",
  apg: "Assists per game",
  spg: "Steals per game",
  bpg: "Blocks per game",
  topg: "Turnovers per game (lowest)",
  ts_pct: "True shooting %",
  fg_pct: "Field goal %",
  per40_pts: "Points per 40",
  per40_reb: "Rebounds per 40",
  per40_ast: "Assists per 40",
  per40_blk: "Blocks per 40",
  per40_stl: "Steals per 40",
};

export interface StandoutPlayer {
  player_id: number;
  name: string;
  position: string;
  class_year: string;
  current_team: string;
  current_level: string;
  current_hoop_score: number;
  projected_hoop_score: number;
  projected_ppg: number;
  confidence: string;
  extreme_mismatch: boolean;
}

export interface StandoutsLeaderboard {
  level: string;
  target_level: string;
  synthetic_target_rating: number;
  synthetic_target_note: string;
  players: StandoutPlayer[];
  candidates_considered: number;
}

export interface ProjectionResult {
  player: {
    id: number;
    name: string;
    position: string;
    class_year: string;
    current_team: string;
    current_division: string;
    current_tier: string;
    games: number;
    season: string;
  };
  current: Record<string, number>;
  target: { team: string; division: string; tier: string; current_rating: number };
  minutes_source: string;
  projected: Record<string, number>;
  projected_range: Record<string, [number, number] | string>;
  projected_range_wide?: Record<string, [number, number] | string>;
  projected_range_note?: string;
  confidence: string;
  strength_gap: number;
  gap_std: number;
  extreme_mismatch: boolean;
  extreme_mismatch_note?: string;
  role_applied?: { role: string; minutes: number; player_count: number };
}

export interface PlayerTrajectorySeason {
  season: string;
  team_id: number;
  team_name: string;
  games: number;
  avg_minutes: number;
  ppg: number;
  rpg: number;
  apg: number;
  bpg: number;
  spg: number;
  topg: number;
  ts_pct: number;
  fg_pct: number;
  per40_pts: number;
  per40_reb: number;
  per40_ast: number;
  hoop_score: number;
  thin_sample?: number | boolean;
}

export interface PlayerTrajectory {
  player_id: number;
  name: string;
  seasons: PlayerTrajectorySeason[];
  trend: "Improving" | "Declining" | "Stable";
  avg_hoop_score_change_per_season: number;
  trend_note: string;
}

export interface PlayerGameLogRow {
  season: string;
  date: string;
  opponent_name: string | null;
  opponent_tier: string | null;
  started: number;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  fgm: number;
  fga: number;
  tfgm: number;
  tfga: number;
  ftm: number;
  fta: number;
}

export interface PlayerGameLogs {
  player_id: number;
  season: string | null;
  games: PlayerGameLogRow[];
}

export interface ScheduleGame {
  game_id: string;
  season: string;
  date: string;
  home_team_id: number;
  home_team_name: string;
  away_team_id: number;
  away_team_name: string;
  home_score: number | null;
  away_score: number | null;
  winner_team_id: number | null;
  margin: number | null;
  neutral_site: number;
  overtime: number;
  conference_game: number;
  opponent_name: string;
  opponent_team_id: number;
  team_score: number | null;
  opponent_score: number | null;
  is_home: boolean;
  won: boolean | null;
}

export interface TeamSchedule {
  team_id: number;
  season: string | null;
  games: ScheduleGame[];
}

export interface OpponentSplitPlayer {
  player_id: number;
  name: string;
  team_name: string;
  own_tier: string;
  position: string;
  class_year: string;
  games_vs_opponent: number;
  avg_points: number;
  avg_rebounds: number;
  avg_assists: number;
  avg_steals: number;
  avg_blocks: number;
  avg_turnovers: number;
  stat_value: number;
}

export interface OpponentSplitLeaderboard {
  stat: string;
  stat_label: string;
  lower_is_better: boolean;
  own_level: string | null;
  opponent_level: string;
  min_games: number;
  conference_filter?: string | null;
  top50_only?: boolean;
  players: OpponentSplitPlayer[];
}

// -------- splits, back-half, conference standings, game detail (Batch 2) --------

export interface OpponentTierSplit {
  games: number;
  avg_points: number;
  avg_rebounds: number;
  avg_assists: number;
  avg_steals: number;
  avg_blocks: number;
  avg_turnovers: number;
  avg_minutes: number;
}

export interface PlayerSplits {
  player_id: number;
  name: string;
  season: string;
  total_games: number;
  by_opponent_tier: Record<string, OpponentTierSplit | null>;
  vs_top50: OpponentTierSplit | null;
  vs_top50_note: string;
  last10: OpponentTierSplit | null;
  last10_games: {
    date: string;
    opponent_name: string | null;
    opponent_tier: string | null;
    points: number;
    rebounds: number;
    assists: number;
  }[];
}

export interface BackHalfPlayer {
  player_id: number;
  name: string;
  team_id: number;
  team_name: string;
  tier: string;
  first_half_games: number;
  second_half_games: number;
  first_half_ppg: number;
  second_half_ppg: number;
  ppg_change: number;
}

export interface BackHalfLeaderboard {
  level_filter: string | null;
  season: string;
  min_games_per_half: number;
  note: string;
  players: BackHalfPlayer[];
}

export interface ConferenceStandingsTeam {
  team_id: number;
  name: string;
  current_rating: number;
  wins: number;
  losses: number;
  conference_wins: number;
  conference_losses: number;
  conference_win_pct: number | null;
}

export interface ConferenceStandings {
  conference: string;
  season: string;
  teams: ConferenceStandingsTeam[];
}

export interface GameBoxScoreRow {
  player_id: number;
  name: string;
  team_id: number;
  started: number;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  fgm: number;
  fga: number;
  tfgm: number;
  tfga: number;
  ftm: number;
  fta: number;
}

export interface GameDetail {
  game_id: string;
  season: string;
  date: string;
  home_team_id: number;
  home_team_name: string;
  away_team_id: number;
  away_team_name: string;
  home_score: number | null;
  away_score: number | null;
  winner_team_id: number | null;
  margin: number | null;
  neutral_site: number;
  overtime: number;
  conference_game: number;
  home_box_score: GameBoxScoreRow[];
  away_box_score: GameBoxScoreRow[];
}

export const ROLE_NAMES = ["starter", "sixth_man", "role_player", "depth_piece"] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

const ROLE_LABELS: Record<string, string> = {
  starter: "Starter",
  sixth_man: "Sixth Man",
  role_player: "Role Player",
  depth_piece: "Depth Piece",
};

// Proper-cased display label for a role key, e.g. "sixth_man" -> "Sixth Man".
// Falls back to a title-cased version of unknown values rather than raw
// snake_case, so a future role added on the backend still renders cleanly.
export function roleLabel(role: string): string {
  if (ROLE_LABELS[role]) return ROLE_LABELS[role];
  return role
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
