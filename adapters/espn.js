// adapters/espn.js
// ESPN context + roster extraction
// Exposes: window.BLAdapters.espn.detectContext(), window.BLAdapters.espn.getRoster()

(function () {
  const host = location.hostname || "";
  const isESPN =
    /(^|\.)espn\.com$/i.test(host) || /(^|\.)fantasy\.espn\.com$/i.test(host);

  // ---------- utils ----------
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const isGeneric = (s) => {
    if (!s) return true;
    const t = s.toLowerCase();
    if (t.includes("fantasy basketball team clubhouse")) return true;
    if (t === "fantasy basketball") return true;
    if (t === "clubhouse") return true;
    if (t.replace(/[^\w]/g, "").length < 3) return true;
    return false;
  };

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
      const found = () => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) return el;
        }
        return null;
      };
      const first = found();
      if (first) return resolve(first);
      const obs = new MutationObserver(() => {
        const el = found();
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => {
        obs.disconnect();
        resolve(null);
      }, timeoutMs);
    });
  }

  // ---------- team name strategies ----------
  function teamNameFromHeader() {
    const selectors = [
      '.ClubhouseHeader__TeamName',
      '[data-testid="teamHeaderTeamName"]',
      '[data-testid="clubhouse-header"] h1',
      '[data-testid="page-title"]',
      'header h1',
      'main h1',
      'h1.TeamName',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const txt = clean(el?.textContent || "");
      if (txt && !isGeneric(txt)) return txt;
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
      const candidate = clean(txt.split(" - ")[0]);
      if (candidate && !isGeneric(candidate)) return candidate;
    }
    return null;
  }

  function teamNameFromAnchors(leagueId, teamId) {
    if (!leagueId || !teamId) return null;
    const hrefNeedle = `/basketball/team?leagueId=${leagueId}&teamId=${teamId}`;
    const anchors = Array.from(document.querySelectorAll('a[href*="/basketball/team?"]'));
    const exact = anchors.find(a => a.getAttribute("href")?.includes(hrefNeedle));
    const cand = exact || anchors.find(a => {
      const h = a.getAttribute("href") || "";
      return h.includes(`leagueId=${leagueId}`) && h.includes(`teamId=${teamId}`);
    });
    const txt = clean(cand?.textContent || "");
    return txt && !isGeneric(txt) ? txt : null;
  }

  function teamNameFromGenericHeadings() {
    const cands = Array.from(
      document.querySelectorAll('h1,h2,[class*="TeamName"],[data-testid*="TeamName"]')
    )
      .map(el => clean(el.textContent))
      .filter(Boolean)
      .filter(t => !isGeneric(t))
      .filter(t => t.length >= 4);
    if (cands.length) return cands.sort((a, b) => b.length - a.length)[0];
    return null;
  }

  // ---------- public: detect context ----------
  async function detectContext() {
    if (!isESPN) return null;

    const path = location.pathname || "";
    const looksLikeFantasyHoops =
      path.includes("/fantasy/") || path.includes("/basketball/");
    if (!looksLikeFantasyHoops) return null;

    const { leagueId, teamId, seasonId } = getParamsFromURL();
    if (!leagueId && !teamId) return null;

    await waitForAny(
      [
        '.ClubhouseHeader__TeamName',
        '[data-testid="teamHeaderTeamName"]',
        '[data-testid="clubhouse-header"]',
        'main h1',
        'header h1',
        '[data-testid="rosterTable"]',
        '.Table__TBODY'
      ],
      3000
    );

    const teamName =
      teamNameFromHeader() ||
      teamNameFromMeta() ||
      teamNameFromAnchors(leagueId, teamId) ||
      teamNameFromGenericHeadings() ||
      null;

    return {
      platform: "espn",
      leagueId: leagueId || undefined,
      teamId: teamId || undefined,
      seasonId: seasonId || undefined,
      teamName: teamName || undefined
    };
  }

  // ---------- public: get roster ----------
  // Returns array of { name, pos: string[], team?: string, espnId?: string }
  function getRoster() {
    const rowSelectors = [
      '[data-testid="rosterTable"] tr',
      '.Table__TBODY tr',
      'table tbody tr'
    ];
    let rows = [];
    for (const sel of rowSelectors) {
      rows = Array.from(document.querySelectorAll(sel));
      if (rows.length) break;
    }
    const players = [];
    for (const tr of rows) {
      const a = tr.querySelector('a[href*="/player/_/id/"]');
      const name = clean(a?.textContent || "");
      if (!name) continue;

      const href = a?.getAttribute("href") || "";
      const idMatch = href.match(/\/player\/_\/id\/(\d+)\//);
      const espnId = idMatch ? idMatch[1] : undefined;

      // Position(s) and team (best-effort)
      let posText = "";
      let teamText = "";

      const posLike = tr.querySelector('[class*="pos"], [data-idx="POS"], td:nth-child(2), span:has(+ span)');
      if (posLike) posText = clean(posLike.textContent);

      const teamLike = tr.querySelector('[class*="Team"] abbr, [class*="team"], td:nth-child(3) abbr');
      if (teamLike) teamText = clean(teamLike.textContent);

      const pos = posText
        ? posText.split(/[,\s/]+/).map(p => p.trim()).filter(Boolean)
        : [];

      players.push({ name, pos, team: teamText || undefined, espnId });
    }

    const seen = new Set();
    return players.filter(p => {
      const key = `${p.espnId || ""}|${p.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  window.BLAdapters = window.BLAdapters || {};
  window.BLAdapters.espn = { detectContext, getRoster };
})();

