// Kitchen Merge — StarHermit platform adapter over the shared SDK
// (js/starhermit-sdk.js, window.StarHermit) plus GET /api/v1/time when signed
// in. Standalone (no launch token) makes no network request at all. The SDK reads the launch token
// (#game_token= or the #access_token= sign-in return), strips it, renews it,
// and makes every platform call here: nickname/avatar, the one cloud-save
// slot game:<slug>, the per-player settings KV, key bindings, the invite link
// and the read-only leaderboard. Hosted mode = the SDK holds a token; without
// one no platform call is made.

export function createPlatform({ sh, store, lsSet, hooks = {} } = {}) {
  const platform = {
    sh: sh || null,
    timeOffset: 0, // server - client, ms
    nickname: null,
    avatar: null, // object URL of the account avatar
    syncState: 'offline', // offline | saving | synced | error
    _adopting: false,
    _cloudReady: false, // set once loadCloud() has compared the slot
    _lastSig: null,

    get token() { return this.hosted ? this.sh.token : null; },
    get sub() { return this.hosted ? String(this.sh.userId) : null; },
    get slug() { return this.sh ? this.sh.slug : null; },
    get hosted() { return !!(this.sh && this.sh.signedIn); },
    canSignIn() { return !!(this.sh && this.sh.canSignIn()); },
    signIn() { return !!(this.sh && this.sh.signIn()); },

    init() {
      if (!this.sh) return this;
      this.sh.init();
      this.sh.on('saved', (ok) => this.setSync(ok ? 'synced' : 'error'));
      this.sh.on('auth', (a) => {
        if (!a.signedIn) { this.nickname = null; this.avatar = null; this.syncState = 'offline'; }
        if (hooks.onAuth) hooks.onAuth(a.signedIn);
        if (hooks.onChange) hooks.onChange();
      });
      return this;
    },

    authHeaders() {
      return this.token ? { Authorization: 'Bearer ' + this.token } : {};
    },
    setSync(state) {
      this.syncState = state;
      if (hooks.onChange) hooks.onChange();
    },

    // Signed in only: round-trip-adjusted offset from GET /api/v1/time.
    // Standalone uses the local clock and makes no request.
    async fetchTime() {
      if (!this.hosted) return;
      try {
        const t0 = Date.now();
        const res = await fetch('/api/v1/time', { headers: this.authHeaders() });
        const t1 = Date.now();
        if (!res.ok) return;
        const data = await res.json();
        const server = typeof data.serverTime === 'number' ? data.serverTime : data.now;
        if (typeof server !== 'number') return;
        this.timeOffset = server - (t0 + (t1 - t0) / 2);
      } catch { /* keep the local clock */ }
    },
    now() { return Date.now() + this.timeOffset; },
    todayIso() { return new Date(this.now()).toISOString().slice(0, 10); },

    // Nickname from the user profile (SDK); never /api/v1/me, never usernames.
    async fetchNickname(userId) {
      const p = this.hosted ? await this.sh.profile(String(userId)) : null;
      return p ? p.displayName : 'Player ' + String(userId).slice(0, 6);
    },
    async fetchProfile() {
      if (!this.hosted) return;
      this.nickname = await this.fetchNickname(this.sub);
      if (hooks.onChange) hooks.onChange();
      const url = await this.sh.avatarUrl();
      if (url) { this.avatar = url; if (hooks.onChange) hooks.onChange(); }
    },

    // ------------------------------------------------------- cloud save ----
    // ONE slot (game:<slug>). localStorage stays the offline cache; cloud is a
    // mirror. Remote wins on load conflict.
    buildSaveDoc() {
      return {
        version: 1,
        savedAt: new Date().toISOString(),
        settings: store.getSettings(),
        progress: store.getProgress(),
        scores: store.getScores(),
      };
    },
    saveSignature(doc) {
      return JSON.stringify(doc.settings) + JSON.stringify(doc.progress) + JSON.stringify(doc.scores);
    },
    // Pushes wait for loadCloud(): a saveJSON() queued at boot (applySettings)
    // would stay pending in the SDK and overwrite a newer cloud doc ~2 s later.
    scheduleCloudPush() {
      if (!this.hosted || this._adopting || !this._cloudReady) return;
      const doc = this.buildSaveDoc();
      const sig = this.saveSignature(doc);
      if (sig === this._lastSig) return;
      this._lastSig = sig;
      this.setSync('saving');
      this.sh.saveJSON(doc); // SDK debounces ~2 s
    },
    flushCloud() {
      if (!this.hosted) return Promise.resolve(false);
      return this.sh.flushSave(true);
    },
    async loadCloud() {
      if (!this.hosted) return;
      const doc = await this.sh.loadJSON();
      this._cloudReady = true;
      if (!doc) { // no remote save yet: push the local doc
        this._lastSig = null;
        this.scheduleCloudPush();
        await this.flushCloud();
        return;
      }
      if (typeof doc !== 'object' || !doc.progress || typeof doc.progress !== 'object') { this.setSync('error'); return; }
      this.adoptRemote(doc);
      this.setSync('synced');
    },
    adoptRemote(doc) {
      this._adopting = true;
      try {
        lsSet('progress', doc.progress);
        if (doc.scores && typeof doc.scores === 'object') lsSet('scores', doc.scores);
        if (doc.settings && typeof doc.settings === 'object') {
          lsSet('settings', doc.settings);
          if (hooks.onSettings) hooks.onSettings(doc.settings);
        }
        this._lastSig = this.saveSignature(this.buildSaveDoc());
      } finally {
        this._adopting = false;
      }
      if (hooks.onChange) hooks.onChange();
    },

    // --------------------------------------- settings KV, controls, invite ----
    getSettings() { return this.hosted ? this.sh.getSettings() : Promise.resolve({}); },
    patchSettings(obj) { if (this.hosted) this.sh.patchSettings(obj); },
    loadBindings(defaults) {
      return this.hosted ? this.sh.loadBindings(defaults) : Promise.resolve(JSON.parse(JSON.stringify(defaults)));
    },
    inviteLink() { return this.hosted ? this.sh.inviteLink() : null; },

    // Read-only platform leaderboard; null when none exists or unreachable.
    async fetchLeaderboard(pageSize = 50) {
      if (!this.hosted) return null;
      try {
        const data = await this.sh.leaderboard(null, { pageSize });
        if (!data || !data.board) return null;
        const rows = [];
        const entries = data.items || [];
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          rows.push({
            rank: e.rank != null ? e.rank : i + 1,
            name: e.userId ? await this.fetchNickname(e.userId) : 'Player',
            score: e.score,
            validated: null,
          });
        }
        return rows;
      } catch { return null; }
    },
  };
  return platform;
}
