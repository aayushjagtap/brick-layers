// content.js — Sidebar + Draft (Live Draft Mode) + ESPN context & roster

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

  // Draft core
  let DraftCore = null;
  (async () => {
    try { DraftCore = await import(chrome.runtime.getURL("core/draft.js")); }
    catch (e) { console.warn("[Brick Layers] draft import failed:", e); }
  })();

  // Detect ESPN context
  (async () => {
    try {
      if (window.BLAdapters?.espn) {
        const ctx = await window.BLAdapters.espn.detectContext();
        if (ctx?.leagueId) {
          chrome.runtime.sendMessage({
            type: "UPSERT_LEAGUE_CONTEXT",
            leagueId: ctx.leagueId, platform: "espn",
            context: { teamId: ctx.teamId, seasonId: ctx.seasonId, teamName: ctx.teamName }
          }, (resp) => resp?.ok ? console.log("[BL] ESPN context saved", ctx) : console.warn("[BL] ctx save failed", resp?.error));
        }
      }
    } catch (e) { console.warn("[BL] ESPN detect failed:", e); }
  })();

  // Data cache
  let _dataCache = null;
  function getData(cb) {
    if (_dataCache) return cb(_dataCache);
    chrome.runtime.sendMessage({ type: "GET_DATA" }, (resp) => {
      if (!resp?.ok) return cb({ projections: {}, schedules: {}, meta: {} });
      _dataCache = resp.data || { projections: {}, schedules: {}, meta: {} };
      cb(_dataCache);
    });
  }

  // Demo league
  chrome.runtime.sendMessage({
    type: "UPSERT_LEAGUE_SETTINGS",
    leagueId: "demo-league-1",
    platform: "espn",
    settings: { scoring: "H2H", categories: ["pts","reb","ast","stl","blk","3pm","fg_pct","ft_pct","to"] }
  }, () => {});

  // Scrape roster
  (async () => {
    try {
      if (!window.BLAdapters?.espn) return;
      const params = new URLSearchParams(location.search);
      const leagueId = params.get("leagueId");
      if (!leagueId) return;

      const saveRoster = (roster) => {
        if (!roster || !roster.length) return false;
        chrome.runtime.sendMessage({ type: "UPSERT_ROSTER", leagueId, roster }, (resp) => {
          if (resp?.ok) { console.log("[BL] roster saved", resp.roster); renderSidebar(leagueId, resp.roster); }
        });
        return true;
      };

      let roster = window.BLAdapters.espn.getRoster();
      if (!saveRoster(roster)) setTimeout(() => { roster = window.BLAdapters.espn.getRoster(); saveRoster(roster); }, 1200);
    } catch (e) { console.warn("[BL] roster parse failed:", e); }
  })();

  // Badge
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
  wrap.querySelector(".x").addEventListener("click", () => host.remove());
  wrap.querySelector("#ping").addEventListener("click", () => chrome.runtime.sendMessage({ type: "PING" }, (r)=>console.log("[BL] PONG", r?.ts)));
  wrap.querySelector("#openSidebar").addEventListener("click", () => {
    const params = new URLSearchParams(location.search);
    const leagueId = params.get("leagueId") || "demo-league-1";
    renderSidebar(leagueId, []);
  });
  shadow.appendChild(style); shadow.appendChild(wrap);

  // Sidebar
  function renderSidebar(leagueId, roster) {
    const SIDEBAR_ID = "brick-layers-sidebar";
    if (document.getElementById(SIDEBAR_ID)) return;

    const sideHost = document.createElement("div");
    sideHost.id = SIDEBAR_ID;
    sideHost.style.position = "fixed";
    sideHost.style.top = "72px";
    sideHost.style.right = "16px";
    sideHost.style.width = "380px";
    sideHost.style.maxHeight = "76vh";
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
      .row{display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;}
      select,input[type="text"]{background:#0b1220;color:#fff;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:4px 6px;}
      .sub{opacity:.8;font-size:12px;} .num{font-variant-numeric:tabular-nums;}
      .chip{padding:3px 6px;border:1px solid rgba(255,255,255,.18);border-radius:999px;font-size:11px;}
      .btns{display:flex;gap:6px;}
      .btn-sm{padding:2px 6px;border-radius:8px;background:#111827;border:1px solid rgba(255,255,255,.2);cursor:pointer;}
      .btn-sm:hover{background:#0b1220;}
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
      body.innerHTML = `<div class="row"><div class="chip">Players ${list.length}</div></div><ul>${
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

    // ---------------- Draft (with Live Draft Mode) ----------------
    function renderDraft() {
      if (!DraftCore) { body.innerHTML = `<div class="sub">Loading draft engine…</div>`; setTimeout(renderDraft, 150); return; }

      getData(({ projections }) => {
        const season = Object.keys(projections || {})[0];
        const players = (projections || {})[season] || {};
        const cats = ["pts","reb","ast","stl","blk","3pm","fg_pct","ft_pct","to"];

        // fetch league to see roster; if empty → live draft mode by default
        chrome.runtime.sendMessage({ type: "GET_LEAGUE_SETTINGS", leagueId }, (resp) => {
          const savedRoster = resp?.league?.roster || [];
          const liveDraftDefault = savedRoster.length === 0;

          // UI skeleton
          body.innerHTML = "";
          const topRow = document.createElement("div");
          topRow.className = "row";
          topRow.innerHTML = `
            <label class="sub">Filter pos:</label>
            <select id="posf">
              <option value="">All</option>
              <option>PG</option><option>SG</option><option>SF</option><option>PF</option><option>C</option>
            </select>
            <label class="sub"><input type="checkbox" id="useNeeds" checked style="vertical-align:middle;margin-right:4px;"> Use team needs</label>
            <label class="sub"><input type="checkbox" id="liveDraft" ${liveDraftDefault ? "checked": ""} style="vertical-align:middle;margin-right:4px;"> Draft mode</label>
          `;
          body.appendChild(topRow);

          // Sliders
          const weightsWrap = document.createElement("div");
          weightsWrap.className = "row";
          weightsWrap.style.gap = "8px";
          weightsWrap.innerHTML = cats.map(c => `
            <div style="display:flex;align-items:center;gap:6px;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:4px 6px;">
              <label class="sub" style="min-width:54px;text-transform:uppercase;">${c}</label>
              <input type="range" min="0" max="200" value="100" data-cat="${c}">
              <span class="sub num" data-lab="${c}">1.00</span>
            </div>
          `).join("");
          body.appendChild(weightsWrap);

          // Live draft controls
          const liveWrap = document.createElement("div");
          liveWrap.className = "row";
          liveWrap.style.width = "100%";
          liveWrap.innerHTML = `
            <div class="chip">Live Draft</div>
            <input type="text" id="search" placeholder="Search player…" style="flex:1 1 auto;min-width:160px;">
            <div class="btns">
              <button class="btn-sm" id="pickMe">Picked by me</button>
              <button class="btn-sm" id="pickThem">Picked by others</button>
              <button class="btn-sm" id="resetDraft">Reset</button>
            </div>
            <div id="pickedList" class="sub" style="width:100%;opacity:.9;"></div>
          `;
          body.appendChild(liveWrap);

          const listWrap = document.createElement("div");
          body.appendChild(listWrap);

          // state
          const state = {
            pos: "",
            useNeeds: true,
            liveDraft: liveDraftDefault,
            manualWeights: Object.fromEntries(cats.map(c => [c, 1])),
            drafted: [], // player ids (from background)
            myPicks: []
          };

          // init sliders
          for (const c of cats) {
            const lab = weightsWrap.querySelector(`[data-lab="${c}"]`);
            lab.textContent = "1.00";
          }

          // load draft state
          chrome.runtime.sendMessage({ type: "DRAFT_GET_STATE", leagueId }, (r) => {
            if (r?.ok) {
              state.drafted = r.state.drafted || [];
              state.myPicks = r.state.myPicks || [];
              updatePickedList();
              renderList();
            } else {
              renderList();
            }
          });

          // events
          topRow.querySelector("#posf").addEventListener("change", e => { state.pos = e.target.value || ""; renderList(); });
          topRow.querySelector("#useNeeds").addEventListener("change", e => { state.useNeeds = !!e.target.checked; renderList(); });
          topRow.querySelector("#liveDraft").addEventListener("change", e => { state.liveDraft = !!e.target.checked; renderList(); });

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

          liveWrap.querySelector("#pickMe").addEventListener("click", () => addPick(true));
          liveWrap.querySelector("#pickThem").addEventListener("click", () => addPick(false));
          liveWrap.querySelector("#resetDraft").addEventListener("click", () => {
            chrome.runtime.sendMessage({ type: "DRAFT_RESET", leagueId }, (r) => {
              if (r?.ok) {
                state.drafted = []; state.myPicks = [];
                updatePickedList(); renderList();
              }
            });
          });

          function addPick(mine) {
            const q = liveWrap.querySelector("#search").value.trim().toLowerCase();
            if (!q) return;
            const hit = Object.values(players).find(p => p.name.toLowerCase() === q) ||
                        Object.values(players).find(p => p.name.toLowerCase().includes(q));
            if (!hit) return;
            chrome.runtime.sendMessage({ type: "DRAFT_ADD_PICK", leagueId, playerId: hit.id || hit.name, mine }, (r) => {
              if (r?.ok) {
                state.drafted = r.state.drafted;
                state.myPicks = r.state.myPicks;
                liveWrap.querySelector("#search").value = "";
                updatePickedList();
                renderList();
              }
            });
          }

          function updatePickedList() {
            const names = state.drafted.map(id => players[id]?.name || id);
            const mine = new Set(state.myPicks);
            liveWrap.querySelector("#pickedList").innerHTML =
              names.length ? names.map((n, i) => {
                const id = state.drafted[i];
                const mineTag = mine.has(id) ? " (me)" : "";
                return `<span class="chip" style="margin:2px;">${n}${mineTag}</span>`;
              }).join(" ") : `<span class="sub">(no picks yet)</span>`;
          }

          function effectiveWeights(myPlayers) {
            // needs (0.5..1.5) from my picks or roster; multiplied by manual sliders
            let needs = Object.fromEntries(cats.map(c => [c, 1]));
            if (state.useNeeds) {
              const source = (state.liveDraft ? myPlayers : null) || // use drafted-by-me in live mode
                             (savedRoster.length ? DraftCore.mapRosterToProjections(savedRoster, players).matched : []);
              if (source && source.length) {
                const { teamZ } = DraftCore.teamZFromRoster(source, players, cats);
                needs = DraftCore.weightsFromNeeds(teamZ);
              }
            }
            const w = {};
            for (const c of cats) w[c] = (needs[c] ?? 1) * (state.manualWeights[c] ?? 1);
            return w;
          }

          function renderList() {
            // Compute "my players" for needs: either my picks (live) or saved roster
            const myPlayers = state.liveDraft
              ? state.myPicks.map(id => players[id]).filter(Boolean)
              : DraftCore.mapRosterToProjections(savedRoster, players).matched;

            const weights = effectiveWeights(myPlayers);
            const ownedNames = []; // we handle exclusion via drafted ids instead
            // build filters: pos + exclude drafted
            const pool = { ...players };
            for (const id of state.drafted) delete pool[id];

            const top = DraftCore.bestAvailable(pool, cats, weights, {
              pos: state.pos ? [state.pos] : [],
              ownedNames
            }).slice(0, 20);

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

          // initial draw
          renderList();
        });
      });
    }
  }
})();
