// background.js (Step 4: data layer + ESPN context + roster persistence)

// ---------- Config ----------
const STORAGE_KEY = "BL_STATE_V1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// ---------- State helpers ----------
async function getState() {
  const { [STORAGE_KEY]: s } = await chrome.storage.local.get(STORAGE_KEY);
  return s || defaultState();
}
async function setState(next) {
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
}
function defaultState() {
  return {
    leagues: {},        // [leagueId]: { platform, settings, context, roster }
    projections: {},    // [season]: { [playerId]: { name, team, pos: [], cats: {...} } }
    schedules: {},      // [dateISO]: { [teamAbbr]: { opp, homeAway, b2b } }
    meta: { updatedAt: 0, lastFetch: 0 }
  };
}

// ---------- Demo data ----------
function sampleProjections() {
  return {
    "2025": {
      lebron_james: {
        name: "LeBron James",
        team: "LAL",
        pos: ["SF", "PF"],
        cats: { pts: 25.3, reb: 7.8, ast: 7.2, stl: 1.1, blk: 0.6, "3pm": 2.2, fg_pct: 0.52, ft_pct: 0.73, to: 3.4 }
      },
      stephen_curry: {
        name: "Stephen Curry",
        team: "GSW",
        pos: ["PG"],
        cats: { pts: 28.1, reb: 4.4, ast: 6.3, stl: 0.9, blk: 0.2, "3pm": 4.7, fg_pct: 0.47, ft_pct: 0.91, to: 3.2 }
      },
      anthony_davis: {
        name: "Anthony Davis",
        team: "DAL",
        pos: ["PF", "C"],
        cats: { pts: 24.7, reb: 12.1, ast: 3.5, stl: 1.2, blk: 2.3, "3pm": 0.4, fg_pct: 0.57, ft_pct: 0.79, to: 2.1 }
      }
    }
  };
}
function sampleSchedules() {
  return {
    "2025-10-21": {
      HOU: { opp: "OKC", homeAway: "away", b2b: false },
      OKC: { opp: "HOU", homeAway: "home", b2b: false },
      GSW: { opp: "LAL", homeAway: "home", b2b: false },
      LAL: { opp: "GSW", homeAway: "away", b2b: false }
    },
    "2025-10-22": {
      CLE: { opp: "NYK", homeAway: "home", b2b: false },
      NYK: { opp: "CLE", homeAway: "away", b2b: false },
      MIA: { opp: "ORL", homeAway: "away", b2b: false },
      ORL: { opp: "MIA", homeAway: "home", b2b: false },
      BKN: { opp: "CHA", homeAway: "away", b2b: false },
      CHA: { opp: "BKN", homeAway: "home", b2b: false },
      TOR: { opp: "ATL", homeAway: "away", b2b: false },
      ATL: { opp: "TOR", homeAway: "home", b2b: false },
      PHI: { opp: "BOS", homeAway: "away", b2b: false },
      BOS: { opp: "PHI", homeAway: "home", b2b: false },
      NOP: { opp: "MEM", homeAway: "away", b2b: false },
      MEM: { opp: "NOP", homeAway: "home", b2b: false },
      DET: { opp: "CHI", homeAway: "home", b2b: false },
      CHI: { opp: "DET", homeAway: "away", b2b: false },
      WAS: { opp: "MIL", homeAway: "away", b2b: false },
      MIL: { opp: "WAS", homeAway: "home", b2b: false },
      LAC: { opp: "UTA", homeAway: "home", b2b: false },
      UTA: { opp: "LAC", homeAway: "away", b2b: false },
      MIN: { opp: "POR", homeAway: "home", b2b: false },
      POR: { opp: "MIN", homeAway: "away", b2b: false },
      SAC: { opp: "PHX", homeAway: "home", b2b: false },
      PHX: { opp: "SAC", homeAway: "away", b2b: false },
      DAL: { opp: "SAS", homeAway: "home", b2b: false },
      SAS: { opp: "DAL", homeAway: "away", b2b: false }
    }
  };
}

// ---------- Fetch/ensure ----------
async function ensureData() {
  const s = await getState();
  const now = Date.now();
  if (now - (s.meta.lastFetch || 0) < CACHE_TTL_MS) return s;

  s.projections = sampleProjections();
  s.schedules = sampleSchedules();
  s.meta.lastFetch = now;
  s.meta.updatedAt = now;

  await setState(s);
  console.log("[Brick Layers][background] demo data loaded", {
    projectionsCount: Object.keys(s.projections?.["2025"] || {}).length,
    daysWithSchedules: Object.keys(s.schedules || {}).length
  });
  return s;
}

// ---------- Message API ----------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case "PING": {
          sendResponse({ ok: true, pong: true, ts: Date.now() });
          break;
        }

        case "GET_DATA": {
          const s = await ensureData();
          sendResponse({ ok: true, data: { projections: s.projections, schedules: s.schedules, meta: s.meta } });
          break;
        }

        case "GET_LEAGUE_SETTINGS": {
          const s = await getState();
          sendResponse({ ok: true, league: s.leagues?.[msg.leagueId] || null });
          break;
        }

        case "UPSERT_LEAGUE_SETTINGS": {
          const s = await getState();
          s.leagues = s.leagues || {};
          s.leagues[msg.leagueId] = {
            ...(s.leagues[msg.leagueId] || {}),
            platform: msg.platform ?? s.leagues[msg.leagueId]?.platform ?? null,
            settings: { ...(s.leagues[msg.leagueId]?.settings || {}), ...(msg.settings || {}) }
          };
          s.meta.updatedAt = Date.now();
          await setState(s);
          sendResponse({ ok: true, league: s.leagues[msg.leagueId] });
          break;
        }

        case "UPSERT_LEAGUE_CONTEXT": {
          const s = await getState();
          const { leagueId, platform, context } = msg;
          if (!leagueId) { sendResponse({ ok: false, error: "missing_leagueId" }); break; }
          s.leagues = s.leagues || {};
          const prev = s.leagues[leagueId] || {};
          s.leagues[leagueId] = {
            ...prev,
            platform: platform ?? prev.platform ?? "espn",
            context: { ...(prev.context || {}), ...(context || {}) }
          };
          s.meta.updatedAt = Date.now();
          await setState(s);
          sendResponse({ ok: true, league: s.leagues[leagueId] });
          break;
        }

        // NEW: roster persistence
        case "UPSERT_ROSTER": {
          const s = await getState();
          const { leagueId, roster } = msg;
          if (!leagueId) { sendResponse({ ok: false, error: "missing_leagueId" }); break; }
          s.leagues = s.leagues || {};
          const prev = s.leagues[leagueId] || {};
          s.leagues[leagueId] = { ...prev, roster: Array.isArray(roster) ? roster : (prev.roster || []) };
          s.meta.updatedAt = Date.now();
          await setState(s);
          sendResponse({ ok: true, roster: s.leagues[leagueId].roster });
          break;
        }

        case "CLEAR_DATA": {
          await setState(defaultState());
          sendResponse({ ok: true });
          break;
        }

        default:
          sendResponse({ ok: false, error: "unknown_message_type" });
      }
    } catch (err) {
      console.error("[Brick Layers][background] error:", err);
      sendResponse({ ok: false, error: String(err) });
    }
  })();
  return true; // async responses
});
