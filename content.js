// content.js — Step 4 (context + roster + sidebar)
(() => {
  if (window.top !== window) return;
  if (!location || !location.hostname) return;

  console.log("[Brick Layers] injected on:", location.href);

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

  const HOST_ID = "brick-layers-host";
  if (document.getElementById(HOST_ID)) return;

  // --- Detect ESPN context and save it ---
  (async () => {
    try {
      if (window.BLAdapters?.espn) {
        const ctx = await window.BLAdapters.espn.detectContext();
        if (ctx?.leagueId) {
          chrome.runtime.sendMessage({
            type: "UPSERT_LEAGUE_CONTEXT",
            leagueId: ctx.leagueId,
            platform: "espn",
            context: { teamId: ctx.teamId, seasonId: ctx.seasonId, teamName: ctx.teamName }
          }, (resp) => {
            if (resp?.ok) {
              console.log("[Brick Layers] ESPN context saved:", {
                leagueId: ctx.leagueId, teamId: ctx.teamId, seasonId: ctx.seasonId, teamName: ctx.teamName
              });
            } else {
              console.warn("[Brick Layers] save context failed:", resp?.error);
            }
          });
        }
      }
    } catch (e) {
      console.warn("[Brick Layers] ESPN detect failed:", e);
    }
  })();

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
    console.log("[Brick Layers] data summary:", {
      season, playersCount: players.length, daysWithSchedules: days.length,
      updatedAt: new Date(meta?.updatedAt || 0).toLocaleString()
    });
  });

  // Optional demo league entry
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
    if (resp?.ok) console.log("[Brick Layers] league saved:", resp.league);
  });

  // --- Fetch roster from ESPN DOM and persist it ---
  (async () => {
    try {
      if (!window.BLAdapters?.espn) return;
      const params = new URLSearchParams(location.search);
      const leagueId = params.get("leagueId");
      if (!leagueId) return;

      // Try immediately, then retry once after a short delay if empty
      const saveRoster = (roster) => {
        if (!roster || !roster.length) return false;
        chrome.runtime.sendMessage({ type: "UPSERT_ROSTER", leagueId, roster }, (resp) => {
          if (resp?.ok) {
            console.log("[Brick Layers] Roster saved:", resp.roster);
            renderSidebar(leagueId, resp.roster);
          } else {
            console.warn("[Brick Layers] roster save failed:", resp?.error);
          }
        });
        return true;
      };

      let roster = window.BLAdapters.espn.getRoster();
      if (!saveRoster(roster)) {
        setTimeout(() => {
          roster = window.BLAdapters.espn.getRoster();
          saveRoster(roster);
        }, 1200);
      }
    } catch (e) {
      console.warn("[Brick Layers] ESPN roster parse failed:", e);
    }
  })();

  // ---------- Badge ----------
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
    .badge { pointer-events:auto; display:inline-flex; align-items:center; gap:8px;
      background: rgba(17,24,39,.92); color:#fff; padding:8px 10px; border-radius:999px;
      box-shadow:0 6px 18px rgba(0,0,0,.25); font:12px/1 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; }
    .dot { width:8px; height:8px; border-radius:50%; background:#22c55e; box-shadow:0 0 0 3px rgba(34,197,94,.25); }
    .x { font-weight:700; margin-left:2px; opacity:.8; cursor:pointer; } .x:hover{opacity:1;}
    .btn { margin-left:6px; padding:4px 8px; border-radius:8px; background:#111827; border:1px solid rgba(255,255,255,.15); color:#fff; cursor:pointer; font-size:12px; }
    .btn:hover { background:#0b1220; }
  `;

  const wrap = document.createElement("div");
  wrap.className = "badge";
  wrap.innerHTML = `
    <span class="dot"></span>
    <span>Brick Layers active on ${location.hostname}</span>
    <span class="btn" id="ping">Ping</span>
    <span class="x" title="Hide">×</span>
  `;
  wrap.querySelector(".x").addEventListener("click", () => { host.remove(); console.log("[Brick Layers] badge removed by user"); });
  wrap.querySelector("#ping").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "PING" }, (resp) => {
      if (resp?.ok) console.log("[Brick Layers] PONG from background:", new Date(resp.ts).toLocaleString());
      else console.warn("[Brick Layers] Ping failed:", resp?.error);
    });
  });

  shadow.appendChild(style);
  shadow.appendChild(wrap);
  console.log("[Brick Layers] badge injected on:", location.hostname);

  // ---------- Minimal sidebar ----------
  function renderSidebar(leagueId, roster) {
    chrome.runtime.sendMessage({ type: "GET_DATA" }, (resp) => {
      const schedules = resp?.data?.schedules || {};
      const days = Object.keys(schedules).sort().slice(0, 3);

      const SIDEBAR_ID = "brick-layers-sidebar";
      if (document.getElementById(SIDEBAR_ID)) return;

      const sideHost = document.createElement("div");
      sideHost.id = SIDEBAR_ID;
      sideHost.style.position = "fixed";
      sideHost.style.top = "80px";
      sideHost.style.right = "16px";
      sideHost.style.width = "320px";
      sideHost.style.maxHeight = "70vh";
      sideHost.style.overflow = "auto";
      sideHost.style.zIndex = "2147483647";
      sideHost.style.pointerEvents = "auto";
      document.documentElement.appendChild(sideHost);

      const shadow = sideHost.attachShadow({ mode: "open" });

      const style = document.createElement("style");
      style.textContent = `
        .panel { font:13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
          background:rgba(17,24,39,.96); color:#fff; border:1px solid rgba(255,255,255,.12);
          border-radius:14px; padding:12px; box-shadow:0 10px 30px rgba(0,0,0,.35); }
        .row{display:flex;justify-content:space-between;align-items:center;gap:8px;}
        .title{font-weight:700;font-size:14px;}
        .sub{opacity:.8;font-size:12px;}
        .section{margin-top:10px;}
        .pill{padding:2px 6px;border:1px solid rgba(255,255,255,.18);border-radius:999px;font-size:11px;opacity:.9;}
        ul{list-style:none;margin:6px 0 0;padding:0;}
        li{padding:4px 0;display:flex;justify-content:space-between;gap:8px;border-bottom:1px dashed rgba(255,255,255,.08);}
        .close{cursor:pointer;opacity:.85;} .close:hover{opacity:1;}
      `;

      const header = document.createElement("div");
      header.className = "row";
      header.innerHTML = `
        <div class="title">Brick Layers</div>
        <div class="pill">League ${leagueId}</div>
        <div class="close" title="Close">✕</div>
      `;

      const rosterEl = document.createElement("div");
      rosterEl.className = "section";
      rosterEl.innerHTML = `<div class="sub">Your Roster (${roster.length})</div>`;
      const ul = document.createElement("ul");
      roster.forEach(p => {
        const li = document.createElement("li");
        li.innerHTML = `<span>${p.name}</span><span class="sub">${(p.team || "")} ${p.pos?.join("/") || ""}</span>`;
        ul.appendChild(li);
      });
      rosterEl.appendChild(ul);

      const schedEl = document.createElement("div");
      schedEl.className = "section";
      schedEl.innerHTML = `<div class="sub">Upcoming (sample data)</div>`;
      const sul = document.createElement("ul");
      days.forEach(d => {
        const games = Object.entries(schedules[d] || {});
        const descr = games.slice(0, 2).map(([team, g]) => `${team}@${g.opp}`).join(" • ");
        const li = document.createElement("li");
        li.innerHTML = `<span>${d}</span><span class="sub">${descr || "—"}</span>`;
        sul.appendChild(li);
      });
      schedEl.appendChild(sul);

      const panel = document.createElement("div");
      panel.className = "panel";
      panel.appendChild(header);
      panel.appendChild(rosterEl);
      panel.appendChild(schedEl);

      header.querySelector(".close").addEventListener("click", () => sideHost.remove());

      shadow.appendChild(style);
      shadow.appendChild(panel);
    });
  }
})();
