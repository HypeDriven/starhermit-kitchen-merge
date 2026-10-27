// Kitchen Merge — the save document and its merge. The document is the one
// the browser build kept in its cloud slot (game:<slug>) and in localStorage
// (kitchen-merge:settings / progress / scores): { version: 1, savedAt,
// settings, progress, scores }. On the StarHermit engine it is the game's save
// (native/platform.ts); two devices' copies merge with mergeDocs. Pure: node
// tests import it.

export const LS_PREFIX = 'kitchen-merge:';
export const DOC_KEYS = ['settings', 'progress', 'scores'];

/** A save document from anything (the browser build's cloud text, an engine save); null when it is none. */
export function parseDoc(v) {
  let d = v;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return null; } }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  if (!d.progress || typeof d.progress !== 'object') return null;
  return {
    version: 1,
    savedAt: typeof d.savedAt === 'string' ? d.savedAt : new Date(0).toISOString(),
    settings: d.settings && typeof d.settings === 'object' && !Array.isArray(d.settings) ? d.settings : {},
    progress: d.progress,
    scores: d.scores && typeof d.scores === 'object' && !Array.isArray(d.scores) ? d.scores : {},
  };
}

// Another device saved since this one last loaded the slot: keep the better of
// each side's progress (furthest journey stage, best stars, every lesson,
// achievement, play day and mastery stage) and both score tables, and keep this
// device's settings (they are the ones the player is looking at).
export function mergeDocs(remote, local) {
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const arr = (v) => (Array.isArray(v) ? v : []);
  const union = (a, b) => [...new Set([...arr(a), ...arr(b)])];
  const r = obj(remote), l = obj(local);
  const rp = obj(r.progress), lp = obj(l.progress);
  const stars = { ...obj(rp.stars) };
  for (const [k, v] of Object.entries(obj(lp.stars))) stars[k] = Math.max(Number(stars[k]) || 0, Number(v) || 0);
  const achievements = { ...obj(rp.achievements) };
  for (const [k, v] of Object.entries(obj(lp.achievements))) {
    const o = achievements[k];
    achievements[k] = !o ? v : { ...o, at: String(o.at) < String(v && v.at) ? o.at : (v && v.at) || o.at, announced: !!(o.announced || (v && v.announced)) };
  }
  const masteryStages = union(rp.masteryStages, lp.masteryStages);
  const progress = {
    ...rp, ...lp,
    journeyStage: Math.max(Number(rp.journeyStage) || 0, Number(lp.journeyStage) || 0),
    stars, achievements,
    tutorialsDone: union(rp.tutorialsDone, lp.tutorialsDone),
    playDays: union(rp.playDays, lp.playDays),
    masteryStages,
    masteryDone: Math.max(Number(rp.masteryDone) || 0, Number(lp.masteryDone) || 0, masteryStages.length),
  };
  const scores = {};
  const rs = obj(r.scores), ls = obj(l.scores);
  for (const id of new Set([...Object.keys(rs), ...Object.keys(ls)])) {
    const seen = new Set();
    scores[id] = [...arr(rs[id]), ...arr(ls[id])]
      .filter((e) => { const key = e && (e.sessionId || JSON.stringify(e)); if (!e || seen.has(key)) return false; seen.add(key); return true; })
      .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
      .slice(0, 20);
  }
  return { version: 1, savedAt: new Date().toISOString(), settings: l.settings && typeof l.settings === 'object' ? l.settings : obj(r.settings), progress, scores };
}
