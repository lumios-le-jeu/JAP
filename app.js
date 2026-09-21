/* ================================================================
   JAP — Le Jour d'Après | app.js V7
   Thème clair, accessible, actions par délégation (data-action).
================================================================ */
'use strict';

/* ── CONFIG ──────────────────────────────────────────────────── */
const SUPABASE_URL = "https://ucydckuzsbbfflbnxkkl.supabase.co";
const SUPABASE_KEY = "sb_publishable_hbsg3nktIYOasu0Kld7Hpg_pp9zh9_C";
const WORKER_URL = "https://jap-api.etienneleborgne.workers.dev/api/estimer";

let supabaseClient = null;
try {
  if (window.supabase) supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
} catch (e) { console.warn('Supabase indisponible :', e); }

/* ── STORE ───────────────────────────────────────────────────── */
const Store = {
  _get(k, d = null) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  _set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) {
      // Stockage local plein (photos) : si le cloud existe, on garde une copie locale sans photos.
      if (k === 'jap_list' && supabaseClient) {
        try {
          const light = v.map(j => ({ ...j, biens: (j.biens || []).map(b => ({ ...b, photo: null })) }));
          localStorage.setItem(k, JSON.stringify(light)); return true;
        } catch { /* rien */ }
      }
      throw e;
    }
  },
  _local() { return this._get('jap_list', []) || []; },
  _cacheLocal(jap) {
    const list = this._local();
    const i = list.findIndex(j => j.id === jap.id);
    if (i >= 0) list[i] = jap; else list.unshift(jap);
    this._set('jap_list', list);
  },

  async getJaps() {
    const local = this._local();
    if (!supabaseClient || !local.length) return local;
    try {
      const { data, error } = await supabaseClient.from('japs').select('data').in('id', local.map(j => j.id));
      if (error) throw error;
      const remote = new Map((data || []).map(d => [d.data.id, d.data]));
      // Fusion : on garde les dossiers locaux absents du cloud au lieu de les perdre.
      const merged = local.map(j => remote.get(j.id) || j);
      try { this._set('jap_list', merged); } catch { /* cache facultatif */ }
      return merged;
    } catch (e) { console.warn('getJaps :', e); return local; }
  },
  async getJap(id) {
    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient.from('japs').select('data').eq('id', id).maybeSingle();
        if (error) throw error;
        if (data && data.data) return data.data;
      } catch (e) { console.warn('getJap :', e); }
    }
    return this._local().find(j => j.id === id) || null;
  },
  async getJapByCode(code) {
    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient.from('japs').select('data').eq('code', code).maybeSingle();
        if (error) throw error;
        if (data && data.data) { try { this._cacheLocal(data.data); } catch { } return data.data; }
      } catch (e) { console.warn('getJapByCode :', e); }
    }
    return this._local().find(j => j.code === code) || null;
  },
  /** Renvoie true si la sauvegarde cloud a réussi (ou s'il n'y a pas de cloud). */
  async saveJap(jap) {
    let localOk = true;
    try { this._cacheLocal(jap); } catch (e) { localOk = false; if (!supabaseClient) throw e; }
    if (supabaseClient) {
      const { error } = await supabaseClient.from('japs').upsert({ id: jap.id, code: jap.code, data: jap });
      if (error) {
        console.error('Supabase :', error);
        if (!localOk) throw new Error("Impossible d'enregistrer (ni en ligne, ni sur cet appareil).");
        toast("Enregistré sur cet appareil seulement : la connexion au serveur a échoué.", 'warn');
        return false;
      }
    }
    return true;
  },
  async deleteJap(id) {
    try { this._set('jap_list', this._local().filter(j => j.id !== id)); } catch { }
    if (supabaseClient) {
      const { error } = await supabaseClient.from('japs').delete().eq('id', id);
      if (error) console.error('Supabase delete :', error);
    }
  },
  forgetJap(id) { try { this._set('jap_list', this._local().filter(j => j.id !== id)); } catch { } },
  getUser() { const u = this._get('jap_user', null) || {}; return { email: (u.email || '').toLowerCase(), nom: u.nom || '' }; },
  setUser(u) { try { this._set('jap_user', { email: (u.email || '').toLowerCase(), nom: u.nom || '' }); } catch { } },
};

/* ── UTILS ───────────────────────────────────────────────────── */
const uid = () => {
  const a = new Uint8Array(6); (window.crypto || window.msCrypto).getRandomValues(a);
  return Array.from(a, b => (b % 36).toString(36)).join('') + Date.now().toString(36).slice(-2);
};
const randInt = n => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const fmt = n => Math.round(num(n)).toLocaleString('fr-FR') + ' €';
const ini = s => {
  const t = String(s || '?').split('@')[0].trim().split(/\s+/);
  return ((t[0] || '?')[0] + (t[1] ? t[1][0] : (t[0][1] || ''))).toUpperCase();
};
const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ''));
const $ = id => document.getElementById(id);
const val = id => ($(id) ? $(id).value.trim() : '');
const seuilOf = j => { const s = num(j.seuil, NaN); return Number.isFinite(s) && s >= 0 ? s : 200; };
const partsOf = h => { const p = num(h.parts, NaN); return Number.isFinite(p) && p >= 0 ? p : 1; };
/** Les experts n'héritent pas : ils n'ont ni part ni liste de souhaits. */
const ayantsDroit = j => (j.herit || []).filter(h => h.role !== 'expert');

const CATS = [
  { v: 'mobilier', l: 'Mobilier', e: '🛋️' }, { v: 'art', l: 'Art / Déco', e: '🖼️' }, { v: 'bijoux', l: 'Bijoux', e: '💎' },
  { v: 'vaisselle', l: 'Vaisselle', e: '🍽️' }, { v: 'livres', l: 'Livres', e: '📚' }, { v: 'electronique', l: 'Électronique', e: '💻' },
  { v: 'vetements', l: 'Vêtements', e: '👗' }, { v: 'vehicule', l: 'Véhicule', e: '🚗' }, { v: 'outil', l: 'Outils', e: '🔧' },
  { v: 'autre', l: 'Autre', e: '📦' }];
const catE = v => (CATS.find(c => c.v === v) || { e: '📦' }).e;
const catL = v => (CATS.find(c => c.v === v) || { l: 'Autre' }).l;

const ROLES = { ayant_droit: 'Ayant droit', 'décédé': 'Décédé (représenté)', expert: 'Expert (estimation)' };
const roleL = r => ROLES[r] || 'Ayant droit';

const STATUTS = {
  prep: { label: 'Inventaire en cours', css: 'status-prep', step: 1 },
  inv: { label: 'Inventaire en cours', css: 'status-prep', step: 1 },
  souhaits: { label: 'Choix des souhaits', css: 'status-wish', step: 2 },
  partage: { label: 'Partage terminé', css: 'status-done', step: 3 },
};

/* ── TOAST ───────────────────────────────────────────────────── */
function toast(msg, type = 'success') {
  if (type === 'warning') type = 'warn';
  const icons = { success: '✓', error: '!', warn: '!' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `<span class="toast-icon" aria-hidden="true">${icons[type] || 'i'}</span><span>${esc(msg)}</span>`;
  const box = $('toast-container');
  while (box.children.length >= 2) box.firstElementChild.remove(); // jamais plus de 2 messages à la fois
  box.appendChild(el);
  setTimeout(() => el.classList.add('toast-out'), 5000);
  setTimeout(() => el.remove(), 5400);
}

/* ── MODALE ──────────────────────────────────────────────────── */
const Modal = {
  _last: null,
  open(title, body) {
    if (this._onClose) { const cb = this._onClose; this._onClose = null; cb(); }
    this._last = document.activeElement;
    $('modal-content').innerHTML = `
      <div class="modal-head">
        <h2 class="modal-title" id="modal-title">${title}</h2>
        <button class="modal-close" data-action="modal-close" aria-label="Fermer la fenêtre">✕<span>Fermer</span></button>
      </div>
      <div class="modal-body">${body}</div>`;
    $('modal-overlay').classList.remove('hidden');
    document.body.classList.add('no-scroll');
    const first = $('modal-content').querySelector('input:not([type=file]),select,textarea');
    setTimeout(() => (first || $('modal-content').querySelector('.modal-close')).focus(), 50);
  },
  _onClose: null,
  close() {
    const cb = this._onClose; this._onClose = null;
    $('modal-overlay').classList.add('hidden');
    document.body.classList.remove('no-scroll');
    $('modal-content').innerHTML = '';
    if (this._last && this._last.focus && document.contains(this._last)) try { this._last.focus(); } catch { }
    if (cb) cb();
  },
  isOpen() { return !$('modal-overlay').classList.contains('hidden'); },
};

/** Remplace window.confirm() : grande fenêtre lisible, boutons explicites. */
function confirmBox({ title, text, ok = 'Confirmer', danger = false }) {
  return new Promise(resolve => {
    Modal.open(esc(title), `
      <p class="lead">${text}</p>
      <div class="btn-stack mt-24">
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} w-full" id="cf-ok">${esc(ok)}</button>
        <button class="btn btn-secondary w-full" id="cf-no">Annuler</button>
      </div>`);
    const done = v => { Modal._onClose = null; Modal.close(); resolve(v); };
    $('cf-ok').onclick = () => done(true);
    $('cf-no').onclick = () => done(false);
    Modal._onClose = () => resolve(false);
  });
}

/* ── ROUTER ──────────────────────────────────────────────────── */
const Router = {
  routes: [],
  add(pat, fn) {
    const keys = [];
    const re = new RegExp('^' + pat.replace(/:([^/]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    this.routes.push({ re, keys, fn });
  },
  go(path) { if (location.hash === '#' + path) this.dispatch(); else location.hash = path; },
  match(hash) {
    const path = hash.replace(/^#/, '') || '/';
    for (const r of this.routes) {
      const m = path.match(r.re);
      if (m) { const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); return { fn: r.fn, params }; }
    }
    return null;
  },
  async dispatch() {
    if (Modal.isOpen()) Modal.close();
    const app = $('app');
    const r = this.match(location.hash || '#/');
    if (!r) { app.innerHTML = notFound(); return; }
    app.innerHTML = `<main class="view"><div class="loading" role="status"><span class="spinner"></span>Chargement…</div></main>`;
    try { await r.fn(r.params); window.scrollTo(0, 0); }
    catch (e) {
      console.error(e);
      app.innerHTML = `<main class="view"><div class="empty-state"><div class="empty-state-icon">😕</div>
        <h2 class="empty-state-title">Un problème est survenu</h2><p>${esc(e.message || e)}</p>
        <button class="btn btn-primary mt-24" data-action="go" data-to="/">Revenir à l'accueil</button></div></main>`;
    }
    const h1 = app.querySelector('h1'); if (h1) { h1.setAttribute('tabindex', '-1'); }
  },
  init() { window.addEventListener('hashchange', () => this.dispatch()); this.dispatch(); },
};
const notFound = () => `<main class="view"><div class="empty-state"><div class="empty-state-icon">🔍</div>
  <h2 class="empty-state-title">Page introuvable</h2>
  <button class="btn btn-primary mt-24" data-action="go" data-to="/">Revenir à l'accueil</button></div></main>`;

/* ── GABARITS COMMUNS ────────────────────────────────────────── */
function topbar(title, back, extra = '') {
  return `<header class="topbar">
    <div class="topbar-inner">
      ${back ? `<button class="topbar-back" data-action="go" data-to="${esc(back)}" aria-label="Retour"><span aria-hidden="true">←</span> Retour</button>` : '<span></span>'}
      <h1 class="topbar-title">${title}</h1>
      ${extra || '<span></span>'}
    </div>
  </header>`;
}
const thumb = (b, size = '') => b.photo
  ? `<img class="thumb ${size}" src="${esc(b.photo)}" alt="" loading="lazy" />`
  : `<div class="thumb thumb-emoji ${size}" aria-hidden="true">${catE(b.cat)}</div>`;

/* ── DROITS ──────────────────────────────────────────────────── */
function getTargetHeir(jap) {
  const email = Store.getUser().email;
  if (!email) return { type: 'autre', heir: null };
  const heirs = ayantsDroit(jap);
  const asHeir = heirs.find(h => h.email && h.email.toLowerCase() === email && h.role !== 'décédé');
  if (asHeir) return { type: 'heritier', heir: asHeir };
  const asEnf = heirs.find(h => (h.enfants || []).some(e => e.contact && e.contact.toLowerCase() === email));
  if (asEnf) return { type: 'enfant', heir: asEnf };
  return { type: 'autre', heir: null };
}
function isAdminOf(jap) {
  const email = Store.getUser().email;
  return !!email && (jap.admins || []).map(a => String(a).toLowerCase()).includes(email);
}
/** Un héritier décédé est représenté par ses enfants : ils peuvent aussi ordonner la liste. */
const canReorder = (role) => role.type === 'heritier' || (role.type === 'enfant' && role.heir.role === 'décédé');

/* ── CALCULS ─────────────────────────────────────────────────── */
/** Part théorique d'un héritier, sur la masse biens + dons déjà reçus. */
function partTheorique(j, h, biensIds = null) {
  const heirs = ayantsDroit(j);
  const biens = (j.biens || []).filter(b => !biensIds || biensIds.has(b.id));
  const masse = biens.reduce((a, b) => a + num(b.val), 0) + heirs.reduce((a, x) => a + num(x.recus), 0);
  const parts = heirs.reduce((a, x) => a + partsOf(x), 0);
  return parts > 0 ? masse / parts * partsOf(h) : 0;
}

/**
 * Algorithme JAP : tours de partage.
 * À chaque tour, chaque héritier réclame son souhait le mieux classé encore libre.
 * Conflit → tirage au sort ; le perdant passe immédiatement à son choix suivant.
 * Pondération : après le tour r, un héritier a droit à ⌈r × parts⌉ objets
 * (2 parts = 2 objets par tour, ½ part = 1 objet un tour sur deux).
 */
function allocate(j) {
  const heirs = ayantsDroit(j).filter(h => partsOf(h) > 0);
  const exist = new Set((j.biens || []).map(b => b.id));
  const avail = new Set(exist);
  const queue = Object.fromEntries(heirs.map(h => [h.id, (h.souhaits || []).filter(b => exist.has(b))]));
  const got = Object.fromEntries(heirs.map(h => [h.id, 0]));
  const attrib = {}; const tours = [];
  const nextWish = h => queue[h.id].find(b => avail.has(b));
  for (let r = 1; r <= 1000; r++) {
    const quota = h => Math.ceil(r * partsOf(h) - 1e-9) - got[h.id];
    let pending = heirs.filter(h => quota(h) > 0 && nextWish(h));
    if (!heirs.some(h => nextWish(h))) break;
    const events = [];
    while (pending.length) {
      const claims = new Map();
      pending.forEach(h => { const b = nextWish(h); if (!claims.has(b)) claims.set(b, []); claims.get(b).push(h); });
      for (const [b, hs] of claims) {
        const w = hs.length > 1 ? hs[randInt(hs.length)] : hs[0];
        attrib[b] = w.id; avail.delete(b); got[w.id]++;
        events.push(hs.length > 1
          ? { type: 'tirage', bien: b, gagnant: w.id, candidats: hs.map(x => x.id) }
          : { type: 'attrib', bien: b, gagnant: w.id });
      }
      pending = heirs.filter(h => quota(h) > 0 && nextWish(h));
    }
    if (events.length) tours.push({ n: tours.length + 1, events });
  }
  return { attrib, tours, date: new Date().toISOString() };
}

/** Soultes : écart entre ce que chacun reçoit et sa part, puis virements à effectuer. */
function computeResult(j) {
  const res = j.resultat || { attrib: {}, tours: [] };
  const heirs = ayantsDroit(j);
  const attribIds = new Set(Object.keys(res.attrib).filter(id => (j.biens || []).some(b => b.id === id)));
  const seuil = seuilOf(j);
  const lignes = heirs.map(h => {
    const biens = (j.biens || []).filter(b => res.attrib[b.id] === h.id);
    const valeur = biens.reduce((a, b) => a + num(b.val), 0);
    const recu = valeur + num(h.recus);
    const theo = partTheorique(j, h, attribIds);
    const ecart = recu - theo;
    return { h, biens, valeur, recu, theo, ecart, soulte: Math.abs(ecart) > seuil ? ecart : 0 };
  });
  // Virements : ceux qui ont trop reçu versent à ceux qui ont moins reçu.
  const payeurs = lignes.filter(l => l.soulte > 0).map(l => ({ h: l.h, m: l.soulte })).sort((a, b) => b.m - a.m);
  const receveurs = lignes.filter(l => l.soulte < 0).map(l => ({ h: l.h, m: -l.soulte })).sort((a, b) => b.m - a.m);
  const virements = [];
  let i = 0, k = 0;
  while (i < payeurs.length && k < receveurs.length) {
    const m = Math.min(payeurs[i].m, receveurs[k].m);
    if (m >= 1) virements.push({ de: payeurs[i].h, a: receveurs[k].h, montant: m });
    payeurs[i].m -= m; receveurs[k].m -= m;
    if (payeurs[i].m < 1) i++;
    if (receveurs[k].m < 1) k++;
  }
  const nonAttribues = (j.biens || []).filter(b => !res.attrib[b.id]);
  return { lignes, virements, nonAttribues, seuil };
}

/* ================================================================
   VUE ACCUEIL
================================================================ */
async function renderWelcome() {
  const japs = await Store.getJaps(); const user = Store.getUser();
  const list = japs.length ? japs.map(j => {
    const s = STATUTS[j.statut] || STATUTS.prep;
    return `<button class="jap-item" data-action="go" data-to="/jap/${esc(j.id)}">
      <span class="avatar avatar-lg" aria-hidden="true">${esc(ini(j.defunt))}</span>
      <span class="jap-item-info">
        <span class="jap-item-name">Succession de ${esc(j.defunt)}</span>
        <span class="jap-item-meta">${(j.herit || []).length} personne(s) · ${(j.biens || []).length} objet(s)</span>
        <span class="badge ${s.css}">${s.label}</span>
      </span>
      <span class="chevron" aria-hidden="true">›</span>
    </button>`;
  }).join('') : `<div class="empty-card">
      <div class="empty-state-icon" aria-hidden="true">🕊️</div>
      <p class="lead">Vous n'avez encore aucune succession.</p>
      <p class="muted">Créez-en une, ou rejoignez celle d'un proche avec le code qu'il vous a transmis.</p>
    </div>`;

  $('app').innerHTML = `
    <header class="hero">
      <div class="hero-inner">
        ${user.email ? `<div class="hero-user"><span>Connecté : <strong>${esc(user.nom || user.email)}</strong></span>
          <button class="link-btn" data-action="logout">Changer d'utilisateur</button></div>` : ''}
        <div class="logo" aria-hidden="true">⚖️</div>
        <h1 class="hero-title">JAP <span>· Le Jour d'Après</span></h1>
        <p class="hero-tagline">Partager les souvenirs d'un proche, simplement et équitablement, en famille.</p>
        <div class="hero-actions">
          <button class="btn btn-primary btn-lg" data-action="go" data-to="/jap/new"><span aria-hidden="true">＋</span> Créer une succession</button>
          <button class="btn btn-secondary btn-lg" data-action="join"><span aria-hidden="true">🔑</span> J'ai reçu un code</button>
        </div>
      </div>
    </header>
    <main class="view">
      <h2 class="section-title">Mes successions</h2>
      <div class="stack">${list}</div>

      <h2 class="section-title mt-40">Comment ça marche ?</h2>
      <ol class="how">
        <li><span class="how-num">1</span><div><strong>L'inventaire</strong><p>On photographie les objets et on leur donne une valeur.</p></div></li>
        <li><span class="how-num">2</span><div><strong>Les souhaits</strong><p>Chaque héritier choisit les objets qu'il aimerait garder, par ordre de préférence.</p></div></li>
        <li><span class="how-num">3</span><div><strong>Le partage</strong><p>JAP attribue les objets, tire au sort en cas d'égalité et calcule les compensations.</p></div></li>
      </ol>
    </main>`;
}

function showJoin() {
  Modal.open("Rejoindre une succession", `
    <p class="muted mb-16">Saisissez le code reçu (par exemple <strong>JAP_AB12CD34</strong>) et votre adresse e-mail.</p>
    <div class="form-group"><label class="form-label" for="join-code">Code de la succession</label>
      <input id="join-code" class="form-input input-code" autocomplete="off" autocapitalize="characters" placeholder="JAP_…" /></div>
    <div class="form-group"><label class="form-label" for="join-email">Votre adresse e-mail</label>
      <input id="join-email" class="form-input" type="email" inputmode="email" autocomplete="email" placeholder="prenom.nom@exemple.fr" value="${esc(Store.getUser().email)}" />
      <p class="form-hint">Utilisez l'adresse que la famille a indiquée pour vous : c'est elle qui vous identifie.</p></div>
    <button class="btn btn-primary w-full" data-action="do-join">Accéder à la succession</button>`);
}
async function doJoin(btn) {
  let c = val('join-code').toUpperCase().replace(/\s+/g, '');
  if (c && !c.startsWith('JAP_')) c = 'JAP_' + c.replace(/^JAP/, '');
  const email = val('join-email').toLowerCase();
  if (!c) return toast("Saisissez le code de la succession.", 'error');
  if (!isEmail(email)) return toast("Saisissez une adresse e-mail valide.", 'error');
  busy(btn, 'Recherche…');
  const j = await Store.getJapByCode(c);
  if (!j) { unbusy(btn); return toast("Aucune succession ne correspond à ce code. Vérifiez-le.", 'error'); }
  const known = (j.herit || []).find(h => (h.email || '').toLowerCase() === email);
  Store.setUser({ email, nom: known ? known.nom : '' });
  Modal.close(); Router.go('/jap/' + j.id);
}

/* ================================================================
   CRÉATION D'UNE SUCCESSION (assistant en 4 étapes)
================================================================ */
let _njStep = 1, _nj = {};
function renderNewJap() {
  const u = Store.getUser();
  _nj = { id: uid(), code: "JAP_" + uid().toUpperCase().slice(0, 8), createur: { email: u.email }, admins: [], herit: [], biens: [], statut: "prep", seuil: 200 };
  _njStep = 1; renderNewJapStep();
}
const NJ_STEPS = ["Vous", "Le défunt", "Les héritiers", "Vérification"];
function renderNewJapStep() {
  const c = _nj.createur || {};
  const steps = `<ol class="steps" aria-label="Étapes">${NJ_STEPS.map((s, i) => {
    const n = i + 1, cls = n < _njStep ? 'done' : n === _njStep ? 'active' : '';
    return `<li class="step ${cls}" ${n === _njStep ? 'aria-current="step"' : ''}><span class="step-num">${n < _njStep ? '✓' : n}</span><span class="step-label">${s}</span></li>`;
  }).join('')}</ol>
  <p class="step-caption">Étape ${_njStep} sur 4 — <strong>${NJ_STEPS[_njStep - 1]}</strong></p>`;

  let body = '';
  if (_njStep === 1) {
    body = `<div class="card">
      <div class="form-row">
        <div class="form-group"><label class="form-label" for="nj-c-pre">Votre prénom *</label><input id="nj-c-pre" class="form-input" autocomplete="given-name" value="${esc(c.prenom)}" /></div>
        <div class="form-group"><label class="form-label" for="nj-c-nom">Votre nom *</label><input id="nj-c-nom" class="form-input" autocomplete="family-name" value="${esc(c.nom)}" /></div>
      </div>
      <div class="form-group"><label class="form-label" for="nj-c-emi">Votre adresse e-mail *</label><input id="nj-c-emi" type="email" inputmode="email" autocomplete="email" class="form-input" value="${esc(c.email)}" /></div>
      <div class="form-group"><label class="form-label" for="nj-c-tel">Votre téléphone <span class="opt">(facultatif)</span></label><input id="nj-c-tel" type="tel" inputmode="tel" autocomplete="tel" class="form-input" value="${esc(c.tel)}" /></div>
      <div class="form-group"><label class="form-label" for="nj-c-adr">Votre adresse <span class="opt">(facultatif)</span></label><input id="nj-c-adr" class="form-input" autocomplete="street-address" value="${esc(c.adresse)}" /></div>
      <fieldset class="form-group"><legend class="form-label">Votre lien avec la personne disparue</legend>
        <div class="choice-list">
          ${[['heritier', 'Je suis héritier', 'Vous serez ajouté automatiquement à la liste des héritiers.'],
        ['enfant', "Je suis l'enfant d'un héritier", "Vous pourrez aider votre parent à faire sa liste."],
        ['autre', 'Autre (notaire, ami, exécuteur…)', 'Vous gérez la succession sans y participer.']].map(([v, l, d]) =>
          `<label class="choice"><input type="radio" name="nj-c-lie" value="${v}" ${(c.lien || 'heritier') === v ? 'checked' : ''} /><span><strong>${l}</strong><small>${d}</small></span></label>`).join('')}
        </div>
      </fieldset>
    </div>
    <div class="actions-bar"><button class="btn btn-primary btn-lg w-full" data-action="nj-1">Continuer <span aria-hidden="true">→</span></button></div>`;
  } else if (_njStep === 2) {
    body = `<div class="card">
      <div class="form-group"><label class="form-label" for="nj-def">Nom et prénom de la personne disparue *</label><input id="nj-def" class="form-input" value="${esc(_nj.defunt)}" /></div>
      <div class="form-group"><label class="form-label" for="nj-adr">Sa dernière adresse <span class="opt">(facultatif)</span></label><input id="nj-adr" class="form-input" value="${esc(_nj.adresse)}" /></div>
      <div class="form-group"><label class="form-label" for="nj-not">Notaire ou étude <span class="opt">(facultatif)</span></label><input id="nj-not" class="form-input" placeholder="Ex. : Maître Dupont, Rennes" value="${esc(_nj.notaire)}" /></div>
      <div class="form-group"><label class="form-label" for="nj-sou">Seuil de tolérance (€)</label>
        <input id="nj-sou" class="form-input input-short" type="number" min="0" step="10" inputmode="numeric" value="${esc(seuilOf(_nj))}" />
        <p class="form-hint">En dessous de ce montant, les petits écarts entre héritiers sont ignorés : personne n'a de compensation (soulte) à verser.</p></div>
    </div>
    <div class="actions-bar"><button class="btn btn-primary btn-lg w-full" data-action="nj-2">Continuer <span aria-hidden="true">→</span></button></div>`;
  } else if (_njStep === 3) {
    const hint = (c.lien === 'enfant') ? `<div class="notice notice-info mb-16">💡 Ajoutez votre parent héritier, et indiquez <strong>votre e-mail (${esc(c.email)})</strong> parmi ses enfants.</div>` : '';
    body = `${hint}<p class="muted mb-16">Ajoutez toutes les personnes concernées par le partage. Chacune sera identifiée par son adresse e-mail.</p>
      <div class="stack mb-16">${_nj.herit.length ? _nj.herit.map(heirRow).join('') : `<div class="empty-card"><p class="muted">Aucun héritier pour l'instant.</p></div>`}</div>
      <button class="btn btn-dashed w-full" data-action="heir-edit"><span aria-hidden="true">＋</span> Ajouter un héritier</button>
      <div class="actions-bar"><button class="btn btn-primary btn-lg w-full" data-action="nj-3">Continuer <span aria-hidden="true">→</span></button></div>`;
  } else {
    const parts = ayantsDroit(_nj).reduce((a, h) => a + partsOf(h), 0);
    body = `<div class="card recap">
      <div class="recap-row"><span>Succession de</span><strong>${esc(_nj.defunt)}</strong></div>
      <div class="recap-row"><span>Notaire</span><strong>${esc(_nj.notaire || 'Non renseigné')}</strong></div>
      <div class="recap-row"><span>Seuil de tolérance</span><strong>${fmt(seuilOf(_nj))}</strong></div>
      <div class="recap-row"><span>Héritiers</span><strong>${ayantsDroit(_nj).length} (${parts} part${parts > 1 ? 's' : ''})</strong></div>
      <div class="recap-row"><span>Créée par</span><strong>${esc((c.prenom || '') + ' ' + (c.nom || ''))}</strong></div>
    </div>
    <p class="muted mt-16">Vous serez administrateur : vous pourrez ajouter les objets, inviter la famille et lancer le partage.</p>
    <div class="actions-bar"><button class="btn btn-success btn-lg w-full" data-action="nj-fin"><span aria-hidden="true">✓</span> Créer la succession</button></div>`;
  }
  const back = _njStep > 1 ? '' : '/';
  $('app').innerHTML = `<header class="topbar"><div class="topbar-inner">
      <button class="topbar-back" data-action="${back ? 'go' : 'nj-back'}" data-to="/" aria-label="Retour"><span aria-hidden="true">←</span> Retour</button>
      <h1 class="topbar-title">Nouvelle succession</h1><span></span></div></header>
    <main class="view">${steps}${body}</main>`;
}
function heirRow(h) {
  const enf = (h.enfants || []).filter(e => e.nom || e.contact);
  return `<div class="person">
    <span class="avatar" aria-hidden="true">${esc(ini(h.nom))}</span>
    <div class="person-info">
      <div class="person-name">${esc(h.nom)}</div>
      <div class="person-meta">${esc(h.email || 'Pas d\'e-mail')} · ${roleL(h.role)}${h.role !== 'expert' ? ` · ${partsOf(h)} part${partsOf(h) > 1 ? 's' : ''}` : ''}</div>
      ${num(h.recus) > 0 ? `<div class="person-meta">Déjà reçu : ${fmt(h.recus)}</div>` : ''}
      ${enf.length ? `<div class="person-meta">Enfant(s) : ${enf.map(e => esc(e.nom || e.contact)).join(', ')}</div>` : ''}
    </div>
    <div class="person-actions">
      <button class="btn btn-sm btn-secondary" data-action="heir-edit" data-hid="${esc(h.id)}">Modifier</button>
      <button class="btn btn-sm btn-ghost-danger" data-action="nj-heir-del" data-hid="${esc(h.id)}">Retirer</button>
    </div>
  </div>`;
}
function readCreator() {
  const lien = (document.querySelector('input[name="nj-c-lie"]:checked') || {}).value || 'heritier';
  return { prenom: val('nj-c-pre'), nom: val('nj-c-nom'), email: val('nj-c-emi').toLowerCase(), tel: val('nj-c-tel'), adresse: val('nj-c-adr'), lien };
}
function njS1() {
  const c = readCreator();
  if (!c.prenom || !c.nom) return toast("Indiquez votre prénom et votre nom.", 'error');
  if (!isEmail(c.email)) return toast("Indiquez une adresse e-mail valide.", 'error');
  const prevEmail = (_nj.createur || {}).email;
  _nj.createur = c; _nj.admins = [c.email];
  Store.setUser({ email: c.email, nom: c.prenom + ' ' + c.nom });
  // Si l'on revient en arrière et que l'on change d'avis, on retire l'entrée auto-créée.
  _nj.herit = _nj.herit.filter(h => !(h.auto && (h.email === prevEmail || h.email === c.email)));
  if (c.lien === 'heritier' && !_nj.herit.find(h => h.email === c.email)) {
    _nj.herit.unshift({ id: uid(), auto: true, nom: c.prenom + ' ' + c.nom, email: c.email, role: 'ayant_droit', parts: 1, recus: 0, enfants: [] });
  }
  _njStep = 2; renderNewJapStep();
}
function njS2() {
  _nj.defunt = val('nj-def'); _nj.adresse = val('nj-adr'); _nj.notaire = val('nj-not');
  _nj.seuil = Math.max(0, num(val('nj-sou'), 200));
  if (!_nj.defunt) return toast("Indiquez le nom de la personne disparue.", 'error');
  _njStep = 3; renderNewJapStep();
}
function njS3() {
  if (!ayantsDroit(_nj).length) return toast("Ajoutez au moins un héritier.", 'error');
  _njStep = 4; renderNewJapStep();
}
async function finNJ(btn) {
  busy(btn, 'Création…');
  try {
    _nj.herit.forEach(h => delete h.auto);
    _nj.createdAt = new Date().toISOString();
    await Store.saveJap(_nj);
    toast("La succession est créée.");
    Router.go("/jap/" + _nj.id);
  } catch (e) { unbusy(btn); toast("Échec de l'enregistrement : " + e.message, 'error'); }
}

/* ── FENÊTRE HÉRITIER (création comme modification) ──────────── */
let _heirCtx = null; // { japId|null (assistant), hId|null }
async function showHeirModal(japId, hId) {
  const j = japId ? await Store.getJap(japId) : _nj;
  if (!j) return toast("Succession introuvable.", 'error');
  const h = (hId && (j.herit || []).find(x => x.id === hId)) || { nom: '', email: '', role: 'ayant_droit', parts: 1, recus: 0, enfants: [] };
  _heirCtx = { japId, hId: hId || null };
  Modal.open(hId ? "Modifier l'héritier" : "Ajouter un héritier", `
    <div class="form-group"><label class="form-label" for="ha-nom">Prénom et nom *</label><input id="ha-nom" class="form-input" value="${esc(h.nom)}" placeholder="Ex. : Jean Martin" /></div>
    <div class="form-group"><label class="form-label" for="ha-email">Adresse e-mail</label><input id="ha-email" type="email" inputmode="email" class="form-input" value="${esc(h.email)}" placeholder="jean.martin@exemple.fr" />
      <p class="form-hint">Nécessaire pour qu'il puisse faire sa liste de souhaits.</p></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label" for="ha-role">Rôle</label>
        <select id="ha-role" class="form-select">${Object.entries(ROLES).map(([v, l]) => `<option value="${v}" ${h.role === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label" for="ha-parts">Nombre de parts</label><input id="ha-parts" class="form-input" type="number" min="0" step="0.5" inputmode="decimal" value="${esc(partsOf(h))}" /></div>
    </div>
    <div class="form-group"><label class="form-label" for="ha-rec">Biens ou dons déjà reçus (€)</label><input id="ha-rec" class="form-input" type="number" min="0" step="1" inputmode="numeric" value="${esc(num(h.recus))}" />
      <p class="form-hint">Montant déjà perçu avant le partage : il est pris en compte dans le calcul.</p></div>
    <fieldset class="form-group"><legend class="form-label">Enfant(s) de cet héritier <span class="opt">(facultatif)</span></legend>
      <p class="form-hint mb-8">Ils pourront l'aider à composer sa liste (ou le représenter s'il est décédé).</p>
      <div id="ha-enfants-container">${(h.enfants || []).map(enfantRow).join('')}</div>
      <button class="btn btn-dashed btn-sm w-full" data-action="enfant-add"><span aria-hidden="true">＋</span> Ajouter un enfant</button>
    </fieldset>
    <button class="btn btn-primary btn-lg w-full mt-16" data-action="heir-save">${hId ? 'Enregistrer les modifications' : "Ajouter l'héritier"}</button>`);
}
const enfantRow = (e = {}) => `<div class="enfant-row">
  <input class="form-input" aria-label="Nom de l'enfant" placeholder="Prénom Nom" value="${esc(e.nom)}" />
  <input class="form-input" aria-label="E-mail de l'enfant" type="email" placeholder="E-mail" value="${esc(e.contact)}" />
  <button class="btn btn-sm btn-ghost-danger" data-action="enfant-del" aria-label="Retirer cet enfant">Retirer</button>
</div>`;

async function saveHeir(btn) {
  const nom = val('ha-nom'); const email = val('ha-email').toLowerCase();
  if (!nom) return toast("Indiquez le nom de l'héritier.", 'error');
  if (email && !isEmail(email)) return toast("L'adresse e-mail n'est pas valide.", 'error');
  const enfants = [];
  document.querySelectorAll('#ha-enfants-container .enfant-row').forEach(r => {
    const [a, b] = r.querySelectorAll('input');
    const n = a.value.trim(), c = b.value.trim().toLowerCase();
    if (n || c) enfants.push({ nom: n, contact: c });
  });
  const { japId, hId } = _heirCtx || {};
  const j = japId ? await Store.getJap(japId) : _nj;
  if (!j) return toast("Succession introuvable.", 'error');
  j.herit = j.herit || [];
  if (email && j.herit.some(x => x.id !== hId && (x.email || '').toLowerCase() === email)) return toast("Cette adresse e-mail est déjà utilisée par un autre héritier.", 'error');
  const old = hId ? j.herit.find(x => x.id === hId) : null;
  const data = {
    ...(old || {}), id: hId || uid(), nom, email, role: $('ha-role').value,
    parts: Math.max(0, num(val('ha-parts'), 1)), recus: Math.max(0, num(val('ha-rec'), 0)), enfants,
  };
  if (old) {
    // Si son e-mail change et qu'il était administrateur, on reporte le droit.
    if (old.email && old.email !== email && (j.admins || []).includes(old.email)) {
      j.admins = j.admins.filter(a => a !== old.email); if (email) j.admins.push(email);
    }
    j.herit[j.herit.indexOf(old)] = data;
  } else j.herit.push(data);

  if (!japId) { Modal.close(); renderNewJapStep(); return; }
  busy(btn, 'Enregistrement…');
  try { await Store.saveJap(j); Modal.close(); toast(hId ? "Héritier modifié." : "Héritier ajouté."); renderDashboard({ id: japId }); }
  catch (e) { unbusy(btn); toast("Échec : " + e.message, 'error'); }
}

/* ================================================================
   TABLEAU DE BORD
================================================================ */
async function editInfosModal(id) {
  const j = await Store.getJap(id); if (!j) return;
  Modal.open("Modifier la succession", `
    <div class="form-group"><label class="form-label" for="ei-def">Personne disparue *</label><input id="ei-def" class="form-input" value="${esc(j.defunt)}" /></div>
    <div class="form-group"><label class="form-label" for="ei-adr">Adresse</label><input id="ei-adr" class="form-input" value="${esc(j.adresse)}" /></div>
    <div class="form-group"><label class="form-label" for="ei-not">Notaire</label><input id="ei-not" class="form-input" value="${esc(j.notaire)}" /></div>
    <div class="form-group"><label class="form-label" for="ei-sou">Seuil de tolérance (€)</label><input id="ei-sou" class="form-input input-short" type="number" min="0" inputmode="numeric" value="${esc(seuilOf(j))}" /></div>
    <button class="btn btn-primary btn-lg w-full" data-action="infos-save" data-id="${esc(id)}">Enregistrer</button>`);
}
async function saveInfos(id, btn) {
  const j = await Store.getJap(id); if (!j) return;
  const d = val('ei-def'); if (!d) return toast("Le nom est obligatoire.", 'error');
  j.defunt = d; j.adresse = val('ei-adr'); j.notaire = val('ei-not'); j.seuil = Math.max(0, num(val('ei-sou'), 200));
  busy(btn, 'Enregistrement…');
  await Store.saveJap(j); Modal.close(); toast('Modifications enregistrées.'); renderDashboard({ id });
}
async function mkAdmin(id, hId) {
  const j = await Store.getJap(id); if (!j) return;
  const h = (j.herit || []).find(x => x.id === hId);
  if (!h || !isEmail(h.email)) return toast("Cette personne doit d'abord avoir une adresse e-mail.", 'error');
  const ok = await confirmBox({ title: "Nommer administrateur ?", text: `<strong>${esc(h.nom)}</strong> pourra modifier l'inventaire, les héritiers et lancer le partage.`, ok: "Oui, nommer administrateur" });
  if (!ok) return;
  j.admins = j.admins || [];
  if (!j.admins.includes(h.email.toLowerCase())) j.admins.push(h.email.toLowerCase());
  await Store.saveJap(j); toast(`${h.nom} est maintenant administrateur.`); renderDashboard({ id });
}

function progressTrack(step) {
  const labels = ['Inventaire', 'Souhaits', 'Partage'];
  return `<ol class="track" aria-label="Avancement">${labels.map((l, i) => {
    const n = i + 1; const cls = n < step ? 'done' : n === step ? 'active' : '';
    return `<li class="track-step ${cls}" ${n === step ? 'aria-current="step"' : ''}><span class="track-dot">${n < step || step === 3 && n === 3 ? '✓' : n}</span><span>${l}</span></li>`;
  }).join('')}</ol>`;
}

async function renderDashboard({ id }) {
  const j = await Store.getJap(id);
  if (!j) { Store.forgetJap(id); toast("Cette succession n'existe plus.", 'error'); return Router.go("/"); }
  const user = Store.getUser();
  const isAdmin = isAdminOf(j);
  const role = getTargetHeir(j);
  const s = STATUTS[j.statut] || STATUTS.prep;
  const heirs = ayantsDroit(j);
  const nbValid = heirs.filter(h => h.valide).length;
  const nbBiens = (j.biens || []).length;
  const totalBiens = (j.biens || []).reduce((a, b) => a + num(b.val), 0);

  // Prochaine action, mise en avant
  let next = '';
  if (j.statut === 'partage') {
    next = `<div class="next-card next-done"><div class="next-label">Le partage est terminé</div>
      <p>Consultez qui reçoit quoi et les éventuelles compensations.</p>
      <button class="btn btn-primary btn-lg w-full" data-action="go" data-to="/jap/${esc(id)}/partage">Voir les résultats</button></div>`;
  } else if (isAdmin && s.step === 1) {
    next = `<div class="next-card"><div class="next-label">Prochaine étape</div>
      <p>${nbBiens ? `Vous avez ${nbBiens} objet(s) dans l'inventaire. Quand il est complet, ouvrez les souhaits à la famille.` : "Commencez par ajouter les objets à partager, avec une photo et une valeur."}</p>
      <button class="btn btn-primary btn-lg w-full" data-action="go" data-to="/jap/${esc(id)}/inv">${nbBiens ? "Compléter l'inventaire" : "Ajouter les objets"}</button>
      ${nbBiens ? `<button class="btn btn-accent btn-lg w-full mt-12" data-action="open-wishes" data-id="${esc(id)}">Ouvrir les souhaits à la famille</button>` : ''}</div>`;
  } else if (isAdmin && s.step === 2) {
    next = `<div class="next-card"><div class="next-label">Prochaine étape</div>
      <p><strong>${nbValid} sur ${heirs.length}</strong> héritier(s) ont validé leur liste de souhaits.</p>
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${heirs.length}" aria-valuenow="${nbValid}"><span style="width:${heirs.length ? nbValid / heirs.length * 100 : 0}%"></span></div>
      <button class="btn btn-primary btn-lg w-full mt-16" data-action="go" data-to="/jap/${esc(id)}/partage">Lancer le partage</button></div>`;
  } else if (role.heir && s.step === 2) {
    const h = role.heir;
    next = `<div class="next-card"><div class="next-label">${h.valide ? 'Votre liste est validée ✓' : 'À vous de jouer'}</div>
      <p>${h.valide ? 'Vous pouvez encore la modifier tant que le partage n\'est pas lancé.' : `Choisissez les objets que ${role.type === 'enfant' ? esc(h.nom) + ' aimerait' : 'vous aimeriez'} garder, par ordre de préférence.`}</p>
      <button class="btn btn-primary btn-lg w-full" data-action="go" data-to="/jap/${esc(id)}/wish">${h.valide ? 'Revoir la liste' : 'Faire ma liste de souhaits'}</button></div>`;
  } else if (s.step === 1) {
    next = `<div class="next-card"><div class="next-label">En attente</div><p>L'inventaire est en cours de préparation. Vous pourrez bientôt choisir vos souhaits.</p></div>`;
  }

  const members = (j.herit || []).map(h => {
    const estAdmin = h.email && (j.admins || []).includes(h.email.toLowerCase());
    const moi = h.email && h.email === user.email;
    return `<div class="person">
      <span class="avatar" aria-hidden="true">${esc(ini(h.nom))}</span>
      <div class="person-info">
        <div class="person-name">${esc(h.nom)} ${moi ? '<span class="tag">Vous</span>' : ''} ${estAdmin ? '<span class="tag tag-accent">Administrateur</span>' : ''}</div>
        <div class="person-meta">${roleL(h.role)}${h.role !== 'expert' ? ` · ${partsOf(h)} part${partsOf(h) > 1 ? 's' : ''}` : ''}${num(h.recus) ? ` · déjà reçu ${fmt(h.recus)}` : ''}</div>
        ${s.step === 2 && h.role !== 'expert' ? `<div class="person-meta ${h.valide ? 'ok' : ''}">${h.valide ? '✓ Liste validée' : '… Liste pas encore validée'}</div>` : ''}
      </div>
      ${isAdmin ? `<div class="person-actions">
        ${j.statut !== 'partage' ? `<button class="btn btn-sm btn-secondary" data-action="heir-edit" data-jid="${esc(id)}" data-hid="${esc(h.id)}">Modifier</button>` : ''}
        ${!estAdmin && h.email ? `<button class="btn btn-sm btn-secondary" data-action="mk-admin" data-id="${esc(id)}" data-hid="${esc(h.id)}">Nommer admin</button>` : ''}
      </div>` : ''}
    </div>`;
  }).join('');

  $('app').innerHTML = `${topbar('Succession', '/', `<span class="badge ${s.css}">${s.label}</span>`)}
  <main class="view">
    <section class="card card-hero">
      <div class="card-hero-top">
        <span class="avatar avatar-xl" aria-hidden="true">${esc(ini(j.defunt))}</span>
        <div><div class="eyebrow">Succession de</div><h2 class="card-hero-title">${esc(j.defunt)}</h2>
        <div class="muted">${esc(j.notaire || 'Notaire non renseigné')}</div></div>
      </div>
      <div class="stats">
        <div class="stat"><span class="stat-value">${nbBiens}</span><span class="stat-label">objet(s)</span></div>
        <div class="stat"><span class="stat-value">${fmt(totalBiens)}</span><span class="stat-label">valeur totale</span></div>
        <div class="stat"><span class="stat-value">${heirs.length}</span><span class="stat-label">héritier(s)</span></div>
      </div>
      ${progressTrack(s.step)}
      ${isAdmin && j.statut !== 'partage' ? `<button class="btn btn-secondary btn-sm mt-16" data-action="infos-edit" data-id="${esc(id)}">✏️ Modifier les informations</button>` : ''}
    </section>

    ${next}

    <section class="card">
      <h2 class="card-title">Inviter la famille</h2>
      <p class="muted">Transmettez ce code aux héritiers. Ils le saisiront dans « J'ai reçu un code ».</p>
      <div class="code-box"><span class="code" aria-label="Code">${esc(j.code)}</span></div>
      <div class="btn-row">
        <button class="btn btn-secondary" data-action="copy-code" data-code="${esc(j.code)}">📋 Copier le code</button>
        <button class="btn btn-secondary" data-action="share-code" data-id="${esc(id)}">✉️ Envoyer par e-mail</button>
      </div>
    </section>

    <nav class="menu-list" aria-label="Rubriques">
      <button class="menu-item" data-action="go" data-to="/jap/${esc(id)}/inv"><span class="menu-icon" aria-hidden="true">📸</span><span class="menu-text"><strong>Inventaire des objets</strong><small>${nbBiens} objet(s) · ${fmt(totalBiens)}</small></span><span class="chevron" aria-hidden="true">›</span></button>
      ${role.heir && j.statut !== 'partage' ? `<button class="menu-item" data-action="go" data-to="/jap/${esc(id)}/wish"><span class="menu-icon" aria-hidden="true">❤️</span><span class="menu-text"><strong>${role.type === 'enfant' ? 'Liste de ' + esc(role.heir.nom) : 'Ma liste de souhaits'}</strong><small>${(role.heir.souhaits || []).length} objet(s) choisi(s)</small></span><span class="chevron" aria-hidden="true">›</span></button>` : ''}
      ${j.statut === 'partage' ? `<button class="menu-item" data-action="go" data-to="/jap/${esc(id)}/partage"><span class="menu-icon" aria-hidden="true">🏆</span><span class="menu-text"><strong>Résultat du partage</strong><small>Qui reçoit quoi, compensations</small></span><span class="chevron" aria-hidden="true">›</span></button>` : ''}
    </nav>

    <h2 class="section-title mt-32">Membres de la succession</h2>
    <div class="stack">${members || '<p class="muted">Aucun membre.</p>'}</div>
    ${isAdmin && j.statut !== 'partage' ? `<button class="btn btn-dashed w-full mt-12" data-action="heir-edit" data-jid="${esc(id)}"><span aria-hidden="true">＋</span> Ajouter une personne</button>` : ''}
    ${!role.heir && !isAdmin ? `<div class="notice notice-info mt-16">Vous consultez cette succession. Si vous êtes héritier, demandez à l'administrateur d'ajouter votre adresse <strong>${esc(user.email || '(aucune)')}</strong>.</div>` : ''}

    ${isAdmin ? `<section class="danger-zone mt-40">
      <h2 class="card-title">Zone sensible</h2>
      ${j.statut === 'souhaits' ? `<button class="btn btn-secondary w-full mb-12" data-action="back-inv" data-id="${esc(id)}">Revenir à l'inventaire</button>` : ''}
      <button class="btn btn-ghost-danger w-full" data-action="jap-del" data-id="${esc(id)}">🗑️ Supprimer cette succession</button>
    </section>` : ''}
  </main>`;
}

async function openWishes(id) {
  const j = await Store.getJap(id); if (!j) return;
  if (!(j.biens || []).length) return toast("Ajoutez d'abord des objets à l'inventaire.", 'error');
  const sansEmail = ayantsDroit(j).filter(h => !h.email && h.role !== 'décédé');
  const ok = await confirmBox({
    title: "Ouvrir les souhaits ?",
    text: `Les héritiers pourront choisir leurs objets préférés. Vous pourrez encore ajouter des objets.${sansEmail.length ? `<br><br>⚠️ Sans e-mail, ces personnes ne pourront pas se connecter : <strong>${sansEmail.map(h => esc(h.nom)).join(', ')}</strong>.` : ''}`,
    ok: "Oui, ouvrir les souhaits",
  });
  if (!ok) return;
  j.statut = 'souhaits'; await Store.saveJap(j);
  toast("Les souhaits sont ouverts. Envoyez le code à la famille.");
  renderDashboard({ id });
  shareCode(id);
}
async function backToInv(id) {
  const ok = await confirmBox({ title: "Revenir à l'inventaire ?", text: "Les listes de souhaits déjà faites sont conservées.", ok: "Oui, revenir" });
  if (!ok) return;
  const j = await Store.getJap(id); j.statut = 'prep'; await Store.saveJap(j); renderDashboard({ id });
}
async function deleteJap(id) {
  const ok = await confirmBox({ title: "Supprimer la succession ?", text: "Toutes les données (objets, photos, listes) seront <strong>définitivement effacées</strong> pour tout le monde.", ok: "Supprimer définitivement", danger: true });
  if (!ok) return;
  await Store.deleteJap(id); toast("Succession supprimée."); Router.go("/");
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { }
    t.remove(); return ok;
  }
}
async function shareCode(id) {
  const j = await Store.getJap(id); if (!j) return;
  const url = location.origin + location.pathname;
  const text = `Bonjour,\n\nPour le partage des biens de ${j.defunt}, nous utilisons l'application JAP.\n\n1. Ouvrez : ${url}\n2. Touchez « J'ai reçu un code »\n3. Saisissez le code : ${j.code}\n4. Indiquez votre adresse e-mail.\n\nMerci.`;
  const emails = ayantsDroit(j).map(h => h.email).filter(e => e && e !== Store.getUser().email);
  Modal.open("Inviter la famille", `
    <p class="muted mb-16">Voici le message à envoyer. Vous pouvez l'envoyer par e-mail ou le copier pour un SMS.</p>
    <pre class="message-box">${esc(text)}</pre>
    <div class="btn-stack mt-16">
      <a class="btn btn-primary btn-lg w-full" href="mailto:${encodeURIComponent(emails.join(','))}?subject=${encodeURIComponent('Succession de ' + j.defunt + ' — JAP')}&body=${encodeURIComponent(text)}">✉️ Ouvrir ma messagerie</a>
      ${navigator.share ? `<button class="btn btn-secondary w-full" id="sh-native">📤 Partager (SMS, WhatsApp…)</button>` : ''}
      <button class="btn btn-secondary w-full" id="sh-copy">📋 Copier le message</button>
    </div>`);
  $('sh-copy').onclick = async () => toast(await copyText(text) ? "Message copié." : "Copie impossible : sélectionnez le texte.", 'success');
  if ($('sh-native')) $('sh-native').onclick = () => navigator.share({ title: 'JAP', text }).catch(() => { });
}

/* ================================================================
   INVENTAIRE
================================================================ */
let tmpPhotoUrl = null;
let _bienCtx = null; // { id, bid|null }

/** Réduit la photo (max 800 px, JPEG 0,7) : indispensable sur mobile. */
function compressImage(dataUrl, maxPx = 800, quality = 0.7) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxPx || h > maxPx) { if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; } else { w = Math.round(w * maxPx / h); h = maxPx; } }
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
      resolve(cv.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
function handlePhotoUpload(input) {
  const f = input.files && input.files[0]; if (!f) return;
  if (!f.type.startsWith('image/')) return toast("Ce fichier n'est pas une image.", 'error');
  const reader = new FileReader();
  reader.onload = async e => {
    const c = await compressImage(e.target.result);
    if (!c) return toast("Impossible de lire cette photo. Essayez-en une autre.", 'error');
    tmpPhotoUrl = c;
    const p = $('b-photo-preview'); if (p) { p.src = c; p.hidden = false; }
    const z = $('photo-empty'); if (z) z.hidden = true;
    const r = $('photo-remove'); if (r) r.hidden = false;
  };
  reader.onerror = () => toast("Impossible de lire cette photo.", 'error');
  reader.readAsDataURL(f);
  input.value = '';
}

async function callEstimer(payload) {
  const urls = location.protocol.startsWith('http') ? ['/api/estimer', WORKER_URL] : [WORKER_URL];
  let lastErr;
  for (const u of urls) {
    try {
      const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (r.status === 404 || r.status === 405) { lastErr = new Error('Service introuvable'); continue; }
      const ct = r.headers.get('content-type') || '';
      const data = ct.includes('json') ? await r.json() : { error: (await r.text()).slice(0, 200) };
      if (!r.ok || data.error) throw new Error(data.error || ('Erreur ' + r.status));
      return data;
    } catch (e) { lastErr = e; if (!(e instanceof TypeError) && e.message !== 'Service introuvable') throw e; }
  }
  throw lastErr || new Error('Service indisponible');
}
async function runAIEval(btn) {
  if (!tmpPhotoUrl) return toast("Ajoutez d'abord une photo de l'objet.", 'error');
  const nom = val('b-n');
  busy(btn, 'Analyse en cours…');
  $('ai-resume').innerHTML = `<div class="notice notice-info"><span class="spinner"></span> L'assistant examine la photo. Cela peut prendre 20 à 30 secondes.</div>`;
  try {
    const d = await callEstimer({ photo: tmpPhotoUrl, contexte: nom });
    if (num(d.prix_median) > 0) $('b-v').value = Math.round(num(d.prix_median));
    if (d.categorie && CATS.some(c => c.v === d.categorie)) $('b-c').value = d.categorie;
    if (!nom && d.objet) $('b-n').value = d.objet;
    $('ai-resume').innerHTML = `<div class="ai-card">
      <div class="ai-card-title">Estimation proposée : <strong>${fmt(d.prix_median)}</strong></div>
      <div class="ai-range"><span>Bas : ${fmt(d.prix_min)}</span><span>Haut : ${fmt(d.prix_max)}</span></div>
      ${d.etat ? `<div class="muted">État observé : ${esc(d.etat)}</div>` : ''}
      ${d.explication ? `<p class="mt-8">${esc(d.explication)}</p>` : ''}
      <p class="form-hint">C'est une indication : vous pouvez modifier le prix.</p></div>`;
  } catch (e) {
    $('ai-resume').innerHTML = '';
    toast("L'estimation n'a pas pu être faite : " + e.message, 'error');
  } finally { unbusy(btn); }
}

async function renderInventaire({ id }) {
  const j = await Store.getJap(id); if (!j) return Router.go('/');
  const b = j.biens || [];
  const isAdmin = isAdminOf(j);
  const locked = j.statut === 'partage';
  const valTotal = b.reduce((a, c) => a + num(c.val), 0);
  const canEdit = isAdmin && !locked;

  $('app').innerHTML = `${topbar('Inventaire', `/jap/${id}`)}
  <main class="view ${canEdit ? 'has-bottom-bar' : ''}">
    <div class="total-card"><div><div class="total-label">Valeur totale</div><div class="muted">${b.length} objet(s)</div></div><div class="total-value">${fmt(valTotal)}</div></div>
    ${!isAdmin ? `<div class="notice notice-info mb-16">Seuls les administrateurs peuvent ajouter ou modifier les objets.</div>` : ''}
    ${locked && isAdmin ? `<div class="notice notice-info mb-16">Le partage est terminé : l'inventaire ne peut plus être modifié.</div>` : ''}
    <div class="stack">
    ${b.length ? b.map(x => `<article class="bien">
        ${thumb(x, 'thumb-lg')}
        <div class="bien-info"><h3 class="bien-name">${esc(x.nom)}</h3><div class="muted">${catE(x.cat)} ${catL(x.cat)}</div><div class="bien-price">${fmt(x.val)}</div></div>
        ${canEdit ? `<div class="bien-actions">
          <button class="btn btn-sm btn-secondary" data-action="bien-edit" data-id="${esc(id)}" data-bid="${esc(x.id)}">Modifier</button>
          <button class="btn btn-sm btn-ghost-danger" data-action="bien-del" data-id="${esc(id)}" data-bid="${esc(x.id)}">Supprimer</button></div>` : ''}
      </article>`).join('') : `<div class="empty-card"><div class="empty-state-icon" aria-hidden="true">📸</div><p class="lead">Aucun objet pour l'instant.</p>${canEdit ? '<p class="muted">Touchez « Ajouter un objet » en bas de l\'écran.</p>' : ''}</div>`}
    </div>
  </main>
  ${canEdit ? `<div class="bottom-bar"><button class="btn btn-primary btn-lg w-full" data-action="bien-edit" data-id="${esc(id)}"><span aria-hidden="true">＋</span> Ajouter un objet</button></div>` : ''}`;
}
async function showBienModal(id, bid) {
  const j = await Store.getJap(id); if (!j) return;
  const x = bid ? (j.biens || []).find(b => b.id === bid) : null;
  tmpPhotoUrl = x ? x.photo || null : null;
  _bienCtx = { id, bid: bid || null };
  Modal.open(x ? "Modifier l'objet" : "Ajouter un objet", `
    <div class="photo-zone">
      <img id="b-photo-preview" alt="Photo de l'objet" ${tmpPhotoUrl ? `src="${esc(tmpPhotoUrl)}"` : 'hidden'} />
      <div id="photo-empty" class="photo-empty" ${tmpPhotoUrl ? 'hidden' : ''}><span aria-hidden="true">📷</span>Aucune photo</div>
    </div>
    <div class="btn-row mb-8">
      <label class="btn btn-secondary">📷 Prendre une photo<input type="file" accept="image/*" capture="environment" class="sr-only" data-change="photo" /></label>
      <label class="btn btn-secondary">🖼️ Choisir une image<input type="file" accept="image/*" class="sr-only" data-change="photo" /></label>
    </div>
    <button id="photo-remove" class="link-btn mb-16" data-action="photo-remove" ${tmpPhotoUrl ? '' : 'hidden'}>Retirer la photo</button>
    <div class="form-group"><label class="form-label" for="b-n">Description de l'objet *</label>
      <input id="b-n" class="form-input" value="${esc(x ? x.nom : '')}" placeholder="Ex. : Montre Tissot, avec sa boîte" /></div>
    <div class="form-group"><label class="form-label" for="b-c">Catégorie</label>
      <select id="b-c" class="form-select">${CATS.map(c => `<option value="${c.v}" ${(x ? x.cat : 'autre') === c.v ? 'selected' : ''}>${c.e} ${c.l}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label" for="b-v">Valeur estimée (€)</label>
      <input id="b-v" class="form-input input-short" type="number" min="0" step="1" inputmode="numeric" value="${x ? esc(num(x.val)) : ''}" placeholder="0" /></div>
    <button id="ai-btn" class="btn btn-accent w-full" data-action="ai-eval">✨ Faire estimer par l'assistant (avec la photo)</button>
    <div id="ai-resume" class="mt-12"></div>
    <button class="btn btn-primary btn-lg w-full mt-16" data-action="bien-save">${x ? 'Enregistrer' : "Ajouter à l'inventaire"}</button>`);
}
async function saveBien(btn) {
  const { id, bid } = _bienCtx || {};
  const n = val('b-n');
  if (!n) return toast("Décrivez l'objet en quelques mots.", 'error');
  const v = num(val('b-v'), 0);
  if (v < 0) return toast("La valeur ne peut pas être négative.", 'error');
  busy(btn, 'Enregistrement…');
  try {
    const j = await Store.getJap(id);
    j.biens = j.biens || [];
    const data = { id: bid || uid(), nom: n, cat: $('b-c').value, val: v, photo: tmpPhotoUrl };
    if (bid) { const i = j.biens.findIndex(b => b.id === bid); if (i >= 0) j.biens[i] = { ...j.biens[i], ...data }; }
    else j.biens.push(data);
    await Store.saveJap(j);
    Modal.close(); toast(bid ? "Objet modifié." : "Objet ajouté."); renderInventaire({ id });
  } catch (err) {
    console.error(err); unbusy(btn);
    toast(err && err.name === 'QuotaExceededError' ? "Mémoire de l'appareil pleine : essayez sans photo." : "Échec de l'enregistrement : " + (err.message || err), 'error');
  }
}
async function delBien(id, bid) {
  const j = await Store.getJap(id); if (!j) return;
  const b = (j.biens || []).find(x => x.id === bid); if (!b) return;
  const inWish = (j.herit || []).filter(h => (h.souhaits || []).includes(bid)).length;
  const ok = await confirmBox({ title: "Supprimer cet objet ?", text: `<strong>${esc(b.nom)}</strong> sera retiré de l'inventaire${inWish ? ` et des listes de ${inWish} héritier(s)` : ''}.`, ok: "Supprimer", danger: true });
  if (!ok) return;
  j.biens = j.biens.filter(x => x.id !== bid);
  (j.herit || []).forEach(h => { if (h.souhaits) h.souhaits = h.souhaits.filter(s => s !== bid); });
  await Store.saveJap(j); toast("Objet supprimé."); renderInventaire({ id });
}

/* ================================================================
   LISTE DE SOUHAITS
================================================================ */
let _japCache = null;
let _saveChain = Promise.resolve();
/** Sauvegardes en file : évite qu'une ancienne version écrase une plus récente. */
function queueSave(j) {
  _saveChain = _saveChain.then(() => Store.saveJap(j)).catch(err => { console.error(err); toast("Échec de l'enregistrement.", 'error'); });
  return _saveChain;
}

async function renderSouhaits({ id }, cachedJap = null) {
  const j = cachedJap || await Store.getJap(id);
  if (!j) return Router.go('/');
  _japCache = j;
  const role = getTargetHeir(j);
  if (!role.heir) { toast("Seuls les héritiers ont une liste de souhaits.", 'warn'); return Router.go(`/jap/${id}`); }
  if (j.statut === 'partage') { toast("Le partage est terminé.", 'warn'); return Router.go(`/jap/${id}/partage`); }

  const h = role.heir;
  const reorder = canReorder(role);
  const b = j.biens || [];
  h.souhaits = (h.souhaits || []).filter(bid => b.some(x => x.id === bid));
  const s = h.souhaits;
  const myPart = partTheorique(j, h);
  const wishVal = s.reduce((a, bid) => a + num((b.find(x => x.id === bid) || {}).val), 0);
  const diff = wishVal + num(h.recus) - myPart;
  const seuil = seuilOf(j);
  let bilan = `<div class="bilan bilan-ok">Votre liste correspond à peu près à votre part.</div>`;
  if (diff > seuil) bilan = `<div class="bilan bilan-warn">Si vous obteniez tout, vous auriez environ <strong>${fmt(diff)}</strong> à reverser aux autres (soulte).</div>`;
  else if (diff < -seuil) bilan = `<div class="bilan bilan-info">Il reste environ <strong>${fmt(-diff)}</strong> avant d'atteindre votre part. Vous pouvez ajouter des objets, ou recevoir une compensation.</div>`;

  const rankHtml = s.map((bid, i) => {
    const o = b.find(x => x.id === bid); if (!o) return '';
    return `<li class="wish">
      <span class="wish-rank" aria-label="Choix numéro ${i + 1}">${i + 1}</span>
      ${thumb(o)}
      <div class="wish-info"><div class="wish-name">${esc(o.nom)}</div><div class="muted">${fmt(o.val)}</div></div>
      <div class="wish-actions">
        ${reorder ? `<button class="icon-btn" data-action="wish-move" data-i="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Monter ${esc(o.nom)}">▲<span>Monter</span></button>
        <button class="icon-btn" data-action="wish-move" data-i="${i}" data-dir="1" ${i === s.length - 1 ? 'disabled' : ''} aria-label="Descendre ${esc(o.nom)}">▼<span>Descendre</span></button>` : ''}
        <button class="icon-btn icon-btn-danger" data-action="wish-toggle" data-bid="${esc(bid)}" aria-label="Retirer ${esc(o.nom)} de la liste">✕<span>Retirer</span></button>
      </div>
    </li>`;
  }).join('');

  const avail = b.filter(x => !s.includes(x.id));
  const availHtml = avail.map(x => `<article class="bien">
      ${thumb(x, 'thumb-lg')}
      <div class="bien-info"><h3 class="bien-name">${esc(x.nom)}</h3><div class="muted">${catL(x.cat)}</div><div class="bien-price">${fmt(x.val)}</div></div>
      <button class="btn btn-sm btn-heart" data-action="wish-toggle" data-bid="${esc(x.id)}" aria-label="Ajouter ${esc(x.nom)} à ma liste">♡ Je le souhaite</button>
    </article>`).join('');

  $('app').innerHTML = `${topbar(role.type === 'enfant' ? 'Liste de ' + esc(h.nom) : 'Ma liste de souhaits', `/jap/${id}`)}
  <main class="view has-bottom-bar">
    ${role.type === 'enfant' ? `<div class="notice notice-info mb-16"><strong>Vous agissez pour ${esc(h.nom)}.</strong> ${reorder ? '' : "Vous pouvez ajouter ou retirer des objets ; seul l'héritier peut changer l'ordre."}</div>` : ''}
    ${h.valide ? `<div class="notice notice-ok mb-16">✓ Liste validée. Toute modification devra être validée à nouveau.</div>` : ''}
    <section class="card">
      <div class="recap-row"><span>Votre part estimée${partsOf(h) !== 1 ? ` (${partsOf(h)} parts)` : ''}</span><strong>${fmt(myPart)}</strong></div>
      <div class="recap-row"><span>Valeur de votre liste</span><strong>${fmt(wishVal)}</strong></div>
      ${num(h.recus) ? `<div class="recap-row"><span>Déjà reçu</span><strong>${fmt(h.recus)}</strong></div>` : ''}
      ${bilan}
    </section>

    <h2 class="section-title mt-32"><span class="section-num">1</span> Vos choix, par ordre de préférence</h2>
    <p class="muted mb-12">Le n°1 est l'objet auquel vous tenez le plus. ${reorder ? 'Utilisez « Monter » et « Descendre » pour changer l\'ordre.' : ''}</p>
    ${s.length ? `<ol class="wish-list">${rankHtml}</ol>` : `<div class="empty-card"><p class="muted">Aucun objet choisi. Touchez « Je le souhaite » sur les objets ci-dessous.</p></div>`}

    <h2 class="section-title mt-32"><span class="section-num">2</span> Objets disponibles</h2>
    <div class="stack">${availHtml || `<div class="empty-card"><p class="muted">${b.length ? 'Vous avez choisi tous les objets.' : "L'inventaire est encore vide."}</p></div>`}</div>
  </main>
  <div class="bottom-bar"><button class="btn btn-success btn-lg w-full" data-action="wish-validate">✓ Valider ${role.type === 'enfant' ? 'la liste' : 'ma liste'} (${s.length} objet${s.length > 1 ? 's' : ''})</button></div>`;
}
function currentHeir() {
  const j = _japCache; if (!j) return {};
  const role = getTargetHeir(j);
  return { j, h: role.heir, role };
}
function togWish(bid) {
  const { j, h } = currentHeir(); if (!h) return;
  h.souhaits = h.souhaits || [];
  const i = h.souhaits.indexOf(bid);
  if (i >= 0) h.souhaits.splice(i, 1); else h.souhaits.push(bid);
  h.valide = false;
  const y = window.scrollY;
  renderSouhaits({ id: j.id }, j).then(() => window.scrollTo(0, y));
  toast(i >= 0 ? "Retiré de votre liste." : `Ajouté en position ${h.souhaits.length}.`);
  queueSave(j);
}
function moveWish(idx, dir) {
  const { j, h, role } = currentHeir(); if (!h || !canReorder(role)) return;
  const s = h.souhaits; const n = idx + dir; if (n < 0 || n >= s.length) return;
  [s[idx], s[n]] = [s[n], s[idx]];
  h.valide = false;
  const y = window.scrollY;
  renderSouhaits({ id: j.id }, j).then(() => {
    window.scrollTo(0, y);
    const btn = document.querySelector(`[data-action="wish-move"][data-i="${n}"][data-dir="${dir}"]:not([disabled])`) || document.querySelector(`[data-action="wish-move"][data-i="${n}"]`);
    if (btn) btn.focus();
  });
  queueSave(j);
}
async function validateWish(btn) {
  const { j, h } = currentHeir(); if (!h) return;
  if (!(h.souhaits || []).length) {
    const ok = await confirmBox({ title: "Liste vide", text: "Vous n'avez choisi aucun objet. Voulez-vous quand même valider ? Vous recevrez alors une compensation financière.", ok: "Valider sans objet" });
    if (!ok) return;
  }
  h.valide = true; h.valideLe = new Date().toISOString();
  busy(btn, 'Enregistrement…');
  await queueSave(j);
  toast("Merci, votre liste est validée.");
  Router.go(`/jap/${j.id}`);
}

/* ================================================================
   PARTAGE & RÉSULTATS
================================================================ */
async function renderPartage({ id }) {
  const j = await Store.getJap(id); if (!j) return Router.go('/');
  if (j.statut === 'partage') {
    if (!j.resultat) { j.resultat = allocate(j); await Store.saveJap(j); } // anciens dossiers
    return showResult(j);
  }
  if (!isAdminOf(j)) { toast("Seul un administrateur peut lancer le partage.", 'warn'); return Router.go(`/jap/${id}`); }
  const heirs = ayantsDroit(j);
  const pending = heirs.filter(h => !h.valide);
  $('app').innerHTML = `${topbar('Lancer le partage', `/jap/${id}`)}
  <main class="view">
    <section class="card center">
      <div class="big-emoji" aria-hidden="true">⚖️</div>
      <h2 class="card-hero-title">Comment se fait le partage ?</h2>
      <ol class="how how-compact">
        <li><span class="how-num">1</span><div>À chaque tour, chacun reçoit son objet préféré encore disponible.</div></li>
        <li><span class="how-num">2</span><div>Si deux personnes veulent le même objet, <strong>un tirage au sort</strong> les départage ; l'autre reçoit aussitôt son choix suivant.</div></li>
        <li><span class="how-num">3</span><div>Les tours continuent jusqu'à épuisement des listes. Les écarts de valeur au-delà de ${fmt(seuilOf(j))} sont compensés par des <strong>soultes</strong>.</div></li>
      </ol>
    </section>
    ${pending.length ? `<div class="notice notice-warn mt-16"><strong>${pending.length} héritier(s) n'ont pas validé leur liste :</strong> ${pending.map(h => esc(h.nom)).join(', ')}.<br>Vous pouvez attendre, ou lancer quand même le partage.</div>`
      : `<div class="notice notice-ok mt-16">✓ Tous les héritiers ont validé leur liste.</div>`}
    <div class="actions-bar"><button class="btn btn-primary btn-lg w-full" data-action="do-partage" data-id="${esc(id)}">Lancer le partage</button></div>
  </main>`;
}
async function doPartage(id, btn) {
  const j = await Store.getJap(id); if (!j) return;
  const ok = await confirmBox({ title: "Lancer le partage ?", text: "Les listes ne pourront plus être modifiées. Le tirage au sort est définitif.", ok: "Oui, lancer le partage" });
  if (!ok) return;
  j.resultat = allocate(j);
  j.statut = 'partage';
  // Nettoyage d'une ancienne version qui stockait la soulte sur chaque héritier.
  (j.herit || []).forEach(h => delete h.soulte);
  await Store.saveJap(j);
  toast("Le partage est terminé.");
  showResult(j);
}
async function cancelPartage(id) {
  const ok = await confirmBox({ title: "Annuler le partage ?", text: "Le résultat et les tirages au sort seront effacés, et la succession reviendra à l'étape des souhaits.", ok: "Annuler le partage", danger: true });
  if (!ok) return;
  const j = await Store.getJap(id); j.statut = 'souhaits'; delete j.resultat;
  await Store.saveJap(j); toast("Partage annulé."); Router.go(`/jap/${id}`);
}

function showResult(j) {
  const { lignes, virements, nonAttribues, seuil } = computeResult(j);
  const isAdmin = isAdminOf(j);
  const me = Store.getUser().email;
  const nomDe = hid => esc(((j.herit || []).find(h => h.id === hid) || {}).nom || '?');
  const bienDe = bid => esc(((j.biens || []).find(b => b.id === bid) || {}).nom || 'Objet supprimé');
  const totalAttrib = lignes.reduce((a, l) => a + l.valeur, 0);
  const totalRecus = lignes.reduce((a, l) => a + num(l.h.recus), 0);

  const cards = lignes.map(l => {
    let st = `<span class="soulte soulte-zero">Partage équilibré ✓</span>`;
    if (l.soulte > 0) st = `<span class="soulte soulte-neg">Verse ${fmt(l.soulte)}</span>`;
    else if (l.soulte < 0) st = `<span class="soulte soulte-pos">Reçoit ${fmt(-l.soulte)}</span>`;
    return `<article class="result-card ${l.h.email && l.h.email === me ? 'is-me' : ''}">
      <header class="result-head">
        <span class="avatar" aria-hidden="true">${esc(ini(l.h.nom))}</span>
        <div class="flex-1"><h3 class="result-name">${esc(l.h.nom)}${l.h.email === me ? ' <span class="tag">Vous</span>' : ''}</h3>
          <div class="muted">Objets : ${fmt(l.valeur)}${num(l.h.recus) ? ` · déjà reçu : ${fmt(l.h.recus)}` : ''} · part : ${fmt(l.theo)}</div></div>
        ${st}
      </header>
      <ul class="result-list">
        ${l.biens.length ? l.biens.map(b => `<li>${thumb(b, 'thumb-sm')}<span class="flex-1">${esc(b.nom)}</span><strong>${fmt(b.val)}</strong></li>`).join('') : '<li class="muted">Aucun objet attribué</li>'}
      </ul>
    </article>`;
  }).join('');

  const tours = (j.resultat && j.resultat.tours) || [];
  const toursHtml = tours.map(t => `<div class="tour"><div class="tour-title">Tour ${t.n}</div><ul>${t.events.map(e =>
    e.type === 'tirage'
      ? `<li>🎲 <strong>${bienDe(e.bien)}</strong> : tirage au sort entre ${e.candidats.map(nomDe).join(', ')} → <strong>${nomDe(e.gagnant)}</strong></li>`
      : `<li>${bienDe(e.bien)} → ${nomDe(e.gagnant)}</li>`).join('')}</ul></div>`).join('');

  $('app').innerHTML = `${topbar('Résultat du partage', `/jap/${j.id}`)}
  <main class="view">
    <div class="print-only print-head"><h1>Protocole de partage — Succession de ${esc(j.defunt)}</h1>
      <p>${j.notaire ? 'Notaire : ' + esc(j.notaire) + ' · ' : ''}Partage réalisé le ${new Date((j.resultat && j.resultat.date) || Date.now()).toLocaleDateString('fr-FR', { dateStyle: 'long' })} · Code ${esc(j.code)}</p></div>
    <div class="total-card"><div><div class="total-label">Valeur partagée</div><div class="muted">Objets attribués${totalRecus ? ' + dons déjà reçus' : ''}</div></div><div class="total-value">${fmt(totalAttrib + totalRecus)}</div></div>

    <section class="card">
      <h2 class="card-title">Compensations à verser (soultes)</h2>
      ${virements.length ? `<ul class="transfers">${virements.map(v => `<li><strong>${esc(v.de.nom)}</strong> verse <strong class="amount">${fmt(v.montant)}</strong> à <strong>${esc(v.a.nom)}</strong></li>`).join('')}</ul>`
      : `<p class="lead">Aucune compensation : les écarts sont inférieurs au seuil de ${fmt(seuil)}.</p>`}
    </section>

    <h2 class="section-title mt-32">Qui reçoit quoi</h2>
    <div class="stack">${cards}</div>

    ${nonAttribues.length ? `<h2 class="section-title mt-32">Objets non attribués (${nonAttribues.length})</h2>
      <p class="muted mb-12">Personne ne les a demandés. Ils peuvent être vendus ou donnés, le produit étant partagé selon les parts.</p>
      <ul class="result-list card">${nonAttribues.map(b => `<li>${thumb(b, 'thumb-sm')}<span class="flex-1">${esc(b.nom)}</span><strong>${fmt(b.val)}</strong></li>`).join('')}</ul>` : ''}

    ${tours.length ? `<details class="card mt-32 details"><summary>Voir le détail des tours et tirages au sort</summary>${toursHtml}</details>` : ''}

    <div class="print-only signatures"><h2>Signatures des héritiers</h2>
      ${lignes.map(l => `<div class="sign"><span>${esc(l.h.nom)}</span><span class="sign-line">Lu et approuvé, le ____ / ____ / ________ &nbsp; Signature :</span></div>`).join('')}</div>

    <div class="btn-stack mt-32 no-print">
      <button class="btn btn-primary btn-lg w-full" data-action="print">🖨️ Imprimer ou enregistrer en PDF</button>
      ${isAdmin ? `<button class="btn btn-secondary w-full" data-action="share-code" data-id="${esc(j.id)}">✉️ Prévenir la famille</button>
      <button class="btn btn-ghost-danger w-full" data-action="partage-cancel" data-id="${esc(j.id)}">Annuler ce partage</button>` : ''}
    </div>
  </main>`;
}

/* ── BOUTONS OCCUPÉS ─────────────────────────────────────────── */
function busy(btn, label) { if (!btn) return; btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> ${esc(label)}`; }
function unbusy(btn) { if (!btn || !btn.dataset.label) return; btn.disabled = false; btn.innerHTML = btn.dataset.label; }

/* ── DÉLÉGATION DES ACTIONS ──────────────────────────────────── */
const Actions = {
  'go': d => Router.go(d.to),
  'modal-close': () => Modal.close(),
  'logout': () => { Store.setUser({}); renderWelcome(); toast("Vous pouvez vous identifier avec une autre adresse."); },
  'join': () => showJoin(),
  'do-join': (d, el) => doJoin(el),
  'nj-back': () => { _njStep--; renderNewJapStep(); },
  'nj-1': () => njS1(), 'nj-2': () => njS2(), 'nj-3': () => njS3(), 'nj-fin': (d, el) => finNJ(el),
  'nj-heir-del': d => { _nj.herit = _nj.herit.filter(h => h.id !== d.hid); renderNewJapStep(); },
  'heir-edit': d => showHeirModal(d.jid || null, d.hid || null),
  'heir-save': (d, el) => saveHeir(el),
  'enfant-add': () => { $('ha-enfants-container').insertAdjacentHTML('beforeend', enfantRow()); const r = $('ha-enfants-container').lastElementChild; r.querySelector('input').focus(); },
  'enfant-del': (d, el) => el.closest('.enfant-row').remove(),
  'infos-edit': d => editInfosModal(d.id),
  'infos-save': (d, el) => saveInfos(d.id, el),
  'mk-admin': d => mkAdmin(d.id, d.hid),
  'open-wishes': d => openWishes(d.id),
  'back-inv': d => backToInv(d.id),
  'jap-del': d => deleteJap(d.id),
  'copy-code': async d => toast(await copyText(d.code) ? `Code ${d.code} copié.` : "Copie impossible : notez le code.", 'success'),
  'share-code': d => shareCode(d.id),
  'bien-edit': d => showBienModal(d.id, d.bid || null),
  'bien-save': (d, el) => saveBien(el),
  'bien-del': d => delBien(d.id, d.bid),
  'photo-remove': () => { tmpPhotoUrl = null; $('b-photo-preview').hidden = true; $('b-photo-preview').removeAttribute('src'); $('photo-empty').hidden = false; $('photo-remove').hidden = true; },
  'ai-eval': (d, el) => runAIEval(el),
  'wish-toggle': d => togWish(d.bid),
  'wish-move': d => moveWish(parseInt(d.i, 10), parseInt(d.dir, 10)),
  'wish-validate': (d, el) => validateWish(el),
  'do-partage': (d, el) => doPartage(d.id, el),
  'partage-cancel': d => cancelPartage(d.id),
  'print': () => window.print(),
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = Actions[el.dataset.action]; if (!fn) return;
  e.preventDefault();
  Promise.resolve(fn(el.dataset, el)).catch(err => { console.error(err); toast("Une erreur est survenue : " + (err.message || err), 'error'); });
});
document.addEventListener('change', e => { if (e.target.dataset && e.target.dataset.change === 'photo') handlePhotoUpload(e.target); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && Modal.isOpen()) Modal.close();
  // « Entrée » dans un champ de fenêtre = bouton principal
  if (e.key === 'Enter' && Modal.isOpen() && e.target.matches('#modal-content input:not([type=file])')) {
    const b = $('modal-content').querySelector('.btn-primary:not([disabled])'); if (b) { e.preventDefault(); b.click(); }
  }
});
$('modal-overlay').addEventListener('click', e => { if (e.target.id === 'modal-overlay') Modal.close(); });
window.addEventListener('unhandledrejection', e => console.error('Promesse rejetée :', e.reason));

/* ── INIT ────────────────────────────────────────────────────── */
Router.add("/", renderWelcome);
Router.add("/jap/new", renderNewJap);
Router.add("/jap/:id", renderDashboard);
Router.add("/jap/:id/inv", renderInventaire);
Router.add("/jap/:id/wish", renderSouhaits);
Router.add("/jap/:id/partage", renderPartage);
Router.init();
