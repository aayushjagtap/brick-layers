// content.js — Step 5 (context + roster + tabbed sidebar + Draft: Best Available)

(() => {
  if (window.top !== window) return;
  if (!location || !location.hostname) return;
  console.log("[Brick Layers] injected on:", location.href);

  const allowedHosts = new Set([
    "fantasy.espn.com", "espn.com", "www.espn.com",
    "basketball.fantasysports.yahoo.com", "sports.yahoo.com", "yahoo.com",
    "sleeper.app", "www.sleeper.app"
  ]);
  const isFantasyHost = [...allowedHosts].some(h => location.hostname.endsWith(h));
  if (!isFantasyHost) return;

  const HOST_ID = "brick-layers-host";
  if (document.getElementById(HOST_ID)) return;

  // --- Load draft core (as an ES module injected at runtime) ---
  let DraftCore = null;
  (async () => {
    try {
      // Dynamically import /core/draft.js via blob to work from content script
      const code = `
        ${draftCoreSource()}
        export { computeCategoryStats, zScores, replacementLevels, draftValue, bestAvailable };
      `;
      const blob = new Blob([code], { type: "text/javascript" });
      const modUrl = URL.createObjectURL(blob);
      DraftCore = await import(modUrl);
      URL.revokeObjectURL(modUrl);
    } catch (e) {
      console.warn("[Brick Layers] failed to load Draft core:", e);
    }
  })();

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

  // Ask background for stored data (projections + schedule)
  let _dataCache = null;
  function getData(cb) {
    if (_dataCache) return cb(_dataCache);
    chrome.runtime.sendMessage({ type: "GET_DATA" }, (resp) => {
      if (!resp?.ok) {
        console.warn("[Brick Layers] GET_DATA failed:", resp?.error);
        return cb({ projections: {}, schedules: {}, meta: {} });
      }
      _dataCache = resp.data || { projections: {}, schedules: {}, meta: {} };
      const { projections, schedules, meta } = _dataCache;
      const season = Object.keys(projections || {})[0];
      const players = Object.keys((projections || {})[season] || {});
      const days = Object.keys(schedules || {});
      console.log("[Brick Layers] data summary:", {
        season, playersCount: players.length, daysWithSchedules: days.length,
        updatedAt: new Date(meta?.updatedAt || 0).toLocaleString()
      });
      cb(_dataCache);
    });
  }

  // Optional demo league entry (kept)
  chrome.runtime.sendMessage({
    type: "UPSERT_LEAGUE_SETTINGS",
    leagueId: "demo-league-1",
    platform: "espn",
    settings: {
      scoring: "H2H",
      categories: ["pts", "reb", "ast", "stl", "blk", "3pm", "fg_pct", "ft_pct", "to"],
      playoffWeeks: ["2025-03-31", "2025-04-07", "2025-04-14"]
    }
  }, (resp) => { if (resp?.ok) console.log("[Brick Layers] league saved:", resp.league); });

  // --- Fetch roster from ESPN DOM and persist it ---
  (async () => {
    try {
      if (!window.BLAdapters?.espn) return;
      const params = new URLSearchParams(location.search);
      const leagueId = params.get("leagueId");
      if (!leagueId) return;

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
        setTimeout(() => { roster = window.BLAdapters.espn.getRoster(); saveRoster(roster); }, 1200);
      }
    } catch (e) {
      console.warn("[Brick Layers] ESPN roster parse failed:", e);
    }
  })();

  // ---------- Floating badge ----------
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.position = "fixed";
  host.style.zIndex = "2147483647";
  host.style.bottom = "16px";
  host.style.right = "16px";
  host.style.pointerEvents = "none";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    .badge{pointer-events:auto;display:inline-flex;align-items:center;gap:8px;background:rgba(17,24,39,.92);color:#fff;padding:8px 10px;border-radius:999px;box-shadow:0 6px 18px rgba(0,0,0,.25);font:12px/1 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;}
    .dot{width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.25);}
    .x{font-weight:700;margin-left:2px;opacity:.8;cursor:pointer;} .x:hover{opacity:1;}
    .btn{margin-left:6px;padding:4px 8px;border-radius:8px;background:#111827;border:1px solid rgba(255,255,255,.15);color:#fff;cursor:pointer;font-size:12px;}
    .btn:hover{background:#0b1220;}
  `;
  const wrap = document.createElement("div");
  wrap.className = "badge";
  wrap.innerHTML = `
    <span class="dot"></span>
    <span>Brick Layers active on ${location.hostname}</span>
    <span class="btn" id="openSidebar">Open</span>
    <span class="btn" id="ping">Ping</span>
    <span class="x" title="Hide">×</span>
  `;
  wrap.querySelector(".x").addEventListener("click", () => { host.remove(); console.log("[Brick Layers] badge removed by user"); });
  wrap.querySelector("#ping").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "PING" }, (resp) => {
      if (resp?.ok) console.log("[Brick Layers] PONG:", new Date(resp.ts).toLocaleString());
      else console.warn("[Brick Layers] Ping failed:", resp?.error);
    });
  });
  wrap.querySelector("#openSidebar").addEventListener("click", () => {
    const params = new URLSearchParams(location.search);
    const leagueId = params.get("leagueId") || "demo-league-1";
    // Render empty roster if not scraped yet
    renderSidebar(leagueId, []);
  });
  shadow.appendChild(style); shadow.appendChild(wrap);
  console.log("[Brick Layers] badge injected on:", location.hostname);

  // ---------- Tabbed sidebar ----------
  function renderSidebar(leagueId, roster) {
    const SIDEBAR_ID = "brick-layers-sidebar";
    if (document.getElementById(SIDEBAR_ID)) return;

    const sideHost = document.createElement("div");
    sideHost.id = SIDEBAR_ID;
    sideHost.style.position = "fixed";
    sideHost.style.top = "72px";
    sideHost.style.right = "16px";
    sideHost.style.width = "360px";
    sideHost.style.maxHeight = "74vh";
    sideHost.style.overflow = "auto";
    sideHost.style.zIndex = "2147483647";
    document.documentElement.appendChild(sideHost);

    const sroot = sideHost.attachShadow({ mode: "open" });

    const css = document.createElement("style");
    css.textContent = `
      .panel{font:13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:rgba(17,24,39,.98);color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:16px;box-shadow:0 12px 36px rgba(0,0,0,.35);}
      .hdr{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.08);}
      .ttl{font-weight:700;font-size:14px;} .pill{padding:2px 8px;border:1px solid rgba(255,255,255,.18);border-radius:999px;font-size:11px;opacity:.9;}
      .tabs{display:flex;gap:6px;padding:8px 8px 0 8px;}
      .tab{padding:6px 10px;border-radius:10px;cursor:pointer;border:1px solid rgba(255,255,255,.12);}
      .tab.active{background:#0b1220;}
      .body{padding:10px 12px;}
      ul{list-style:none;margin:6px 0 0;padding:0;}
      li{padding:4px 0;display:flex;justify-content:space-between;gap:8px;border-bottom:1px dashed rgba(255,255,255,.08);}
      .close{cursor:pointer;opacity:.85;} .close:hover{opacity:1;}
      .row{display:flex;gap:8px;align-items:center;margin-bottom:8px;}
      select{background:#0b1220;color:#fff;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:4px 6px;}
      .num{font-variant-numeric:tabular-nums;}
    `;
    const wrap = document.createElement("div");
    wrap.className = "panel";
    wrap.innerHTML = `
      <div class="hdr">
        <div class="ttl">Brick Layers</div>
        <div class="pill">League ${leagueId}</div>
        <div class="close" title="Close">✕</div>
      </div>
      <div class="tabs">
        <div class="tab active" data-tab="roster">Roster</div>
        <div class="tab" data-tab="draft">Draft</div>
        <div class="tab" data-tab="upcoming">Upcoming</div>
      </div>
      <div class="body" id="tabbody"></div>
    `;
    wrap.querySelector(".close").addEventListener("click", () => sideHost.remove());
    sroot.appendChild(css); sroot.appendChild(wrap);

    const body = wrap.querySelector("#tabbody");
    const tabs = wrap.querySelectorAll(".tab");
    tabs.forEach(t => t.addEventListener("click", () => {
      tabs.forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      renderTab(t.dataset.tab);
    }));

    // Render initial
    renderTab("roster");

    function renderTab(which) {
      if (which === "roster") {
        renderRoster();
      } else if (which === "draft") {
        renderDraft();
      } else {
        renderUpcoming();
      }
    }

    function renderRoster() {
      const list = (roster && roster.length) ? roster : [{ name: "(scraping…)", pos: [], team: "" }];
      body.innerHTML = `<div class="row"><div class="pill">Players ${list.length}</div></div><ul>${list.map(p =>
        `<li><span>${p.name}</span><span class="sub">${(p.team || "")} ${p.pos?.join("/") || ""}</span></li>`
      ).join("")}</ul>`;
    }

    function renderUpcoming() {
      getData(({ schedules }) => {
        const days = Object.keys(schedules || {}).sort().slice(0, 4);
        body.innerHTML = `<ul>${
          days.map(d => {
            const games = Object.entries(schedules[d] || {});
            const descr = games.slice(0, 3).map(([team, g]) => `${team}@${g.opp}`).join(" • ");
            return `<li><span>${d}</span><span class="sub">${descr || "—"}</span></li>`;
          }).join("")
        }</ul>`;
      });
    }

    function renderDraft() {
      if (!DraftCore) {
        body.innerHTML = `<div class="sub">Loading draft engine…</div>`;
        setTimeout(renderDraft, 200);
        return;
      }
      getData(({ projections }) => {
        const season = Object.keys(projections || {})[0];
        const players = (projections || {})[season] || {};
        const cats = ["pts","reb","ast","stl","blk","3pm","fg_pct","ft_pct","to"];
        const weights = { pts:1, reb:1, ast:1, stl:1, blk:1, "3pm":1, fg_pct:1, ft_pct:1, to:1 };

        const controls = document.createElement("div");
        controls.className = "row";
        controls.innerHTML = `
          <label class="sub">Filter pos:</label>
          <select id="posf">
            <option value="">All</option>
            <option>PG</option><option>SG</option><option>SF</option><option>PF</option><option>C</option>
          </select>
        `;
        body.innerHTML = "";
        body.appendChild(controls);
        const listWrap = document.createElement("div");
        body.appendChild(listWrap);

        const renderList = () => {
          const pos = controls.querySelector("#posf").value;
          const top = DraftCore.bestAvailable(players, cats, weights, { pos: pos ? [pos] : [] }).slice(0, 10);
          listWrap.innerHTML = `
            <ul>
              ${top.map(item => {
                const p = item.player;
                return `<li>
                  <span>${p.name}</span>
                  <span class="sub">${(p.team||"")} ${(p.pos||[]).join("/")}</span>
                  <span class="num">${item.dv.toFixed(2)}</span>
                </li>`;
              }).join("")}
            </ul>`;
        };

        controls.querySelector("#posf").addEventListener("change", renderList);
        renderList();
      });
    }
  }

  // Inline source for /core/draft.js (so we can import via blob without packaging changes)
  function draftCoreSource() {
    // NOTE: keep this in sync with core/draft.js
    return `
      ${computeCategoryStats_src()}
      ${zScores_src()}
      ${replacementLevels_src()}
      ${draftValue_src()}
      ${bestAvailable_src()}
    `;
  }

  function computeCategoryStats_src(){return `
    function computeCategoryStats(playersById, cats) {
      const catVals = {}; cats.forEach(c => (catVals[c] = []));
      for (const p of Object.values(playersById)) {
        cats.forEach(c => {
          const v = p.cats?.[c];
          if (typeof v === "number" && isFinite(v)) catVals[c].push(v);
        });
      }
      const stats = {};
      cats.forEach(c => {
        const arr = catVals[c];
        const mean = arr.reduce((a, b) => a + b, 0) / Math.max(arr.length, 1);
        const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / Math.max(arr.length, 1);
        const std = Math.sqrt(variance) || 1e-9;
        stats[c] = { mean, std };
      });
      return stats;
    }
    export { computeCategoryStats };
  `}

  function zScores_src(){return `
    function zScores(p, stats, cats) {
      const z = {};
      cats.forEach(c => {
        const v = p.cats?.[c];
        const st = stats[c] || { mean: 0, std: 1 };
        z[c] = typeof v === "number" ? (v - st.mean) / (st.std || 1e-9) : 0;
      });
      return z;
    }
    export { zScores };
  `}

  function replacementLevels_src(){return `
    function replacementLevels(playersById, league) {
      const teams = league?.teamsCount || 12;
      const starters = league?.startersPerPos || { PG:1, SG:1, SF:1, PF:1, C:1, G:0, F:0, UTIL:2 };
      const pool = Object.values(playersById);
      const byPos = {}; Object.keys(starters).forEach(pos => (byPos[pos] = []));
      for (const p of pool) (p.pos || []).forEach(pos => { if (byPos[pos]) byPos[pos].push(p); });
      const repl = {};
      for (const pos of Object.keys(byPos)) {
        const arr = byPos[pos].slice().sort((a, b) => (b.cats?.pts || 0) - (a.cats?.pts || 0));
        const n = Math.max(1, teams * Math.max(1, starters[pos]));
        const idx = Math.min(arr.length - 1, n - 1);
        repl[pos] = arr[idx] || null;
      }
      return repl;
    }
    export { replacementLevels };
  `}

  function draftValue_src(){return `
    function draftValue(z, weights) {
      let sum = 0;
      for (const [cat, val] of Object.entries(z)) {
        const w = weights?.[cat] ?? 1;
        sum += (cat === "to") ? (w * -val) : (w * val);
      }
      return sum;
    }
    export { draftValue };
  `}

  function bestAvailable_src(){return `
    import { computeCategoryStats } from 'data:text/javascript,export{}';
    import { zScores } from 'data:text/javascript,export{}';
    import { draftValue } from 'data:text/javascript,export{}';

    function bestAvailable(playersById, cats, weights, filters = {}) {
      const stats = computeCategoryStats(playersById, cats);
      const list = [];
      for (const [id, p] of Object.entries(playersById)) {
        if (filters.pos && filters.pos.length) {
          const ok = (p.pos || []).some(pp => filters.pos.includes(pp));
          if (!ok) continue;
        }
        const z = zScores(p, stats, cats);
        const dv = draftValue(z, weights);
        list.push({ id, player: p, z, dv });
      }
      return list.sort((a, b) => b.dv - a.dv);
    }
    export { bestAvailable };
  `}
})();
