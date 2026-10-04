// Kitchen Merge — Graphics section of the Settings screen: quality preset,
// render scale, per-effect overrides, adaptive resolution, frame-rate readout
// and a cost summary. Strings are localized here (the rest of the game ships
// English only); the locale comes from ?lang= or navigator.languages.
import { PRESETS, CATEGORIES, resolve, presetTier, applyPreset } from './gfx.js';

const EN_US = {
  graphics: 'Graphics', quality: 'Quality', auto: 'Auto (detected: {tier})',
  low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra',
  renderScale: 'Render scale', fromPreset: 'From preset ({tier})',
  shadows: 'Shadows', ao: 'Ambient occlusion', bloom: 'Bloom', grade: 'Color grade',
  antialias: 'Anti-aliasing', reflections: 'Reflections', detail: 'Scene detail',
  particles: 'Particles', ambient: 'Ambient motion',
  t_off: 'Off', t_on: 'On', t_low: 'Low', t_medium: 'Medium', t_high: 'High',
  t_fxaa: 'FXAA', t_smaa: 'SMAA', t_msaa: 'MSAA', t_plain: 'Plain', t_detailed: 'Detailed',
  t_static: 'Static', t_animated: 'Animated',
  adaptive: 'Adaptive resolution', showFps: 'Show frame rate',
  postNote: 'Post-processing is unavailable on this device; the game renders without it.',
  noWebgl: '3D view unavailable — these settings apply when WebGL is available.',
  unknownGpu: 'unknown GPU',
  d_noShadows: 'no shadows', d_shadows: 'shadows', d_ao: 'ambient occlusion', d_aoFull: 'full ambient occlusion',
  d_bloom: 'bloom', d_reflections: 'reflections', d_noAA: 'no anti-aliasing',
};

const STRINGS = {
  'en-US': EN_US,
  'en-GB': { ...EN_US, grade: 'Colour grade' },
  'es-419': {
    graphics: 'Gráficos', quality: 'Calidad', auto: 'Automática (detectada: {tier})',
    low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra',
    renderScale: 'Escala de renderizado', fromPreset: 'Según el ajuste ({tier})',
    shadows: 'Sombras', ao: 'Oclusión ambiental', bloom: 'Resplandor', grade: 'Corrección de color',
    antialias: 'Antialiasing', reflections: 'Reflejos', detail: 'Detalle de la escena',
    particles: 'Partículas', ambient: 'Movimiento ambiental',
    t_off: 'No', t_on: 'Sí', t_low: 'Baja', t_medium: 'Media', t_high: 'Alta',
    t_fxaa: 'FXAA', t_smaa: 'SMAA', t_msaa: 'MSAA', t_plain: 'Simple', t_detailed: 'Detallado',
    t_static: 'Estático', t_animated: 'Animado',
    adaptive: 'Resolución adaptativa', showFps: 'Mostrar cuadros por segundo',
    postNote: 'El posprocesado no está disponible en este dispositivo; el juego se muestra sin él.',
    noWebgl: 'Vista 3D no disponible: estos ajustes se aplican cuando WebGL está disponible.',
    unknownGpu: 'GPU desconocida',
    d_noShadows: 'sin sombras', d_shadows: 'sombras', d_ao: 'oclusión ambiental', d_aoFull: 'oclusión ambiental completa',
    d_bloom: 'resplandor', d_reflections: 'reflejos', d_noAA: 'sin antialiasing',
  },
  'es-ES': null, // filled below from es-419 with Spain variants
  'de-DE': {
    graphics: 'Grafik', quality: 'Qualität', auto: 'Automatisch (erkannt: {tier})',
    low: 'Niedrig', balanced: 'Ausgewogen', high: 'Hoch', ultra: 'Ultra',
    renderScale: 'Renderskalierung', fromPreset: 'Aus Voreinstellung ({tier})',
    shadows: 'Schatten', ao: 'Umgebungsverdeckung', bloom: 'Bloom', grade: 'Farbkorrektur',
    antialias: 'Kantenglättung', reflections: 'Reflexionen', detail: 'Szenendetails',
    particles: 'Partikel', ambient: 'Umgebungsbewegung',
    t_off: 'Aus', t_on: 'An', t_low: 'Niedrig', t_medium: 'Mittel', t_high: 'Hoch',
    t_fxaa: 'FXAA', t_smaa: 'SMAA', t_msaa: 'MSAA', t_plain: 'Einfach', t_detailed: 'Detailliert',
    t_static: 'Statisch', t_animated: 'Animiert',
    adaptive: 'Adaptive Auflösung', showFps: 'Bildrate anzeigen',
    postNote: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar; das Spiel wird ohne sie dargestellt.',
    noWebgl: '3D-Ansicht nicht verfügbar – diese Einstellungen gelten, sobald WebGL verfügbar ist.',
    unknownGpu: 'unbekannte GPU',
    d_noShadows: 'keine Schatten', d_shadows: 'Schatten', d_ao: 'Umgebungsverdeckung', d_aoFull: 'volle Umgebungsverdeckung',
    d_bloom: 'Bloom', d_reflections: 'Reflexionen', d_noAA: 'keine Kantenglättung',
  },
  'fr-FR': {
    graphics: 'Graphismes', quality: 'Qualité', auto: 'Auto (détectée : {tier})',
    low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra',
    renderScale: 'Échelle de rendu', fromPreset: 'Selon le préréglage ({tier})',
    shadows: 'Ombres', ao: 'Occlusion ambiante', bloom: 'Flou lumineux', grade: 'Étalonnage des couleurs',
    antialias: 'Anticrénelage', reflections: 'Reflets', detail: 'Détails de la scène',
    particles: 'Particules', ambient: 'Mouvement ambiant',
    t_off: 'Désactivé', t_on: 'Activé', t_low: 'Bas', t_medium: 'Moyen', t_high: 'Élevé',
    t_fxaa: 'FXAA', t_smaa: 'SMAA', t_msaa: 'MSAA', t_plain: 'Simple', t_detailed: 'Détaillé',
    t_static: 'Statique', t_animated: 'Animé',
    adaptive: 'Résolution adaptative', showFps: 'Afficher la fréquence d’images',
    postNote: 'Le post-traitement n’est pas disponible sur cet appareil ; le jeu s’affiche sans.',
    noWebgl: 'Vue 3D indisponible — ces réglages s’appliquent quand WebGL est disponible.',
    unknownGpu: 'GPU inconnu',
    d_noShadows: 'sans ombres', d_shadows: 'ombres', d_ao: 'occlusion ambiante', d_aoFull: 'occlusion ambiante complète',
    d_bloom: 'flou lumineux', d_reflections: 'reflets', d_noAA: 'sans anticrénelage',
  },
  'fr-CA': null, // filled below from fr-FR with Canadian variants
  'pt-BR': {
    graphics: 'Gráficos', quality: 'Qualidade', auto: 'Automática (detectada: {tier})',
    low: 'Baixa', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra',
    renderScale: 'Escala de renderização', fromPreset: 'Da predefinição ({tier})',
    shadows: 'Sombras', ao: 'Oclusão de ambiente', bloom: 'Brilho', grade: 'Correção de cor',
    antialias: 'Antisserrilhado', reflections: 'Reflexos', detail: 'Detalhes da cena',
    particles: 'Partículas', ambient: 'Movimento ambiente',
    t_off: 'Desligado', t_on: 'Ligado', t_low: 'Baixo', t_medium: 'Médio', t_high: 'Alto',
    t_fxaa: 'FXAA', t_smaa: 'SMAA', t_msaa: 'MSAA', t_plain: 'Simples', t_detailed: 'Detalhado',
    t_static: 'Estático', t_animated: 'Animado',
    adaptive: 'Resolução adaptativa', showFps: 'Mostrar taxa de quadros',
    postNote: 'O pós-processamento não está disponível neste dispositivo; o jogo é exibido sem ele.',
    noWebgl: 'Visão 3D indisponível — estas configurações valem quando o WebGL estiver disponível.',
    unknownGpu: 'GPU desconhecida',
    d_noShadows: 'sem sombras', d_shadows: 'sombras', d_ao: 'oclusão de ambiente', d_aoFull: 'oclusão de ambiente completa',
    d_bloom: 'brilho', d_reflections: 'reflexos', d_noAA: 'sem antisserrilhado',
  },
  'it-IT': {
    graphics: 'Grafica', quality: 'Qualità', auto: 'Automatica (rilevata: {tier})',
    low: 'Bassa', balanced: 'Bilanciata', high: 'Alta', ultra: 'Ultra',
    renderScale: 'Scala di rendering', fromPreset: 'Da preimpostazione ({tier})',
    shadows: 'Ombre', ao: 'Occlusione ambientale', bloom: 'Bagliore', grade: 'Correzione colore',
    antialias: 'Antialiasing', reflections: 'Riflessi', detail: 'Dettagli della scena',
    particles: 'Particelle', ambient: 'Movimento ambientale',
    t_off: 'No', t_on: 'Sì', t_low: 'Basso', t_medium: 'Medio', t_high: 'Alto',
    t_fxaa: 'FXAA', t_smaa: 'SMAA', t_msaa: 'MSAA', t_plain: 'Semplice', t_detailed: 'Dettagliato',
    t_static: 'Statico', t_animated: 'Animato',
    adaptive: 'Risoluzione adattiva', showFps: 'Mostra frequenza fotogrammi',
    postNote: 'La post-elaborazione non è disponibile su questo dispositivo; il gioco viene mostrato senza.',
    noWebgl: 'Vista 3D non disponibile: queste impostazioni valgono quando WebGL è disponibile.',
    unknownGpu: 'GPU sconosciuta',
    d_noShadows: 'nessuna ombra', d_shadows: 'ombre', d_ao: 'occlusione ambientale', d_aoFull: 'occlusione ambientale completa',
    d_bloom: 'bagliore', d_reflections: 'riflessi', d_noAA: 'nessun antialiasing',
  },
};
STRINGS['es-ES'] = {
  ...STRINGS['es-419'], showFps: 'Mostrar fotogramas por segundo',
  auto: 'Automática (detectada: {tier})', t_static: 'Estático',
};
STRINGS['fr-CA'] = {
  ...STRINGS['fr-FR'], showFps: 'Afficher la fréquence d’affichage', bloom: 'Halo lumineux', d_bloom: 'halo lumineux',
};

export const LOCALES = Object.keys(STRINGS);
export const STRING_KEYS = Object.keys(EN_US);
export function stringsFor(locale) { return STRINGS[locale]; }

/** Map a BCP-47 tag onto a supported locale (regional fallbacks, then en-US). */
export function pickLocale(tags) {
  for (const raw of tags || []) {
    const tag = String(raw || '');
    if (STRINGS[tag]) return tag;
    const [lang, region = ''] = tag.split(/[-_]/);
    const R = region.toUpperCase();
    if (lang === 'en') return ['GB', 'IE', 'AU', 'NZ', 'ZA', 'IN'].includes(R) ? 'en-GB' : 'en-US';
    if (lang === 'es') return R === 'ES' || !R ? 'es-ES' : 'es-419';
    if (lang === 'fr') return R === 'CA' ? 'fr-CA' : 'fr-FR';
    if (lang === 'pt') return 'pt-BR';
    if (lang === 'de') return 'de-DE';
    if (lang === 'it') return 'it-IT';
  }
  return 'en-US';
}

/** StarHermit account strings (sign-in, invite link, toasts) for the player's locale. */
const SH_STRINGS = {
 "en-US": {
  "signIn": "Sign in with StarHermit",
  "invite": "Invite a friend",
  "copied": "Invite link copied to clipboard.",
  "copyFailed": "Could not copy the invite link: {link}",
  "signedOut": "Signed out of StarHermit. Progress keeps saving on this device."
 },
 "en-GB": {
  "signIn": "Sign in with StarHermit",
  "invite": "Invite a friend",
  "copied": "Invite link copied to clipboard.",
  "copyFailed": "Could not copy the invite link: {link}",
  "signedOut": "Signed out of StarHermit. Progress keeps saving on this device."
 },
 "es-419": {
  "signIn": "Iniciar sesión con StarHermit",
  "invite": "Invitar a un amigo",
  "copied": "Enlace de invitación copiado al portapapeles.",
  "copyFailed": "No se pudo copiar el enlace de invitación: {link}",
  "signedOut": "Sesión de StarHermit cerrada. El progreso se sigue guardando en este dispositivo."
 },
 "es-ES": {
  "signIn": "Iniciar sesión con StarHermit",
  "invite": "Invitar a un amigo",
  "copied": "Enlace de invitación copiado al portapapeles.",
  "copyFailed": "No se ha podido copiar el enlace de invitación: {link}",
  "signedOut": "Se ha cerrado la sesión de StarHermit. El progreso se sigue guardando en este dispositivo."
 },
 "de-DE": {
  "signIn": "Mit StarHermit anmelden",
  "invite": "Freund einladen",
  "copied": "Einladungslink in die Zwischenablage kopiert.",
  "copyFailed": "Einladungslink konnte nicht kopiert werden: {link}",
  "signedOut": "Von StarHermit abgemeldet. Der Fortschritt wird weiter auf diesem Gerät gespeichert."
 },
 "fr-FR": {
  "signIn": "Se connecter avec StarHermit",
  "invite": "Inviter un ami",
  "copied": "Lien d’invitation copié dans le presse-papiers.",
  "copyFailed": "Impossible de copier le lien d’invitation : {link}",
  "signedOut": "Déconnecté de StarHermit. La progression reste enregistrée sur cet appareil."
 },
 "fr-CA": {
  "signIn": "Se connecter avec StarHermit",
  "invite": "Inviter un ami",
  "copied": "Lien d’invitation copié dans le presse-papiers.",
  "copyFailed": "Impossible de copier le lien d’invitation : {link}",
  "signedOut": "Déconnecté de StarHermit. La progression reste enregistrée sur cet appareil."
 },
 "pt-BR": {
  "signIn": "Entrar com StarHermit",
  "invite": "Convidar um amigo",
  "copied": "Link de convite copiado para a área de transferência.",
  "copyFailed": "Não foi possível copiar o link de convite: {link}",
  "signedOut": "Você saiu do StarHermit. O progresso continua salvo neste dispositivo."
 },
 "it-IT": {
  "signIn": "Accedi con StarHermit",
  "invite": "Invita un amico",
  "copied": "Link di invito copiato negli appunti.",
  "copyFailed": "Impossibile copiare il link di invito: {link}",
  "signedOut": "Disconnesso da StarHermit. I progressi restano salvati su questo dispositivo."
 }
};
export function shStrings() { return SH_STRINGS[currentLocale()] || SH_STRINGS['en-US']; }

function currentLocale() {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    return pickLocale([q, ...(navigator.languages || [navigator.language])].filter(Boolean));
  } catch { return 'en-US'; }
}

/**
 * Build and bind the Graphics controls.
 * `getSaved()` returns the saved graphics object, `save(obj)` persists and
 * applies it, `getRenderer()` returns the live renderer (or null).
 */
export function initGraphicsPanel({ root, getSaved, save, getRenderer }) {
  const S = STRINGS[currentLocale()];
  const tr = (k, vars) => (S[k] || EN_US[k]).replace('{tier}', vars || '');
  const words = {};
  for (const k of Object.keys(EN_US)) if (k.startsWith('d_')) words[k.slice(2)] = S[k];

  const legend = root.querySelector('legend');
  if (legend) legend.textContent = S.graphics;
  const host = root.querySelector('#gfx-controls');
  host.textContent = '';

  const mk = (tag, props = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el) el[k] = v;
      else el.setAttribute(k, v);
    }
    el.append(...kids);
    return el;
  };

  // Quality preset (keeps the historical #set-tier id).
  const presetSel = mk('select', { id: 'set-tier', dataset: { gfx: 'preset' } });
  host.append(mk('label', { className: 'gfx-row', htmlFor: 'set-tier' }, mk('span', { textContent: S.quality }), presetSel));

  // Render scale slider with an inline value.
  const scale = mk('input', { type: 'range', id: 'gfx-scale', min: '50', max: '200', step: '5', dataset: { gfx: 'render_scale' } });
  const scaleOut = mk('output', { id: 'gfx-scale-value', htmlFor: 'gfx-scale', className: 'gfx-value' });
  host.append(mk('label', { className: 'gfx-row gfx-slider', htmlFor: 'gfx-scale' }, mk('span', { textContent: S.renderScale }), mk('span', { className: 'gfx-slider-wrap' }, scale, scaleOut)));

  // One select per category.
  const catSel = {};
  const grid = mk('div', { className: 'gfx-cats' });
  for (const cat of Object.keys(CATEGORIES)) {
    const sel = mk('select', { id: 'gfx-' + cat, dataset: { gfx: cat } });
    catSel[cat] = sel;
    grid.append(mk('label', { className: 'gfx-row gfx-stack', htmlFor: 'gfx-' + cat }, mk('span', { textContent: S[cat] }), sel));
  }
  host.append(grid);

  const adaptive = mk('input', { type: 'checkbox', id: 'gfx-adaptive', dataset: { gfx: 'adaptive' } });
  const fps = mk('input', { type: 'checkbox', id: 'gfx-fps', dataset: { gfx: 'show_fps' } });
  host.append(
    mk('label', { className: 'gfx-check', htmlFor: 'gfx-adaptive' }, adaptive, mk('span', { textContent: ' ' + S.adaptive })),
    mk('label', { className: 'gfx-check', htmlFor: 'gfx-fps' }, fps, mk('span', { textContent: ' ' + S.showFps })),
  );
  const summary = mk('p', { id: 'gfx-summary', className: 'muted gfx-summary' });
  const note = mk('p', { id: 'gfx-post-note', className: 'gfx-note', hidden: true, textContent: S.postNote });
  host.append(summary, note);

  function detected() {
    const r = getRenderer();
    return r && r.ok ? r.detected : 'low';
  }

  function render() {
    const saved = getSaved();
    const det = detected();
    const res = resolve(saved, det);
    // Preset options (Auto shows the detected tier).
    presetSel.textContent = '';
    presetSel.append(mk('option', { value: 'auto', textContent: tr('auto', S[det]) }));
    for (const p of PRESETS) presetSel.append(mk('option', { value: p, textContent: S[p] }));
    presetSel.value = PRESETS.includes(saved.preset) ? saved.preset : 'auto';
    for (const [cat, tiers] of Object.entries(CATEGORIES)) {
      const sel = catSel[cat];
      sel.textContent = '';
      sel.append(mk('option', { value: 'preset', textContent: tr('fromPreset', S['t_' + presetTier(res.preset, cat)]) }));
      for (const t of tiers) sel.append(mk('option', { value: t, textContent: S['t_' + t] }));
      sel.value = tiers.includes(saved[cat]) ? saved[cat] : 'preset';
    }
    scale.value = String(Math.round(res.renderScale * 100));
    scaleOut.textContent = scale.value + '%';
    adaptive.checked = res.adaptive;
    fps.checked = res.showFps;
    refreshInfo();
  }

  function refreshInfo() {
    const r = getRenderer();
    const saved = getSaved();
    if (r && r.ok) {
      const info = r.graphicsInfo(words);
      summary.textContent = [info.gpu || S.unknownGpu, info.summary].join(' · ');
      note.hidden = !info.postFailed;
      document.body.dataset.gfxPreset = info.resolved.preset;
    } else {
      summary.textContent = S.noWebgl;
      note.hidden = true;
      document.body.dataset.gfxPreset = resolve(saved, 'low').preset;
    }
  }

  const update = (fn) => { const next = fn({ ...getSaved() }); save(next); render(); };

  presetSel.addEventListener('change', () => update((s) => applyPreset(s, presetSel.value)));
  for (const [cat, sel] of Object.entries(catSel)) {
    sel.addEventListener('change', () => update((s) => { if (sel.value === 'preset') delete s[cat]; else s[cat] = sel.value; return s; }));
  }
  scale.addEventListener('input', () => {
    scaleOut.textContent = scale.value + '%';
    update((s) => { s.render_scale = Number(scale.value) / 100; return s; });
  });
  adaptive.addEventListener('change', () => update((s) => { s.adaptive = adaptive.checked; return s; }));
  fps.addEventListener('change', () => update((s) => { s.show_fps = fps.checked; return s; }));

  // Keep the summary's pixel size / fallback note current while the panel is open.
  setInterval(() => { if (root.offsetParent !== null) refreshInfo(); }, 1000);

  render();
  return { render, refreshInfo };
}
