// adapters/espn.js
// Robust ESPN context detector with team-name resolution.
// Exposes: window.BLAdapters.espn.detectContext()

(function () {
  const host = location.hostname || "";
  const isESPN =
    /(^|\.)espn\.com$/i.test(host) || /(^|\.)fantasy\.espn\.com$/i.test(host);

  // --- small utils ---
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

  const isGeneric = (s) => {
    if (!s) return true;
    const t = s.toLowerCase();
    if (t.includes("fantasy basketball team clubhouse")) return true;
    if (t === "fantasy basketball") return true;
    if (t === "clubhouse") return true;
    // discard very short / non-informative strings
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

  // Wait for an element that matches any selector (or time out)
  function waitForAny(selectors, timeoutMs = 2500) {
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

  // Strategy A: direct header text (most reliable when present)
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

  // Strategy B: meta titles often include "{Team Name} - Fantasy Basketball ..."
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

  // Strategy C: find an anchor that links to *this* team (includes leagueId & teamId)
  function teamNameFromAnchors(leagueId, teamId) {
    if (!leagueId || !teamId) return null;
    const hrefNeedle = `/basketball/team?leagueId=${leagueId}&teamId=${teamId}`;
    // Grab many anchors to be safe (header nav, sidebars, menus)
    const anchors = Array.from(document.querySelectorAll('a[href*="/basketball/team?"]'));
    // Prefer exact match start, then contains
    const exact = anchors.find(a => a.getAttribute("href")?.includes(hrefNeedle));
    const cand = exact || anchors.find(a => {
      const h = a.getAttribute("href") || "";
      return h.includes(`leagueId=${leagueId}`) && h.includes(`teamId=${teamId}`);
    });
    const txt = clean(cand?.textContent || "");
    return txt && !isGeneric(txt) ? txt : null;
  }

  // Strategy D: general headings that look like custom names
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

  async function detectContext() {
    if (!isESPN) return null;

    const path = location.pathname || "";
    const looksLikeFantasyHoops =
      path.includes("/fantasy/") || path.includes("/basketball/");
    if (!looksLikeFantasyHoops) return null;

    const { leagueId, teamId, seasonId } = getParamsFromURL();
    if (!leagueId && !teamId) return null;

    // Give the app a moment to render its header
    await waitForAny(
      [
        '.ClubhouseHeader__TeamName',
        '[data-testid="teamHeaderTeamName"]',
        '[data-testid="clubhouse-header"]',
        'main h1',
        'header h1'
      ],
      2500
    );

    // Try strategies in order of reliability
    let teamName =
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

  window.BLAdapters = window.BLAdapters || {};
  window.BLAdapters.espn = { detectContext };
})();

