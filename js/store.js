// Capa de datos: misma interfaz para Firebase y para el modo local.
import { FIREBASE_CONFIG } from './config.js';

const ROOT = 'impostor';
const FB_VER = '10.12.2';

export async function createStore() {
  if (FIREBASE_CONFIG && FIREBASE_CONFIG.databaseURL) {
    try { return await firebaseStore(); }
    catch (e) { console.error('No se pudo conectar a Firebase, uso modo local', e); }
  }
  return localStore();
}

async function firebaseStore() {
  const appMod = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-app.js`);
  const db = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-database.js`);
  const app = appMod.initializeApp(FIREBASE_CONFIG);
  const d = db.getDatabase(app);
  let offset = 0;
  db.onValue(db.ref(d, '.info/serverTimeOffset'), s => { offset = s.val() || 0; });
  const r = p => db.ref(d, p ? `${ROOT}/${p}` : ROOT);
  return {
    mode: 'firebase',
    now: () => Date.now() + offset,
    get: async p => (await db.get(r(p))).val(),
    set: (p, v) => db.set(r(p), v),
    update: (p, o) => db.update(r(p), o),
    push: (p, v) => db.push(r(p), v).key,
    remove: p => db.remove(r(p)),
    on: (p, cb) => db.onValue(r(p), s => cb(s.val())),
  };
}

// ── Modo local: localStorage + BroadcastChannel (solo pestañas del mismo navegador)
function localStore() {
  const KEY = 'impostor_local_db_v1';
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('impostor_local') : null;
  const parts = p => p.split('/').filter(Boolean);
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const getAt = (o, p) => {
    for (const k of parts(p)) { if (o == null || typeof o !== 'object') return null; o = o[k]; }
    return o === undefined ? null : o;
  };
  const setAt = (o, p, v) => {
    const ks = parts(p);
    for (let i = 0; i < ks.length - 1; i++) {
      if (typeof o[ks[i]] !== 'object' || o[ks[i]] === null) o[ks[i]] = {};
      o = o[ks[i]];
    }
    const last = ks[ks.length - 1];
    if (v === null || v === undefined) delete o[last];
    else o[last] = JSON.parse(JSON.stringify(v));
  };
  // Igual que Firebase: los objetos vacíos desaparecen
  const prune = o => {
    if (o && typeof o === 'object') {
      for (const k of Object.keys(o)) {
        o[k] = prune(o[k]);
        if (o[k] === null || o[k] === undefined) delete o[k];
      }
      if (Object.keys(o).length === 0) return null;
    }
    return o;
  };
  const listeners = new Set();
  const notify = () => {
    const db = read();
    for (const l of listeners) {
      const v = getAt(db, `${ROOT}/${l.path}`);
      const s = JSON.stringify(v);
      if (s !== l.last) { l.last = s; l.cb(v === null ? null : JSON.parse(s)); }
    }
  };
  if (bc) bc.onmessage = notify;
  window.addEventListener('storage', e => { if (e.key === KEY) notify(); });
  const mutate = fn => {
    const db = read(); fn(db);
    localStorage.setItem(KEY, JSON.stringify(prune(db) || {}));
    setTimeout(notify, 0);
    if (bc) bc.postMessage(1);
    return Promise.resolve();
  };
  const full = p => `${ROOT}/${p}`;
  let seq = 0;
  const pushKey = () => Date.now().toString(36).padStart(9, '0') + (seq++ % 1296).toString(36).padStart(2, '0') + Math.random().toString(36).slice(2, 7);
  return {
    mode: 'local',
    now: () => Date.now(),
    get: async p => getAt(read(), full(p)),
    set: (p, v) => mutate(db => setAt(db, full(p), v)),
    update: (p, o) => mutate(db => { for (const [k, v] of Object.entries(o)) setAt(db, `${full(p)}/${k}`, v); }),
    push: (p, v) => { const k = pushKey(); mutate(db => setAt(db, `${full(p)}/${k}`, v)); return k; },
    remove: p => mutate(db => setAt(db, full(p), null)),
    on: (p, cb) => {
      const l = { path: p, cb, last: undefined };
      listeners.add(l); setTimeout(notify, 0);
      return () => listeners.delete(l);
    },
  };
}
