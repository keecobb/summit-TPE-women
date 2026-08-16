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
  height_in?: number | null;
  team_id: number;
  team_name?: string;
  tier?: string;
  position: string;
  class_year: string;
  games: number;
  // Not a column on `players` -- summed live from player_game_logs.started
  // (see games_started_by_player() in projection.py). null means no game
  // log data at all this season (zero-game placeholder row), distinct
  // from a real 0 (played but never started).
  games_started?: number | null;
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
  // 3-point % / free-throw %, same 0-1-fraction convention as ts_pct/fg_pct
  // above -- also not columns on `players`, summed live from
  // player_game_logs. null if she's never attempted one (or zero attempts
  // on record this season).
  tfg_pct: number | null;
  ft_pct: number | null;
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
  roster_avg_summit_score: number | null;
  roster_avg_summit_score_count: number;
  // Classification (phase 11h -- real games-started rate, not an
  // avg_minutes rank): Starter = starts in >=80% of her own games played.
  // Sixth Man = the single highest-avg_minutes player among everyone who
  // starts in <25% of her own games. Depth Piece = not a starter/sixth
  // man and under 10 MPG. Role Player = everyone else. See
  // projection.py's team_roles() for the full rule.
  starter: { minutes: number | null; player_count: number; note: string };
  sixth_man: { minutes: number | null; note: string };
  role_player: { minutes: number | null; range: [number, number] | null; player_count: number; note: string };
  depth_piece: { minutes: number | null; player_count: number; note: string };
  // Same 4-way classification applied to every individual player on the
  // roster, in roster (avg_minutes descending) order -- lets a UI label
  // each player rather than just showing the 4 aggregate numbers above.
  // role is null only for a zero-game placeholder row with no real data
  // to classify.
  roster_roles: {
    player_id: number;
    name: string;
    avg_minutes: number | null;
    games: number;
    games_started: number | null;
    role: "Solidified Starter" | "Sixth Man" | "Role Player" | "Depth Piece" | null;
  }[];
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
  // Her real CURRENT-season games played/started (not projected -- there's
  // no meaningful "projected games started" for a hypothetical transfer).
  games: number;
  games_started: number | null;
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
  class_filter?: string | null;
  position_filter?: string | null;
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
  "total_pts",
  "total_reb",
  "total_ast",
  "total_stl",
  "total_blk",
  "total_tfgm",
  "total_ftm",
  "tfg_pct",
  "ft_pct",
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
  total_pts: "Total points",
  total_reb: "Total rebounds",
  total_ast: "Total assists",
  total_stl: "Total steals",
  total_blk: "Total blocks",
  total_tfgm: "Total 3-pointers made",
  total_ftm: "Total free throws made",
  tfg_pct: "3-point % (season)",
  ft_pct: "Free throw % (season)",
};

// Player class years / positions -- used to populate the Leaderboard's
// class/position filter dropdowns on the Data page. Matches the exact
// values stored in players.class_year / players.position (see
// API_REFERENCE.md).
export const CLASS_YEARS = ["FR", "SO", "JR", "SR", "GR"] as const;
export const POSITIONS = ["G", "F", "C"] as const;

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
  projected_minutes: number;
  confidence: string;
  extreme_mismatch: boolean;
}

export interface StandoutsLeaderboard {
  level: string;
  target_level: string;
  synthetic_target_rating: number;
  synthetic_target_note: string;
  projected_minutes_note: string;
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
    games_started: number | null;
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
  opponent_level: string | null;
  min_games: number;
  conference_filter?: string | null;
  top50_only?: boolean;
  top50_national?: boolean;
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
  // Total makes / total attempts across this bucket's games (not an
  // average of each game's own %) -- null only if the bucket has zero
  // field goal attempts on record.
  fg_pct: number | null;
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
  first_half_rpg: number;
  second_half_rpg: number;
  rpg_change: number;
  first_half_apg: number;
  second_half_apg: number;
  apg_change: number;
  first_half_ts_pct: number | null;
  second_half_ts_pct: number | null;
  ts_pct_change: number | null;
  first_half_mpg: number;
  second_half_mpg: number;
  mpg_change: number;
  first_half_topg: number;
  second_half_topg: number;
  topg_change: number;
}

export interface BackHalfLeaderboard {
  level_filter: string | null;
  season: string;
  min_games_per_half: number;
  min_games: number;
  min_mpg: number;
  sort: string;
  note: string;
  players: BackHalfPlayer[];
}

// sort=all response shape -- all 6 rankings from one call/one DB scan,
// instead of one BackHalfLeaderboard fetch per stat (see lib note on the
// Data page for why that mattered in production).
export interface BackHalfLeaderboardAll {
  level_filter: string | null;
  season: string;
  min_games_per_half: number;
  min_games: number;
  min_mpg: number;
  sort: "all";
  note: string;
  by_sort: {
    ppg: BackHalfPlayer[];
    rpg: BackHalfPlayer[];
    apg: BackHalfPlayer[];
    ts: BackHalfPlayer[];
    mpg: BackHalfPlayer[];
    topg: BackHalfPlayer[];
  };
}

export interface SeasonJumpPlayer {
  player_id: number;
  name: string;
  position: string | null;
  class_year: string | null;
  from_team_id: number;
  from_team_name: string;
  to_team_id: number;
  to_team_name: string;
  to_tier: string | null;
  from_games: number;
  from_hoop_score: number;
  from_ppg: number | null;
  to_games: number;
  to_hoop_score: number;
  to_ppg: number | null;
  hoop_score_change: number;
  ppg_change: number | null;
  transferred: boolean;
}

export interface SeasonJumpLeaderboard {
  season_from: string;
  season_to: string;
  min_games: number;
  note: string;
  players: SeasonJumpPlayer[];
}

export interface TeamEfficiencyPoint {
  team_id: number;
  name: string;
  tier: string;
  conference: string;
  current_rating: number;
  games: number;
  ppg: number;
  papg: number;
  quadrant: "Elite" | "Offense-First" | "Defense-First" | "Below Average";
}

export interface TeamEfficiencyQuadrant {
  level_filter: string | null;
  season: string;
  min_games: number;
  mean_ppg: number;
  mean_papg: number;
  note: string;
  teams: TeamEfficiencyPoint[];
}

export interface PlayerEfficiencyPoint {
  player_id: number;
  name: string;
  position: string;
  class_year: string;
  team_id: number;
  team_name: string;
  tier: string;
  games: number;
  ppg: number;
  ts_pct: number;
  hoop_score: number;
  quadrant: "Elite" | "Volume Scorer" | "Efficient" | "Below Average";
}

export interface PlayerEfficiencyQuadrant {
  level_filter: string | null;
  min_games: number;
  mean_ppg: number;
  mean_ts: number;
  note: string;
  players: PlayerEfficiencyPoint[];
}

export interface BestGamePerformance {
  player_id: number;
  name: string;
  team_id: number;
  team_name: string;
  tier: string;
  date: string;
  opponent_name: string | null;
  opponent_tier: string | null;
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
  production_rating: number;
}

export interface BestGamesLeaderboard {
  season: string;
  sort: "points" | "production_rating";
  level_filter: string | null;
  note: string;
  games: BestGamePerformance[];
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
  starter: "Solidified Starter",
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

// -------- Biggest Leap (team profile page, phase 7) --------

export interface LeapCandidate {
  player_id: number;
  name: string;
  position: string;
  class_year: string;
  current_team: string;
  current_tier: string;
  level: string;
  current_hoop_score: number;
  projected_hoop_score: number;
  hoop_score_delta: number;
  projected_minutes: number;
  confidence: string;
}

export interface LeapCandidates {
  team_id: number;
  team_name: string;
  role_applied: { role: string; minutes: number } | null;
  minutes_applied: number | null;
  candidates: LeapCandidate[];
  candidates_considered: number;
  note: string;
}

// -------- Role Translation (player profile page, phase 12) --------

// One role's translated per-game line for GET /players/{id}/role-translation
// -- null when that role isn't resolvable on the player's own current team
// (see TeamRoles' starter/sixth_man/role_player/depth_piece `minutes` null
// case, same underlying reason).
export interface RoleTranslationLine {
  minutes: number;
  ppg: number;
  rpg: number;
  apg: number;
  bpg: number | null;
  spg: number | null;
  topg: number | null;
}

export interface RoleTranslation {
  player_id: number;
  name: string;
  team_id: number;
  team_name: string;
  // Which of the 4 roles she's actually in today on her real current
  // roster (via /teams/{id}/roles' roster_roles) -- null if there wasn't
  // enough data to classify her. Highlight this card in the UI.
  current_role: RoleName | null;
  real_avg_minutes: number | null;
  // Minutes-independent rate composites -- deliberately the SAME across
  // every role below, not recomputed per role. See projection.py's
  // role_translation() docstring for why.
  hoop_score: number;
  ts_pct: number | null;
  fg_pct: number | null;
  // true when she hasn't cleared role_translation()'s own stricter sample
  // floor (12+ games AND 100+ minutes -- stricter than the site-wide
  // thin_sample floor, since scaling a small sample up to a heavier role's
  // minutes amplifies its noise). `roles` is null in that case -- render
  // `note` as an explanation instead of the 4 role tiles.
  insufficient_sample: boolean;
  roles: Record<RoleName, RoleTranslationLine | null> | null;
  note: string;
}

// -------- Optimal Lineup (team profile page, phase 12/13) --------

// One row of GET /teams/{id}/optimal-lineup's `rotation` table (phase 13 --
// covers the WHOLE roster, not just the starting 5 + sixth man). `minutes`
// is her real season avg_minutes scaled by one constant factor so the full
// roster adds up to a real game's 200 total player-minutes -- her real
// relative playing time is preserved, just normalized to one game.
// ppg/rpg/apg/spg/bpg/topg are her real per-40 rates applied to that scaled
// minutes figure (same math as RoleTranslationLine). hoop_score/ts_pct/
// fg_pct are rate composites that don't change with minutes, so they're her
// real season values, unscaled.
export interface OptimalLineupPlayer {
  player_id: number;
  name: string;
  position: string;
  class_year: string;
  role: "Starter" | "Sixth Man" | "Role Player" | "Depth Piece";
  hoop_score: number;
  ts_pct: number | null;
  fg_pct: number | null;
  minutes: number;
  ppg: number | null;
  rpg: number | null;
  apg: number | null;
  spg: number | null;
  bpg: number | null;
  topg: number | null;
  // Equal-weighted blend of this team's own hoop_score z-score and
  // avg_production z-score -- team-relative, not a league-wide ranking.
  // This is what `role`/table order is ranked by, NOT `minutes`.
  optimizer_score: number;
}

export interface OptimalLineup {
  team_id: number;
  team_name: string;
  // Sum of every rotation row's `minutes` -- should read very close to
  // 200.0 (rounding across individually-rounded rows keeps it from landing
  // exactly on 200.0 every time).
  total_minutes: number;
  // Whole roster (every player with a real season profile AND real
  // per-game logs), ordered by role (Starter > Sixth Man > Role Player >
  // Depth Piece) then by minutes descending within each role.
  rotation: OptimalLineupPlayer[];
  // Explains any positional-balance fallback (e.g. no true Center on the
  // roster) and/or any roster players excluded for lacking real data --
  // empty array when nothing needed flagging.
  notes: string[];
  method_note: string;
}
