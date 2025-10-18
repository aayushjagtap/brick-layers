// background.js — storage, demo data, league+roster, and draft-state
// MV3 service worker

// ---- tiny helpers ----
const now = () => Date.now();
const get = (keys) => chrome.storage.local.get(keys);
const set = (obj) => chrome.storage.local.set(obj);

async function getDataStore() {
  const { BL_DATA } = await get(["BL_DATA"]);
  if (BL_DATA) return BL_DATA;

  // --- Demo projections/schedule (replace with full dataset when ready) ---
  const demo = {
    projections: {
      "2025": {
        // id keyed for stability; use your real full NBA dataset here
        "100": { id: "100", name: "Anthony Davis", team: "DAL", pos: ["PF","C"], cats: { pts:27, reb:12, ast:3,  stl:1.2, blk:2.3, "3pm":0.7, fg_pct:.56, ft_pct:.80, to:2.8 }},
        "101": { id: "101", name: "Stephen Curry", team: "GSW", pos: ["PG"],   cats: { pts:28, reb:4,  ast:6,  stl:1.1, blk:0.3, "3pm":4.7, fg_pct:.47, ft_pct:.92, to:3.1 }},
        "102": { id: "102", name: "LeBron James",  team: "LAL", pos: ["SF","PF"], cats: { pts:25, reb:8,  ast:7,  stl:1.0, blk:0.6, "3pm":2.2, fg_pct:.51, ft_pct:.72, to:3.5 }}
      }
    },
    schedules: {
      "2025-10-21": { LAL:{opp:"GSW"}, HOU:{opp:"OKC"}, LAL2:{opp:"GSW"} },
      "2025-10-22": { ATL:{opp:"TOR"}, BKN:{opp:"CHA"}, BOS:{opp:"PHI"} }
    },
    meta: { updatedAt: now() }
  };

  await set({ BL_DATA: demo });
  return demo;
}

async function getLeagueStore() {
  const { BL_LEAGUES } = await get(["BL_LEAGUES"]);
  return BL_LEAGUES || {}; // { [leagueId]: { platform, settings, context, roster } }
}

async function saveLeagueStore(store) {
  await set({ BL_LEAGUES: store });
}

// ---- Draft state: per-league set of drafted player ids & my picks ----
// BL_DRAFT = { [leagueId]: { drafted: string[], myPicks: string[] } }
async function getDraftStore() {
  const { BL_DRAFT } = await get(["BL_DRAFT"]);
  return BL_DRAFT || {};
}
async function saveDraftStore(store) {
  await set({ BL_DRAFT: store });
}

// ---- Message handling ----
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "PING") {
        sendResponse({ ok: true, ts: now() });
        return;
      }

      if (msg.type === "GET_DATA") {
        const data = await getDataStore();
        sendResponse({ ok: true, data });
        return;
      }

      if (msg.type === "UPSERT_LEAGUE_SETTINGS") {
        const leagues = await getLeagueStore();
        const { leagueId, platform, settings } = msg;
        leagues[msg.leagueId] = leagues[msg.leagueId] || {};
        Object.assign(leagues[msg.leagueId], { platform, settings: settings || leagues[msg.leagueId].settings || {} });
        await saveLeagueStore(leagues);
        sendResponse({ ok: true, league: leagues[msg.leagueId] });
        return;
      }

      if (msg.type === "UPSERT_LEAGUE_CONTEXT") {
        const leagues = await getLeagueStore();
        const { leagueId, platform, context } = msg;
        leagues[leagueId] = leagues[leagueId] || {};
        Object.assign(leagues[leagueId], { platform, context: { ...(leagues[leagueId].context || {}), ...(context || {}) } });
        await saveLeagueStore(leagues);
        sendResponse({ ok: true, league: leagues[leagueId] });
        return;
      }

      if (msg.type === "UPSERT_ROSTER") {
        const leagues = await getLeagueStore();
        const { leagueId, roster } = msg;
        leagues[leagueId] = leagues[leagueId] || {};
        leagues[leagueId].roster = roster;
        await saveLeagueStore(leagues);
        sendResponse({ ok: true, roster });
        return;
      }

      if (msg.type === "GET_LEAGUE_SETTINGS") {
        const leagues = await getLeagueStore();
        const league = leagues[msg.leagueId] || null;
        sendResponse({ ok: true, league });
        return;
      }

      // ------ DRAFT STATE API ------
      if (msg.type === "DRAFT_RESET") {
        const store = await getDraftStore();
        store[msg.leagueId] = { drafted: [], myPicks: [] };
        await saveDraftStore(store);
        sendResponse({ ok: true, state: store[msg.leagueId] });
        return;
      }

      if (msg.type === "DRAFT_GET_STATE") {
        const store = await getDraftStore();
        sendResponse({ ok: true, state: store[msg.leagueId] || { drafted: [], myPicks: [] } });
        return;
      }

      if (msg.type === "DRAFT_ADD_PICK") {
        const { leagueId, playerId, mine } = msg;
        const store = await getDraftStore();
        store[leagueId] = store[leagueId] || { drafted: [], myPicks: [] };
        const s = store[leagueId];
        if (!s.drafted.includes(playerId)) s.drafted.push(playerId);
        if (mine && !s.myPicks.includes(playerId)) s.myPicks.push(playerId);
        await saveDraftStore(store);
        sendResponse({ ok: true, state: s });
        return;
      }

      if (msg.type === "DRAFT_REMOVE_PICK") {
        const { leagueId, playerId } = msg;
        const store = await getDraftStore();
        const s = store[leagueId] || { drafted: [], myPicks: [] };
        s.drafted = s.drafted.filter(id => id !== playerId);
        s.myPicks = s.myPicks.filter(id => id !== playerId);
        store[leagueId] = s;
        await saveDraftStore(store);
        sendResponse({ ok: true, state: s });
        return;
      }

      sendResponse({ ok: false, error: "Unknown message type" });
    } catch (e) {
      console.error("[BL] background error:", e);
      sendResponse({ ok: false, error: String(e) });
    }
  })();

  // keep the message channel open for async
  return true;
});

// Optional: keep SW alive a bit for bursts
chrome.alarms.create("bl_heartbeat", { periodInMinutes: 4.9 });
chrome.alarms.onAlarm.addListener(() => void 0);
