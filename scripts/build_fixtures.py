"""Build Gridcast test fixtures from nflverse data.

ESPN and Kalshi were unreachable from the build sandbox, so this script reshapes real nflverse
data into the ESPN site-API schema. Every play, player, score and win probability comes from
nflverse; only the JSON layout is ESPN's. Outputs are marked with "_synthetic": true.
On a machine with network access, `pnpm fixtures:fetch` overwrites them with real responses.

Usage:
    python scripts/fetch_nflverse.py            # downloads to data/raw/nflverse
    python scripts/build_fixtures.py            # writes data/fixtures/
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "nflverse"
OUT = ROOT / "data" / "fixtures"

DEMO_GAME = "2026_06_PIT_TB"
FEATURED_GAME = "2026_07_PIT_NO"
SCOREBOARD_WEEKS = (6, 7)
SEASON = 2026
FIXTURE_TEAMS = ("PIT", "NO", "TB")
EVAL_SEASONS = (2024, 2025, 2026)

ESPN_TEAM_IDS = {
    "ARI": "22", "ATL": "1", "BAL": "33", "BUF": "2", "CAR": "29", "CHI": "3", "CIN": "4",
    "CLE": "5", "DAL": "6", "DEN": "7", "DET": "8", "GB": "9", "HOU": "34", "IND": "11",
    "JAX": "30", "KC": "12", "LV": "13", "LAC": "24", "LAR": "14", "MIA": "15", "MIN": "16",
    "NE": "17", "NO": "18", "NYG": "19", "NYJ": "20", "PHI": "21", "PIT": "23", "SF": "25",
    "SEA": "26", "TB": "27", "TEN": "10", "WSH": "28",
}

TEAM_NAMES = {
    "ARI": ("Arizona", "Cardinals"), "ATL": ("Atlanta", "Falcons"), "BAL": ("Baltimore", "Ravens"),
    "BUF": ("Buffalo", "Bills"), "CAR": ("Carolina", "Panthers"), "CHI": ("Chicago", "Bears"),
    "CIN": ("Cincinnati", "Bengals"), "CLE": ("Cleveland", "Browns"), "DAL": ("Dallas", "Cowboys"),
    "DEN": ("Denver", "Broncos"), "DET": ("Detroit", "Lions"), "GB": ("Green Bay", "Packers"),
    "HOU": ("Houston", "Texans"), "IND": ("Indianapolis", "Colts"),
    "JAX": ("Jacksonville", "Jaguars"), "KC": ("Kansas City", "Chiefs"),
    "LV": ("Las Vegas", "Raiders"), "LAC": ("Los Angeles", "Chargers"),
    "LAR": ("Los Angeles", "Rams"), "MIA": ("Miami", "Dolphins"), "MIN": ("Minnesota", "Vikings"),
    "NE": ("New England", "Patriots"), "NO": ("New Orleans", "Saints"),
    "NYG": ("New York", "Giants"), "NYJ": ("New York", "Jets"),
    "PHI": ("Philadelphia", "Eagles"), "PIT": ("Pittsburgh", "Steelers"),
    "SF": ("San Francisco", "49ers"), "SEA": ("Seattle", "Seahawks"),
    "TB": ("Tampa Bay", "Buccaneers"), "TEN": ("Tennessee", "Titans"),
    "WSH": ("Washington", "Commanders"),
}

# ESPN `color` / `alternateColor` (hex without '#').
ESPN_COLORS = {
    "PIT": ("000000", "ffb612"), "NO": ("d3bc8d", "000000"), "TB": ("bd1c36", "3e3a35"),
}

ALIASES = {"LA": "LAR", "WAS": "WSH", "JAC": "JAX"}


def abbr(team: str) -> str:
    return ALIASES.get(team, team)


def clean(v):
    """NaN-safe conversion of pandas scalars to JSON values."""
    if v is None:
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    if hasattr(v, "item"):
        return v.item()
    return v


def team_ref(t: str) -> dict:
    loc, name = TEAM_NAMES[t]
    color, alt = ESPN_COLORS.get(t, ("ffffff", "000000"))
    return {
        "id": ESPN_TEAM_IDS[t],
        "abbreviation": t,
        "displayName": f"{loc} {name}",
        "shortDisplayName": name,
        "name": name,
        "location": loc,
        "color": color,
        "alternateColor": alt,
    }


def espn_type(r) -> tuple[str, str]:
    """(type id, type text) the way ESPN labels the play."""
    pt = r.play_type
    nfl = r.play_type_nfl if isinstance(r.play_type_nfl, str) else ""
    desc = r.desc if isinstance(r.desc, str) else ""
    if nfl == "TIMEOUT":
        return "21", "Timeout"
    if nfl == "END_QUARTER":
        return ("65", "End of Half") if r.qtr == 2 else ("2", "End Period")
    if nfl == "END_GAME":
        return "66", "End of Game"
    if nfl == "TWO_MINUTE_WARNING" or "Two-Minute Warning" in desc:
        return "75", "Two-minute warning"
    if pt == "no_play" or nfl == "PENALTY":
        return "8", "Penalty"
    if r.interception == 1:
        return ("36", "Interception Return Touchdown") if r.return_touchdown == 1 else (
            "26", "Pass Interception Return")
    if r.fumble_lost == 1:
        return ("39", "Fumble Return Touchdown") if r.return_touchdown == 1 else (
            "29", "Fumble Recovery (Opponent)")
    if r.sack == 1:
        return "7", "Sack"
    if pt == "pass":
        if r.qb_spike == 1:
            return "3", "Pass Incompletion"
        if r.touchdown == 1:
            return "67", "Passing Touchdown"
        return ("24", "Pass Reception") if r.complete_pass == 1 else ("3", "Pass Incompletion")
    if pt in ("run", "qb_kneel"):
        return ("68", "Rushing Touchdown") if r.touchdown == 1 else ("5", "Rush")
    if pt == "punt":
        return ("34", "Punt Return Touchdown") if r.return_touchdown == 1 else ("52", "Punt")
    if pt == "kickoff":
        return ("32", "Kickoff Return Touchdown") if r.return_touchdown == 1 else (
            "53", "Kickoff")
    if pt == "field_goal":
        res = r.field_goal_result
        if res == "made":
            return "59", "Field Goal Good"
        if res == "blocked":
            return "18", "Blocked Field Goal"
        return "60", "Field Goal Missed"
    if pt == "extra_point":
        return ("61", "Extra Point Good") if r.extra_point_result == "good" else (
            "62", "Extra Point Missed")
    if pt == "qb_spike":
        return "3", "Pass Incompletion"
    return "70", "No Play"


def spot(r, home: str, ytg_col: str = "yardline_100") -> dict | None:
    ytg = clean(getattr(r, ytg_col))
    pos = r.posteam if isinstance(r.posteam, str) else None
    if ytg is None or pos is None:
        return None
    ytg = int(ytg)
    pos = abbr(pos)
    own = 100 - ytg
    side = pos if own <= 50 else [t for t in (abbr(r.home_team), abbr(r.away_team)) if t != pos][0]
    yl = own if own <= 50 else ytg
    s = {
        "yardLine": own if pos == home else ytg,
        "yardsToEndzone": ytg,
        "possessionText": f"{side} {yl}" if yl != 50 else "50",
        "team": {"id": ESPN_TEAM_IDS[pos]},
    }
    down = clean(r.down)
    if down is not None:
        dist = int(clean(r.ydstogo) or 0)
        ordn = {1: "1st", 2: "2nd", 3: "3rd", 4: "4th"}[int(down)]
        goal = clean(r.goal_to_go) == 1
        s.update({
            "down": int(down),
            "distance": dist,
            "downDistanceText": f"{ordn} & {'Goal' if goal else dist} at {s['possessionText']}",
            "shortDownDistanceText": f"{ordn} & {'Goal' if goal else dist}",
        })
    return s


def build_summary(pbp: pd.DataFrame, games: pd.DataFrame, game_id: str) -> dict:
    g = games[games.game_id == game_id].iloc[0]
    d = pbp[pbp.game_id == game_id].sort_values("order_sequence" if "order_sequence" in pbp else "play_id")
    home, away = abbr(g.home_team), abbr(g.away_team)
    event_id = str(int(g.espn))
    plays_by_drive: dict[int, list[dict]] = {}
    wp = []
    rows = list(d.itertuples())
    for i, r in enumerate(rows):
        desc = r.desc if isinstance(r.desc, str) else ""
        if desc == "GAME" or not desc:
            continue
        tid, ttext = espn_type(r)
        pid = f"{event_id}{int(r.play_id):05d}"
        play = {
            "id": pid,
            "sequenceNumber": str(int(r.play_id)),
            "type": {"id": tid, "text": ttext},
            "text": desc,
            "awayScore": int(r.total_away_score),
            "homeScore": int(r.total_home_score),
            "period": {"number": int(r.qtr)},
            "clock": {"displayValue": r.time if isinstance(r.time, str) else "0:00"},
            "scoringPlay": bool(r.sp == 1),
            "wallclock": r.time_of_day if isinstance(r.time_of_day, str) else None,
            "modified": r.time_of_day if isinstance(r.time_of_day, str) else None,
        }
        st = spot(r, home)
        if st:
            play["start"] = st
        if clean(r.yards_gained) is not None and play["type"]["id"] not in ("21", "2", "65", "66", "75"):
            play["statYardage"] = int(r.yards_gained)
        # End spot: the next play's start when the same team still has the ball.
        for nxt in rows[i + 1:]:
            if isinstance(nxt.desc, str) and clean(nxt.yardline_100) is not None and isinstance(nxt.posteam, str):
                e = spot(nxt, home)
                if e:
                    play["end"] = e
                break
        play = {k: v for k, v in play.items() if v is not None}
        drive_no = int(clean(r.fixed_drive) or 0)
        plays_by_drive.setdefault(drive_no, []).append(play)
        hw = clean(r.home_wp_post)
        if hw is None:
            hw = clean(r.home_wp)
        if hw is not None:
            wp.append({"playId": pid, "homeWinPercentage": round(float(hw), 4), "tiePercentage": 0})

    drives = []
    for drive_no, plays in sorted(plays_by_drive.items()):
        dd = d[d.fixed_drive == drive_no]
        pos = next((abbr(t) for t in dd.posteam if isinstance(t, str)), None)
        res = next((x for x in dd.fixed_drive_result if isinstance(x, str)), "")
        nplays = int(clean(dd.drive_play_count.dropna().max()) or 0) if "drive_play_count" in dd else 0
        top = next((x for x in dd.drive_time_of_possession if isinstance(x, str)), "")
        ydsnet = int(dd[dd.play_type.isin(["run", "pass"])].yards_gained.sum())
        drive = {
            "id": f"{event_id}{drive_no:03d}",
            "description": f"{nplays} plays, {ydsnet} yards, {top}",
            "displayResult": res,
            "result": res.upper(),
            "yards": ydsnet,
            "isScore": res in ("Touchdown", "Field goal"),
            "offensivePlays": nplays,
            "plays": plays,
        }
        if pos:
            drive["team"] = {k: v for k, v in team_ref(pos).items() if k in ("id", "abbreviation", "displayName", "shortDisplayName")}
        drives.append(drive)

    last = d.iloc[-1]
    ot = int(last.qtr) > 4
    status = {
        "clock": 0,
        "displayClock": "0:00",
        "period": int(last.qtr),
        "type": {
            "id": "3", "name": "STATUS_FINAL", "state": "post", "completed": True,
            "description": "Final", "detail": "Final/OT" if ot else "Final",
            "shortDetail": "Final/OT" if ot else "Final",
        },
    }
    competitors = [
        {"id": ESPN_TEAM_IDS[home], "homeAway": "home", "team": team_ref(home), "score": str(int(g.home_score)), "winner": bool(g.home_score > g.away_score)},
        {"id": ESPN_TEAM_IDS[away], "homeAway": "away", "team": team_ref(away), "score": str(int(g.away_score)), "winner": bool(g.away_score > g.home_score)},
    ]
    return {
        "_synthetic": True,
        "_source": f"nflverse play_by_play_{SEASON} {game_id}, reshaped to the ESPN summary schema by scripts/build_fixtures.py",
        "header": {
            "id": event_id,
            "season": {"year": int(g.season), "type": 2},
            "week": int(g.week),
            "competitions": [{
                "id": event_id,
                "date": f"{g.gameday}T{g.gametime}:00-04:00",
                "neutralSite": g.location == "Neutral",
                "competitors": competitors,
                "status": status,
            }],
        },
        "drives": {"previous": drives},
        "winprobability": wp,
        "pickcenter": [pickcenter(g)],
        "gameInfo": {"venue": {"fullName": g.stadium}},
    }


def pickcenter(g) -> dict:
    home, away = abbr(g.home_team), abbr(g.away_team)
    spread = clean(g.spread_line)  # nflverse: positive means the home team is favored
    out = {"provider": {"name": "nflverse closing line"}}
    if spread is not None:
        fav, n = (home, spread) if spread > 0 else (away, -spread)
        out["details"] = f"{fav} -{n:g}"
        out["spread"] = -spread
    if clean(g.total_line) is not None:
        out["overUnder"] = float(g.total_line)
    return out


def build_scoreboard(games: pd.DataFrame, week: int, asof: str) -> dict:
    wk = games[(games.season == SEASON) & (games.week == week) & (games.game_type == "REG")]
    events = []
    for g in wk.itertuples():
        home, away = abbr(g.home_team), abbr(g.away_team)
        final = clean(g.home_score) is not None
        eid = str(int(g.espn))
        date = f"{g.gameday}T{g.gametime}:00-04:00"
        status = {
            "clock": 0 if final else 3600,
            "displayClock": "0:00" if final else "15:00",
            "period": (5 if g.overtime == 1 else 4) if final else 0,
            "type": (
                {"id": "3", "name": "STATUS_FINAL", "state": "post", "completed": True, "description": "Final",
                 "detail": "Final/OT" if g.overtime == 1 else "Final", "shortDetail": "Final/OT" if g.overtime == 1 else "Final"}
                if final else
                {"id": "1", "name": "STATUS_SCHEDULED", "state": "pre", "completed": False, "description": "Scheduled",
                 "detail": f"{g.weekday} {g.gametime} ET", "shortDetail": f"{g.gameday} {g.gametime} ET"}
            ),
        }
        comp = {
            "id": eid,
            "date": date,
            "neutralSite": g.location == "Neutral",
            "venue": {"fullName": g.stadium},
            "competitors": [
                {"id": ESPN_TEAM_IDS[home], "homeAway": "home", "team": team_ref(home),
                 **({"score": str(int(g.home_score))} if final else {})},
                {"id": ESPN_TEAM_IDS[away], "homeAway": "away", "team": team_ref(away),
                 **({"score": str(int(g.away_score))} if final else {})},
            ],
            "status": status,
            "odds": [pickcenter(g)],
        }
        if eid == "401873011":
            comp["broadcasts"] = [{"names": ["NFL Network"]}]
        events.append({
            "id": eid,
            "date": date,
            "name": f"{TEAM_NAMES[away][0]} {TEAM_NAMES[away][1]} at {TEAM_NAMES[home][0]} {TEAM_NAMES[home][1]}",
            "shortName": f"{away} @ {home}",
            "week": {"number": week},
            "season": {"year": SEASON, "type": 2},
            "competitions": [comp],
            "status": status,
        })
    return {
        "_synthetic": True,
        "_source": f"nflverse schedules (games.csv) as of {asof}, reshaped to the ESPN scoreboard schema",
        "season": {"year": SEASON, "type": 2},
        "week": {"number": week},
        "events": events,
    }


def build_roster(roster: pd.DataFrame, team: str) -> dict:
    nfl_team = {"LAR": "LA", "WSH": "WAS"}.get(team, team)
    t = roster[roster.team == nfl_team]
    t = t[t.week == t.week.max()]
    groups = {"offense": [], "defense": [], "specialTeam": []}
    off = {"QB", "RB", "FB", "WR", "TE", "OL", "T", "G", "C", "OT", "OG"}
    st = {"K", "P", "LS"}
    for r in t.itertuples():
        pos = r.depth_chart_position if isinstance(r.depth_chart_position, str) else r.position
        grp = "offense" if r.position in off or pos in off else "specialTeam" if r.position in st else "defense"
        jersey = clean(r.jersey_number)
        groups[grp].append({
            "id": str(int(r.espn_id)) if clean(r.espn_id) is not None else r.gsis_id,
            "displayName": r.full_name,
            "fullName": r.full_name,
            "firstName": r.first_name,
            "lastName": r.last_name,
            "shortName": f"{str(r.first_name)[:1]}. {r.last_name}",
            "jersey": str(int(jersey)) if jersey is not None else None,
            "position": {"abbreviation": pos},
            "status": {"type": r.status},
        })
    return {
        "_synthetic": True,
        "_source": f"nflverse roster_{SEASON} week {int(t.week.max())}, reshaped to the ESPN roster schema",
        "team": {k: v for k, v in team_ref(team).items() if k in ("id", "abbreviation", "displayName")},
        "athletes": [{"position": k, "items": v} for k, v in groups.items()],
    }


def build_depth(depth: pd.DataFrame, roster: pd.DataFrame, team: str) -> dict:
    nfl_team = {"LAR": "LA", "WSH": "WAS"}.get(team, team)
    t = depth[depth.team == nfl_team]
    t = t[t.dt == t.dt.max()]
    jerseys = {}
    r = roster[roster.team == nfl_team]
    for row in r.itertuples():
        if clean(row.espn_id) is not None and clean(row.jersey_number) is not None:
            jerseys[str(int(row.espn_id))] = str(int(row.jersey_number))
    out = []
    for grp, gdf in t.groupby("pos_grp", sort=False):
        positions = {}
        for pos, pdf in gdf.groupby("pos_abb", sort=False):
            athletes = []
            for a in pdf.sort_values("pos_rank").itertuples():
                eid = str(int(a.espn_id)) if clean(a.espn_id) is not None else str(a.gsis_id)
                athletes.append({k: v for k, v in {
                    "id": eid, "displayName": a.player_name, "jersey": jerseys.get(eid),
                    "position": {"abbreviation": a.pos_abb},
                }.items() if v is not None})
            positions[pos.lower()] = {"position": {"abbreviation": pos}, "athletes": athletes}
        out.append({"name": grp, "positions": positions})
    return {
        "_synthetic": True,
        "_source": f"nflverse depth_charts_{SEASON} snapshot {t.dt.max()}, reshaped to the ESPN depth chart schema",
        "depthchart": out,
    }


def american_to_prob(ml: float) -> float:
    return 100 / (ml + 100) if ml > 0 else -ml / (-ml + 100)


def build_kalshi(games: pd.DataFrame, week: int) -> dict:
    """Kalshi /events snapshot shaped per the public docs.

    Prices are de-vigged closing moneylines from nflverse, not Kalshi trades. This fixture
    exists to exercise the Kalshi parser; replace it with `pnpm fixtures:fetch`.
    """
    wk = games[(games.season == SEASON) & (games.week == week)]
    events = []
    mon = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
    for g in wk.itertuples():
        if clean(g.home_moneyline) is None or clean(g.home_score) is not None:
            continue
        home, away = abbr(g.home_team), abbr(g.away_team)
        y, m, dday = g.gameday.split("-")
        ticker = f"KXNFLGAME-{y[2:]}{mon[int(m) - 1]}{dday}{away}{home}"
        ph, pa = american_to_prob(g.home_moneyline), american_to_prob(g.away_moneyline)
        ph, pa = ph / (ph + pa), pa / (ph + pa)
        markets = []
        for t, p in ((away, pa), (home, ph)):
            c = round(p * 100)
            markets.append({
                "ticker": f"{ticker}-{t}",
                "event_ticker": ticker,
                "title": f"{TEAM_NAMES[away][0]} at {TEAM_NAMES[home][0]} Winner?",
                "yes_sub_title": f"{TEAM_NAMES[t][0]}",
                "status": "active",
                "yes_bid": c - 1,
                "yes_ask": c + 1,
                "last_price": c,
                "yes_bid_dollars": f"{(c - 1) / 100:.4f}",
                "yes_ask_dollars": f"{(c + 1) / 100:.4f}",
                "last_price_dollars": f"{c / 100:.4f}",
                "volume": 0,
            })
        events.append({
            "event_ticker": ticker,
            "series_ticker": "KXNFLGAME",
            "title": f"{TEAM_NAMES[away][1]} at {TEAM_NAMES[home][1]}",
            "sub_title": f"{away} at {home} ({mon[int(m) - 1].title()} {int(dday)})",
            "markets": markets,
        })
    return {
        "_synthetic": True,
        "_source": "Shape per docs.kalshi.com GET /events?series_ticker=KXNFLGAME&with_nested_markets=true. "
                   "Prices are de-vigged nflverse closing moneylines, NOT Kalshi trades.",
        "events": events,
        "cursor": "",
    }


EVAL_COLS = [
    "game_id", "play_id", "season", "posteam", "defteam", "home_team", "away_team", "qtr", "time", "down", "ydstogo",
    "yardline_100", "desc", "play_type", "play_type_nfl", "yards_gained", "shotgun", "no_huddle",
    "qb_scramble", "pass_length", "pass_location", "air_yards", "run_location", "run_gap",
    "field_goal_result", "extra_point_result", "two_point_attempt", "two_point_conv_result",
    "kick_distance", "return_yards", "touchback", "punt_fair_catch", "kickoff_fair_catch", "sack",
    "interception", "fumble", "fumble_lost", "touchdown", "td_team", "complete_pass",
    "incomplete_pass", "penalty", "penalty_team", "penalty_type", "penalty_yards", "qb_kneel",
    "qb_spike", "safety", "passer_player_name", "receiver_player_name", "rusher_player_name",
    "kicker_player_name", "punter_player_name", "sp", "first_down",
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", type=Path, default=RAW)
    ap.add_argument("--asof", default="2026-10-24")
    args = ap.parse_args()
    raw: Path = args.raw

    games = pd.read_csv(raw / "games.csv", low_memory=False)
    pbp = pd.read_csv(raw / f"play_by_play_{SEASON}.csv.gz", low_memory=False)
    roster = pd.read_csv(raw / f"roster_{SEASON}.csv", low_memory=False)
    depth = pd.read_csv(raw / f"depth_charts_{SEASON}.csv", low_memory=False)

    (OUT / "espn").mkdir(parents=True, exist_ok=True)
    (OUT / "kalshi").mkdir(parents=True, exist_ok=True)
    (OUT / "nflverse").mkdir(parents=True, exist_ok=True)

    def dump(path: Path, obj) -> None:
        path.write_text(json.dumps(obj, indent=1, ensure_ascii=False) + "\n")
        print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KB)")

    demo = games[games.game_id == DEMO_GAME].iloc[0]
    dump(OUT / "espn" / f"summary_{int(demo.espn)}.json", build_summary(pbp, games, DEMO_GAME))
    for wk in SCOREBOARD_WEEKS:
        dump(OUT / "espn" / f"scoreboard_{SEASON}_wk{wk}.json", build_scoreboard(games, wk, args.asof))
    for t in FIXTURE_TEAMS:
        dump(OUT / "espn" / f"team_{t}.json", {"_synthetic": True, "team": team_ref(t)})
        dump(OUT / "espn" / f"roster_{t}.json", build_roster(roster, t))
        dump(OUT / "espn" / f"depthchart_{t}.json", build_depth(depth, roster, t))
    dump(OUT / "kalshi" / "events_KXNFLGAME.json", build_kalshi(games, 7))

    demo_rows = pbp[pbp.game_id == DEMO_GAME]
    p = OUT / "nflverse" / f"pbp_{DEMO_GAME}.csv"
    demo_rows.to_csv(p, index=False)
    print(f"wrote {p.relative_to(ROOT)}")

    for season in EVAL_SEASONS:
        src = raw / f"play_by_play_{season}.csv.gz"
        if not src.exists():
            print(f"skip eval {season}: {src} missing")
            continue
        df = pd.read_csv(src, low_memory=False)
        df = df[[c for c in EVAL_COLS if c in df.columns]]
        df = df[df.desc.notna() & df.play_type.notna()]
        p = OUT / "nflverse" / f"parser_eval_{season}.csv.gz"
        df.to_csv(p, index=False, compression="gzip")
        print(f"wrote {p.relative_to(ROOT)} ({len(df)} plays, {p.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
