import { createStore } from './store.js';
import { CUSTOM_CAT } from './words.js';
import * as L from './logic.js';

// ═════════════════════════ constantes y estado ═════════════════════════
const NCOLS = 26, NROWS = 60;
const COLW = [150, 125, 120, 120, 120, 120, 120, 120, 110, 110, 110, 110, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100];
const FRESH_MS = 15000;     // sin latido por más de esto = desconectado
const DROP_MS = 60000;      // en partida: se lo saca de juego
const LOBBY_PRUNE_MS = 45000;
const GRAY = '#80868b';

const S = {
  store: null, pid: null, room: null, name: '',
  state: null, players: {}, chat: {}, dms: {}, ranking: {}, words: {},
  roomUnsubs: [], sheet: 'main', panic: false, side: true, thread: 'general', lastRead: {},
  sel: 'A1', model: {}, form: {}, formInit: {}, prevGame: null, prevPhase: null,
  hostActed: { step: -1, t: 0 }, hb: null, hostTimer: null,
};

const $ = s => document.querySelector(s);
const now = () => S.store.now();
const colL = i => String.fromCharCode(65 + i);
const parseRef = ref => ({ c: ref.charCodeAt(0) - 65, r: parseInt(ref.slice(1), 10) });
const fresh = pid => { const p = S.players[pid]; return !!p && now() - (p.seen || 0) < FRESH_MS; };
const rp = (p = '') => `rooms/${S.room}${p ? '/' + p : ''}`;
const gp = p => rp(`state/game/${p}`);
const game = () => S.state && S.state.game;
const active = g => g && g.phase !== 'lobby' && g.phase !== 'end';
const settings = () => Object.assign({}, L.DEFAULT_SETTINGS, (S.state && S.state.settings) || {});
const nameOf = pid => (S.players[pid] && S.players[pid].name) || (game() && game().names && game().names[pid]) || '¿?';
const colorOf = pid => (S.players[pid] && S.players[pid].color) || (game() && game().colors && game().colors[pid]) || '#888';
const docTitle = () => $('#docTitle').value || 'Planilla sin título';
const mmss = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const initials = n => (n || '?').trim().split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase();
const hhmm = ts => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

// ═════════════════════════ grilla ═════════════════════════
const cellEls = {};
function buildGrid() {
  const g = $('#grid');
  g.style.gridTemplateColumns = `46px ${COLW.map(w => w + 'px').join(' ')}`;
  g.style.gridTemplateRows = `22px 30px repeat(${NROWS - 1}, 21px)`;
  const frag = document.createDocumentFragment();
  const corner = document.createElement('div'); corner.className = 'corner'; frag.appendChild(corner);
  for (let c = 0; c < NCOLS; c++) { const h = document.createElement('div'); h.className = 'hc'; h.dataset.c = c; h.textContent = colL(c); frag.appendChild(h); }
  for (let r = 1; r <= NROWS; r++) {
    const h = document.createElement('div'); h.className = 'hr'; h.dataset.r = r; h.textContent = r; frag.appendChild(h);
    for (let c = 0; c < NCOLS; c++) {
      const el = document.createElement('div'); const ref = colL(c) + r;
      el.className = 'cell'; el.dataset.ref = ref; el._k = '';
      cellEls[ref] = el; frag.appendChild(el);
    }
  }
  g.appendChild(frag);
  g.addEventListener('mousedown', e => {
    const cell = e.target.closest('.cell'); if (!cell) return;
    if (e.target.closest('input,select,button')) { select(cell.dataset.ref, false); return; }
    select(cell.dataset.ref, true);
  });
}

function paint(model) {
  // desborde de texto hacia celdas vacías, como en cualquier planilla
  for (const [ref, m] of Object.entries(model)) {
    if (!m || (m.k && m.k !== 't') || !m.v) continue;
    const { c, r } = parseRef(ref);
    const next = colL(c + 1) + r;
    if (c + 1 < NCOLS && !model[next]) m.ov = 1;
  }
  S.model = model;
  for (const ref in cellEls) {
    const el = cellEls[ref], m = model[ref] || null;
    const key = m ? JSON.stringify(m) : '';
    if (el._k === key) continue;
    el._k = key; renderCell(el, m);
  }
  applySel();
}

function styleText(s, m) {
  if (m.b) s.style.fontWeight = '700';
  if (m.i) s.style.fontStyle = 'italic';
  if (m.c) s.style.color = m.c;
  if (m.sz) s.style.fontSize = m.sz + 'px';
  if (m.al) s.style.textAlign = m.al;
  if (m.u) s.style.textDecoration = 'line-through';
}

function renderCell(el, m) {
  el.className = 'cell'; el.removeAttribute('style'); el.innerHTML = '';
  if (!m) return;
  if (m.cls) m.cls.split(' ').forEach(x => x && el.classList.add(x));
  if (m.bg) el.style.background = m.bg;
  const k = m.k || 't';
  if (k === 't') {
    const s = document.createElement('div'); s.className = 'cv' + (m.ov ? ' ov' : '');
    s.textContent = m.v == null ? '' : String(m.v); styleText(s, m);
    if (m.ov) { el.classList.add('hasov'); if (m.bg) s.style.background = m.bg; }
    el.appendChild(s);
  } else if (k === 'secret') {
    el.classList.add('secret');
    const s = document.createElement('div'); s.className = 'cv';
    s.innerHTML = '<span class="mask">••••••••••</span><span class="real"></span>';
    s.querySelector('.real').textContent = m.v; styleText(s, m); el.appendChild(s);
  } else if (k === 'in') {
    const i = document.createElement('input'); i.className = 'cin';
    i.placeholder = m.ph || ''; i.maxLength = m.max || 40; i.spellcheck = false;
    if (m.val) i.value = m.val;
    i.addEventListener('input', () => { S.form[m.act] = i.value; });
    i.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); act(m.act, i.value, m); if (m.clear) i.value = ''; }
      if (e.key !== 'Escape') e.stopPropagation();
    });
    el.appendChild(i);
    if (m.focus) setTimeout(() => {
      const a = document.activeElement;
      if (!a || a === document.body || a.classList.contains('cell')) i.focus();
    }, 30);
  } else if (k === 'sel') {
    const s = document.createElement('select');
    for (const [v, l] of m.opts) { const o = document.createElement('option'); o.value = v; o.textContent = l; s.appendChild(o); }
    s.value = m.val == null ? '' : String(m.val);
    s.addEventListener('change', () => act(m.act, s.value, m));
    el.appendChild(s);
  } else if (k === 'chk') {
    const i = document.createElement('input'); i.type = 'checkbox'; i.className = 'cchk';
    i.checked = !!m.val; i.disabled = !!m.dis;
    i.addEventListener('change', () => act(m.act, i.checked, m));
    el.appendChild(i);
  } else if (k === 'btn') {
    const b = document.createElement('button'); b.className = 'cbtn' + (m.pri ? ' pri' : '');
    b.textContent = m.v; b.disabled = !!m.dis;
    b.addEventListener('click', () => act(m.act, m.arg, m));
    el.appendChild(b);
  }
  if (m.outline) {
    el.classList.add('cursor'); el.style.setProperty('--cc', m.outline);
    if (m.tag) { const t = document.createElement('div'); t.className = 'ctag'; t.textContent = m.tag; el.appendChild(t); }
  }
}

function select(ref, focusInput) {
  S.sel = ref; applySel();
  const el = cellEls[ref];
  if (focusInput && el) { const i = el.querySelector('input.cin'); if (i) setTimeout(() => i.focus(), 0); }
}
function applySel() {
  document.querySelectorAll('.cell.sel').forEach(e => e.classList.remove('sel'));
  document.querySelectorAll('.hc.on,.hr.on').forEach(e => e.classList.remove('on'));
  const el = cellEls[S.sel]; if (el) el.classList.add('sel');
  const { c, r } = parseRef(S.sel);
  const hc = document.querySelector(`.hc[data-c="${c}"]`), hr = document.querySelector(`.hr[data-r="${r}"]`);
  if (hc) hc.classList.add('on'); if (hr) hr.classList.add('on');
  $('#namebox').textContent = S.sel;
  const m = S.model[S.sel];
  let v = '';
  if (m) v = m.f || ((!m.k || m.k === 't') ? (m.v == null ? '' : String(m.v)) : m.k === 'btn' ? '' : m.k === 'sel' ? ((m.opts.find(o => String(o[0]) === String(m.val)) || [])[1] || '') : '');
  $('#fval').textContent = v;
}

// ═════════════════════════ hojas (modelos) ═════════════════════════
function loginModel() {
  const m = {};
  m.A1 = { v: 'Planilla de acceso', b: 1, sz: 15 };
  m.A3 = { v: 'Tu nombre', b: 1 };
  const fi = S.formInit;
  m.B3 = { k: 'in', act: 'f_name', ph: 'Escribí tu nombre', val: fi.f_name || '', max: 20, focus: !fi.f_name };
  m.A4 = { v: 'Código de sala', b: 1 };
  m.B4 = { k: 'in', act: 'f_code', ph: 'Ej: KQXM', val: fi.f_code || '', max: 4, focus: !!fi.f_name && !fi.f_code };
  m.A6 = { k: 'btn', v: 'Unirse a la sala', act: 'join', pri: 1 };
  m.B6 = { k: 'btn', v: 'Crear sala nueva', act: 'create' };
  m.A8 = { v: 'Creá una sala y pasales el enlace a tus compañeros con el botón "Compartir". Mínimo 3 personas.', i: 1, c: GRAY };
  m.A9 = { v: 'Si te pasaron un enlace, el código ya está cargado: poné tu nombre y tocá "Unirse a la sala".', i: 1, c: GRAY };
  m.A10 = { v: 'Tecla Esc en cualquier momento: oculta todo y muestra una planilla de presupuesto.', i: 1, c: GRAY };
  if (S.store.mode === 'local') m.A12 = { v: 'Modo local: sin servidor configurado, solo funciona entre pestañas de este navegador (ver README).', i: 1, c: '#b06000' };
  return m;
}

function hostId() {
  const h = S.state && S.state.hostId;
  if (h && fresh(h)) return h;
  const f = Object.entries(S.players).filter(([id]) => fresh(id)).sort((a, b) => a[1].joinedAt - b[1].joinedAt);
  return f.length ? f[0][0] : h;
}

function lobbyModel() {
  const m = {}, set = settings(), amHost = hostId() === S.pid;
  m.A1 = { v: docTitle(), b: 1, sz: 15 };
  m.A2 = { v: 'Estado:', c: GRAY }; m.B2 = { v: L.PHASES.lobby, b: 1 };
  m.C2 = { v: 'Sala:', c: GRAY, al: 'right' }; m.D2 = { v: S.room, b: 1 };
  ['Responsable', 'Estado', 'Desde'].forEach((h, i) => { m[colL(i) + 4] = { v: h, cls: 'hd' }; });
  const list = Object.entries(S.players).sort((a, b) => a[1].joinedAt - b[1].joinedAt);
  const hid = hostId();
  list.forEach(([id, p], i) => {
    const r = 5 + i, me = id === S.pid;
    m['A' + r] = { v: p.name + (me ? ' (vos)' : ''), c: p.color, b: 1, cls: me ? 'me' : '' };
    m['B' + r] = { v: !fresh(id) ? 'Ausente' : id === hid ? 'Organiza' : 'Conectado', c: fresh(id) ? '' : GRAY, cls: me ? 'me' : '' };
    m['C' + r] = { v: hhmm(p.joinedAt), c: GRAY, cls: me ? 'me' : '' };
  });
  let r = 5 + list.length + 1;
  m['A' + r] = { v: 'Configuración', b: 1, sz: 14 }; r++;

  const cats = L.categoryList(S.words);
  cats.forEach((c, i) => {
    if (i === 0) m['A' + r] = { v: 'Categorías' };
    const on = (set.cats || {})[c.id] !== false;
    m['B' + r] = amHost ? { k: 'chk', val: on, act: 'cat', arg: c.id } : { v: on ? '✓' : '—', al: 'center' };
    m['C' + r] = { v: `${c.name} (${c.count})`, c: on ? '' : GRAY };
    r++;
  });
  const sel = (label, key, opts, desc) => {
    m['A' + r] = { v: label };
    m['B' + r] = amHost ? { k: 'sel', act: 'set', arg: key, val: set[key], opts: opts.map(o => [o, String(o)]) } : { v: String(set[key]), al: 'right' };
    if (desc) m['C' + r] = { v: desc, c: GRAY, i: 1 };
    r++;
  };
  const chk = (label, key, desc) => {
    m['A' + r] = { v: label };
    m['B' + r] = amHost ? { k: 'chk', act: 'set', arg: key, val: !!set[key] } : { v: set[key] ? '✓' : '—', al: 'center' };
    if (desc) m['C' + r] = { v: desc, c: GRAY, i: 1 };
    r++;
  };
  sel('Vueltas de pistas', 'clueRounds', [1, 2, 3], 'Cuántas pistas da cada uno antes de debatir');
  sel('Segundos por pista', 'clueSec', [20, 30, 40, 60, 90]);
  sel('Segundos de debate', 'discussSec', [45, 60, 90, 120, 180, 300]);
  sel('Segundos de votación', 'voteSec', [30, 45, 60, 90]);
  chk('Roles especiales', 'roles', 'Pasante (4+), RRHH (5+), Gerente (6+), Chusma (7+); cada uno puede o no aparecer');
  chk('Eventos sorpresa', 'events', 'VPN caída, reunión que pudo ser un mail, viernes de after, auditoría');
  chk('Impostores se conocen', 'impKnow', 'Con 2 o más impostores: se ven entre sí y tienen hilo propio');
  chk('Impostor ve la categoría', 'impCat', 'Le da una pista sobre de qué va el concepto');
  m['A' + r] = { v: 'Impostores:', c: GRAY }; m['B' + r] = { v: '1 hasta 6 personas · 2 de 7 a 10 · 3 desde 11', c: GRAY, i: 1 }; r += 2;

  const n = Object.keys(S.players).filter(fresh).length;
  if (amHost) {
    m['A' + r] = { k: 'btn', v: '▶ Iniciar partida', act: 'start', pri: 1, dis: n < 3 };
    m['B' + r] = { v: n < 3 ? `Faltan ${3 - n} para poder arrancar (mínimo 3).` : `${n} personas listas.`, c: GRAY, i: 1 };
  } else {
    m['A' + r] = { v: `Esperando a que ${nameOf(hid)} inicie la partida…`, c: GRAY, i: 1 };
  }
  r += 2;
  m['A' + r] = { v: 'Para sumar gente: botón "Compartir" (arriba a la derecha) y pasales el enlace.', c: GRAY, i: 1 };
  return m;
}

function conceptFor(g, me) {
  const role = g.roles[me], set = settings();
  if (g.phase === 'end' || !role || !g.alive[me]) return { v: g.word, f: g.word };
  if (role === 'impostor') return { v: '#N/A' + (set.impCat ? `   (categoría: ${g.category})` : '') };
  if (role === 'pasante') return { v: `¿?   (categoría: ${g.category})` };
  return { v: g.word };
}

function clueKeys(g) {
  const keys = [];
  for (let r = 1; r <= g.round; r++) {
    const n = (g.clueRoundsBy || {})[L.rk(r)] || 1;
    for (let c = 1; c <= n; c++) keys.push({ key: `${r}_${c}`, label: n > 1 ? `Ítem R${r}.${c}` : `Ítem R${r}` });
  }
  return keys.slice(-8);
}

function gameModel(g) {
  const m = {}, me = S.pid, set = settings();
  const role = g.roles[me], inGame = !!role, alive = !!(g.alive || {})[me];
  const t = now(), left = g.deadline ? Math.max(0, Math.ceil((g.deadline - t) / 1000)) : null;
  const turns = L.turnList(g), curKey = `${g.round}_${g.clueRound}`, cur = g.phase === 'clues' ? turns[g.turn] : null;
  const res = (g.results || {})[L.rk(g.round)];

  m.A1 = { v: docTitle(), b: 1, sz: 15 };
  m.A2 = { v: 'Estado:', c: GRAY }; m.B2 = { v: L.PHASES[g.phase] || g.phase, b: 1 };
  m.C2 = { v: 'Vence:', c: GRAY, al: 'right' };
  m.D2 = { v: g.phase === 'end' || left == null ? '—' : mmss(left), b: 1, c: left != null && left <= 10 && g.phase !== 'end' ? '#c0392b' : '' };
  m.E2 = { v: 'Ronda:', c: GRAY, al: 'right' }; m.F2 = { v: g.round, al: 'left' };
  m.G2 = { v: 'Impostores:', c: GRAY, al: 'right' }; m.H2 = { v: g.nImp, al: 'left' };

  m.A3 = { v: 'Concepto:', c: GRAY };
  m.B3 = Object.assign({ k: 'secret' }, conceptFor(g, me));
  m.C3 = { v: 'Rol:', c: GRAY, al: 'right' };
  m.D3 = { k: 'secret', v: inGame ? (L.ROLE_NAMES[role] + (alive || g.phase === 'end' ? '' : ' · fuera')) : 'Espectador' };

  // nota según fase
  let note = '';
  if (!inGame) note = 'Entraste con la partida empezada: mirás esta y jugás la próxima.';
  else if (!alive && g.phase !== 'end') note = 'Quedaste fuera: podés mirar y charlar en el hilo "Fuera de juego".';
  else if (g.phase === 'reveal') note = '';
  else if (g.phase === 'clues') note = cur === me
    ? 'Te toca: escribí UNA palabra relacionada en tu celda resaltada y Enter. No puede contener el concepto.'
    : `Turno de ${nameOf(cur)}. Prestá atención a las pistas.`;
  else if (g.phase === 'discuss') note = 'Debatan en Comentarios quién es el impostor. Marcá "Listo para votar" cuando quieras.';
  else if (g.phase === 'vote') note = 'Elegí en la columna "Aprobación" a quién echar (o Abstención). Empate = no se va nadie.';
  else if (g.phase === 'result') note = resultText(g, res);
  else if (g.phase === 'guess') note = g.guess && g.guess.pid === me
    ? 'Te descubrieron. Última chance: adiviná el concepto abajo y ganás igual.'
    : `${nameOf(g.guess && g.guess.pid)} era impostor y está intentando adivinar el concepto…`;
  else if (g.phase === 'end') note = endText(g);
  m.A4 = { v: 'Nota:', c: GRAY };  // en "Asignación" la nota también va oculta
  if (g.phase === 'reveal' && inGame && alive) m.B4 = { k: 'secret', v: L.ROLE_DESC[role] };
  else m.B4 = { v: note, i: g.phase !== 'end', b: g.phase === 'end', c: g.phase === 'end' ? (g.winner === 'imp' ? '#c0392b' : '#188038') : '#3c4043' };
  if (g.event && g.phase !== 'end') { m.A5 = { v: 'Evento:', c: GRAY, bg: '#fff4d6' }; m.B5 = { v: L.EVENTS[g.event], bg: '#fff4d6' }; }

  // tabla
  const keys = clueKeys(g);
  const H = 7, voteCol = 2 + keys.length, cntCol = voteCol + 1;
  m['A' + H] = { v: 'Responsable', cls: 'hd' }; m['B' + H] = { v: 'Estado', cls: 'hd' };
  keys.forEach((k, i) => { m[colL(2 + i) + H] = { v: k.label, cls: 'hd' }; });
  m[colL(voteCol) + H] = { v: 'Aprobación', cls: 'hd' }; m[colL(cntCol) + H] = { v: 'Votos', cls: 'hd' };
  const myVotes = ((g.votes || {})[L.rk(g.round)]) || {};
  const aliveOthers = g.order.filter(p => g.alive[p] && p !== me);
  g.order.forEach((p, i) => {
    const r = H + 1 + i, isMe = p === me, pa = !!g.alive[p], cls = isMe ? 'me' : '';
    m['A' + r] = { v: nameOf(p) + (isMe ? ' (vos)' : ''), c: colorOf(p), b: 1, u: !pa, cls };
    let st = '';
    if (g.phase === 'end') st = L.ROLE_NAMES[g.roles[p]];
    else if (!pa) st = 'Fuera';
    else if (g.roles[p] === 'gerente') st = 'Gerente';
    else if (!fresh(p)) st = 'Desconectado';
    else st = 'Activo';
    m['B' + r] = { v: st, cls, c: g.phase === 'end' && g.roles[p] === 'impostor' ? '#c0392b' : (pa ? '' : GRAY), b: g.phase === 'end' && g.roles[p] === 'impostor' };
    keys.forEach((k, j) => {
      const ref = colL(2 + j) + r;
      const val = ((g.clues || {})[k.key] || {})[p];
      if (cur === p && k.key === curKey) {
        m[ref] = isMe
          ? { k: 'in', act: 'clue', ph: 'Tu pista + Enter', max: 30, focus: 1, outline: colorOf(p), tag: nameOf(p) }
          : { v: '', outline: colorOf(p), tag: nameOf(p), cls };
      } else m[ref] = val ? { v: val, cls, c: val === '—' ? GRAY : '' } : (cls ? { v: '', cls } : undefined);
      if (!m[ref]) delete m[ref];
    });
    // votos
    const vref = colL(voteCol) + r, vt = myVotes[p];
    if (g.phase === 'vote') {
      if (isMe && pa) m[vref] = { k: 'sel', act: 'vote', val: vt || '', opts: [['', '— elegir —']].concat(aliveOthers.map(o => [o, nameOf(o)]), [['skip', 'Abstención']]) };
      else if (vt) m[vref] = { v: g.event === 'after' ? (vt === 'skip' ? 'Abstención' : nameOf(vt)) : '✓ enviado', c: g.event === 'after' ? '' : GRAY, cls };
      else if (cls) m[vref] = { v: '', cls };
    } else if (res && vt && ['result', 'guess', 'end'].includes(g.phase)) {
      m[vref] = { v: vt === 'skip' ? 'Abstención' : nameOf(vt), cls };
    } else if (cls) m[vref] = { v: '', cls };
    if (res && ['result', 'guess', 'end'].includes(g.phase) && res.counts && res.counts[p]) {
      m[colL(cntCol) + r] = { v: res.counts[p], al: 'right', b: res.ejected === p, c: res.ejected === p ? '#c0392b' : '', cls };
    } else if (cls) m[colL(cntCol) + r] = { v: '', cls };
  });

  // filas de acción
  let r = H + g.order.length + 2;
  const row = (a, b) => { if (a) m['A' + r] = a; if (b) m['B' + r] = b; r++; };
  if (role === 'impostor' && set.impKnow && g.nImp > 1) {
    const mates = g.order.filter(p => p !== me && g.roles[p] === 'impostor').map(nameOf).join(', ');
    row({ v: 'Tu equipo:', c: GRAY }, { k: 'secret', v: mates + '  (hilo "Finanzas" en Comentarios)' });
  }
  if (g.phase === 'discuss' && alive) {
    const ready = ((g.ready || {})[L.rk(g.round)]) || {};
    const nAlive = g.order.filter(p => g.alive[p]).length, nReady = g.order.filter(p => g.alive[p] && ready[p]).length;
    m['A' + r] = { v: 'Listo para votar' }; m['B' + r] = { k: 'chk', act: 'ready', val: !!ready[me] };
    m['C' + r] = { v: `${nReady}/${nAlive} listos`, c: GRAY }; r++;
  }
  const pw = g.powers || {};
  if (role === 'rrhh' && (alive || pw.rrhh)) {
    if (pw.rrhh) row({ v: 'Legajo auditado:', c: GRAY }, { k: 'secret', v: `${nameOf(pw.rrhh.target)}: ${pw.rrhh.isImp ? 'ES IMPOSTOR' : 'no es impostor'}` });
    else if (g.phase === 'discuss') row({ v: 'Auditar legajo de:' }, { k: 'sel', act: 'rrhh', val: '', opts: [['', '— elegir (1 vez) —']].concat(aliveOthers.map(o => [o, nameOf(o)])) });
    else row({ v: 'Auditar legajo:', c: GRAY }, { v: 'disponible durante el debate', c: GRAY, i: 1 });
  }
  if (role === 'chusma' && (alive || pw.chusma)) {
    if (pw.chusma) row({ v: 'Chusmerío:', c: GRAY }, { v: pw.chusma.round === g.round && active(g) ? `espiando a ${nameOf(pw.chusma.target)} (hilos con 👀 en Comentarios)` : `ya espiaste a ${nameOf(pw.chusma.target)}`, c: GRAY, i: 1 });
    else if (g.phase === 'discuss') row({ v: 'Espiar hilos de:' }, { k: 'sel', act: 'chusma', val: '', opts: [['', '— elegir (1 vez) —']].concat(aliveOthers.map(o => [o, nameOf(o)])) });
    else row({ v: 'Chusmerío:', c: GRAY }, { v: 'disponible durante el debate', c: GRAY, i: 1 });
  }
  if (g.phase === 'guess' && g.guess && g.guess.pid === me) {
    row({ v: 'Tu apuesta:', b: 1, c: '#c0392b' }, { k: 'in', act: 'guess', ph: 'El concepto es… + Enter', max: 40, focus: 1, outline: '#c0392b' });
  }
  if (g.guess && g.guess.text && ['guess', 'end'].includes(g.phase)) {
    row({ v: 'Apuesta:', c: GRAY }, { v: `${nameOf(g.guess.pid)} dijo "${g.guess.text}"`, i: 1 });
  }
  if (g.phase === 'end') {
    r++;
    if (hostId() === me) {
      m['A' + r] = { k: 'btn', v: '↻ Revancha', act: 'start', pri: 1 };
      m['B' + r] = { k: 'btn', v: 'Volver a la sala', act: 'lobby' };
    } else m['A' + r] = { v: `Esperando a que ${nameOf(hostId())} arranque otra…`, c: GRAY, i: 1 };
  }
  return m;
}

function resultText(g, res) {
  if (!res) return '';
  if (res.ejected) return `Se fue ${nameOf(res.ejected)}. ${res.wasImp ? 'ERA impostor.' : 'NO era impostor.'}`;
  return res.tie ? 'Empate: no se va nadie.' : 'Ganó la abstención: no se va nadie.';
}
function endText(g) {
  const imps = g.order.filter(p => g.roles[p] === 'impostor').map(nameOf).join(', ');
  if (g.winner === 'eq') return `Ganó el equipo: cayeron todos los impostores (${imps}). El concepto era "${g.word}".`;
  if (g.reason === 'guess') return `Ganaron los impostores (${imps}): adivinaron el concepto "${g.word}".`;
  return `Ganaron los impostores (${imps}): ya son tantos como el equipo. El concepto era "${g.word}".`;
}

function kpiModel() {
  const m = {};
  m.A1 = { v: 'KPIs del trimestre', b: 1, sz: 15 };
  m.A2 = { v: 'Ranking acumulado de todas las salas', c: GRAY, i: 1 };
  ['Responsable', 'Partidas', 'Victorias', '% Victorias', 'Como impostor', 'Ganadas impostor', 'Impostores cazados'].forEach((h, i) => { m[colL(i) + 4] = { v: h, cls: 'hd', al: i ? 'right' : '' }; });
  const rows = Object.values(S.ranking || {}).filter(x => x && x.games).sort((a, b) => (b.wins - a.wins) || (b.wins / b.games - a.wins / a.games));
  rows.slice(0, NROWS - 6).forEach((x, i) => {
    const r = 5 + i;
    m['A' + r] = { v: x.name, b: i < 3 };
    m['B' + r] = { v: x.games, al: 'right' }; m['C' + r] = { v: x.wins, al: 'right' };
    m['D' + r] = { v: Math.round(100 * x.wins / x.games) + '%', al: 'right', f: `=C${r}/B${r}` };
    m['E' + r] = { v: x.impGames || 0, al: 'right' }; m['F' + r] = { v: x.impWins || 0, al: 'right' };
    m['G' + r] = { v: x.caught || 0, al: 'right' };
  });
  if (!rows.length) m.A5 = { v: 'Todavía no hay partidas terminadas.', c: GRAY, i: 1 };
  return m;
}

function glosModel() {
  const m = {};
  m.A1 = { v: 'Glosario – conceptos de la casa', b: 1, sz: 15 };
  m.A2 = { k: 'in', act: 'gw', ph: 'Nuevo concepto + Enter', max: 40, clear: 1 };
  m.B2 = { k: 'in', act: 'gc', ph: 'Categoría (opcional)', max: 30 };
  m.C2 = { k: 'btn', v: 'Agregar', act: 'gwbtn' };
  m.D2 = { v: 'Ej: nombres de salas, clientes, proyectos, frases típicas, lugares cercanos…', c: GRAY, i: 1 };
  ['Concepto', 'Categoría', 'Cargado por', ''].forEach((h, i) => { m[colL(i) + 4] = { v: h, cls: 'hd' }; });
  const list = Object.entries(S.words || {}).sort((a, b) => (a[1].cat || '').localeCompare(b[1].cat || '') || (a[1].text || '').localeCompare(b[1].text || ''));
  list.slice(0, NROWS - 6).forEach(([k, w], i) => {
    const r = 5 + i;
    m['A' + r] = { v: w.text }; m['B' + r] = { v: w.cat || CUSTOM_CAT.name, c: GRAY }; m['C' + r] = { v: w.by || '', c: GRAY };
    m['D' + r] = { k: 'btn', v: 'Quitar', act: 'delw', arg: k };
  });
  if (!list.length) m.A5 = { v: 'Vacío. Lo que carguen acá se puede activar como categoría al configurar la sala.', c: GRAY, i: 1 };
  return m;
}

// planilla falsa para el botón de pánico (Esc)
const PANIC = (() => {
  const areas = ['Administración', 'Comercial', 'Marketing', 'Operaciones', 'Sistemas', 'RR.HH.', 'Logística', 'Legales', 'Compras', 'Atención al cliente', 'Mantenimiento', 'Capacitación'];
  let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const fmt = n => '$ ' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const m = {};
  m.A1 = { v: 'Presupuesto Q4 – Revisión final', b: 1, sz: 15 };
  m.A2 = { v: 'Cifras en pesos. Fuente: cierre contable al 30/09.', c: GRAY, i: 1 };
  ['Área', 'Presupuesto', 'Ejecutado', 'Desvío', '% Ejec.', 'Oct', 'Nov', 'Dic', 'Observaciones'].forEach((h, i) => { m[colL(i) + 4] = { v: h, cls: 'hd', al: i && i < 8 ? 'right' : '' }; });
  let tb = 0, te = 0;
  areas.forEach((a, i) => {
    const r = 5 + i, b = 2e6 + rnd() * 9e6, e = b * (0.55 + rnd() * 0.5); tb += b; te += e;
    m['A' + r] = { v: a }; m['B' + r] = { v: fmt(b), al: 'right' }; m['C' + r] = { v: fmt(e), al: 'right' };
    m['D' + r] = { v: fmt(e - b), al: 'right', c: e > b ? '#c0392b' : '', f: `=C${r}-B${r}` };
    m['E' + r] = { v: (100 * e / b).toFixed(1).replace('.', ',') + '%', al: 'right', f: `=C${r}/B${r}` };
    ['F', 'G', 'H'].forEach(c => { m[c + r] = { v: fmt(e / 3 * (0.8 + rnd() * 0.4)), al: 'right' }; });
    if (e > b) m['I' + r] = { v: 'Revisar con el área', c: GRAY, i: 1 };
  });
  const r = 5 + areas.length;
  m['A' + r] = { v: 'Total', b: 1 }; m['B' + r] = { v: fmt(tb), b: 1, al: 'right', f: `=SUMA(B5:B${r - 1})` };
  m['C' + r] = { v: fmt(te), b: 1, al: 'right', f: `=SUMA(C5:C${r - 1})` };
  m['D' + r] = { v: fmt(te - tb), b: 1, al: 'right', f: `=C${r}-B${r}` };
  m['E' + r] = { v: (100 * te / tb).toFixed(1).replace('.', ',') + '%', b: 1, al: 'right' };
  return m;
})();

// ═════════════════════════ render general ═════════════════════════
let raf = 0;
function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }

function render() {
  let model;
  if (S.panic) model = JSON.parse(JSON.stringify(PANIC));
  else if (S.sheet === 'kpi') model = kpiModel();
  else if (S.sheet === 'glos') model = glosModel();
  else if (!S.room) model = loginModel();
  else if (!S.state) model = { A1: { v: 'Cargando…', c: GRAY } };
  else model = (!game() || game().phase === 'lobby') ? lobbyModel() : gameModel(game());
  for (const k of Object.keys(model)) if (!model[k]) delete model[k];
  paint(model);
  renderSide(); renderHeader(); renderTabs();
}

function renderHeader() {
  const av = $('#avatars');
  const ps = S.room && !S.panic ? Object.entries(S.players).filter(([id]) => fresh(id)).sort((a, b) => a[1].joinedAt - b[1].joinedAt) : [];
  const html = ps.slice(0, 7).map(([, p]) => `<div class="av" style="background:${p.color}" title="${escapeHtml(p.name)}">${escapeHtml(initials(p.name))}</div>`).join('')
    + (ps.length > 7 ? `<div class="av more">+${ps.length - 7}</div>` : '');
  if (av._h !== html) { av._h = html; av.innerHTML = html; }
  const unread = S.panic ? 0 : totalUnread();
  const b = $('#badge'); b.hidden = !unread; b.textContent = unread > 9 ? '9+' : unread;
  $('#btnComments').style.visibility = S.room ? 'visible' : 'hidden';
  const g = game();
  $('#saved').textContent = S.panic ? 'Todos los cambios se guardaron' : (S.room ? `Todos los cambios se guardaron · ${S.room}` : 'Todos los cambios se guardaron');
  if (document.title !== docTitle()) document.title = docTitle();
  void g;
}

function renderTabs() {
  const tabs = [['main', S.room ? 'Resumen Q4' : 'Hoja 1'], ['kpi', 'KPIs'], ['glos', 'Glosario']];
  const html = tabs.map(([id, l]) => `<div class="tab${S.sheet === id ? ' on' : ''}" data-tab="${id}">${l}</div>`).join('');
  const tl = $('#tablist'); if (tl._h !== html) { tl._h = html; tl.innerHTML = html; }
  const st = S.store.mode === 'local' && !S.panic ? 'Modo local' : (S.panic ? 'Suma: $ 0' : '');
  $('#status').textContent = st;
}

function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

// ═════════════════════════ comentarios (chat) ═════════════════════════
const tid2 = (a, b) => [a, b].sort().join('__');
const gkey = () => (game() && active(game()) || (game() && game().phase === 'end')) ? game().id : 'lobby';

function threadMsgs(id) {
  if (id === 'general') return S.chat || {};
  return ((S.dms || {})[gkey()] || {})[id] || {};
}

function visibleThreads() {
  const me = S.pid, g = game(), list = [{ id: 'general', name: 'Todos' }];
  const all = (S.dms || {})[gkey()] || {};
  const seen = new Set(['general']);
  const add = t => { if (!seen.has(t.id)) { seen.add(t.id); list.push(t); } };
  for (const id of Object.keys(all)) {
    if (!id.includes('__')) continue;
    const [a, b] = id.split('__');
    if (a === me || b === me) add({ id, name: '@' + nameOf(a === me ? b : a) });
  }
  if (S.thread && S.thread.includes('__') && S.thread.split('__').includes(me)) {
    const [a, b] = S.thread.split('__'); add({ id: S.thread, name: '@' + nameOf(a === me ? b : a) });
  }
  if (g && active(g)) {
    const set = settings();
    if (g.roles[me] === 'impostor' && set.impKnow && g.nImp > 1) add({ id: 'equipo', name: '🔒 Finanzas' });
    if (!g.alive[me]) add({ id: 'fuera', name: 'Fuera de juego' });
    const ch = (g.powers || {}).chusma;
    if (ch && ch.by === me && ch.round === g.round) {
      for (const id of Object.keys(all)) {
        if (id.includes('__')) {
          const [a, b] = id.split('__');
          if ((a === ch.target || b === ch.target) && a !== me && b !== me) add({ id, name: `👀 ${nameOf(a)} ↔ ${nameOf(b)}`, ro: 1 });
        } else if (id === 'equipo' && g.roles[ch.target] === 'impostor') add({ id, name: '👀 Finanzas', ro: 1 });
      }
    }
  }
  return list;
}

function writeBlock(t) {
  const g = game(), me = S.pid;
  if (!S.room) return 'Sin sala';
  if (t.ro) return 'Solo lectura (chusmerío)';
  if (!g || !active(g)) return '';
  if (t.id === 'fuera') return '';
  if (!g.alive[me]) return 'Estás fuera de juego: solo el hilo "Fuera de juego"';
  if (t.id === 'general') {
    if (g.event === 'vpn' && g.phase === 'discuss' && now() < (g.discussStart || 0) + 30000)
      return `Se cayó la VPN: ${Math.ceil(((g.discussStart || 0) + 30000 - now()) / 1000)} s sin chat general`;
    return '';
  }
  if (g.event === 'auditoria') return 'Auditoría sorpresa: hilos privados bloqueados esta ronda';
  return '';
}

function totalUnread() {
  if (!S.room) return 0;
  let n = 0;
  for (const t of visibleThreads()) n += unreadIn(t.id);
  return n;
}
function unreadIn(id) {
  const lr = S.lastRead[gkey() + ':' + id] || 0;
  return Object.values(threadMsgs(id)).filter(x => x && x.ts > lr && x.pid !== S.pid).length;
}

function renderSide() {
  const side = $('#side');
  const show = !!S.room && S.side && !S.panic;
  side.hidden = !show;
  if (!show) return;
  const threads = visibleThreads();
  if (!threads.find(t => t.id === S.thread)) S.thread = 'general';
  const cur = threads.find(t => t.id === S.thread);
  // marcar leído
  const msgs = Object.entries(threadMsgs(S.thread)).map(([k, v]) => Object.assign({ k }, v)).filter(x => x.ts).sort((a, b) => a.ts - b.ts || (a.k < b.k ? -1 : 1));
  if (msgs.length) S.lastRead[gkey() + ':' + S.thread] = Math.max(S.lastRead[gkey() + ':' + S.thread] || 0, msgs[msgs.length - 1].ts);

  const chips = threads.map(t => `<button class="chip${t.id === S.thread ? ' on' : ''}" data-thread="${t.id}">${escapeHtml(t.name)}${t.id !== S.thread && unreadIn(t.id) ? '<span class="dot"></span>' : ''}</button>`).join('');
  const th = $('#threads'); if (th._h !== chips) { th._h = chips; th.innerHTML = chips; }

  // nuevo hilo privado
  const g = game();
  let cands = Object.keys(S.players).filter(p => p !== S.pid && fresh(p));
  if (g && active(g)) cands = g.order.filter(p => p !== S.pid && g.alive[p]);
  const opts = '<option value="">＋ Hilo privado con…</option>' + cands.map(p => `<option value="${p}">${escapeHtml(nameOf(p))}</option>`).join('');
  const nt = $('#newThread'); if (nt._h !== opts) { nt._h = opts; nt.innerHTML = opts; }

  const html = msgs.length ? msgs.slice(-200).map(x => {
    if (x.sys) return `<div class="msg sys">${escapeHtml(x.text)}</div>`;
    const c = colorOf(x.pid);
    return `<div class="msg${x.pid === S.pid ? ' mine' : ''}"><div class="h"><div class="a" style="background:${c}">${escapeHtml(initials(x.name))}</div><span class="n">${escapeHtml(x.name)}</span><span class="t">${hhmm(x.ts)}</span></div><div class="x">${escapeHtml(x.text)}</div></div>`;
  }).join('') : `<div class="empty">${S.thread === 'general' ? 'Sin comentarios todavía.' : 'Hilo privado: solo lo ven ustedes.'}</div>`;
  const box = $('#msgs');
  if (box._h !== html) {
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    box._h = html; box.innerHTML = html;
    if (atBottom || box._thread !== S.thread) box.scrollTop = box.scrollHeight;
    box._thread = S.thread;
  }
  const block = writeBlock(cur || { id: 'general' });
  const inp = $('#msgIn');
  inp.disabled = !!block; $('#sendBtn').disabled = !!block;
  $('#composeNote').textContent = block;
  const ph = S.thread === 'general' ? 'Comentar para todos…' : 'Responder en privado…';
  if (inp.placeholder !== ph) inp.placeholder = ph;
}

async function sendMsg() {
  const inp = $('#msgIn'), text = inp.value.trim().slice(0, 500);
  if (!text) return;
  const t = visibleThreads().find(x => x.id === S.thread) || { id: 'general' };
  if (writeBlock(t)) return toast(writeBlock(t));
  const msg = { pid: S.pid, name: S.name, text, ts: now() };
  if (S.thread === 'general') S.store.push(rp('chat'), msg);
  else S.store.push(rp(`dms/${gkey()}/${S.thread}`), msg);
  inp.value = '';
}
function sysMsg(text) { S.store.push(rp('chat'), { sys: true, text, ts: now(), pid: '_' }); }

// ═════════════════════════ acciones ═════════════════════════
async function act(a, v, m) {
  const g = game(), me = S.pid;
  try {
    switch (a) {
      case 'f_name': S.form.f_name = v; if (S.form.f_code) return joinRoom(S.form.f_code, v); return;
      case 'f_code': S.form.f_code = v; return joinRoom(v, S.form.f_name);
      case 'join': return joinRoom(S.form.f_code, S.form.f_name);
      case 'create': return createRoom(S.form.f_name);
      case 'set': {
        const key = m.arg; let val = v;
        if (typeof L.DEFAULT_SETTINGS[key] === 'number') val = Number(v);
        return S.store.set(rp(`state/settings/${key}`), val);
      }
      case 'cat': return S.store.set(rp(`state/settings/cats/${m.arg}`), !!v);
      case 'start': return startGame();
      case 'lobby': {
        const gid = g && g.id;
        await S.store.set(rp('state/game'), null);
        if (gid) S.store.remove(rp(`dms/${gid}`));
        return;
      }
      case 'clue': {
        const text = (v || '').trim().slice(0, 30);
        if (!text || !g || g.phase !== 'clues') return;
        const role = g.roles[me];
        if (role !== 'impostor' && role !== 'pasante' && L.clueHasWord(text, g.word)) return toast('La pista no puede contener el concepto.');
        return S.store.set(gp(`clues/${g.round}_${g.clueRound}/${me}`), text);
      }
      case 'vote': if (g && g.phase === 'vote' && g.alive[me]) return S.store.set(gp(`votes/${L.rk(g.round)}/${me}`), v || null); return;
      case 'ready': if (g && g.phase === 'discuss') return S.store.set(gp(`ready/${L.rk(g.round)}/${me}`), v ? true : null); return;
      case 'rrhh':
        if (!v || !g || g.roles[me] !== 'rrhh' || (g.powers || {}).rrhh) return;
        return S.store.set(gp('powers/rrhh'), { by: me, target: v, isImp: g.roles[v] === 'impostor', round: g.round });
      case 'chusma':
        if (!v || !g || g.roles[me] !== 'chusma' || (g.powers || {}).chusma) return;
        await S.store.set(gp('powers/chusma'), { by: me, target: v, round: g.round });
        if (!S.side) { S.side = true; } return;
      case 'guess': {
        const text = (v || '').trim().slice(0, 40);
        if (!text || !g || g.phase !== 'guess' || !g.guess || g.guess.pid !== me) return;
        return S.store.set(gp('guess/text'), text);
      }
      case 'gc': S.form.gc = v; return;
      case 'gw': case 'gwbtn': {
        const text = (a === 'gw' ? v : (S.form.gw || '')).trim().slice(0, 40);
        if (!text) return toast('Escribí un concepto.');
        const exists = Object.values(S.words || {}).some(w => L.norm(w.text) === L.norm(text));
        if (exists) return toast('Ese concepto ya está.');
        const cat = (S.form.gc || '').trim() || CUSTOM_CAT.name;
        const catId = cat === CUSTOM_CAT.name ? CUSTOM_CAT.id : ('c_' + L.slug(cat));
        S.store.push('words', { text, cat, catId, by: S.name || '' });
        S.form.gw = '';
        if (a === 'gwbtn') { const i = cellEls.A2.querySelector('input'); if (i) i.value = ''; }
        return toast(`Agregado: ${text}`);
      }
      case 'delw': return S.store.remove(`words/${v}`);
    }
  } catch (e) { console.error(e); toast('Algo falló: ' + (e.message || e)); }
}

// ═════════════════════════ salas ═════════════════════════
const cleanName = n => (n || '').replace(/\s+/g, ' ').trim().slice(0, 20);

async function createRoom(name) {
  name = cleanName(name);
  if (!name) return toast('Primero poné tu nombre.');
  let code = L.roomCode();
  for (let i = 0; i < 10; i++) { if (!(await S.store.get(`rooms/${code}/state`))) break; code = L.roomCode(); }
  await S.store.set(`rooms/${code}/state`, { hostId: S.pid, createdAt: now(), settings: L.DEFAULT_SETTINGS });
  await joinRoom(code, name);
}

async function joinRoom(code, name) {
  code = (code || '').toUpperCase().replace(/[^A-Z]/g, '');
  name = cleanName(name);
  if (!name) return toast('Primero poné tu nombre.');
  if (code.length !== 4) return toast('El código de sala tiene 4 letras.');
  const st = await S.store.get(`rooms/${code}/state`);
  if (!st) return toast('No existe una sala con ese código.');
  const players = (await S.store.get(`rooms/${code}/players`)) || {};
  const others = Object.entries(players).filter(([id, p]) => id !== S.pid && now() - (p.seen || 0) < DROP_MS);
  const taken = new Set(others.map(([, p]) => L.norm(p.name)));
  let finalName = name, n = 2;
  while (taken.has(L.norm(finalName))) finalName = `${name} ${n++}`;
  const used = new Set(others.map(([, p]) => p.color));
  const mine = players[S.pid];
  const color = (mine && mine.color && !used.has(mine.color) && mine.color) || L.COLORS.find(c => !used.has(c)) || L.COLORS[Math.floor(Math.random() * L.COLORS.length)];
  await S.store.set(`rooms/${code}/players/${S.pid}`, { name: finalName, color, joinedAt: (mine && mine.joinedAt) || now(), seen: now() });
  S.room = code; S.name = finalName; S.sheet = 'main'; S.thread = 'general';
  localStorage.setItem('imp_name', name);
  sessionStorage.setItem('imp_room', code);
  history.replaceState(null, '', '#gid=' + code);
  subscribeRoom();
  render();
}

function subscribeRoom() {
  S.roomUnsubs.forEach(u => u()); S.roomUnsubs = [];
  S.roomUnsubs.push(S.store.on(rp('state'), v => {
    if (v === null && S.room) { toast('La sala ya no existe.'); leaveRoom(); return; }
    S.state = v; onStateChange(); schedule();
  }));
  S.roomUnsubs.push(S.store.on(rp('players'), v => { S.players = v || {}; schedule(); }));
  S.roomUnsubs.push(S.store.on(rp('chat'), v => { S.chat = v || {}; schedule(); }));
  S.roomUnsubs.push(S.store.on(rp('dms'), v => { S.dms = v || {}; schedule(); }));
  clearInterval(S.hb);
  S.hb = setInterval(heartbeat, 4000);
  clearInterval(S.hostTimer);
  S.hostTimer = setInterval(() => { hostTick().catch(e => console.error(e)); }, 600);
}

function heartbeat() {
  if (!S.room) return;
  if (!S.players[S.pid]) {
    S.store.set(rp(`players/${S.pid}`), { name: S.name, color: L.COLORS[0], joinedAt: now(), seen: now() });
  } else S.store.set(rp(`players/${S.pid}/seen`), now());
}

async function leaveRoom() {
  const code = S.room;
  S.roomUnsubs.forEach(u => u()); S.roomUnsubs = [];
  clearInterval(S.hb); clearInterval(S.hostTimer);
  S.room = null; S.state = null; S.players = {}; S.chat = {}; S.dms = {};
  sessionStorage.removeItem('imp_room');
  history.replaceState(null, '', location.pathname);
  if (code) await S.store.remove(`rooms/${code}/players/${S.pid}`);
  render();
}

function onStateChange() {
  const g = game();
  const gid = g ? g.id : null, ph = g ? g.phase : null;
  if (gid !== S.prevGame) {
    S.thread = 'general';
    if (g && g.phase !== 'end') { S.sheet = 'main'; if (S.prevGame !== undefined && g.roles[S.pid]) toast('¡Arrancó la partida! Pasá el mouse por B3 (concepto) y D3 (rol).', 5000); }
  }
  if (ph !== S.prevPhase && g && g.phase === 'clues') {
    const t = L.turnList(g)[g.turn];
    if (t === S.pid) select('A1', false);
  }
  S.prevGame = gid; S.prevPhase = ph;
}

// ═════════════════════════ motor (lo corre quien organiza) ═════════════════════════
async function startGame() {
  const set = settings();
  const ids = Object.keys(S.players).filter(fresh).sort((a, b) => S.players[a].joinedAt - S.players[b].joinedAt);
  if (ids.length < 3) return toast('Se necesitan al menos 3 personas conectadas.');
  const pool = L.buildPool(set, S.words);
  if (!pool.length) return toast('No hay conceptos en las categorías elegidas.');
  const pick = pool[Math.floor(Math.random() * pool.length)];
  const order = L.shuffle(ids), roles = L.assignRoles(order, set), ev = L.rollEvent(set, null), t = now();
  const prev = game();
  const g = {
    id: 'g' + L.rid(7), step: 1, phase: 'reveal', deadline: t + 10000, startedAt: t,
    word: pick.w, category: pick.cat, roles, order,
    alive: Object.fromEntries(order.map(p => [p, true])),
    names: Object.fromEntries(order.map(p => [p, S.players[p].name])),
    colors: Object.fromEntries(order.map(p => [p, S.players[p].color])),
    nImp: Object.values(roles).filter(r => r === 'impostor').length,
    round: 1, clueRound: 1, turn: 0, event: ev,
    clueRoundsBy: { r1: set.clueRounds + (ev === 'mail' ? 1 : 0) },
  };
  await S.store.set(rp('state/game'), g);
  if (prev && prev.id) S.store.remove(rp(`dms/${prev.id}`));
  const gerente = order.find(p => roles[p] === 'gerente');
  sysMsg(`Nueva partida: ${order.length} personas, ${g.nImp} impostor${g.nImp > 1 ? 'es' : ''}.${gerente ? ` ${S.players[gerente].name} es Gerente (voto doble).` : ''}`);
}

async function hostTick() {
  if (!S.room || !S.state) return;
  const me = S.pid, h = hostId();
  if (h !== me) return;
  if (S.state.hostId !== me) await S.store.set(rp('state/hostId'), me);
  const g = game(), t = now();

  // limpiar gente que se fue del lobby
  for (const [id, p] of Object.entries(S.players)) {
    const inGame = g && active(g) && g.roles && g.roles[id];
    if (id !== me && !inGame && t - (p.seen || 0) > LOBBY_PRUNE_MS) S.store.remove(rp(`players/${id}`));
  }
  if (!g || !active(g)) return;
  if (S.hostActed.step === g.step && t - S.hostActed.t < 4000) return;

  const set = settings(), upd = {};
  const commit = async () => {
    upd.step = g.step + 1;
    S.hostActed = { step: g.step, t };
    await S.store.update(rp('state/game'), upd);
  };

  // desconectados por mucho tiempo: quedan fuera
  const dropped = g.order.filter(p => g.alive[p] && t - ((S.players[p] || {}).seen || 0) > DROP_MS);
  if (dropped.length) {
    dropped.forEach(p => { upd[`alive/${p}`] = false; });
    sysMsg(`${dropped.map(p => g.names[p]).join(', ')} se desconectó y queda fuera.`);
    const g2 = Object.assign({}, g, { alive: Object.assign({}, g.alive) });
    dropped.forEach(p => { g2.alive[p] = false; });
    const w = L.winCheck(g2);
    if (w) { finish(g2, w, upd); }
    return commit();
  }

  switch (g.phase) {
    case 'reveal':
      if (t >= g.deadline) { upd.phase = 'clues'; upd.turn = 0; upd.clueRound = 1; upd.deadline = t + set.clueSec * 1000; return commit(); }
      return;
    case 'clues': {
      const turns = L.turnList(g), cur = turns[g.turn], key = `${g.round}_${g.clueRound}`;
      const done = cur && ((g.clues || {})[key] || {})[cur];
      if (!cur || done || t >= g.deadline || !fresh(cur)) {
        if (cur && !done) upd[`clues/${key}/${cur}`] = '—';
        let turn = g.turn + 1, cr = g.clueRound;
        if (turn >= turns.length) { turn = 0; cr++; }
        if (cr > ((g.clueRoundsBy || {})[L.rk(g.round)] || 1)) {
          upd.phase = 'discuss'; upd.deadline = t + set.discussSec * 1000; upd.discussStart = t;
        } else { upd.turn = turn; upd.clueRound = cr; upd.deadline = t + set.clueSec * 1000; }
        return commit();
      }
      return;
    }
    case 'discuss': {
      const ready = ((g.ready || {})[L.rk(g.round)]) || {};
      const need = g.order.filter(p => g.alive[p] && fresh(p));
      if (t >= g.deadline || (need.length && need.every(p => ready[p]))) {
        upd.phase = 'vote'; upd.deadline = t + set.voteSec * 1000; return commit();
      }
      return;
    }
    case 'vote': {
      const votes = ((g.votes || {})[L.rk(g.round)]) || {};
      const need = g.order.filter(p => g.alive[p] && fresh(p));
      if (t >= g.deadline || (need.length && need.every(p => votes[p]))) {
        const res = L.tally(g);
        upd[`results/${L.rk(g.round)}`] = { ejected: res.ejected, tie: res.tie, counts: res.counts, wasImp: res.wasImp };
        if (res.ejected) upd[`alive/${res.ejected}`] = false;
        upd.phase = 'result'; upd.deadline = t + 7000;
        sysMsg(res.ejected ? `Se fue ${g.names[res.ejected]}: ${res.wasImp ? 'ERA impostor' : 'NO era impostor'}.` : (res.tie ? 'Empate en la votación: no se va nadie.' : 'Ganó la abstención: no se va nadie.'));
        return commit();
      }
      return;
    }
    case 'result': {
      if (t < g.deadline) return;
      const res = (g.results || {})[L.rk(g.round)] || {};
      if (res.ejected && res.wasImp) {
        upd.phase = 'guess'; upd.deadline = t + 30000; upd.guess = { pid: res.ejected, round: g.round };
        return commit();
      }
      nextOrEnd(g, upd, t, set); return commit();
    }
    case 'guess': {
      const gs = g.guess || {};
      if (gs.text || t >= g.deadline || !fresh(gs.pid)) {
        if (gs.text && L.guessOk(gs.text, g.word)) {
          sysMsg(`${g.names[gs.pid]} adivinó el concepto: "${g.word}".`);
          finish(g, { winner: 'imp', reason: 'guess' }, upd);
        } else {
          if (gs.text) sysMsg(`${g.names[gs.pid]} apostó "${gs.text}" y no era.`);
          nextOrEnd(g, upd, t, set);
        }
        return commit();
      }
      return;
    }
  }
}

function nextOrEnd(g, upd, t, set) {
  const w = L.winCheck(g);
  if (w) return finish(g, w, upd);
  const r = g.round + 1, ev = L.rollEvent(set, g.event);
  upd.round = r; upd.clueRound = 1; upd.turn = 0; upd.event = ev;
  upd[`clueRoundsBy/${L.rk(r)}`] = set.clueRounds + (ev === 'mail' ? 1 : 0);
  upd.phase = 'clues'; upd.deadline = t + set.clueSec * 1000;
}

function finish(g, w, upd) {
  upd.phase = 'end'; upd.winner = w.winner; upd.reason = w.reason; upd.deadline = null;
  const final = Object.assign({}, g, { winner: w.winner });
  sysMsg(w.winner === 'eq' ? `Ganó el equipo. El concepto era "${g.word}".` : `Ganaron los impostores. El concepto era "${g.word}".`);
  writeRanking(final).catch(e => console.error(e));
}

async function writeRanking(g) {
  const rk = (await S.store.get('ranking')) || {}, upd = {};
  for (const p of g.order) {
    const name = g.names[p], key = L.slug(name) || p;
    const cur = rk[key] || { name, games: 0, wins: 0, impGames: 0, impWins: 0, caught: 0 };
    const imp = g.roles[p] === 'impostor', won = g.winner === (imp ? 'imp' : 'eq');
    let caught = 0;
    for (const [rkey, res] of Object.entries(g.results || {})) {
      if (res && res.ejected && res.wasImp && ((g.votes || {})[rkey] || {})[p] === res.ejected) caught++;
    }
    upd[key] = { name, games: (cur.games || 0) + 1, wins: (cur.wins || 0) + (won ? 1 : 0), impGames: (cur.impGames || 0) + (imp ? 1 : 0), impWins: (cur.impWins || 0) + (imp && won ? 1 : 0), caught: (cur.caught || 0) + caught };
  }
  await S.store.update('ranking', upd);
}

// ═════════════════════════ menús, modal, teclado ═════════════════════════
const HELP = `<div class="dlg"><h2>Cómo se juega</h2>
<p>Todos reciben el mismo <b>concepto</b> secreto (celda B3), menos el <b>impostor</b>, que ve <b>#N/A</b>. Tu rol está en D3. Pasá el mouse por esas celdas para verlas: así nadie lo lee por encima de tu hombro.</p>
<h3>Una ronda</h3><ul>
<li><b>Carga de ítems:</b> por turnos, cada uno escribe UNA palabra relacionada en su celda resaltada. Ni tan obvia que el impostor la adivine, ni tan rara que sospechen de vos.</li>
<li><b>Revisión:</b> debatan en Comentarios (a la derecha). Abran hilos privados para complotar.</li>
<li><b>Aprobación:</b> cada uno vota a quién echar. Empate o mayoría de abstenciones: no se va nadie.</li>
<li>Si echan a un impostor, tiene <b>una apuesta</b>: si adivina el concepto, ganan los impostores.</li></ul>
<p>Gana el <b>equipo</b> si caen todos los impostores. Ganan los <b>impostores</b> si llegan a ser tantos como el equipo o si adivinan el concepto.</p>
<h3>Roles especiales (opcionales)</h3><ul>
<li><b>Pasante</b> (4+): del equipo, pero solo conoce la categoría.</li>
<li><b>RRHH</b> (5+): una vez por partida audita a alguien y sabe si es impostor.</li>
<li><b>Gerente</b> (6+): público; su voto vale doble.</li>
<li><b>Chusma</b> (7+): una vez por partida lee los hilos privados de alguien durante esa ronda.</li></ul>
<h3>Eventos sorpresa</h3><ul>
<li><b>Se cayó la VPN:</b> 30 s de debate sin chat general.</li><li><b>Reunión que pudo ser un mail:</b> vuelta extra de pistas.</li>
<li><b>Viernes de after:</b> votos a cara descubierta.</li><li><b>Auditoría sorpresa:</b> sin hilos privados esa ronda.</li></ul>
<h3>Disimulo</h3><p><b>Esc</b> oculta todo y muestra una planilla de presupuesto. Otra vez <b>Esc</b> para volver. El título del archivo (arriba a la izquierda) se puede cambiar.</p>
<p>Hojas de abajo: <b>KPIs</b> es el ranking histórico y <b>Glosario</b> sirve para cargar conceptos propios de la oficina.</p>
<div class="foot"><button data-close>Entendido</button></div></div>`;

const MENUS = {
  archivo: [['share', 'Compartir enlace de la sala'], ['leave', 'Salir de la sala'], '-', ['panic', 'Ocultar (Esc)'], '-', [null, 'Abrir'], [null, 'Descargar'], [null, 'Imprimir']],
  editar: [[null, 'Deshacer'], [null, 'Rehacer'], '-', [null, 'Cortar'], [null, 'Copiar'], [null, 'Pegar']],
  ver: [['side', 'Mostrar/ocultar comentarios'], '-', [null, 'Inmovilizar'], [null, 'Líneas de cuadrícula']],
  insertar: [[null, 'Filas'], [null, 'Columnas'], [null, 'Gráfico'], [null, 'Comentario']],
  formato: [[null, 'Número'], [null, 'Texto'], [null, 'Formato condicional']],
  datos: [[null, 'Ordenar rango'], [null, 'Crear un filtro'], [null, 'Validación de datos']],
  herramientas: [[null, 'Ortografía'], [null, 'Notificaciones']],
  ayuda: [['help', 'Cómo se juega'], [null, 'Combinaciones de teclas']],
};

function openMenu(name, anchor) {
  const d = $('#menuDrop');
  document.querySelectorAll('#menus span').forEach(s => s.classList.toggle('open', s === anchor));
  d.innerHTML = MENUS[name].map(it => it === '-' ? '<hr>' : `<div class="${it[0] ? 'act' : 'dis'}" data-mact="${it[0] || ''}">${it[1]}</div>`).join('');
  const r = anchor.getBoundingClientRect();
  d.style.left = r.left + 'px'; d.style.top = (r.bottom + 2) + 'px'; d.hidden = false;
}
function closeMenu() { $('#menuDrop').hidden = true; document.querySelectorAll('#menus span.open').forEach(s => s.classList.remove('open')); }

function menuAction(a) {
  closeMenu();
  if (a === 'share') return share();
  if (a === 'leave') return S.room ? leaveRoom() : toast('No estás en ninguna sala.');
  if (a === 'panic') return togglePanic();
  if (a === 'side') { S.side = !S.side; return schedule(); }
  if (a === 'help') { $('#modal').innerHTML = HELP; $('#modal').hidden = false; }
}

function share() {
  if (!S.room) return toast('Primero creá o unite a una sala.');
  const url = location.origin + location.pathname + '#gid=' + S.room;
  const done = () => toast('Enlace copiado: ' + url, 4000);
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => prompt('Copiá el enlace:', url));
  else prompt('Copiá el enlace:', url);
}

function togglePanic() {
  S.panic = !S.panic;
  closeMenu(); $('#modal').hidden = true; $('#toast').hidden = true;
  if (S.panic && document.activeElement) document.activeElement.blur();
  S.sel = 'A1'; render();
}

function bindUI() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); togglePanic(); return; }
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag)) return;
    const { c, r } = parseRef(S.sel); let nc = c, nr = r;
    if (e.key === 'ArrowUp') nr = Math.max(1, r - 1); else if (e.key === 'ArrowDown' || e.key === 'Enter') nr = Math.min(NROWS, r + 1);
    else if (e.key === 'ArrowLeft') nc = Math.max(0, c - 1); else if (e.key === 'ArrowRight' || e.key === 'Tab') nc = Math.min(NCOLS - 1, c + 1);
    else return;
    e.preventDefault();
    const ref = colL(nc) + nr; select(ref, false);
    const el = cellEls[ref]; if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  $('#menus').addEventListener('click', e => { const s = e.target.closest('span[data-menu]'); if (!s) return; if (!$('#menuDrop').hidden && s.classList.contains('open')) closeMenu(); else openMenu(s.dataset.menu, s); });
  $('#menuDrop').addEventListener('click', e => { const it = e.target.closest('[data-mact]'); if (it && it.dataset.mact) menuAction(it.dataset.mact); });
  document.addEventListener('mousedown', e => { if (!e.target.closest('#menuDrop,#menus')) closeMenu(); });
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) $('#modal').hidden = true; });
  $('#btnShare').addEventListener('click', share);
  $('#btnComments').addEventListener('click', () => { S.side = !S.side; schedule(); });
  $('#sideClose').addEventListener('click', () => { S.side = false; schedule(); });
  $('#tablist').addEventListener('click', e => { const t = e.target.closest('[data-tab]'); if (!t) return; S.sheet = t.dataset.tab; S.sel = 'A1'; render(); });
  $('#threads').addEventListener('click', e => { const c = e.target.closest('[data-thread]'); if (!c) return; S.thread = c.dataset.thread; schedule(); });
  $('#newThread').addEventListener('change', e => { const p = e.target.value; if (!p) return; S.thread = tid2(S.pid, p); e.target.value = ''; schedule(); setTimeout(() => $('#msgIn').focus(), 50); });
  $('#msgIn').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } });
  $('#sendBtn').addEventListener('click', sendMsg);
  $('#docTitle').addEventListener('input', () => { localStorage.setItem('imp_title', $('#docTitle').value); schedule(); });
  $('#docTitle').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
}

// ═════════════════════════ arranque ═════════════════════════
async function main() {
  S.store = await createStore();
  S.pid = sessionStorage.getItem('imp_pid');
  if (!S.pid) { S.pid = L.rid(10); sessionStorage.setItem('imp_pid', S.pid); }
  const t = localStorage.getItem('imp_title'); if (t) $('#docTitle').value = t;
  S.form.f_name = localStorage.getItem('imp_name') || '';
  const hm = location.hash.match(/gid=([A-Za-z]{4})/);
  S.form.f_code = hm ? hm[1].toUpperCase() : '';
  S.formInit = { f_name: S.form.f_name, f_code: S.form.f_code };
  S.prevGame = undefined;
  buildGrid(); bindUI();
  S.store.on('ranking', v => { S.ranking = v || {}; schedule(); });
  S.store.on('words', v => { S.words = v || {}; schedule(); });
  render();
  setInterval(schedule, 500);
  // reconexión automática al recargar la pestaña
  const saved = sessionStorage.getItem('imp_room');
  if (saved && S.form.f_name && (!hm || hm[1].toUpperCase() === saved)) joinRoom(saved, S.form.f_name).catch(() => {});
}

main();
