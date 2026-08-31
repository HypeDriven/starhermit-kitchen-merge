// Kitchen Merge — authoritative server script (StarHermit `server=server.js`).
// Zero-dependency Node ESM. Serves the static distribution and a small API:
//   GET  /api/v1/time    — authoritative platform time (UTC)
//   GET  /api/v1/scores?day=YYYY-MM-DD — daily leaderboard
//   POST /api/v1/scores  — submit a daily score with replay envelope
// Score claims are validated by replaying the deterministic input log.
// If validation cannot pass, entries are stored but labelled casual.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { replayEnvelope, compareResults, totalScore } from './js/rules.js';
import { dailyLevel, CONTENT_VERSION } from './js/content.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.KM_DATA || path.join(__dirname, 'data');
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.opus': 'audio/ogg',
};

function loadScores() {
  try { return JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8')); } catch { return { days: {} }; }
}
function saveScores(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SCORES_FILE, JSON.stringify(db));
}

// Rate limiting: simple per-IP token bucket.
const buckets = new Map();
function rateOk(ip, limit = 30, windowMs = 60000) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || now > b.reset) { b = { count: 0, reset: now + windowMs }; buckets.set(ip, b); }
  b.count++;
  return b.count <= limit;
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function handleApi(req, res, url) {
  const ip = req.socket.remoteAddress || 'unknown';
  if (!rateOk(ip)) return json(res, 429, { error: 'rate-limited' });

  if (url.pathname === '/api/v1/time' && req.method === 'GET') {
    return json(res, 200, { now: Date.now() });
  }

  if (url.pathname === '/api/v1/scores' && req.method === 'GET') {
    const day = url.searchParams.get('day') || new Date().toISOString().slice(0, 10);
    if (!DATE_RE.test(day)) return json(res, 400, { error: 'bad-day' });
    const db = loadScores();
    const scores = (db.days[day] || []).map((e) => ({
      sessionId: e.sessionId, score: e.score, fulfilled: e.fulfilled, validated: e.validated,
    }));
    return json(res, 200, { day, scores, excluded: !!(db.excluded && db.excluded[day]) });
  }

  if (url.pathname === '/api/v1/scores' && req.method === 'POST') {
    let body = '';
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 512 * 1024) return json(res, 413, { error: 'payload-too-large' });
      body += chunk;
    }
    let claim;
    try { claim = JSON.parse(body); } catch { return json(res, 400, { error: 'bad-json' }); }

    // Validate identity, bounds and structure.
    if (!claim || typeof claim !== 'object') return json(res, 400, { error: 'bad-claim' });
    if (!DATE_RE.test(claim.day || '')) return json(res, 400, { error: 'bad-day' });
    if (typeof claim.score !== 'number' || !Number.isInteger(claim.score) || claim.score < 0 || claim.score > 1e7) {
      return json(res, 400, { error: 'bad-score' });
    }
    if (typeof claim.sessionId !== 'string' || claim.sessionId.length > 40) return json(res, 400, { error: 'bad-session' });
    if (claim.contentVersion !== CONTENT_VERSION) return json(res, 400, { error: 'stale-version' });

    const db = loadScores();
    if (db.excluded && db.excluded[claim.day]) return json(res, 400, { error: 'day-excluded-from-ranking' });

    // Daily seeds are immutable: derive the level from the day, never trust
    // the client's seed.
    const level = dailyLevel(claim.day);
    let validated = false;
    if (claim.envelope && claim.envelope.levelId === level.id && claim.envelope.seed === level.seed) {
      const rep = replayEnvelope(level, claim.envelope);
      validated = rep.ok && rep.score === claim.score;
    }

    const entry = {
      sessionId: claim.sessionId,
      score: claim.score,
      components: claim.components || null,
      fulfilled: claim.fulfilled | 0,
      invalidActions: claim.invalidActions | 0,
      ticks: claim.ticks | 0,
      assists: Array.isArray(claim.assists) ? claim.assists.slice(0, 8) : [],
      validated,
      at: new Date().toISOString(),
    };
    // Idempotent by session id: a resubmission replaces the previous entry.
    db.days[claim.day] = (db.days[claim.day] || []).filter((e) => e.sessionId !== entry.sessionId);
    db.days[claim.day].push(entry);
    db.days[claim.day].sort((a, b) => compareResults(a, b));
    db.days[claim.day] = db.days[claim.day].slice(0, 100);
    saveScores(db);

    const rank = db.days[claim.day].findIndex((e) => e.sessionId === entry.sessionId) + 1;
    return json(res, 200, { ok: true, validated, rank, total: db.days[claim.day].length });
  }

  return json(res, 404, { error: 'not-found' });
}

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(__dirname, p));
  if (!file.startsWith(__dirname)) { res.writeHead(403); return res.end('forbidden'); }
  // Keep secrets and data outside the served tree.
  if (file.startsWith(DATA_DIR)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(file);
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    // Immutable hashed assets (three.js) cache long; HTML does not.
    headers['Cache-Control'] = ext === '.html' ? 'no-cache' : 'public, max-age=3600';
    res.writeHead(200, headers);
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  return serveStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log('Kitchen Merge server listening on http://localhost:' + PORT);
});
