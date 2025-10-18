// adapters/espn.js
// ESPN context + roster extraction (new + legacy DOMs).
// Exposes: window.BLAdapters.espn.detectContext(), window.BLAdapters.espn.getRoster()

(function () {
  const host = location.hostname || "";
  const isESPN =
    /(^|\.)espn\.com$/i.test(host) || /(^|\.)fantasy\.espn\.com$/i.test(host);

  // ---------- utils ----------
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

  // ---------- team name helpers ----------
  const isGenericTeam = (t) => {
    if (!t) return true;
    const s = t.toLowerCase();
    if (s.includes("fantasy basketball team clubhouse")) return true;
    if (s === "fantasy basketball") return true;
    if (s === "clubhouse") return true;
    if (s.replace(/[^\w]/g, "").length < 3) return true;
    return false;
  };

  function teamNameFromHeader() {
    const selectors = [
      '[data-testid="teamHeaderTeamName"]',
      '.ClubhouseHeader__TeamName',
      '[data-testid="clubhouse-header"] h1',
      '[data-testid="page-title"]',
      'header h1',
      'main h1',
      'h1.TeamName',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const txt = clean(el?.textContent || "");
      if (txt && !isGenericTeam(txt)) return txt;
    }
    return null;
  }

  function teamNameFromMeta() {
    const metas = [
      document.querySelector('meta[property="og:title"]')?.content,
      document.querySelector('meta[name="twitter:title"]')?.content,
    ].filter(Boolean);
    for (const m of metas) {
      const txt = clean(m);
      if (!txt) continue;
      const candidate = clean(txt.split(" - ")[0]);
      if (candidate && !isGenericTeam(candidate)) return candidate;
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
    return txt && !isGenericTeam(txt) ? txt : null;
  }

  function teamNameFromGenericHeadings() {
    const cands = Array.from(
      document.querySelectorAll('h1,h2,[class*="TeamName"],[data-testid*="TeamName"]')
    )
      .map(el => clean(el.textContent))
      .filter(Boolean)
      .filter(t => !isGenericTeam(t))
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
        '[data-testid="teamHeaderTeamName"]',
        '.ClubhouseHeader__TeamName',
        '[data-testid="clubhouse-header"]',
        'main h1',
        'header h1',
        // roster bits we also wait for
        '[data-testid="rosterSlot"]',
        '[data-testid="rosterTable"]',
        '.Table__TBODY',
        'table tbody'
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
  // Supports both new React layouts (data-testid="rosterSlot") and legacy tables.
  // Returns [{ name, team, pos: string[], espnId? }]
  function getRoster() {
    // 1) Try modern rows first
    let rows = Array.from(document.querySelectorAll('[data-testid="rosterSlot"]'));
    let mode = "modern";

    // Fallback to table rows (legacy)
    if (!rows.length) {
      rows = Array.from(document.querySelectorAll('[data-testid="rosterTable"] tr, .Table__TBODY tr, table tbody tr'));
      mode = "table";
    }

    const roster = [];
    for (const tr of rows) {
      // Find name element
      const nameEl =
        tr.querySelector('[data-testid="playerName"]') ||
        tr.querySelector('a[href*="/player/_/id/"]') ||
        tr.querySelector('a[href*="/player/"]') ||
        tr.querySelector('.player__columnName') ||
        tr.querySelector('td a');

      if (!nameEl) continue;

      // Clean player name (strip any trailing status like (DTD))
      const rawName = clean(nameEl.textContent || "");
      const name = rawName.replace(/\s+\((?:DTD|O|Q|P|IR|INJ|NA).*?\)$/i, "");

      // Grab ESPN numeric id if present
      const href = nameEl.getAttribute("href") || "";
      const idMatch = href.match(/\/player\/_\/id\/(\d+)\//);
      const espnId = idMatch ? idMatch[1] : undefined;

      // Team + positions
      let team = "";
      let pos = [];

      // Common “TEAM POS” text container (new layout)
      const teamPosEl =
        tr.querySelector('[data-testid="playerTeamPos"]') ||
        tr.querySelector('.player__position') ||
        tr.querySelector('td:nth-child(3), td[data-idx="POS"]');

      const teamPosText = clean(teamPosEl?.textContent || "");

      // Patterns to parse e.g. "LAL PF/SF", "GS PG", "IND PF C"
      // Prefer team abbreviation first token, then split positions by /, , or whitespace
      if (teamPosText) {
        // Try TEAM + positions
        let m = teamPosText.match(/^([A-Z]{2,3})\s+(.+)$/);
        if (m) {
          team = m[1];
          pos = m[2].split(/[,\s/]+/).filter(Boolean);
        } else {
          // Sometimes shows only positions
          pos = teamPosText.split(/[,\s/]+/).filter(Boolean);
        }
      }

      // Legacy tables may show position in 2nd or 3rd cell
      if (!pos.length) {
        const cells = tr.querySelectorAll("td");
        if (cells.length) {
          const guess = clean(cells[1]?.textContent || cells[2]?.textContent || "");
          if (guess) pos = guess.split(/[,\s/]+/).filter(Boolean);
        }
      }

      // Skip obvious non-player rows
      if (!name || name === "Player") continue;

      roster.push({ name, team: team || undefined, pos, espnId });
    }

    // De-dup in case of header rows/etc.
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

  // expose
  window.BLAdapters = window.BLAdapters || {};
  window.BLAdapters.espn = { detectContext, getRoster };
})();

