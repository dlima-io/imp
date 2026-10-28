// Reglas puras del juego (sin interfaz ni red).
import { CATEGORIES, CUSTOM_CAT } from './words.js';

export const COLORS = ['#e8710a', '#9334e6', '#188038', '#d93025', '#1967d2', '#e52592', '#12a4b8', '#c58a00',
  '#5f6368', '#6a9a1f', '#795548', '#3949ab', '#00897b', '#ad1457', '#ef6c00', '#0277bd'];

export const DEFAULT_SETTINGS = {
  cats: { oficina: true, jerga: true, comida: true, tecno: true, vida: true, casa: true },
  clueRounds: 1, clueSec: 40, discussSec: 90, voteSec: 45,
  roles: true, events: true, impKnow: true, impCat: true,
};

export const ROLE_NAMES = {
  impostor: 'Impostor', ciudadano: 'Equipo', pasante: 'Pasante (equipo)',
  rrhh: 'RRHH (equipo)', gerente: 'Gerente (equipo)', chusma: 'Chusma (equipo)',
};

export const ROLE_DESC = {
  impostor: 'Sos el IMPOSTOR. No sabés el concepto: improvisá pistas creíbles y que no te descubran. Si te echan, todavía podés ganar adivinando el concepto.',
  ciudadano: 'Sos del EQUIPO. Dá pistas sobre el concepto sin regalárselo al impostor, y entre todos échenlo.',
  pasante: 'Sos el PASANTE: del equipo, pero no te pasaron el concepto, solo la categoría. Disimulá para que no te echen por error.',
  rrhh: 'Sos RRHH (equipo). Una vez por partida, durante el debate, podés auditar a alguien y saber si es impostor.',
  gerente: 'Sos el GERENTE (equipo) y todos lo saben. Tu voto vale doble.',
  chusma: 'Sos el CHUSMA (equipo). Una vez por partida, durante el debate, podés leer los hilos privados de alguien.',
};

export const EVENTS = {
  vpn: 'Se cayó la VPN: los primeros 30 segundos del debate solo andan los hilos privados.',
  mail: 'Reunión que pudo ser un mail: esta ronda hay una vuelta extra de pistas.',
  after: 'Viernes de after: esta ronda se vota a cara descubierta.',
  auditoria: 'Auditoría sorpresa: esta ronda no se pueden usar los hilos privados.',
};

export const PHASES = {
  lobby: 'Borrador', reveal: 'Asignación', clues: 'Carga de ítems', discuss: 'Revisión',
  vote: 'Aprobación', result: 'Resultados', guess: 'Apelación', end: 'Cierre',
};

export const rid = (n = 8) => {
  const a = 'abcdefghijkmnopqrstuvwxyz23456789'; let s = '';
  for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
};
export const roomCode = () => {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; let s = '';
  for (let i = 0; i < 4; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
};
export const norm = s => (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
export const slug = s => norm(s).replace(/ /g, '_').slice(0, 40);
export const shuffle = arr => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
export const rk = r => 'r' + r;

export function impostorCount(n) { return n <= 6 ? 1 : n <= 10 ? 2 : 3; }

export function assignRoles(ids, settings) {
  const n = ids.length, k = impostorCount(n);
  const sh = shuffle(ids), roles = {};
  sh.forEach((p, i) => { roles[p] = i < k ? 'impostor' : 'ciudadano'; });
  if (settings.roles) {
    const specials = [['pasante', 4], ['rrhh', 5], ['gerente', 6], ['chusma', 7]]
      .filter(([, min]) => n >= min && Math.random() < 0.7).map(([r]) => r);
    shuffle(sh.slice(k)).forEach((p, i) => { if (i < specials.length) roles[p] = specials[i]; });
  }
  return roles;
}

export function categoryList(words) {
  const cats = CATEGORIES.map(c => ({ id: c.id, name: c.name, count: c.words.length }));
  const custom = {};
  for (const w of Object.values(words || {})) {
    const id = w.catId || CUSTOM_CAT.id;
    custom[id] = custom[id] || { id, name: w.cat || CUSTOM_CAT.name, count: 0 };
    custom[id].count++;
  }
  return cats.concat(Object.values(custom));
}

export function buildPool(settings, words) {
  const on = id => (settings.cats || {})[id] !== false;
  const pool = [];
  for (const c of CATEGORIES) if (on(c.id)) for (const w of c.words) pool.push({ w, cat: c.name });
  for (const w of Object.values(words || {})) {
    const id = w.catId || CUSTOM_CAT.id;
    if (on(id) && w.text) pool.push({ w: w.text, cat: w.cat || CUSTOM_CAT.name });
  }
  return pool;
}

export function rollEvent(settings, prev) {
  if (!settings.events || Math.random() > 0.4) return null;
  const opts = Object.keys(EVENTS).filter(e => e !== prev);
  return opts[Math.floor(Math.random() * opts.length)];
}

// Orden de turnos de pistas: vivos, rotando quién arranca cada ronda
export function turnList(g) {
  const alive = (g.order || []).filter(p => g.alive && g.alive[p]);
  if (!alive.length) return [];
  const s = (g.round - 1) % alive.length;
  return alive.slice(s).concat(alive.slice(0, s));
}

export function tally(g) {
  const votes = (g.votes || {})[rk(g.round)] || {};
  const counts = {};
  for (const v of (g.order || []).filter(p => g.alive[p])) {
    const t = votes[v] || 'skip';
    const w = g.roles[v] === 'gerente' ? 2 : 1;
    counts[t] = (counts[t] || 0) + w;
  }
  let max = 0, top = [];
  for (const [t, c] of Object.entries(counts)) {
    if (c > max) { max = c; top = [t]; } else if (c === max) top.push(t);
  }
  const tie = top.length > 1;
  const ejected = !tie && top[0] && top[0] !== 'skip' ? top[0] : null;
  return { counts, ejected, tie, wasImp: ejected ? g.roles[ejected] === 'impostor' : false };
}

export function winCheck(g) {
  const alive = (g.order || []).filter(p => g.alive[p]);
  const imp = alive.filter(p => g.roles[p] === 'impostor').length;
  const eq = alive.length - imp;
  if (imp === 0) return { winner: 'eq', reason: 'caught' };
  if (imp >= eq) return { winner: 'imp', reason: 'numbers' };
  return null;
}

export function clueHasWord(clue, word) {
  const c = norm(clue).replace(/ /g, ''), w = norm(word).replace(/ /g, '');
  if (!c || !w) return false;
  if (c.includes(w)) return true;
  // también cada palabra significativa del concepto ("Sala de reuniones" → "reuniones")
  return norm(word).split(' ').filter(x => x.length >= 4).some(x => c.includes(x));
}

export function guessOk(guess, word) {
  const strip = s => norm(s).replace(/\b(el|la|los|las|un|una|de|del)\b/g, '').replace(/ /g, '');
  return !!strip(guess) && strip(guess) === strip(word);
}
