// core/store.js
// Optional convenience helpers if you want to use the same schema in popup/sidebar UIs.

export const STORAGE_KEY = "BL_STATE_V1";

export async function getState() {
  const { [STORAGE_KEY]: state } = await chrome.storage.local.get(STORAGE_KEY);
  return state || defaultState();
}

export async function setState(next) {
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
}

export function defaultState() {
  return {
    leagues: {},        // [leagueId]: { platform, settings, teams, roster }
    projections: {},    // [season]: { [playerId]: { name, team, pos: [], cats: {...} } }
    schedules: {},      // [dateISO]: { [teamAbbr]: { opp, homeAway, b2b } }
    meta: { updatedAt: 0 }
  };
}

export async function getLeague(leagueId) {
  const s = await getState();
  return s.leagues?.[leagueId] || null;
}

export async function upsertLeague(leagueId, patch) {
  const s = await getState();
  s.leagues = s.leagues || {};
  s.leagues[leagueId] = { ...(s.leagues[leagueId] || {}), ...patch };
  s.meta.updatedAt = Date.now();
  await setState(s);
  return s.leagues[leagueId];
}

export async function setProjections(season, data) {
  const s = await getState();
  s.projections = s.projections || {};
  s.projections[season] = data;
  s.meta.updatedAt = Date.now();
  await setState(s);
  return true;
}

export async function setSchedules(data) {
  const s = await getState();
  s.schedules = data;
  s.meta.updatedAt = Date.now();
  await setState(s);
  return true;
}
