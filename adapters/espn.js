// adapters/espn.js — ESPN context + robust roster scraper (new + legacy DOMs)

(function () {
  const host = location.hostname || "";
  const isESPN =
    /(^|\.)espn\.com$/i.test(host) || /(^|\.)fantasy\.espn\.com$/i.test(host);

  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

  function getParamsFromURL() {
    try {
      const u = new URL(location.href);
      const q = u.searchParams;
      const leagueId = q.get("leagueId") || q.get("leagueid") || null;
      const teamId   = q.get("teamId")   || q.get("teamid")   || null;
      const seasonId = q.get("seasonId") || q.get("season")   || null;
      return { leagueId, teamId, seasonId };
    } catch {
      return { leagueId: null, teamId: null, seasonId: null };
    }
  }

  function waitForAny(selectors, timeoutMs = 3000) {
    return new Promise((resolve) => {
      const tryOne = () => selectors.map(sel => document.querySelector(sel)).find(Boolean);
      const el = tryOne();
      if (el) return resolve(el);
      const obs = new MutationObserver(() => { const e = tryOne(); if (e) { obs.disconnect(); resolve(e); } });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); resolve(null); }, timeoutMs);
    });
  }

  const isGenericTeam = (t) => {
    if (!t) return true;
    const s = t.toLowerCase();
    return (
      s.includes("fantasy basketball team clubhouse") ||
      s === "fantasy basketball" ||
      s === "clubhouse" ||
      s.replace(/[^\w]/g, "").length < 3
    );
  };

  function teamNameFromHeader() {
    const sels = [
      '[data-testid="teamHeaderTeamName"]',
      '.ClubhouseHeader__TeamName',
      '[data-testid="clubhouse-header"] h1',
      '[data-testid="page-title"]',
      'header h1',
      'main h1',
      'h1.TeamName'
    ];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      const txt = clean(el?.textContent || "");
      if (txt && !isGenericTeam(txt)) return txt;
    }
    return null;
  }
  function teamNameFromMeta() {
    const metas = [
      document.querySelector('meta[property="og:title"]')?.content,
      document.querySelector('meta[name="twitter:title"]')?.content
    ].filter(Boolean);
    for (const m of metas) {
      const txt = clean(m);
      if (!txt) continue;
      const cand = clean(txt.split(" - ")[0]);
      if (cand && !isGenericTeam(cand)) return cand;
    }
    return null;
  }
  function teamNameFromAnchors(leagueId, teamId) {
    if (!leagueId || !teamId) return null;
    const needle = `/basketball/team?leagueId=${leagueId}&teamId=${teamId}`;
    const anchors = Array.from(document.querySelectorAll('a[href*="/basketball/team?"]'));
    const a = anchors.find(x => x.getAttribute("href")?.includes(needle));
    const txt = clean(a?.textContent || "");
    return txt && !isGenericTeam(txt) ? txt : null;
  }
  function teamNameFromGeneric() {
    const cands = Array.from(document.querySelectorAll('h1,h2,[class*="TeamName"],[data-testid*="TeamName"]'))
      .map(el => clean(el.textContent))
      .filter(Boolean)
      .filter(t => !isGenericTeam(t))
      .filter(t => t.length >= 4);
    return cands.length ? cands.sort((a, b) => b.length - a.length)[0] : null;
  }

  async function detectContext() {
    if (!isESPN) return null;
    const path = location.pathname || "";
    if (!path.includes("/fantasy/") && !path.includes("/basketball/")) return null;

    const { leagueId, teamId, seasonId } = getParamsFromURL();
    if (!leagueId && !teamId) return null;

    await waitForAny([
      '[data-testid="teamHeaderTeamName"]',
      '.ClubhouseHeader__TeamName',
      '[data-testid="clubhouse-header"]',
      'main h1',
      'header h1',
      '[data-testid="rosterSlot"]',
      '[data-testid="rosterTable"]',
      '.Table__TBODY',
      'table tbody'
    ], 3000);

    const teamName =
      teamNameFromHeader() ||
      teamNameFromMeta() ||
      teamNameFromAnchors(leagueId, teamId) ||
      teamNameFromGeneric() ||
      null;

    return { platform: "espn", leagueId, teamId, seasonId, teamName };
  }

  function getRoster() {
    let rows = Array.from(document.querySelectorAll('[data-testid="rosterSlot"]'));
    let mode = "modern";
    if (!rows.length) {
      rows = Array.from(document.querySelectorAll('[data-testid="rosterTable"] tr, .Table__TBODY tr, table tbody tr'));
      mode = "table";
    }

    const cleanText = (s) => clean(s).replace(/\s+\((?:DTD|O|Q|P|IR|INJ|NA).*?\)$/i, "");
    const roster = [];
    for (const tr of rows) {
      const nameEl =
        tr.querySelector('[data-testid="playerName"]') ||
        tr.querySelector('a[href*="/player/_/id/"]') ||
        tr.querySelector('a[href*="/player/"]') ||
        tr.querySelector('.player__columnName') ||
        tr.querySelector('td a');

      if (!nameEl) continue;
      const name = cleanText(nameEl.textContent || "");
      if (!name || name === "Player") continue;

      const href = nameEl.getAttribute("href") || "";
      const idMatch = href.match(/\/player\/_\/id\/(\d+)\//);
      const espnId = idMatch ? idMatch[1] : undefined;

      const tpe =
        tr.querySelector('[data-testid="playerTeamPos"]') ||
        tr.querySelector('.player__position') ||
        tr.querySelector('td:nth-child(3), td[data-idx="POS"]');

      let team = "";
      let pos = [];
      const txt = clean(tpe?.textContent || "");
      if (txt) {
        const m = txt.match(/^([A-Z]{2,3})\s+(.+)$/);
        if (m) { team = m[1]; pos = m[2].split(/[,\s/]+/).filter(Boolean); }
        else { pos = txt.split(/[,\s/]+/).filter(Boolean); }
      }

      if (!pos.length) {
        const cells = tr.querySelectorAll("td");
        const guess = clean(cells[1]?.textContent || cells[2]?.textContent || "");
        if (guess) pos = guess.split(/[,\s/]+/).filter(Boolean);
      }

      roster.push({ name, team: team || undefined, pos, espnId });
    }

    const seen = new Set();
    const unique = roster.filter(p => {
      const k = `${p.espnId || ""}|${p.name}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    console.log(`[Brick Layers] ESPN roster parsed (${mode}):`, unique.length);
    return unique;
  }

  window.BLAdapters = window.BLAdapters || {};
  window.BLAdapters.espn = { detectContext, getRoster };
})();

