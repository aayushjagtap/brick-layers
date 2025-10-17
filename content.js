// content.js — Step 2
(() => {
  // Don’t run in iframes
  if (window.top !== window) return;
  if (!location || !location.hostname) return;

  console.log("[Brick Layers] injected on:", location.href);

  // Limit to fantasy basketball hosts
  const allowedHosts = new Set([
    "fantasy.espn.com",
    "espn.com",
    "www.espn.com",
    "basketball.fantasysports.yahoo.com",
    "sports.yahoo.com",
    "yahoo.com",
    "sleeper.app",
    "www.sleeper.app"
  ]);
  const isFantasyHost = [...allowedHosts].some(h => location.hostname.endsWith(h));
  if (!isFantasyHost) return;

  // Prevent duplicate injection
  const HOST_ID = "brick-layers-host";
  if (document.getElementById(HOST_ID)) return;

  // Ask background for stored data
  chrome.runtime.sendMessage({ type: "GET_DATA" }, (resp) => {
    if (!resp?.ok) {
      console.warn("[Brick Layers] GET_DATA failed:", resp?.error);
      return;
    }
    const { projections, schedules, meta } = resp.data || {};
    const season = Object.keys(projections || {})[0];
    const players = Object.keys((projections || {})[season] || {});
    const days = Object.keys(schedules || {});
    console.debug("[Brick Layers] data summary:", {
      season,
      playersCount: players.length,
      daysWithSchedules: days.length,
      updatedAt: new Date(meta?.updatedAt || 0).toLocaleString()
    });
  });

  // Add a demo league to storage
  chrome.runtime.sendMessage({
    type: "UPSERT_LEAGUE_SETTINGS",
    leagueId: "demo-league-1",
    platform: "espn",
    settings: {
      scoring: "H2H",
      categories: ["pts", "reb", "ast", "stl", "blk", "3pm", "fg_pct", "ft_pct", "to"],
      playoffWeeks: ["2025-03-31", "2025-04-07", "2025-04-14"]
    }
  }, (resp) => {
    if (resp?.ok) console.debug("[Brick Layers] league saved:", resp.league);
  });

  // ---------- Badge injection ----------
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.position = "fixed";
  host.style.zIndex = "2147483647";
  host.style.bottom = "16px";
  host.style.right = "16px";
  host.style.width = "auto";
  host.style.height = "auto";
  host.style.pointerEvents = "none";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    .badge {
      pointer-events: auto;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(17, 24, 39, 0.92);
      color: #fff;
      padding: 8px 10px;
      border-radius: 999px;
      box-shadow: 0 6px 18px rgba(0,0,0,.25);
      font: 12px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      user-select: none;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 0 3px rgba(34,197,94,.25);
    }
    .x {
      display: inline-block;
      font-weight: 700;
      margin-left: 2px;
      opacity: .8;
      cursor: pointer;
    }
    .x:hover { opacity: 1; }
    .btn {
      margin-left: 6px;
      padding: 4px 8px;
      border-radius: 8px;
      background: #111827;
      border: 1px solid rgba(255,255,255,.15);
      color: #fff;
      cursor: pointer;
      font-size: 12px;
    }
    .btn:hover { background: #0b1220; }
  `;

  const wrap = document.createElement("div");
  wrap.className = "badge";
  wrap.innerHTML = `
    <span class="dot"></span>
    <span>Brick Layers active on ${location.hostname}</span>
    <span class="btn" id="ping">Ping</span>
    <span class="x" title="Hide">×</span>
  `;

  wrap.querySelector(".x").addEventListener("click", () => {
    host.remove();
    console.log("[Brick Layers] badge removed by user");
  });

  wrap.querySelector("#ping").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "PING" }, (resp) => {
      if (resp?.ok)
        console.log("[Brick Layers] PONG from background:", new Date(resp.ts).toLocaleString());
      else
        console.warn("[Brick Layers] Ping failed:", resp?.error);
    });
  });

  shadow.appendChild(style);
  shadow.appendChild(wrap);

  console.log("[Brick Layers] badge injected on:", location.hostname);
})();
