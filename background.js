// background.js (MV3 service worker, ESM-friendly)

// Simple in-memory cache for projections/schedules
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const state = {
  projections: {},
  schedules: {},
  lastFetch: 0
};

// Listen for messages from content scripts / popup / sidebar
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "GET_NORMALIZED_DATA") {
        await ensureData();
        sendResponse({
          ok: true,
          data: {
            projections: state.projections,
            schedules: state.schedules
          }
        });
      } else if (msg?.type === "PING") {
        sendResponse({ ok: true, pong: true, ts: Date.now() });
      }
    } catch (err) {
      console.error("[Brick Layers][background] error:", err);
      sendResponse({ ok: false, error: String(err) });
    }
  })();
  return true; // keep the channel open for async responses
});

// Ensure our cache is populated/fresh
async function ensureData() {
  const now = Date.now();
  if (now - state.lastFetch < CACHE_TTL_MS) return;

  // In Step 1, we stub these out. In later steps, wire to your feeds.
  state.projections = await loadProjections();
  state.schedules = await loadSchedules();
  state.lastFetch = now;

  console.log("[Brick Layers][background] data refreshed", {
    projectionsCount: Object.keys(state.projections || {}).length,
    schedulesCount: Object.keys(state.schedules || {}).length
  });
}

// TODO: Replace with real projection sources (static JSON or remote)
async function loadProjections() {
  // Example shape (for later steps):
  // return {
  //   "2025": {
  //     "playerId_123": {
  //       name: "Player A",
  //       team: "LAL",
  //       pos: ["SG", "SF"],
  //       cats: { pts: 24.5, reb: 6.1, ast: 4.3, stl: 1.3, blk: 0.6, "3pm": 2.7, fg_pct: 0.475, ft_pct: 0.85, to: 2.3 }
  //     }
  //   }
  // };
  return {}; // stub for step 1
}

// TODO: Replace with real NBA schedule feed
async function loadSchedules() {
  // Example shape (for later steps):
  // return {
  //   "2025-10-20": { LAL: { opp: "GSW", homeAway: "home", b2b: false }, GSW: {...} },
  //   "2025-10-21": { ... }
  // };
  return {}; // stub for step 1
}

// Optional: simple alarm to refresh cache on a cadence (disabled for now)
// chrome.alarms.create("refreshData", { periodInMinutes: 60 });
// chrome.alarms.onAlarm.addListener(async alarm => {
//   if (alarm.name === "refreshData") await ensureData();
// });
