// background.js — storage, league/roster, draft state, and data merge for ESPN player pool

const now = () => Date.now();
const get = (keys) => chrome.storage.local.get(keys);
const set = (obj) => chrome.storage.local.set(obj);

// ---------- Data store ----------
async function getDataStore() {
  const { BL_DATA } = await get(["BL_DATA"]);
  // BL_DATA shape: { projections: { [season]: { id: playerObj } }, schedules: {}, meta:{} }
  return BL_DATA || { projections: {}, schedules: {}, meta: { updatedAt: now() } };
}
async function saveDataStore(data) { await set({ BL_DATA: data }); }

// ---------- League store ----------
async function getLeagueStore() {
  const { BL_LEAGUES } = await get(["BL_LEAGUES"]);
  return BL_LEAGUES || {}; // { [leagueId]: { platform, settings, context, roster } }
}
async function saveLeagueStore(store) { await set({ BL_LEAGUES: store }); }

// ---------- Draft store ----------
async function getDraftStore() {
  const { BL_DRAFT } = await get(["BL_DRAFT"]);
  return BL_DRAFT || {}; // { [leagueId]: { drafted:[], myPicks:[] } }
}
async function saveDraftStore(store) { await set({ BL_DRAFT: store }); }

// ---------- SW listener ----------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      // Health
      if (msg.type === "PING") { sendResponse({ ok: true, ts: now() }); return; }

      // Data
      if (msg.type === "GET_DATA") { sendResponse({ ok: true, data: await getDataStore() }); return; }

      // Merge/replace projections coming from content (ESPN player pool or your own file)
      if (msg.type === "UPSERT_LOADED_PLAYERS") {
        const incoming = msg.data; // expected: { projections:{ [season]: { id: {...} } }, schedules?, meta? }
        const store = await getDataStore();
        store.projections = { ...store.projections, ...incoming.projections };
        store.schedules = { ...store.schedules, ...(incoming.schedules || {}) };
        store.meta = { ...(store.meta || {}), ...(incoming.meta || {}), updatedAt: now() };
        await saveDataStore(store);
        sendResponse({ ok: true });
        return;
      }

      // League
      if (msg.type === "UPSERT_LEAGUE_SETTINGS") {
        const leagues = await getLeagueStore();
        const { leagueId, platform, settings } = msg;
        leagues[leagueId] = leagues[leagueId] || {};
        Object.assign(leagues[leagueId], { platform, settings: settings || leagues[leagueId].settings || {} });
        await saveLeagueStore(leagues);
        sendResponse({ ok: true, league: leagues[leagueId] });
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

      // Draft state
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
  return true;
});

// Keep SW alive-ish
chrome.alarms.create("bl_heartbeat", { periodInMinutes: 4.9 });
chrome.alarms.onAlarm.addListener(() => void 0);

