// core/draft.js
// Minimal z-score & positional-replacement scaffolding for "Best Available".

export function computeCategoryStats(playersById, cats) {
  const catVals = {};
  cats.forEach(c => (catVals[c] = []));
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

export function zScores(p, stats, cats) {
  const z = {};
  cats.forEach(c => {
    const v = p.cats?.[c];
    const { mean, std } = stats[c] || { mean: 0, std: 1 };
    z[c] = typeof v === "number" ? (v - mean) / (std || 1e-9) : 0;
  });
  return z;
}

export function replacementLevels(playersById, league) {
  const teams = league?.teamsCount || 12;
  const starters = league?.startersPerPos || { PG: 1, SG: 1, SF: 1, PF: 1, C: 1, G: 0, F: 0, UTIL: 2 };
  const pool = Object.values(playersById);

  const byPos = {};
  Object.keys(starters).forEach(pos => (byPos[pos] = []));
  for (const p of pool) {
    (p.pos || []).forEach(pos => {
      if (byPos[pos]) byPos[pos].push(p);
    });
  }

  const repl = {};
  for (const pos of Object.keys(byPos)) {
    const arr = byPos[pos].slice().sort((a, b) => (b.cats?.pts || 0) - (a.cats?.pts || 0));
    const n = Math.max(1, teams * Math.max(1, starters[pos]));
    const idx = Math.min(arr.length - 1, n - 1);
    repl[pos] = arr[idx] || null;
  }
  return repl;
}

export function draftValue(z, weights) {
  let sum = 0;
  for (const [cat, val] of Object.entries(z)) {
    const w = weights?.[cat] ?? 1;
    sum += (cat === "to") ? (w * -val) : (w * val);
  }
  return sum;
}

export function bestAvailable(playersById, cats, weights, filters = {}) {
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
