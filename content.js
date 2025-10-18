// content.js — Tabbed sidebar (Roster / Draft / Upcoming) + Draft engine import + ESPN context & roster

(() => {
  // Don’t run in iframes or on non-target hosts
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

  // Prevent duplicate injection
  const HOST_ID = "brick-layers-host";
  if (document.getElementById(HOST_ID)) return;

  // --- Load the Draft core as a real module (fast & reliable) ---
  let DraftCore = null;
  (async () => {
    try {
      DraftCore = await import(chrome.runtime.getURL("core/draft.js"));
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

  // --- Projections + Schedules (demo data) ---
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

  // --- Optional demo league entry ---
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

  // --- Scrape roster from ESPN and persist it ---
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
    renderSidebar(leagueId, []); // open immediately; roster fills when saved
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
      .sub{opacity:.8;font-size:12px;} .num{font-variant-numeric:tabular-nums;}
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

    renderTab("roster");

    function renderTab(which) {
      if (which === "roster") renderRoster();
      else if (which === "draft") renderDraft();
      else renderUpcoming();
    }

    function renderRoster() {
      const list = (roster && roster.length) ? roster : [{ name: "(scraping…)", pos: [], team: "" }];
      body.innerHTML = `<div class="row"><div class="pill">Players ${list.length}</div></div><ul>${
        list.map(p => `<li><span>${p.name}</span><span class="sub">${(p.team || "")} ${p.pos?.join("/") || ""}</span></li>`).join("")
      }</ul>`;
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

    // ---------- Draft tab (needs-based + sliders + owned filter) ----------
    function renderDraft() {
      if (!DraftCore) {
        body.innerHTML = `<div class="sub">Loading draft engine…</div>`;
        setTimeout(renderDraft, 150);
        return;
      }

      getData(({ projections }) => {
        const season = Object.keys(projections || {})[0];
        const players = (projections || {})[season] || {};
        const cats = ["pts","reb","ast","stl","blk","3pm","fg_pct","ft_pct","to"];

        body.innerHTML = "";

        // Controls row
        const controls = document.createElement("div");
        controls.className = "row";
        controls.style.flexWrap = "wrap";
        controls.innerHTML = `
          <label class="sub">Filter pos:</label>
          <select id="posf">
            <option value="">All</option>
            <option>PG</option><option>SG</option><option>SF</option><option>PF</option><option>C</option>
          </select>
          <label class="sub" style="margin-left:8px;">
            <input type="checkbox" id="useNeeds" checked style="vertical-align:middle; margin-right:4px;"> Use team needs
          </label>
        `;
        body.appendChild(controls);

        // Category sliders
        const weightsWrap = document.createElement("div");
        weightsWrap.className = "row";
        weightsWrap.style.flexWrap = "wrap";
        weightsWrap.style.gap = "8px";
        weightsWrap.style.margin = "6px 0 4px 0";
        weightsWrap.innerHTML = cats.map(c => `
          <div style="display:flex;align-items:center;gap:6px;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:4px 6px;">
            <label class="sub" style="min-width:46px;text-transform:uppercase;">${c}</label>
            <input type="range" min="0" max="200" value="100" data-cat="${c}">
            <span class="sub num" data-lab="${c}">1.00</span>
          </div>
        `).join("");
        body.appendChild(weightsWrap);

        const listWrap = document.createElement("div");
        body.appendChild(listWrap);

        // Pull roster from storage to compute needs & exclude owned
        const params = new URLSearchParams(location.search);
        const leagueId = params.get("leagueId");
        chrome.runtime.sendMessage({ type: "GET_LEAGUE_SETTINGS", leagueId }, (resp) => {
          const roster = resp?.league?.roster || [];

          // Default & needs weights
          let baseWeights = Object.fromEntries(cats.map(c => [c, 1]));
          let needsWeights = baseWeights;

          if (roster.length) {
            const { matched } = DraftCore.mapRosterToProjections(roster, players);
            if (matched.length) {
              const { teamZ } = DraftCore.teamZFromRoster(matched, players, cats);
              needsWeights = DraftCore.weightsFromNeeds(teamZ);
            }
          }

          // UI state
          const state = {
            pos: "",
            useNeeds: true,
            manualWeights: { ...baseWeights },
          };

          // Initialize slider labels
          for (const c of cats) {
            const lab = weightsWrap.querySelector(`[data-lab="${c}"]`);
            lab.textContent = state.manualWeights[c].toFixed(2);
            const slider = weightsWrap.querySelector(`input[data-cat="${c}"]`);
            slider.value = String(Math.round(state.manualWeights[c] * 100));
          }

          // Wire controls
          controls.querySelector("#posf").addEventListener("change", (e) => {
            state.pos = e.target.value || "";
            renderList();
          });
          controls.querySelector("#useNeeds").addEventListener("change", (e) => {
            state.useNeeds = !!e.target.checked;
            renderList();
          });
          weightsWrap.querySelectorAll('input[type="range"]').forEach(sl => {
            sl.addEventListener("input", () => {
              const cat = sl.dataset.cat;
              const v = Math.max(0, Number(sl.value) || 100) / 100;
              state.manualWeights[cat] = v;
              const lab = weightsWrap.querySelector(`[data-lab="${cat}"]`);
              lab.textContent = v.toFixed(2);
              renderList();
            });
          });

          renderList();

          function effectiveWeights() {
            // needs (0.5..1.5) × manual slider (0..2)
            const w = {};
            for (const c of cats) {
              const needs = state.useNeeds ? (needsWeights[c] ?? 1) : 1;
              w[c] = needs * (state.manualWeights[c] ?? 1);
            }
            return w;
          }

          function renderList() {
            const weights = effectiveWeights();
            const ownedNames = roster.map(r => r.name);
            const top = DraftCore.bestAvailable(players, cats, weights, {
              pos: state.pos ? [state.pos] : [],
              ownedNames
            }).slice(0, 15);

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
              </ul>
            `;
          }
        });
      });
    }
  }
})();
