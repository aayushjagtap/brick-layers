// content.js — Sidebar + ESPN ranked player-pool + Sleeper ACTIVE fallback
// + projections scraper (auto-paginates when you visit ESPN projections page)

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

  // -------- ESPN: load NBA players for CURRENT SEASON with draft ranks --------
  async function loadEspnAllPlayers(seasonId) {
    if (!seasonId) {
      const q = new URLSearchParams(location.search);
      seasonId = q.get("seasonId") || q.get("season") || new Date().getFullYear();
    }
    seasonId = String(seasonId);

    const BASE = `https://fantasy.espn.com/apis/v3/games/fba/seasons/${seasonId}`;
    const LIMIT = 200;

    const SLOT_TO_POS = {
      0: "PG", 1: "SG", 2: "SF", 3: "PF", 4: "C",
      5: "G", 6: "F", 7: "UTIL",
      8: "BE", 9: "IR", 10: "IL", 11: "IL+", 12: "NA"
    };

    const all = [];
    const pushPage = (arr) => {
      for (const row of arr) {
        const p = row?.player || row;
        const id = String(p.id ?? row.id);
        const name = (p.fullName || `${p.firstName || ""} ${p.lastName || ""}`).trim();
        const teamAbbrev =
          p.proTeam?.abbrev ||
          (p.proTeamId && (row.proTeams?.[p.proTeamId]?.abbrev || "")) ||
          "";

        const pos = Array.from(
          new Set((p.eligibleSlots || [])
            .map(s => SLOT_TO_POS[s])
            .filter(Boolean)
            .filter(x => !["BE","IR","IL","IL+","NA"].includes(x)))
        );

        const rankStd =
          p.draftRanksByRankType?.STANDARD?.rank ??
          p.draftRanksByRankType?.ROTO?.rank ??
          p.ratings?.[0]?.rank ?? null;

        const owned = p.ownership?.percentOwned ?? 0;

        all.push({ id, name, team: teamAbbrev, pos, rank: rankStd, owned });
      }
    };

    // (A) Simple GET paging
    let offset = 0;
    try {
      while (true) {
        const url = `${BASE}/players?scoringPeriodId=1&view=kona_player_info&limit=${LIMIT}&offset=${offset}`;
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) throw new Error(`A-get ${res.status}`);
        const page = await res.json();
        if (!Array.isArray(page) || page.length === 0) break;
        pushPage(page);
        offset += page.length;
        if (page.length < LIMIT) break;
      }
      if (all.length > 0) {
        console.log(`[Brick Layers] ESPN players (simple) ${all.length} for ${seasonId}`);
        return { seasonId, players: all };
      }
    } catch (e) {
      console.warn("[Brick Layers] ESPN simple GET failed, trying X-Fantasy-Filter:", e);
    }

    // (B) Official draft-room style with X-Fantasy-Filter
    const FILTER_TEMPLATE = (offset) => ({
      players: {
        filterStatus: { value: ["FREEAGENT", "ONTEAM"] },
        filterSlotIds: { value: [0,1,2,3,4,5,6,7,8,9,10,11,12] },
        filterRanksForScoringPeriodIds: { value: [1] },
        filterRanksForRankTypes: { value: ["STANDARD"] },
        sortDraftRanks: { sortPriority: 1, sortAsc: true, value: "STANDARD" },
        limit: LIMIT,
        offset
      }
    });

    offset = 0;
    while (true) {
      const url = `${BASE}/players?scoringPeriodId=1&view=kona_player_info`;
      const headers = { "X-Fantasy-Filter": JSON.stringify(FILTER_TEMPLATE(offset)) };
      const res = await fetch(url, { credentials: "include", headers });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error("[Brick Layers] ESPN filter fetch failed", res.status, text?.slice(0, 200));
        throw new Error(`B-filter ${res.status}`);
      }
      const page = await res.json();
      if (!Array.isArray(page) || page.length === 0) break;
      pushPage(page);
      offset += page.length;
      if (page.length < LIMIT) break;
    }

    // Deduplicate best ranks
    const byId = new Map();
    for (const p of all) {
      const prev = byId.get(p.id);
      if (!prev || (prev.rank ?? 99999) > (p.rank ?? 99999)) byId.set(p.id, p);
    }
    const players = [...byId.values()];

    console.log(`[Brick Layers] ESPN players (filter) ${players.length} for ${seasonId}`);
    return { seasonId, players };
  }

  // -------- Sleeper fallback: ACTIVE players only --------
  async function loadSleeperPlayers() {
    const res = await fetch("https://api.sleeper.app/v1/players/nba");
    if (!res.ok) throw new Error("Sleeper players fetch failed");
    const data = await res.json();
    const all = [];
    for (const [id, p] of Object.entries(data)) {
      if (p?.active !== true) continue;
      if (!p?.team) continue;
      if (!p?.full_name) continue;
      const pos = Array.isArray(p.fantasy_positions) ? p.fantasy_positions : (p.position ? [p.position] : []);
      all.push({ id: String(id), name: p.full_name, team: p.team, pos: pos.filter(Boolean), rank: null, owned: 0 });
    }
    console.log(`[Brick Layers] Sleeper ACTIVE players: ${all.length}`);
    const year = new URLSearchParams(location.search).get("seasonId") || String(new Date().getFullYear());
    return { seasonId: year, players: all };
  }

  // -------- Projections: manual page scraper (auto-pagination) --------
  function isEspnProjectionsPage() {
    return location.hostname.endsWith("espn.com") &&
           location.pathname.startsWith("/basketball/players/projections");
  }

  // Click a button and wait a tick
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function normalizePct(val) {
    // ESPN may render 47.3 or .473 — normalize to 0.473
    const n = Number(val);
    if (!Number.isFinite(n)) return 0;
    return n > 1.2 ? n / 100 : n; // anything > 1 is likely percent form
  }

  async function scrapeEspnProjectionsAndCache() {
    // Wait the first tbody
    const waitTbody = async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 8000) {
        const el = document.querySelector(".Table__TBODY");
        if (el) return el;
        await sleep(200);
      }
      return null;
    };
    const firstTbody = await waitTbody();
    if (!firstTbody) { console.warn("[Brick Layers] projections table not found"); return; }

    const q = new URLSearchParams(location.search);
    const seasonId = q.get("seasonId") || q.get("season") || String(new Date().getFullYear());

    const readHeaders = () =>
      Array.from(document.querySelectorAll(".Table__THEAD th"))
        .map(th => (th.textContent || "").trim().toUpperCase());

    const locateCols = (headers) => {
      const colIx = (opts) => {
        const L = Array.isArray(opts) ? opts : [opts];
        for (const l of L) {
          const i = headers.findIndex(h => h === l || h.includes(l));
          if (i !== -1) return i;
        }
        return -1;
      };
      return {
        PLAYER: colIx("PLAYER"),
        TEAMPOS: colIx(["TYPE","TEAM","POS"]),
        PTS: colIx("PTS"),
        REB: colIx("REB"),
        AST: colIx("AST"),
        STL: colIx("STL"),
        BLK: colIx("BLK"),
        TPM: colIx(["3PM","3-PT"]),
        FG:  colIx("FG%"),
        FT:  colIx("FT%"),
        TO:  colIx(["TO","TOV"])
      };
    };

    const projById = {};
    const readPage = () => {
      const headers = readHeaders();
      const ix = locateCols(headers);
      const num = (s) => {
        const t = String(s || "").replace(/[^\d.\-]/g, "");
        const v = parseFloat(t);
        return Number.isFinite(v) ? v : 0;
      };
      for (const tr of Array.from(document.querySelectorAll(".Table__TBODY tr"))) {
        const tds = tr.querySelectorAll("td");
        if (!tds.length) continue;
        const a = tds[ix.PLAYER]?.querySelector('a[href*="/player/"]');
        const name = (a?.textContent || "").trim();
        if (!name) continue;
        const href = a?.getAttribute("href") || "";
        const m = href.match(/\/player\/_\/id\/(\d+)\//);
        const id = m ? m[1] : name;

        let team = "", pos = [];
        const rawTP = (tds[ix.TEAMPOS]?.textContent || "").trim().replace(/\s+/g," ");
        if (rawTP) {
          const parts = rawTP.split(" ");
          const maybePos = parts[parts.length - 1];
          if (/[A-Z]{1,3}(?:\/[A-Z]{1,3})*/.test(maybePos)) {
            team = parts.slice(0, -1).join(" ");
            pos = maybePos.split("/");
          } else {
            team = rawTP;
          }
        }

        const cats = {
          pts:   num(tds[ix.PTS]?.textContent),
          reb:   num(tds[ix.REB]?.textContent),
          ast:   num(tds[ix.AST]?.textContent),
          stl:   num(tds[ix.STL]?.textContent),
          blk:   num(tds[ix.BLK]?.textContent),
          "3pm": num(tds[ix.TPM]?.textContent),
          fg_pct: normalizePct(num(tds[ix.FG]?.textContent)),
          ft_pct: normalizePct(num(tds[ix.FT]?.textContent)),
          to:    num(tds[ix.TO]?.textContent)
        };

        projById[id] = { id, name, team, pos, cats, metaRank: null, metaOwned: 0 };
      }
    };

    // Scrape first page
    readPage();

    // Keep clicking "Next" (or ">" button) until disabled/not present
    // ESPN usually uses buttons with aria-labels or visible text like "Next"
    const isDisabled = (btn) => btn.disabled || btn.getAttribute("aria-disabled") === "true";
    const findNextBtn = () =>
      document.querySelector('button[aria-label*="Next"], button[aria-label*="next"], .Pagination__Button--next');

    // Try up to 2000 players safety
    let pageGuard = 0;
    while (pageGuard < 60) {
      pageGuard++;
      const nextBtn = findNextBtn();
      if (!nextBtn || isDisabled(nextBtn)) break;
      nextBtn.click();
      // wait page swap
      await sleep(500);
      readPage();
      // tiny yield to allow virtualized rows
      await sleep(150);
    }

    const count = Object.keys(projById).length;
    const pack = { projections: { [seasonId]: projById }, schedules: {}, meta: { updatedAt: Date.now() } };
    await new Promise(r => chrome.runtime.sendMessage({ type: "UPSERT_LOADED_PLAYERS", data: pack }, () => r()));
    console.log(`[Brick Layers] scraped ESPN projections: ${count} players for ${seasonId}`);
  }

  // Run scraper only when you open the ESPN projections page manually
  if (isEspnProjectionsPage()) {
    scrapeEspnProjectionsAndCache().catch(e => console.warn("[Brick Layers] projections scrape failed:", e));
  }

  // -------- Convert pool → zero projections (keeps ESPN rank for fallback sort) --------
  function asZeroProjections(players, seasonKey) {
    const byId = {};
    for (const p of players) {
      byId[p.id] = {
        id: p.id,
        name: p.name,
        team: p.team,
        pos: p.pos,
        metaRank: p.rank ?? null,
        metaOwned: p.owned ?? 0,
        cats: { pts:0, reb:0, ast:0, stl:0, blk:0, "3pm":0, fg_pct:0, ft_pct:0, to:0 }
      };
    }
    return { projections: { [seasonKey]: byId }, schedules: {}, meta: { updatedAt: Date.now() } };
  }

  // -------- Draft core --------
  let DraftCore = null;
  (async () => {
    try { DraftCore = await import(chrome.runtime.getURL("core/draft.js")); }
    catch (e) { console.warn("[BL] draft import failed:", e); }
  })();

  // -------- ESPN context -> save --------
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

  // -------- Data cache --------
  let _dataCache = null;
  function getData(cb) {
    if (_dataCache) return cb(_dataCache);
    chrome.runtime.sendMessage({ type: "GET_DATA" }, (resp) => {
      if (!resp?.ok) return cb({ projections: {}, schedules: {}, meta: {} });
      _dataCache = resp.data || { projections: {}, schedules: {}, meta: {} };
      cb(_dataCache);
    });
  }

  // seed demo league
  chrome.runtime.sendMessage({
    type: "UPSERT_LEAGUE_SETTINGS",
    leagueId: "demo-league-1",
    platform: "espn",
    settings: { scoring: "H2H", categories: ["pts","reb","ast","stl","blk","3pm","fg_pct","ft_pct","to"] }
  }, () => {});

  // -------- Roster scrape & save (with fallback) --------
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
          else { console.warn("[BL] roster save failed", resp?.error); }
        });
        return true;
      };

      // Try adapter reader
      let roster = window.BLAdapters.espn.getRoster();

      // Fallback: scrape visible lineup table if adapter returns empty
      if (!roster || !roster.length) {
        try {
          const table = document.querySelector(".Table, table");
          if (table) {
            const headerTexts = Array.from(table.querySelectorAll("thead th")).map(th => (th.textContent || "").trim().toUpperCase());
            const playerCol = headerTexts.findIndex(h => h.includes("PLAYER"));
            if (playerCol !== -1) {
              const rows = Array.from(table.querySelectorAll("tbody tr"));
              const guess = rows.map(r => {
                const cells = r.querySelectorAll("td");
                const playerCell = cells[playerCol];
                const name = (playerCell?.querySelector("a")?.textContent || playerCell?.textContent || "").trim();
                const meta = playerCell?.querySelector("span, div")?.textContent || "";
                const posMatch = meta.match(/\b(PG|SG|SF|PF|C)(?:\/(PG|SG|SF|PF|C))*\b/);
                const pos = posMatch ? meta.split(" ").pop().split("/") : [];
                const teamMatch = meta.match(/\b[A-Z]{2,3}\b/);
                const team = teamMatch ? teamMatch[0] : "";
                return name ? { name, pos, team } : null;
              }).filter(Boolean);
              if (guess.length) roster = guess;
            }
          }
        } catch (e) { /* ignore */ }
      }

      if (!saveRoster(roster)) {
        setTimeout(() => {
          roster = window.BLAdapters.espn.getRoster();
          if (!saveRoster(roster)) renderSidebar(leagueId, []); // show empty instead of stuck "scraping…"
        }, 1200);
      }
    } catch (e) { console.warn("[BL] roster parse failed:", e); }
  })();

  // -------- Badge UI --------
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

  // -------- Sidebar & Tabs --------
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
      body.innerHTML = `<div class="sub">Upcoming schedule demo</div>`;
    }

    // ---------------- Draft ----------------
    function renderDraft() {
      if (!DraftCore) { body.innerHTML = `<div class="sub">Loading draft engine…</div>`; setTimeout(renderDraft, 150); return; }

      getData(async ({ projections }) => {
        let season = Object.keys(projections || {})[0];
        let players = (projections || {})[season] || {};

        if (!season || Object.keys(players).length < 50) {
          try {
            const espn = await loadEspnAllPlayers();
            season = espn.seasonId;
            const zeroProj = asZeroProjections(espn.players, season);
            players = zeroProj.projections[season];
            chrome.runtime.sendMessage({ type: "UPSERT_LOADED_PLAYERS", data: zeroProj }, () => {});
          } catch (e) {
            console.warn("[BL] ESPN pool failed — using Sleeper ACTIVE fallback:", e);
            try {
              const sl = await loadSleeperPlayers();
              season = sl.seasonId;
              const zeroProj = asZeroProjections(sl.players, season);
              players = zeroProj.projections[season];
              chrome.runtime.sendMessage({ type: "UPSERT_LOADED_PLAYERS", data: zeroProj }, () => {});
            } catch (e2) {
              console.error("[BL] Sleeper fallback also failed:", e2);
              body.innerHTML = `<div class="sub">Couldn’t load any player pool. Open from fantasy.espn.com while logged in.</div>`;
              return;
            }
          }
        }

        const cats = ["pts","reb","ast","stl","blk","3pm","fg_pct","ft_pct","to"];

        chrome.runtime.sendMessage({ type: "GET_LEAGUE_SETTINGS", leagueId }, (resp) => {
          const savedRoster = resp?.league?.roster || [];
          const liveDraftDefault = savedRoster.length === 0;

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

          const state = {
            pos: "",
            useNeeds: true,
            liveDraft: liveDraftDefault,
            manualWeights: Object.fromEntries(cats.map(c => [c, 1])),
            drafted: [],
            myPicks: []
          };

          chrome.runtime.sendMessage({ type: "DRAFT_GET_STATE", leagueId }, (r) => {
            if (r?.ok) { state.drafted = r.state.drafted || []; state.myPicks = r.state.myPicks || []; updatePickedList(); renderList(); }
            else { renderList(); }
          });

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
              if (r?.ok) { state.drafted = []; state.myPicks = []; updatePickedList(); renderList(); }
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
                state.drafted = r.state.drafted; state.myPicks = r.state.myPicks;
                liveWrap.querySelector("#search").value = "";
                updatePickedList(); renderList();
              }
            });
          }

          function updatePickedList() {
            const names = state.drafted.map(id => players[id]?.name || id);
            const mine = new Set(state.myPicks);
            liveWrap.querySelector("#pickedList").innerHTML =
              names.length ? names.map((n, i) => {
                const id = state.drafted[i];
                const tag = mine.has(id) ? " (me)" : "";
                return `<span class="chip" style="margin:2px;">${n}${tag}</span>`;
              }).join(" ") : `<span class="sub">(no picks yet)</span>`;
          }

          function effectiveWeights(myPlayers) {
            let needs = Object.fromEntries(cats.map(c => [c, 1]));
            if (state.useNeeds) {
              const source = (state.liveDraft ? myPlayers : null) ||
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
            const myPlayers = state.liveDraft
              ? state.myPicks.map(id => players[id]).filter(Boolean)
              : DraftCore.mapRosterToProjections(savedRoster, players).matched;

            const weights = effectiveWeights(myPlayers);

            const pool = { ...players };
            for (const id of state.drafted) delete pool[id];

            let top = DraftCore.bestAvailable(pool, cats, weights, {
              pos: state.pos ? [state.pos] : [],
              ownedNames: []
            }).slice(0, 50);

            const allZero = top.every(x => Math.abs(x.dv) < 1e-9);
            if (allZero) {
              const arr = Object.values(pool)
                .filter(p => !state.pos || (p.pos || []).includes(state.pos))
                .sort((a, b) => {
                  const ra = (a.metaRank ?? 99999);
                  const rb = (b.metaRank ?? 99999);
                  if (ra !== rb) return ra - rb;
                  return (b.metaOwned ?? 0) - (a.metaOwned ?? 0);
                })
                .slice(0, 25)
                .map(p => ({ player: p, dv: (p.metaRank ? (10000 - p.metaRank) : 0) / 1000 }));
              top = arr;
            } else {
              top = top.slice(0, 25);
            }

            listWrap.innerHTML = `
              <ul>
                ${top.map(item => {
                  const p = item.player;
                  const rankBadge = (p.metaRank != null) ? `<span class="chip">#${p.metaRank}</span>` : "";
                  return `<li>
                    <span>${p.name}</span>
                    <span class="sub">${(p.team||"")} ${(p.pos||[]).join("/")}</span>
                    <span>${rankBadge}</span>
                  </li>`;
                }).join("")}
              </ul>
            `;
          }

          renderList();
        });
      });
    }
  }
})();

