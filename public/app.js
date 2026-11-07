// Cabo Crew app (served from the Worker behind the trip code)
(() => {
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DISPLAY = '"Bricolage Grotesque", system-ui, sans-serif', BODY = '"Geist", system-ui, sans-serif', MONO = '"Geist Mono", ui-monospace, monospace';
const PAL = ['#FF5A36','#0E8A9A','#E89B0C','#6E57F5','#1FA36B','#E2457F','#2F6BFF','#B8622B'];
const KEY = 'cabocrew.v2';
const VIDEO_ID = 'ffv0dH8r5uY';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const icons = () => { try { window.lucide && lucide.createIcons({ attrs: { 'stroke-width': 1.8 } }); } catch (e) {} };
const GRP = { adult: 'Adult', teen: 'Teen', kid: 'Kid' };
const grpOf = m => GRP[m.grp] ? m.grp : (m.age >= 18 ? 'adult' : m.age >= 13 ? 'teen' : m.age >= 0 ? 'kid' : 'adult');
const grpLabel = m => GRP[grpOf(m)];
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- State ---------- */
const DEFAULTS = { family: null, myId: null, token: null, famCache: [], plan: null, planCache: null, me: null, lastRead: null, watched: false, checks: {}, screen: 'intro', tab: 'today', planDay: 0, resort: 'palace', who: 'all' };
let S = Object.assign({}, DEFAULTS, load() || {});
function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
let warned = false;
function save() { try { localStorage.setItem(KEY, JSON.stringify(Object.assign({}, S, { famCache: FAM }))); } catch (e) { if (!warned) { warned = true; toast("Couldn't save on this phone"); } } }

/* ---------- Server ---------- */
const API = { mode: 'local', ai: false, code: '', owner: false };
let FAM = S.famCache || [];
let famSig = '';
function getCode() {
  let c = '';
  try { c = new URL(location.href).searchParams.get('code') || ''; } catch (e) {}
  try { if (c) localStorage.setItem('cabocrew.code', c); else c = localStorage.getItem('cabocrew.code') || ''; } catch (e) {}
  // Keep the code out of the address bar so it isn't shared by accident; the invite button builds the link.
  try { if (new URL(location.href).searchParams.get('code')) history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
  return c;
}
function hdrs(extra) { const h = Object.assign({ 'x-trip-code': API.code }, extra || {}); if (S.token) h['x-family-token'] = S.token; return h; }
async function api(path, opts = {}) {
  const o = { method: opts.method || 'GET', headers: hdrs(opts.headers) };
  if (opts.json) { o.body = JSON.stringify(opts.json); o.headers['content-type'] = 'application/json'; }
  else if (opts.body) o.body = opts.body;
  const r = await fetch('/api/' + path, o);
  const ct = r.headers.get('content-type') || '';
  const d = ct.includes('json') ? await r.json().catch(() => null) : null;
  if (!r.ok) { const e = new Error((d && d.message) || "Couldn't reach Cabo Crew. Check your connection."); e.status = r.status; throw e; }
  return d;
}
async function detect() {
  API.code = getCode();
  try {
    const r = await fetch('/api/ping', { headers: hdrs() });
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('json')) return 'local';
    if (r.status === 401) return 'locked';
    const d = await r.json(); API.ai = !!d.ai; API.owner = !!d.owner; return 'server';
  } catch (e) { return 'local'; }
}
async function refresh() {
  if (API.mode !== 'server') return false;
  const d = await api('families');
  const sig = JSON.stringify(d.families), changed = sig !== famSig;
  FAM = d.families; famSig = sig;
  const mine = FAM.find(f => f.id === S.myId);
  if (!(S.family && S.family.example)) {
    if (mine) S.family = { id: mine.id, name: mine.name, members: mine.members };
    else if (S.myId) { S.myId = null; S.token = null; S.family = null; }
  }
  save(); return changed;
}
const others = () => API.mode === 'server' ? FAM.filter(f => f.id !== S.myId).map(f => ({ id: f.id, name: f.name, members: f.members })) : [];
function allPeople() {
  const out = [];
  if (S.family) S.family.members.forEach((m, i) => out.push({ m, i, fam: S.family, mine: true }));
  others().forEach(f => f.members.forEach((m, i) => out.push({ m, i, fam: f, mine: false })));
  return out;
}
const findPerson = id => allPeople().find(p => p.m.id === id);

/* ---------- Figurine sources ---------- */
const MYST = new Map();
const isReal = m => API.mode === 'server' && !(S.family && S.family.example) ? m.fig_v > 0 : !!m.fig;
function figSrc(m, idx) {
  if (API.mode === 'server' && m.fig_v > 0) return `/api/fig/${encodeURIComponent(m.id)}?v=${m.fig_v}&code=${encodeURIComponent(API.code)}`;
  if (m.fig) return m.fig;
  const key = `${m.name}|${grpOf(m)}|${idx}`;
  if (!MYST.has(key)) MYST.set(key, renderFig(null, m, idx).toDataURL('image/jpeg', .88));
  return MYST.get(key);
}

/* ---------- Content ---------- */
const WHERE = { palace: 'Palace Cabo', santafe: 'Santa Fe', offsite: 'Off-site' };
const DAYS = [
  { d: 24, wk: 'Thu', title: 'Arrival day', sub: 'Christmas Eve · Thu, Dec 24', items: [
    { t: 'Midday', i: 'plane-landing', title: 'Land at Los Cabos (SJD)', note: 'The resort is about 40 km from the airport, roughly 45 minutes by road.', where: 'offsite' },
    { t: '3:00 PM', i: 'key-round', title: 'Check in at Palace Cabo', note: 'Check-in opens at 3 PM. Have a photo ID and a card ready for the front desk.', where: 'palace' },
    { t: '4:00 PM', i: 'waves', title: 'First swim', note: 'Two pools have swim-up bars, and the whirlpools are heated in winter.', where: 'palace' },
    { t: 'Evening', i: 'sparkles', title: 'Christmas Eve dinner', note: 'Dinner is at Palace Cabo. Ask at check-in about the holiday program.', where: 'palace' } ] },
  { d: 25, wk: 'Fri', title: 'Christmas Day', sub: 'Water park day · Fri, Dec 25', items: [
    { t: 'Morning', i: 'coffee', title: 'Breakfast at Mar de Cortés', note: 'Buffet with live cooking stations.', where: 'palace' },
    { t: '10:00 AM', i: 'droplets', title: 'Splash Water World', note: 'Five slides. It opens 6 days a week, so check today is one of them.', where: 'santafe', who: 'slides' },
    { t: '10:00 AM', i: 'blocks', title: 'RiuLand kids club', note: 'Crafts, games and sports for the younger crew.', where: 'santafe', who: 'kids' },
    { t: '1:00 PM', i: 'utensils', title: 'Lunch by the pool', note: 'La Misión (Mexican) or Torote (grill) at Santa Fe.', where: 'santafe' },
    { t: 'Evening', i: 'utensils', title: 'À la carte dinner', note: 'Krystal, Misaki, Bombay, El Médano or San José. Long pants for dinner.', where: 'palace' } ] },
  { d: 26, wk: 'Sat', title: 'Ocean day', sub: 'Beach and boats · Sat, Dec 26', items: [
    { t: 'Morning', i: 'ship', title: 'Boat to El Arco', note: "Land's End and Lover's Beach are a short boat ride away. Booked separately.", where: 'offsite', opt: true },
    { t: 'Morning', i: 'fish', title: 'Whale watching', note: 'Whale season in Cabo starts in December. Booked separately.', where: 'offsite', opt: true },
    { t: 'Afternoon', i: 'sun', title: 'Médano Beach', note: 'Calm, swimmable water right in front of the hotel. Water sports cost extra.', where: 'palace' },
    { t: 'Night', i: 'party-popper', title: 'Riu Pool Party', note: 'Themed party at Santa Fe, 4 nights a week. Check which nights.', where: 'santafe', who: 'adult' } ] },
  { d: 27, wk: 'Sun', title: 'Last full day', sub: 'Slow morning, big dinner · Sun, Dec 27', items: [
    { t: '9:00 AM', i: 'dumbbell', title: 'RiuFit or pickleball', note: 'Daily group workouts and 3 pickleball courts at Santa Fe.', where: 'santafe' },
    { t: 'Midday', i: 'flower-2', title: 'Renova Spa', note: 'Massages and treatments. Extra cost.', where: 'palace', opt: true },
    { t: 'Sunset', i: 'camera', title: 'All 5 families, one photo', note: 'Médano Beach looks out toward the Arch. Golden hour is the shot.', where: 'palace' },
    { t: 'Evening', i: 'utensils', title: 'Farewell dinner', note: 'Last à la carte night at Palace Cabo.', where: 'palace' } ] },
  { d: 28, wk: 'Mon', title: 'Departure', sub: 'Check out by 11 · Mon, Dec 28', items: [
    { t: 'Morning', i: 'coffee', title: 'Last breakfast', note: 'Mar de Cortés.', where: 'palace' },
    { t: '11:00 AM', i: 'bed-double', title: 'Check out', note: 'Ask the front desk to hold bags. Lounge 24 stays open for snacks.', where: 'palace' },
    { t: 'Afternoon', i: 'plane-takeoff', title: 'Head to SJD', note: 'About 45 minutes to the airport. Aim to arrive 3 hours before an international flight.', where: 'offsite' } ] }
];
const RESORTS = {
  palace: { name: 'Riu Palace Cabo San Lucas', tag: 'Your hotel', blurb: '24-hour all-inclusive on Médano Beach. Breakfast and dinner happen here.', items: [
    { c: 'Eat', i: 'utensils', n: 'Mar de Cortés', w: 'Main buffet with live cooking', when: 'Breakfast and dinner · themed nights 3× a week' },
    { c: 'Eat', i: 'utensils', n: 'Krystal', w: 'Fusion · à la carte', when: 'Dinner' },
    { c: 'Eat', i: 'utensils', n: 'Misaki', w: 'Japanese · à la carte', when: 'Dinner' },
    { c: 'Eat', i: 'utensils', n: 'Bombay', w: 'Indian · à la carte', when: 'Dinner' },
    { c: 'Eat', i: 'beef', n: 'El Médano', w: 'Poolside grill, steakhouse at night', when: 'Lunch and dinner' },
    { c: 'Eat', i: 'utensils', n: 'San José', w: 'Theme restaurant · à la carte', when: 'Dinner' },
    { c: 'Eat', i: 'concierge-bell', n: 'Room service', w: 'Included, around the clock', when: '24 hours' },
    { c: 'Drink', i: 'coffee', n: 'Lounge 24', w: 'Drinks and snacks any time', when: '24 hours' },
    { c: 'Drink', i: 'martini', n: 'La Ventana', w: 'Lobby bar with terrace' },
    { c: 'Drink', i: 'martini', n: 'Baja Sur and Baja Norte', w: 'Swim-up and poolside bars' },
    { c: 'Drink', i: 'umbrella', n: 'Beach Club', w: 'Chill-out bar on the sand' },
    { c: 'Drink', i: 'coffee', n: 'Cappuccino Corner', w: 'Coffee and something sweet' },
    { c: 'Swim', i: 'waves', n: 'Main pools', w: 'Two large pools with whirlpools, heated in winter' },
    { c: 'Swim', i: 'waves', n: 'Swim-up pools', w: 'Two pools with swim-up bars' },
    { c: 'Swim', i: 'baby', n: "Kids' pool", w: 'Shallow pool for little ones', r: 'kids' },
    { c: 'Swim', i: 'sun', n: 'Médano Beach', w: 'Swimmable beach out front · water sports extra' },
    { c: 'Play', i: 'blocks', n: 'RiuLand kids club', w: 'Crafts, games and sports', r: 'kids' },
    { c: 'Play', i: 'trophy', n: 'Tennis', w: 'Two courts' },
    { c: 'Wellness', i: 'flower-2', n: 'Renova Spa', w: 'Massages and treatments', x: 'Extra cost' },
    { c: 'Wellness', i: 'dumbbell', n: 'Gym', w: 'Cardio and weights' } ] },
  santafe: { name: 'Riu Santa Fe', tag: 'Next door', blurb: 'Yours for lunch, snacks, drinks and fun. Breakfast and dinner stay at Palace Cabo.', items: [
    { c: 'Play', i: 'droplets', n: 'Splash Water World', w: 'Water park with five slides', when: 'Open 6 days a week', r: 'slides' },
    { c: 'Play', i: 'blocks', n: 'RiuLand kids club', w: 'Crafts, games and sports', when: 'Daily', r: 'kids' },
    { c: 'Play', i: 'trophy', n: 'Pickleball and tennis', w: '3 pickleball courts, 1 floodlit tennis court' },
    { c: 'Swim', i: 'waves', n: 'Pools', w: 'Several pools, some with swim-up bars' },
    { c: 'Swim', i: 'baby', n: "Kids' pool with slides", w: 'Splash zone for younger kids', r: 'kids' },
    { c: 'Eat', i: 'utensils', n: 'La Misión', w: 'Mexican · poolside', when: 'Lunch' },
    { c: 'Eat', i: 'beef', n: 'Torote', w: 'Steakhouse · poolside', when: 'Lunch' },
    { c: 'Eat', i: 'sandwich', n: 'Tiki Taco and Pepe’s Food', w: 'Snack bars' },
    { c: 'Eat', i: 'utensils', n: 'Carusso, Sakura, Kulinarium', w: 'Italian, Asian and à la carte', when: 'Dinner', r: 'sfdinner' },
    { c: 'Night', i: 'party-popper', n: 'Riu Pool Party', w: 'Themed party 4 nights a week', r: 'adult' },
    { c: 'Night', i: 'music', n: 'Pachá nightclub', w: 'Free entry and drinks', when: '6 nights a week', r: 'adult' },
    { c: 'Wellness', i: 'dumbbell', n: 'RiuFit', w: 'Group workouts', when: 'Daily' },
    { c: 'Wellness', i: 'dumbbell', n: 'Gym', w: 'Cardio and weights', r: 'adult' } ] }
};
const CATS = ['Eat', 'Drink', 'Swim', 'Play', 'Night', 'Wellness'];
const RULE_LABEL = { kids: 'Kids', slides: '1.20 m+', adult: '18+', sfdinner: 'Not for you at dinner' };
function access(r, m) {
  if (!r) return { s: 'ok', l: 'Yes' };
  if (r === 'sfdinner') return { s: 'no', l: 'Dinner is at Palace' };
  if (r === 'adult') return grpOf(m) === 'adult' ? { s: 'ok', l: 'Yes' } : { s: 'no', l: '18+ only' };
  if (r === 'kids') return grpOf(m) === 'kid' ? { s: 'ok', l: 'Yes' } : { s: 'no', l: 'For kids' };
  if (r === 'slides') return grpOf(m) !== 'kid' ? { s: 'ok', l: 'Yes' } : { s: 'warn', l: 'Check height' };
  return { s: 'ok', l: 'Yes' };
}
const KNOW = `
  <div class="kcard"><span class="tile"><i data-lucide="utensils"></i></span><strong>Breakfast and dinner at Palace Cabo</strong><span>Lunch, snacks and drinks work at both resorts.</span></div>
  <div class="kcard"><span class="tile"><i data-lucide="droplets"></i></span><strong>Water park rules</strong><span>Slides need 1.20 m (3′11″). 12+ recommended. Open 6 days a week.</span></div>
  <div class="kcard"><span class="tile"><i data-lucide="party-popper"></i></span><strong>Adults-only spots</strong><span>Riu Pool Parties and Pachá at Santa Fe are 18+.</span></div>
  <div class="kcard"><span class="tile"><i data-lucide="shirt"></i></span><strong>Dinner dress code</strong><span>Long pants at à la carte dinners. Lounge 24 never closes.</span></div>`;

/* ---------- Canvas engine (2D scenes) ---------- */
const scenes = new Map();
function reg(c, draw) { scenes.set(c, { draw, dirty: true }); }
function visible(c) {
  const s = c.closest('.screen'); if (s && !s.classList.contains('on')) return false;
  const p = c.closest('.pane'); if (p && !p.classList.contains('on')) return false;
  return c.clientWidth > 0 && !document.hidden;
}
function fit(c) {
  const d = Math.min(window.devicePixelRatio || 1, 3);
  const w = Math.round(c.clientWidth * d), h = Math.round(c.clientHeight * d);
  if (w && h && (c.width !== w || c.height !== h)) { c.width = w; c.height = h; return true; }
  return false;
}
function loop(ms) {
  const t = ms / 1000;
  for (const [c, o] of scenes) {
    if (!c.isConnected) { scenes.delete(c); continue; }
    if (!visible(c)) continue;
    const changed = fit(c);
    if (!RM || o.dirty || changed) { o.draw(c.getContext('2d'), c.width, c.height, t); o.dirty = false; }
  }
  requestAnimationFrame(loop);
}
function rr(x, X, Y, w, h, r) { r = Math.min(r, w / 2, h / 2); x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }
function circle(x, X, Y, r) { x.beginPath(); x.arc(X, Y, r, 0, Math.PI * 2); x.fill(); }
const ROCK = [[0,0],[.04,.22],[.08,.38],[.13,.58],[.19,.70],[.24,.74],[.29,.66],[.34,.72],[.40,.86],[.47,.96],[.52,.92],[.58,.80],[.64,.84],[.72,.68],[.80,.58],[.90,.50],[1,.46],[1.3,.44],[1.3,0]];
const STACK = [[-.13,0],[-.115,.2],[-.095,.26],[-.075,.15],[-.062,0]];
function rockPath(x, x0, hz, rw, rh, dir) {
  const P = (u, v) => [x0 + u * rw, hz - dir * v * rh];
  x.beginPath();
  ROCK.forEach(([u, v], i) => { const [a, b] = P(u, v); i ? x.lineTo(a, b) : x.moveTo(a, b); }); x.closePath();
  let p = P(.10, 0); x.moveTo(p[0], p[1]); p = P(.11, .16); x.lineTo(p[0], p[1]);
  const c1 = P(.15, .40), e1 = P(.205, .34); x.quadraticCurveTo(c1[0], c1[1], e1[0], e1[1]);
  const c2 = P(.255, .26), e2 = P(.27, 0); x.quadraticCurveTo(c2[0], c2[1], e2[0], e2[1]); x.closePath();
  STACK.forEach(([u, v], i) => { const [a, b] = P(u, v); i ? x.lineTo(a, b) : x.moveTo(a, b); }); x.closePath();
}
function drawDusk(x, W, H, t, o = {}) {
  const u = Math.max(1, W / 400), hz = H * (o.hz || .6);
  let g = x.createLinearGradient(0, 0, 0, hz);
  g.addColorStop(0, '#111B38'); g.addColorStop(.42, '#4C3768'); g.addColorStop(.76, '#E2694F'); g.addColorStop(1, '#FFB07A');
  x.fillStyle = g; x.fillRect(0, 0, W, hz + 1);
  x.fillStyle = 'rgba(255,255,255,.7)';
  for (let i = 0; i < 26; i++) { const sx = ((i * 97.3) % 100) / 100 * W, sy = ((i * 41.7) % 100) / 100 * hz * .38; x.globalAlpha = (.35 + .65 * Math.abs(Math.sin(t * .8 + i))) * .7; circle(x, sx, sy, u * (i % 3 ? .7 : 1.1)); }
  x.globalAlpha = 1;
  const sX = W * (o.sunX || .3), sR = Math.min(W, H) * .09, sY = hz - sR * .45;
  const rg = x.createRadialGradient(sX, sY, sR * .3, sX, sY, sR * 5);
  rg.addColorStop(0, 'rgba(255,214,160,.6)'); rg.addColorStop(1, 'rgba(255,160,110,0)');
  x.fillStyle = rg; x.fillRect(0, 0, W, hz);
  x.save(); x.beginPath(); x.rect(0, 0, W, hz); x.clip(); x.fillStyle = '#FFE6BF'; circle(x, sX, sY, sR); x.restore();
  x.fillStyle = 'rgba(62,36,66,.75)'; x.beginPath(); x.moveTo(0, hz);
  for (let i = 0; i <= 20; i++) { const px = i / 20 * W * .62; x.lineTo(px, hz - (Math.sin(i * .9) * .5 + .8) * H * .022 - (i < 6 ? H * .012 : 0)); }
  x.lineTo(W * .62, hz); x.closePath(); x.fill();
  g = x.createLinearGradient(0, hz, 0, H); g.addColorStop(0, '#41608A'); g.addColorStop(.3, '#1E3658'); g.addColorStop(1, '#091526');
  x.fillStyle = g; x.fillRect(0, hz, W, H - hz);
  const rw = Math.min(W * .66, H * .75), rh = rw * .6, x0 = W - rw * .98;
  x.save(); x.globalAlpha = .35; x.fillStyle = '#0B0A16'; rockPath(x, x0, hz, rw, rh * .55, -1); x.fill('evenodd'); x.restore();
  for (let i = 0; i < 40; i++) {
    const p = i / 40, y = hz + (H - hz) * Math.pow(p, 1.5);
    const w = (W * .02 + W * .2 * p) * (.45 + .55 * Math.abs(Math.sin(t * 1.1 + i * 1.7)));
    const cx = sX + Math.sin(t * .7 + i * 2.3) * W * .012 * (1 + p * 3);
    x.fillStyle = `rgba(255,${(205 - p * 70) | 0},${(160 - p * 70) | 0},${.6 * (1 - p)})`;
    x.fillRect(cx - w / 2, y, w, Math.max(1, u * (.8 + p * 2)));
  }
  x.strokeStyle = 'rgba(180,210,240,.12)'; x.lineWidth = u;
  for (let k = 0; k < 9; k++) {
    const p = ((k + (t * .05) % 1) / 9), y = hz + (H - hz) * Math.pow(p, 1.4);
    x.beginPath(); for (let px = 0; px <= W; px += W / 24) { const yy = y + Math.sin(px / W * 12 + t + k) * u * (1 + p * 3); px ? x.lineTo(px, yy) : x.moveTo(px, yy); } x.stroke();
  }
  g = x.createLinearGradient(x0, hz - rh, x0 + rw * .4, hz); g.addColorStop(0, '#4A2C3A'); g.addColorStop(1, '#170F1D');
  x.fillStyle = g; rockPath(x, x0, hz, rw, rh, 1); x.fill('evenodd');
  x.strokeStyle = 'rgba(255,170,120,.35)'; x.lineWidth = u * 1.1; x.stroke();
  x.strokeStyle = 'rgba(255,255,255,.25)'; x.lineWidth = u * 1.2; x.beginPath(); x.moveTo(x0 - rw * .14, hz + u); x.lineTo(W, hz + u); x.stroke();
  x.strokeStyle = 'rgba(20,16,30,.75)'; x.lineWidth = u * 1.3; x.lineCap = 'round';
  for (let b = 0; b < 2; b++) {
    const bx = ((t * 8 * (b ? .8 : 1) + b * 140) % (W / u + 80)) * u - 40 * u, by = hz * (.42 + b * .08) + Math.sin(t * 2 + b) * 4 * u, s = u * (6 + b * 2), f = Math.sin(t * 6 + b) * .5;
    x.beginPath(); x.moveTo(bx - s, by - s * (.4 + f)); x.quadraticCurveTo(bx - s * .4, by - s * .1, bx, by); x.quadraticCurveTo(bx + s * .4, by - s * .1, bx + s, by - s * (.4 + f)); x.stroke();
  }
  x.lineCap = 'butt';
}

/* ---------- Figurines ---------- */
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
function shade(hex, amt) { const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = n >> 8 & 255, b = n & 255; const T = amt < 0 ? 0 : 255, p = Math.abs(amt); r = Math.round((T - r) * p + r); g = Math.round((T - g) * p + g); b = Math.round((T - b) * p + b); return `rgb(${r},${g},${b})`; }
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
function toyHead(img) {
  const iw = img.naturalWidth, ih = img.naturalHeight, s = Math.min(iw, ih) * .92;
  const sx = (iw - s) / 2, sy = Math.max(0, Math.min(ih - s, (ih - s) * .3));
  const N = 400, A = mk(N, N), a = A.getContext('2d'); a.imageSmoothingQuality = 'high'; a.drawImage(img, sx, sy, s, s, 0, 0, N, N);
  const B = mk(80, 80), b = B.getContext('2d'); b.imageSmoothingQuality = 'high'; b.drawImage(A, 0, 0, 80, 80);
  const C = mk(N, N), c = C.getContext('2d'); c.imageSmoothingQuality = 'high'; c.drawImage(B, 0, 0, N, N);
  const da = a.getImageData(0, 0, N, N), dc = c.getImageData(0, 0, N, N), p = da.data, q = dc.data;
  const st = 255 / 15, cl = v => v < 0 ? 0 : v > 255 ? 255 : v;
  let ar = 0, ag = 0, ab = 0, an = 0;
  for (let i = 0; i < p.length; i += 4) {
    let r = p[i] * .45 + q[i] * .55, g = p[i + 1] * .45 + q[i + 1] * .55, bl = p[i + 2] * .45 + q[i + 2] * .55;
    const l = .299 * r + .587 * g + .114 * bl;
    r = l + (r - l) * 1.28; g = l + (g - l) * 1.28; bl = l + (bl - l) * 1.28;
    r = (r - 128) * 1.08 + 136; g = (g - 128) * 1.08 + 131; bl = (bl - 128) * 1.08 + 124;
    p[i] = Math.round(cl(r) / st) * st; p[i + 1] = Math.round(cl(g) / st) * st; p[i + 2] = Math.round(cl(bl) / st) * st;
    const px = (i / 4) % N, py = Math.floor(i / 4 / N);
    if (px > N * .35 && px < N * .65 && py > N * .45 && py < N * .7) { ar += p[i]; ag += p[i + 1]; ab += p[i + 2]; an++; }
  }
  a.putImageData(da, 0, 0);
  const hx = n => n.toString(16).padStart(2, '0');
  A.skin = an ? '#' + hx(Math.round(ar / an)) + hx(Math.round(ag / an)) + hx(Math.round(ab / an)) : '#E2B48E';
  return A;
}
// The collectible box. With aiImg the AI figurine photo fills the window; otherwise a toy figure is drawn.
function renderFig(head, m, idx, aiImg) {
  const W = 720, H = 960, c = mk(W, H), x = c.getContext('2d'), col = PAL[idx % PAL.length];
  let g = x.createLinearGradient(0, 0, W * .4, H); g.addColorStop(0, shade(col, .12)); g.addColorStop(1, shade(col, -.38));
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.save(); x.globalAlpha = .07; x.strokeStyle = '#fff'; x.lineWidth = 18;
  for (let k = -H; k < W; k += 64) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k + H, H); x.stroke(); } x.restore();
  x.fillStyle = 'rgba(255,255,255,.96)'; x.font = `800 50px ${DISPLAY}`; x.fillText('CABO CREW', 56, 92);
  x.font = `500 22px ${MONO}`; x.textAlign = 'right'; x.fillStyle = 'rgba(255,255,255,.8)'; x.fillText('SERIES ’26 · NO. ' + String(idx + 1).padStart(2, '0'), W - 56, 88); x.textAlign = 'left';
  const wx = 44, wy = 124, ww = W - 88, wh = 650;
  x.save(); rr(x, wx, wy, ww, wh, 40); x.clip();
  if (aiImg) {
    const s = Math.max(ww / aiImg.naturalWidth, wh / aiImg.naturalHeight), dw = aiImg.naturalWidth * s, dh = aiImg.naturalHeight * s;
    x.imageSmoothingQuality = 'high'; x.drawImage(aiImg, wx + (ww - dw) / 2, wy + (wh - dh) / 2, dw, dh);
  } else {
    g = x.createRadialGradient(W / 2, 380, 40, W / 2, 420, 520); g.addColorStop(0, 'rgba(255,255,255,.97)'); g.addColorStop(1, shade(col, .72));
    x.fillStyle = g; x.fillRect(wx, wy, ww, wh);
    x.fillStyle = shade(col, .55); x.fillRect(wx, 700, ww, wh);
    g = x.createRadialGradient(W / 2, 726, 10, W / 2, 726, 230); g.addColorStop(0, 'rgba(0,0,0,.28)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.beginPath(); x.ellipse(W / 2, 728, 240, 44, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#1C232B'; x.beginPath(); x.ellipse(W / 2, 718, 160, 34, 0, 0, Math.PI); x.fill(); x.fillRect(W / 2 - 160, 690, 320, 28);
    x.fillStyle = '#2C3640'; x.beginPath(); x.ellipse(W / 2, 690, 160, 34, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(255,255,255,.18)'; x.lineWidth = 3; x.beginPath(); x.ellipse(W / 2, 690, 156, 31, 0, Math.PI * 1.05, Math.PI * 1.6); x.stroke();
    const skin = head ? head.skin : shade(col, .6);
    x.fillStyle = '#26303A'; rr(x, W / 2 - 62, 590, 54, 110, 26); x.fill(); rr(x, W / 2 + 8, 590, 54, 110, 26); x.fill();
    x.fillStyle = '#F4F6F8'; rr(x, W / 2 - 68, 676, 64, 24, 12); x.fill(); rr(x, W / 2 + 4, 676, 64, 24, 12); x.fill();
    x.lineCap = 'round'; x.strokeStyle = shade(col, -.12); x.lineWidth = 46;
    x.beginPath(); x.moveTo(W / 2 - 92, 506); x.lineTo(W / 2 - 128, 600); x.stroke();
    x.beginPath(); x.moveTo(W / 2 + 92, 506); x.lineTo(W / 2 + 128, 600); x.stroke();
    x.fillStyle = skin; circle(x, W / 2 - 130, 612, 25); circle(x, W / 2 + 130, 612, 25);
    g = x.createLinearGradient(W / 2 - 100, 0, W / 2 + 100, 0); g.addColorStop(0, shade(col, .18)); g.addColorStop(.55, col); g.addColorStop(1, shade(col, -.25));
    x.fillStyle = g; rr(x, W / 2 - 104, 462, 208, 160, 62); x.fill();
    x.fillStyle = 'rgba(255,255,255,.9)'; x.font = `800 30px ${DISPLAY}`; x.textAlign = 'center'; x.fillText('CABO', W / 2, 560); x.textAlign = 'left';
    x.fillStyle = 'rgba(0,0,0,.18)'; x.beginPath(); x.ellipse(W / 2, 472, 70, 18, 0, 0, Math.PI * 2); x.fill();
    const hx = W / 2, hy = 322, hr = 156;
    x.fillStyle = 'rgba(0,0,0,.18)'; circle(x, hx + 8, hy + 12, hr);
    x.save(); x.beginPath(); x.arc(hx, hy, hr, 0, Math.PI * 2); x.clip();
    if (head) x.drawImage(head, hx - hr, hy - hr, hr * 2, hr * 2);
    else {
      g = x.createLinearGradient(0, hy - hr, 0, hy + hr); g.addColorStop(0, shade(col, .7)); g.addColorStop(1, shade(col, .45)); x.fillStyle = g; x.fillRect(hx - hr, hy - hr, hr * 2, hr * 2);
      const ini = (m.name || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
      x.fillStyle = shade(col, -.35); x.font = `800 120px ${DISPLAY}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(ini, hx, hy + 8); x.textAlign = 'left'; x.textBaseline = 'alphabetic';
    }
    g = x.createRadialGradient(hx, hy, hr * .62, hx, hy, hr); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(10,10,20,.32)');
    x.fillStyle = g; x.fillRect(hx - hr, hy - hr, hr * 2, hr * 2);
    g = x.createRadialGradient(hx - 60, hy - 70, 0, hx - 60, hy - 70, hr * 1.1); g.addColorStop(0, 'rgba(255,255,255,.32)'); g.addColorStop(.5, 'rgba(255,255,255,.06)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(hx - hr, hy - hr, hr * 2, hr * 2);
    x.restore();
    x.save(); x.translate(hx - 62, hy - 88); x.rotate(-.6); x.fillStyle = 'rgba(255,255,255,.55)'; x.beginPath(); x.ellipse(0, 0, 40, 20, 0, 0, Math.PI * 2); x.fill(); x.restore();
    x.fillStyle = 'rgba(255,255,255,.8)'; circle(x, hx - 20, hy - 120, 7);
  }
  x.globalAlpha = aiImg ? .1 : .16; x.fillStyle = '#fff';
  x.beginPath(); x.moveTo(wx + 380, wy); x.lineTo(wx + 470, wy); x.lineTo(wx + 140, wy + wh); x.lineTo(wx + 50, wy + wh); x.closePath(); x.fill();
  x.globalAlpha = aiImg ? .06 : .1; x.beginPath(); x.moveTo(wx + 500, wy); x.lineTo(wx + 530, wy); x.lineTo(wx + 200, wy + wh); x.lineTo(wx + 170, wy + wh); x.closePath(); x.fill();
  x.globalAlpha = 1; x.restore();
  x.save(); rr(x, wx, wy, ww, wh, 40); x.strokeStyle = 'rgba(255,255,255,.75)'; x.lineWidth = 6; x.stroke(); x.restore();
  x.fillStyle = '#FFFFFF'; rr(x, wx, 800, ww, 116, 30); x.fill();
  x.fillStyle = '#0E1317'; let fs = 52; x.font = `800 ${fs}px ${DISPLAY}`;
  const nm = m.name || 'Mystery'; while (x.measureText(nm).width > 420 && fs > 28) { fs -= 2; x.font = `800 ${fs}px ${DISPLAY}`; }
  x.fillText(nm, wx + 30, 866);
  x.font = `500 20px ${MONO}`; x.fillStyle = '#6A747C'; x.fillText('CABO SAN LUCAS · DEC 24–28', wx + 30, 898);
  x.fillStyle = shade(col, -.2); rr(x, wx + ww - 150, 828, 120, 60, 30); x.fill();
  x.fillStyle = '#fff'; x.font = `600 22px ${MONO}`; x.textAlign = 'center'; x.fillText(grpLabel(m).toUpperCase(), wx + ww - 90, 866); x.textAlign = 'left';
  return c;
}
const canvasBlob = (c, q = .9) => new Promise(r => c.toBlob(r, 'image/jpeg', q));
async function scaledJpeg(img, max, q, limit) {
  for (const k of [1, .85, .7]) {
    const s = Math.min(1, max * k / Math.max(img.naturalWidth, img.naturalHeight));
    const c = mk(Math.round(img.naturalWidth * s), Math.round(img.naturalHeight * s));
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, c.width, c.height);
    const b = await canvasBlob(c, q * (k === 1 ? 1 : .92)); if (b && b.size <= limit) return b;
  }
  return null;
}
const putMedia = async (m, kind, blob) => { if (blob) await api(`members/${encodeURIComponent(m.id)}/media/${kind}`, { method: 'PUT', body: blob, headers: { 'content-type': 'image/jpeg' } }); };
async function selfieBlob(img) {
  for (const [max, q] of [[1024, .86], [900, .78], [720, .72]]) {
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = mk(Math.round(img.naturalWidth * s), Math.round(img.naturalHeight * s));
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, c.width, c.height);
    const b = await canvasBlob(c, q); if (b && b.size < 680 * 1024) return b;
  }
  throw new Error('That photo is too big. Try another.');
}
let fontsReady = null;
function fonts() {
  if (!fontsReady) fontsReady = Promise.race([
    Promise.all([document.fonts.load(`800 50px ${DISPLAY}`), document.fonts.load(`500 22px ${MONO}`), document.fonts.load(`400 20px ${BODY}`)]).catch(() => {}),
    sleep(2500)
  ]);
  return fontsReady;
}

/* ---------- Navigation ---------- */
function go(name) {
  $$('.screen').forEach(s => s.classList.toggle('on', s.id === 's-' + name));
  S.screen = name; save();
  if (name !== 'welcome') stopVideo();
  if (name === 'family') renderFamilyForm();
  if (name === 'welcome') renderWelcome();
  if (name === 'booth') { renderBooth(); refreshAI(); }
  if (name === 'app') { renderAll(); setTab(S.tab, true); loadPlan().then(rerenderPlan); if (shared()) pollChat().then(() => { if (S.tab === 'chat') { renderChat(); icons(); } }); }
}
function setTab(t, force) {
  const tabs = ['today', 'plan', 'resorts', 'chat', 'crew'], i = tabs.indexOf(t);
  if (S.tab === t && !force) { $('#p-' + t).scrollTo({ top: 0, behavior: RM ? 'auto' : 'smooth' }); return; }
  S.tab = t; save();
  $$('.pane').forEach(p => p.classList.toggle('on', p.id === 'p-' + t));
  $$('.tab').forEach(b => { b.classList.toggle('on', b.dataset.tab === t); b.setAttribute('aria-current', b.dataset.tab === t ? 'page' : 'false'); });
  $('#tabInd').style.transform = `translateX(${i * 100}%)`;
  if (t === 'resorts') initModel();
  if (t === 'chat') { renderChat(); icons(); reloadChat(); }
  scheduleChat(); updateBadge();
}

/* ---------- Family form ---------- */
let draft = [];
const uid = () => 'n' + Math.random().toString(36).slice(2, 9);
function renderFamilyForm() {
  const f = S.family && !S.family.example ? S.family : null;
  $('#famName').value = f ? f.name : '';
  draft = f ? f.members.map(m => ({ id: m.id, name: m.name, grp: grpOf(m) })) : [{ id: uid(), name: '', grp: 'adult' }, { id: uid(), name: '', grp: 'adult' }];
  drawRows(); $('#famErr').textContent = '';
}
function drawRows() {
  $('#mrows').innerHTML = draft.map((m, i) => `
    <div class="mrow" data-i="${i}">
      <span class="num">${String(i + 1).padStart(2, '0')}</span>
      <input id="mn-${m.id}" data-k="name" value="${esc(m.name)}" placeholder="First name" autocomplete="off" maxlength="18" aria-label="Name of person ${i + 1}">
      <button data-rm="${i}" aria-label="Remove person ${i + 1}"><i data-lucide="x"></i></button>
      <div class="grp" role="radiogroup" aria-label="Adult, teen or kid for person ${i + 1}">${Object.keys(GRP).map(g => `<button type="button" class="${m.grp === g ? 'on' : ''}" data-grp="${g}" data-i="${i}" role="radio" aria-checked="${m.grp === g}">${GRP[g]}</button>`).join('')}</div>
    </div>`).join('');
  icons();
}
const cleanName = v => v.trim().replace(/^the\s+/i, '').replace(/\s+family$/i, '').replace(/\s+/g, ' ');
async function submitFamily() {
  const name0 = cleanName($('#famName').value), err = $('#famErr'), btn = $('#famNext');
  if (!name0) { err.textContent = 'Add your family name to continue.'; $('#famName').focus(); return; }
  const name = name0.charAt(0).toUpperCase() + name0.slice(1);
  const rows = draft.filter(m => String(m.name).trim());
  if (!rows.length) { err.textContent = 'Add at least one person.'; return; }
  const members = rows.map(m => ({ id: m.id, name: String(m.name).trim(), grp: m.grp || 'adult' }));
  if (API.mode === 'server') {
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      if (S.myId && S.token) await api(`families/${S.myId}`, { method: 'PUT', json: { name, members } });
      else { const d = await api('families', { method: 'POST', json: { name, members } }); S.myId = d.family.id; S.token = d.token; }
      S.family = null; await refresh(); recordVisit();
    } catch (e) { err.textContent = e.message; return; }
    finally { btn.disabled = false; btn.textContent = 'Continue'; }
  } else {
    const old = S.family && !S.family.example ? S.family.members : [];
    S.family = { name, members: members.map(m => { const p = old.find(o => o.id === m.id); return Object.assign({}, m, { fig: p && p.name === m.name ? p.fig : null }); }) };
  }
  save(); go('welcome');
}

/* ---------- Welcome ---------- */
function renderWelcome() {
  const f = S.family; if (!f) return;
  $('#welH').textContent = `Welcome, the ${f.name} family`;
  const n = f.members.length;
  $('#welMsg').textContent = `You're one of five families spending Dec 24 to 28 at Riu Palace Cabo San Lucas. Everything the ${n === 1 ? 'trip needs' : n + ' of you need'} is in here: what each person can use at both resorts, what's happening each day, and the few rules worth knowing. Start with RIU's official video of the resort.`;
  $('#welKnow').innerHTML = KNOW; icons();
}
function playVideo() {
  S.watched = true; save();
  const v = $('#video');
  if (API.mode === 'local') { window.open(`https://www.youtube.com/watch?v=${VIDEO_ID}`, '_blank', 'noopener'); return; }
  v.classList.add('live');
  v.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&rel=0&playsinline=1&modestbranding=1" title="Riu Palace Cabo San Lucas, official video by RIU Hotels & Resorts" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
}
function stopVideo() {
  const v = $('#video'); if (!v || !v.classList.contains('live')) return;
  v.classList.remove('live');
  v.innerHTML = `<img id="vthumb" alt="Riu Palace Cabo San Lucas, from RIU's official video" src="https://i.ytimg.com/vi/${VIDEO_ID}/maxresdefault.jpg" referrerpolicy="no-referrer"><button class="video-play" id="vplay" aria-label="Play RIU's official video of the resort"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z"/></svg></button><span class="vtag"><b></b>Official video · RIU Hotels &amp; Resorts</span>`;
  wireThumb();
}
function wireThumb() {
  const im = $('#vthumb'); if (!im) return;
  im.onerror = () => { if (!im.dataset.fb) { im.dataset.fb = 1; im.src = `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`; } else im.remove(); };
}

/* ---------- Booth ---------- */
async function refreshAI() {
  if (API.mode !== 'server') return;
  try { const r = await fetch('/api/ping', { headers: hdrs() }); const d = await r.json(); API.owner = !!d.owner; if (API.ai !== !!d.ai) { API.ai = !!d.ai; if (S.screen === 'booth') renderBooth(); } } catch (e) {}
}
let shootId = null;
const JUST = new Set();
function lookChips(m) {
  if (!(API.mode === 'server' && API.ai && !isExample())) return '';
  const L = grpOf(m) === 'kid' ? ['Girl', 'Boy'] : ['Woman', 'Man'], cur = (S.looks || {})[m.id] || 'auto';
  return `<div class="look" role="radiogroup" aria-label="Figurine for ${esc(m.name)}">${[['auto', 'Auto'], ['f', L[0]], ['m', L[1]]].map(([k, t]) => `<button class="${cur === k ? 'on' : ''}" data-look="${k}" data-lm="${m.id}" role="radio" aria-checked="${cur === k}">${t}</button>`).join('')}</div>`;
}
function shootBtns(m, real, big) {
  return `<div class="shoot2"><label class="btn ${real ? 'btn-ghost' : 'btn-primary'}${big ? '' : ' btn-sm'}" for="camIn" data-shoot="${m.id}" role="button" tabindex="0"><i data-lucide="camera"></i>${real ? 'Retake' : 'Take photo'}</label><label class="btn btn-ghost${big ? '' : ' btn-sm'} pick" for="picIn" data-shoot="${m.id}" role="button" tabindex="0" aria-label="Choose a photo of ${esc(m.name)} from the gallery"><i data-lucide="image"></i></label></div>`;
}
function renderBooth() {
  const f = S.family; if (!f) return;
  $('#booth').innerHTML = f.members.map((m, i) => {
    const real = isReal(m);
    return `<div class="bcard" id="bc-${m.id}">
      <div class="fig${JUST.has(m.id) ? ' reveal' : ''}">${real ? `<img src="${figSrc(m, i)}" alt="${esc(m.name)} as a figurine">${m.fig_kind === 'ai' ? '<span class="ai-badge">AI</span>' : ''}` : `<div class="empty"><i data-lucide="scan-face"></i><span>No photo yet</span></div>`}</div>
      <div class="bname"><strong>${esc(m.name)}</strong><small>${grpLabel(m)}</small></div>
      ${lookChips(m)}${shootBtns(m, real)}
    </div>`;
  }).join('');
  JUST.clear();
  $('#boothNote span').textContent = API.mode !== 'server' || f.example ? 'In this preview the figurine is made on your phone.'
    : API.ai ? 'AI figurines are on. Gemini sculpts each one from the photo in about 30 seconds. The trip organizer keeps a copy of each photo and figurine for the trip album.'
    : 'AI figurines are off right now, so figurines are made on the phone. The trip organizer keeps a copy of each photo and figurine for the trip album.';
  icons();
}
async function shoot(file) {
  const f = S.family, m = f && f.members.find(x => x.id === shootId); if (!m || !file) return;
  const idx = f.members.indexOf(m), useServer = API.mode === 'server' && !f.example;
  const slot = $('#bc-' + m.id + ' .fig');
  const setLabel = t => { if (slot) { const l = slot.querySelector('.label'); if (l) l.textContent = t; } };
  if (slot) { slot.classList.add('sculpt'); slot.innerHTML = '<span class="label">Sculpting…</span>'; }
  const t0 = performance.now();
  let aiErr = null;
  try {
    const url = URL.createObjectURL(file); const img = await loadImg(url); await fonts();
    let canvas = null, kind = 'phone';
    const keep = [];
    if (useServer) keep.push(scaledJpeg(img, 1600, .88, 1700 * 1024).then(b => putMedia(m, 'photo', b)));
    if (useServer && API.ai) {
      setLabel('Sculpting with AI · about 30 s');
      try {
        const body = await selfieBlob(img);
        const r = await fetch(`/api/members/${encodeURIComponent(m.id)}/ai`, { method: 'POST', body, headers: hdrs({ 'content-type': 'image/jpeg', 'x-look': (S.looks || {})[m.id] || 'auto' }) });
        if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.message || 'The figurine maker is busy.'); }
        const ai = await loadImg(URL.createObjectURL(await r.blob()));
        canvas = renderFig(null, m, idx, ai); kind = 'ai';
        keep.push(scaledJpeg(ai, 2048, .92, 1700 * 1024).then(b => putMedia(m, 'raw', b)));
      } catch (e) { aiErr = e.message; }
    }
    if (!canvas) canvas = renderFig(toyHead(img), m, idx);
    URL.revokeObjectURL(url);
    await sleep(Math.max(0, 1400 - (performance.now() - t0)));
    if (useServer) {
      setLabel('Saving…');
      const blob = await canvasBlob(canvas, .9);
      await api(`members/${encodeURIComponent(m.id)}/fig`, { method: 'PUT', body: blob, headers: { 'content-type': 'image/jpeg', 'x-fig-kind': kind } });
      await Promise.allSettled(keep);
      await refresh();
    } else m.fig = canvas.toDataURL('image/jpeg', .9);
    JUST.add(m.id); save();
    if (S.screen === 'booth') renderBooth(); else { renderAll(); openFig(m.id); }
    toast(aiErr ? `Made on the phone: ${aiErr}` : `${m.name} is now a figurine`);
  } catch (e) {
    renderBooth(); toast(e.message && e.message.length < 80 ? e.message : "That photo didn't work. Try another.");
  }
}

/* ---------- App panes ---------- */
function tripState() {
  const START = Date.UTC(2026, 11, 24, 22, 0), now = Date.now(), cabo = new Date(now - 7 * 3600e3);
  if (cabo.getUTCFullYear() === 2026 && cabo.getUTCMonth() === 11 && cabo.getUTCDate() >= 24 && cabo.getUTCDate() <= 28) return { phase: 'during', day: cabo.getUTCDate() - 24 };
  if (now < START) return { phase: 'before', days: Math.max(1, Math.ceil((START - now) / 864e5)) };
  return { phase: 'after' };
}
const avStyle = (m, i) => `background-image:url('${figSrc(m, i)}')`;
function renderAll() { if (!S.family) return; renderTop(); renderToday(); renderPlan(); renderResorts(); renderCrew(); if (S.tab === 'chat') renderChat(); icons(); }
function renderTop() {
  const f = S.family;
  $('#avsBtn').innerHTML = f.members.slice(0, 4).map((m, i) => `<span class="av" style="${avStyle(m, i)}"></span>`).join('') + `<span class="fam">${esc(f.name)}</span>`;
}
function miniFig(m, i) { return `<button class="mini" data-fig="${m.id}"><div class="fig"><img src="${figSrc(m, i)}" alt="${esc(m.name)}" loading="lazy"></div><strong>${esc(m.name)}</strong><small>${grpLabel(m)}</small></button>`; }
function renderToday() {
  const f = S.family, st = tripState(), el = $('#p-today');
  const done = f.members.filter(isReal).length, n = f.members.length;
  let heroIn;
  if (st.phase === 'before') heroIn = `<p class="mono eyebrow">Riu Palace Cabo San Lucas</p><div class="count"><span class="n">${st.days}</span><span class="u">${st.days === 1 ? 'day' : 'days'}<br>to Cabo</span></div>`;
  else if (st.phase === 'during') heroIn = `<p class="mono eyebrow">Day ${st.day + 1} of 5</p><div class="day-big">${esc(DAYS[st.day].title)}</div>`;
  else heroIn = `<p class="mono eyebrow">That's a wrap</p><div class="day-big">Hasta pronto, Cabo</div>`;
  const checks = [
    { id: 'film', auto: S.watched, t: 'Watch the resort video', s: "RIU's official video of Palace Cabo", go: S.watched ? '' : 'Watch', act: 'video' },
    { id: 'photos', auto: done === n, t: `Photos: ${done} of ${n}`, s: 'One selfie per person for the figurines', go: done === n ? '' : 'Open booth', act: 'booth' },
    { id: 'passports', t: "Check everyone's passport", s: 'Valid for the whole trip' },
    { id: 'dress', t: 'Pack long pants', s: 'Appropriate attire is required at dinner' },
    { id: 'swim', t: 'Swimwear and water shoes', s: 'For Splash Water World and the beach' }
  ];
  const joined = API.mode === 'server' ? FAM.length : 1;
  const ex = f.example ? `<div class="banner"><i data-lucide="eye"></i><span>You're previewing an example family.</span><button data-act="setup">Set up yours</button></div>` : '';
  el.innerHTML = `${ex}
    <div class="hero-card"><canvas id="todayCanvas" aria-hidden="true"></canvas><div class="hero-in">${heroIn}</div></div>
    <div class="ticket">
      <div><p class="mono k">Check-in</p><div class="v">Thu, Dec 24</div><div class="s">From 3:00 PM</div></div>
      <div><p class="mono k">Check-out</p><div class="v">Mon, Dec 28</div><div class="s">By 11:00 AM</div></div>
    </div>
    ${st.phase === 'during' ? `<div class="sec-h"><h3>Today's plan</h3><button data-tab-go="plan">Full plan <i data-lucide="chevron-right"></i></button></div>${timelineHTML(dayItems(st.day))}` : ''}
    <div class="sec-h"><h3>The ${esc(f.name)} family</h3><button data-tab-go="crew">${API.mode === 'server' && !f.example ? `${joined} of 5 joined` : 'Crew'} <i data-lucide="chevron-right"></i></button></div>
    <div class="strip">${f.members.map(miniFig).join('')}</div>
    ${shared() ? `<div class="sec-h"><h3>Crew chat</h3><button data-tab-go="chat">Open <i data-lucide="chevron-right"></i></button></div><div class="card" id="todayChat"></div>` : ''}
    ${st.phase === 'before' ? `<div class="sec-h"><h3>Before you fly</h3></div>
    <div class="card"><div class="list">${checks.map(c => {
      const on = c.auto !== undefined ? c.auto : !!S.checks[c.id];
      return `<div class="li">${c.auto !== undefined ? `<span class="check${on ? ' done' : ''}"><i data-lucide="check"></i></span>` : `<button class="check${on ? ' done' : ''}" data-check="${c.id}" aria-pressed="${on}" aria-label="${esc(c.t)}"><i data-lucide="check"></i></button>`}
        <div class="tx"><strong>${esc(c.t)}</strong><span>${esc(c.s)}</span></div>${c.go ? `<button class="go" data-act="${c.act}">${c.go}</button>` : ''}</div>`;
    }).join('')}</div></div>` : ''}
    <div class="sec-h"><h3>Good to know</h3></div>
    <div class="know">${KNOW}</div>
    ${st.phase === 'before' ? `<div class="sec-h"><h3>Day 1 at a glance</h3><button data-tab-go="plan">Full plan <i data-lucide="chevron-right"></i></button></div>${timelineHTML(dayItems(0).slice(0, 3))}` : ''}`;
  reg($('#todayCanvas'), (x, W, H, t) => drawDusk(x, W, H, t, { hz: .66, sunX: .3 }));
  renderTodayChat();
}
function whoChips() {
  const sel = S.who;
  return `<button class="wchip${sel === 'all' ? ' on' : ''}" data-who="all"><span class="all"><i data-lucide="users"></i></span>Everyone</button>` +
    allPeople().map(p => `<button class="wchip${sel === p.m.id ? ' on' : ''}" data-who="${p.m.id}"><span class="av" style="${avStyle(p.m, p.i)}"></span>${esc(p.m.name)}</button>`).join('');
}
function renderResorts() {
  const R = RESORTS[S.resort], person = S.who !== 'all' ? findPerson(S.who) : null, m = person ? person.m : null;
  if (!m) S.who = 'all';
  $('#rSeg').innerHTML = `<div class="seg" role="tablist"><span class="ind" style="transform:translateX(${S.resort === 'palace' ? 0 : 100}%)"></span>
      <button class="${S.resort === 'palace' ? 'on' : ''}" data-resort="palace" role="tab" aria-selected="${S.resort === 'palace'}">Palace Cabo</button>
      <button class="${S.resort === 'santafe' ? 'on' : ''}" data-resort="santafe" role="tab" aria-selected="${S.resort === 'santafe'}">Santa Fe</button></div>`;
  let ok = 0;
  const groups = CATS.map(c => {
    const items = R.items.filter(it => it.c === c); if (!items.length) return '';
    return `<div class="rgroup"><h4>${c}</h4><div class="card"><div class="list">${items.map(it => {
      let badge = '';
      if (m) { const a = access(it.r, m); if (a.s !== 'no') ok++; badge = `<span class="chip ${a.s}">${a.s === 'ok' ? '<i data-lucide="check"></i>' : a.s === 'warn' ? '<i data-lucide="ruler"></i>' : '<i data-lucide="lock"></i>'}${a.l}</span>`; }
      else if (it.r) badge = `<span class="chip ${it.r === 'kids' ? '' : it.r === 'slides' ? 'warn' : 'no'}">${RULE_LABEL[it.r]}</span>`;
      else if (it.x) badge = `<span class="chip">${it.x}</span>`;
      return `<div class="li"><span class="tile"><i data-lucide="${it.i}"></i></span><div class="tx"><strong>${esc(it.n)}</strong><span>${esc(it.w)}</span>${it.when ? `<em>${esc(it.when)}</em>` : ''}</div>${badge}</div>`;
    }).join('')}</div></div></div>`;
  }).join('');
  $('#legend').innerHTML = m
    ? `<span><i style="border-color:#157F50"></i>${esc(m.name)} can go</span><span><i style="border-color:#B77900"></i>Check height</span><span><i style="border-color:#8A939B"></i>Not for ${esc(m.name)}</span>`
    : `<span><i style="border-color:#0E1317"></i>Palace Cabo</span><span><i style="border-color:#C2562F"></i>Santa Fe</span><span style="margin-left:auto">Pick a person below to see what they can use</span>`;
  $('#rDyn').innerHTML = `
    <div class="rhead"><p class="mono" style="color:var(--accent)">${R.tag}</p><h2>${esc(R.name)}</h2><p>${esc(R.blurb)}</p></div>
    <div class="who" aria-label="Show what each person can use">${whoChips()}</div>
    ${m ? `<div class="summary"><b>${ok}/${R.items.length}</b><span>spots here are open to ${esc(m.name)}</span></div>` : ''}
    ${groups}
    <p class="note"><i data-lucide="info"></i><span>Based on RIU's published info. Hours and age rules can change, so confirm at the front desk. The 3D model shows roughly where things are, not exact positions.</span></p>`;
  $('#modelWho').innerHTML = whoChips();
  $('#modelTag').innerHTML = m ? `<b>Showing ${esc(m.name)}</b>Green = can go` : `<b>Miniature model</b>Illustrative, not to scale`;
  updatePinStates();
}
function renderCrew() {
  const f = S.family, oth = others(), slots = Math.max(0, 4 - oth.length);
  $('#p-crew').innerHTML = `
    <div class="sec-h" style="margin-top:2px"><h3>The ${esc(f.name)} family</h3><button data-act="${f.example ? 'setup' : 'edit'}"><i data-lucide="pencil"></i> ${f.example ? 'Set up yours' : 'Edit'}</button></div>
    <div class="crew-grid">${f.members.map((m, i) => `<button data-fig="${m.id}"><div class="fig"><img src="${figSrc(m, i)}" alt="${esc(m.name)} as a figurine" loading="lazy">${m.fig_kind === 'ai' ? '<span class="ai-badge">AI</span>' : ''}</div><strong>${esc(m.name)}</strong><small>${grpLabel(m)}</small></button>`).join('')}</div>
    <div class="sec-h"><h3>The other families</h3>${API.mode === 'server' && !f.example ? `<span class="mono" style="color:var(--ink-2)">${oth.length} of 4 joined</span>` : ''}</div>
    ${oth.map(o => `<div class="card ofam"><div class="ofam-h"><strong>The ${esc(o.name)} family</strong><small>${o.members.length} ${o.members.length === 1 ? 'person' : 'people'}${API.owner ? ` · <button class="linkish" data-act="fam-rm" data-id="${esc(o.id)}" data-name="${esc(o.name)}">Remove</button>` : ''}</small></div><div class="strip">${o.members.map(miniFig).join('')}</div></div>`).join('')}
    ${slots ? `<div class="card"><div class="list">${Array.from({ length: slots }, (_, k) => `<div class="slot"><span class="ph">${String(oth.length + k + 2).padStart(2, '0')}</span><div><strong>Family ${oth.length + k + 2}</strong><span>Hasn't joined yet</span></div></div>`).join('')}</div></div>` : ''}
    ${API.owner && !f.example ? `<button class="card album-entry" data-act="album"><span class="tile"><i data-lucide="images"></i></span><span class="tx"><strong>Trip album</strong><span>Every figurine and original photo. Only you can see this.</span></span><i data-lucide="chevron-right"></i></button>` : ''}
    <button class="btn btn-primary" data-act="invite"><i data-lucide="link"></i> Copy invite link</button>
    <p class="note"><i data-lucide="info"></i><span>${API.mode === 'server' && !f.example ? 'Send the invite link to the other families. Each family sets itself up on its own phone.' : 'In this preview, sign-ups stay on this phone.'}</span></p>
    <button class="textlink" data-act="reset">${API.mode === 'server' && !f.example ? 'Remove our family from the trip' : 'Start over'}</button>`;
}

/* ---------- Sheet + toast ---------- */
function openSheet(html) { $('#sheet').innerHTML = '<div class="grab"></div>' + html; icons(); $('#scrim').classList.add('on'); $('#sheet').classList.add('on'); }
function closeSheet() { $('#scrim').classList.remove('on'); $('#sheet').classList.remove('on', 'tall'); }
function openFig(id) {
  const p = findPerson(id); if (!p) return;
  const m = p.m, real = isReal(m);
  openSheet(`<div class="big-fig"><img src="${figSrc(m, p.i)}" alt="${esc(m.name)} as a figurine"></div><h3>${esc(m.name)}</h3><p>The ${esc(p.fam.name)} family · ${grpLabel(m)}${real ? '' : ' · No photo yet'}</p>
    ${p.mine ? `<div class="row2"><button class="btn btn-ghost" data-act="close">Close</button><div>${lookChips(m)}${shootBtns(m, real, true)}</div></div>` : `<button class="btn btn-ghost" data-act="close">Close</button>`}`);
}
let tt;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 2600); }

/* ---------- Events ---------- */
let downAt = null;
document.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
document.addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) {
    if (e.target.id === 'scrim') closeSheet();
    const card = e.target.closest('.c[data-item]'); if (card && !DRAG) return itemSheet(card.dataset.item);
    const msg = e.target.closest('[data-msg]'); if (msg) return openSheet(`<h3>Remove this message?</h3><p>It disappears from the chat for everyone.</p><div class="row2"><button class="btn btn-ghost" data-act="close">Cancel</button><button class="btn btn-accent" data-act="msg-rm" data-id="${msg.dataset.msg}">Remove</button></div>`);
    if (e.target.closest('#modelStage') && downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 6) clearPin();
    return;
  }
  const d = b.dataset;
  if ($('#sheet').classList.contains('on') && sheetClick(b, d)) return;
  if (d.look) { S.looks = Object.assign({}, S.looks, { [d.lm]: d.look }); save(); b.parentNode.querySelectorAll('button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); }); return; }
  if (d.media) return albumView(d.media);
  if (d.item) return itemSheet(d.item);
  if (d.me) { S.me = d.me; save(); renderChat(); icons(); setTimeout(() => { const i = $('#chatIn'); if (i) i.focus(); }, 50); return; }
  if (d.quick) return sendChat(d.quick);
  if (b.id === 'vplay') return playVideo();
  if (d.go) return go(d.go);
  if (d.tab) return setTab(d.tab);
  if (d.tabGo) return setTab(d.tabGo);
  if (d.pin) return selectPin(d.pin);
  if (d.rm != null) { draft.splice(+d.rm, 1); if (!draft.length) draft.push({ id: uid(), name: '', grp: 'adult' }); return drawRows(); }
  if (d.grp) { draft[+d.i].grp = d.grp; return drawRows(); }
  if (d.fig) return openFig(d.fig);
  if (d.check) { S.checks[d.check] = !S.checks[d.check]; save(); b.classList.toggle('done', S.checks[d.check]); b.setAttribute('aria-pressed', S.checks[d.check]); return; }
  if (d.day != null) { S.planDay = +d.day; save(); renderPlan(); icons(); return; }
  if (d.resort) { S.resort = d.resort; save(); renderResorts(); icons(); flyResort(d.resort); return; }
  if (d.who) { S.who = d.who; save(); renderResorts(); icons(); if (MODEL.sel) selectPin(MODEL.sel, true); return; }
  if (d.act) {
    const a = d.act;
    if (a === 'close') return closeSheet();
    if (a === 'pin-close') return clearPin();
    if (a === 'plan-add') return openAdd(S.planDay || 0);
    if (a === 'album') return openAlbum();
    if (a === 'msg-rm') { closeSheet(); try { await api(`chat/${encodeURIComponent(d.id)}`, { method: 'DELETE' }); CHAT = CHAT.filter(m => String(m.id) !== d.id); drawMessages(false); toast('Message removed'); } catch (err) { toast(err.message); } return; }
    if (a === 'fam-rm') return openSheet(`<h3>Remove the ${esc(d.name)} family?</h3><p>Their people, figurines, photos and sign-up are deleted for everyone. Their plans and messages stay.</p><div class="row2"><button class="btn btn-ghost" data-act="close">Cancel</button><button class="btn btn-accent" data-act="fam-rm-yes" data-id="${esc(d.id)}">Remove</button></div>`);
    if (a === 'fam-rm-yes') { closeSheet(); try { await api(`families/${encodeURIComponent(d.id)}`, { method: 'DELETE' }); await refresh(); renderAll(); toast('Family removed'); } catch (err) { toast(err.message); } return; }
    if (a === 'album-zip') return albumZip(b);
    if (a === 'album-save') return albumSave(d.key);
    if (a === 'album-share') return albumShare(d.key);
    if (a === 'album-back') return openAlbum(true);
    if (a === 'who-chat') { S.me = null; save(); renderChat(); icons(); return; }
    if (a === 'model-full') return toggleFull();
    if (a === 'model-reset') return resetView();
    if (a === 'video') { go('welcome'); setTimeout(playVideo, 500); return; }
    if (a === 'booth') return go('booth');
    if (a === 'setup') { if (S.family && S.family.example) S.family = null; S.watched = false; save(); return go('family'); }
    if (a === 'edit') return go('family');
    if (a === 'invite') {
      const link = API.mode === 'server' ? `${location.origin}/?code=${encodeURIComponent(API.code)}` : location.href.split('#')[0];
      try { await navigator.clipboard.writeText(link); toast('Invite link copied'); } catch (err) { openSheet(`<h3>Invite link</h3><p>Copy this and send it to the other families.</p><input id="inviteLink" readonly value="${esc(link)}" style="height:48px;border:1px solid var(--line);border-radius:14px;padding:0 14px;background:var(--paper)"><button class="btn btn-ghost" data-act="close">Done</button>`); }
      return;
    }
    if (a === 'reset') return openSheet(`<h3>${API.mode === 'server' && !(S.family && S.family.example) ? 'Remove your family?' : 'Start over?'}</h3><p>${API.mode === 'server' && !(S.family && S.family.example) ? 'This removes your family and figurines from the trip for everyone.' : 'This clears your family, photos and checklist on this phone.'}</p><div class="row2"><button class="btn btn-ghost" data-act="close">Cancel</button><button class="btn btn-accent" data-act="reset-yes">${API.mode === 'server' && !(S.family && S.family.example) ? 'Remove' : 'Start over'}</button></div>`);
    if (a === 'reset-yes') {
      closeSheet();
      const gone = S.myId;
      if (API.mode === 'server' && gone && !(S.family && S.family.example)) { try { await api(`families/${gone}`, { method: 'DELETE' }); } catch (err) { toast(err.message); return; } }
      Object.assign(S, DEFAULTS, { checks: {}, famCache: [] }); PLAN = []; CHAT = []; chatLast = 0; chatReady = false; FAM = FAM.filter(f => f.id !== gone); save(); if (API.mode === 'server') refresh().catch(() => {}); return go('intro');
    }
  }
});
$('#scrim').addEventListener('click', closeSheet);
$('#startBtn').addEventListener('click', () => { if (S.family && S.family.example) S.family = null; go('family'); });
$('#demoBtn').addEventListener('click', async () => {
  S.family = { name: 'Rao', example: true, members: [
    { id: uid(), name: 'Priya', grp: 'adult' }, { id: uid(), name: 'Arjun', grp: 'adult' }, { id: uid(), name: 'Meera', grp: 'teen' }, { id: uid(), name: 'Kabir', grp: 'kid' } ] };
  S.watched = false; save(); await fonts(); go('welcome');
});
$('#addMember').addEventListener('click', () => { if (draft.length >= 8) { $('#famErr').textContent = 'Up to 8 people per family.'; return; } draft.push({ id: uid(), name: '', grp: 'adult' }); drawRows(); const r = $$('.mrow input[data-k="name"]'); r[r.length - 1].focus(); });
$('#mrows').addEventListener('input', e => {
  const row = e.target.closest('.mrow'); if (!row) return; const i = +row.dataset.i, k = e.target.dataset.k;
  draft[i][k] = e.target.value; $('#famErr').textContent = '';
});
$('#famName').addEventListener('input', () => $('#famErr').textContent = '');
$('#famNext').addEventListener('click', submitFamily);
$('#welNext').addEventListener('click', () => go('booth'));
$('#boothNext').addEventListener('click', () => go('app'));
$('#avsBtn').addEventListener('click', () => setTab('crew'));
['#camIn', '#picIn'].forEach(sel => $(sel).addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) shoot(f); }));
// Photo buttons are <label for=...> so the phone opens the camera or gallery natively; this only records whose photo it is.
document.addEventListener('click', e => {
  const l = e.target.closest('label[data-shoot]'); if (!l) return;
  shootId = l.dataset.shoot; const inp = document.getElementById(l.htmlFor); if (inp) inp.value = '';
  if ($('#sheet').classList.contains('on')) setTimeout(closeSheet, 300);
}, true);
document.addEventListener('keydown', e => { const l = e.target.closest && e.target.closest('label[data-shoot]'); if (l && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); l.click(); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeSheet(); if ($('#model').classList.contains('full')) toggleFull(); } });

/* ---------- 3D miniature model of the RIU complex (Three.js) ---------- */
// Coordinates: x runs west (−) to east (+), z runs from the road (−) to the sea (+). One unit ≈ 4 m. Illustrative, not surveyed.
const PINS = [
  { id: 'p-lobby', r: 'palace', n: 'Lobby and La Ventana bar', w: 'Check-in, lobby bar with terrace', i: 'concierge-bell', pos: [-21, 8.8, -19] },
  { id: 'p-mar', r: 'palace', n: 'Mar de Cortés', w: 'Main buffet · breakfast and dinner', i: 'utensils', pos: [-29, 5.6, -14] },
  { id: 'p-alc', r: 'palace', n: 'Krystal, Misaki, Bombay, San José', w: 'À la carte dinner · long pants', i: 'utensils', pos: [-13, 5.6, -14] },
  { id: 'p-medano', r: 'palace', n: 'El Médano', w: 'Poolside grill, steakhouse at night', i: 'beef', pos: [-21, 3.6, 6] },
  { id: 'p-pools', r: 'palace', n: 'Main pools', w: 'Whirlpools heated in winter', i: 'waves', pos: [-26, 1.2, -1] },
  { id: 'p-swimup', r: 'palace', n: 'Swim-up bars', w: 'Baja Sur and Baja Norte', i: 'martini', pos: [-9.8, 1.2, -9] },
  { id: 'p-kids', r: 'palace', n: "Kids' pool", w: 'Shallow pool for little ones', i: 'baby', rule: 'kids', pos: [-21, 1.2, -8] },
  { id: 'p-beach', r: 'palace', n: 'Beach Club', w: 'Chill-out bar on Médano Beach', i: 'umbrella', pos: [-22, 3.4, 12.2] },
  { id: 'p-spa', r: 'palace', n: 'Renova Spa and gym', w: 'Spa treatments cost extra', i: 'flower-2', pos: [-36, 4.4, -21] },
  { id: 'p-tennis', r: 'palace', n: 'Tennis', w: 'Two courts', i: 'trophy', pos: [-6, 1.2, -21] },
  { id: 's-lobby', r: 'santafe', n: 'Santa Fe lobby', w: 'Next door, a short walk', i: 'map-pin', pos: [14, 5.8, -19] },
  { id: 's-splash', r: 'santafe', n: 'Splash Water World', w: 'Five slides · open 6 days a week', i: 'droplets', rule: 'slides', pos: [28, 8.8, -15] },
  { id: 's-riuland', r: 'santafe', n: 'RiuLand and kids pool', w: 'Kids club with slides', i: 'blocks', rule: 'kids', pos: [10.2, 3.6, -12.5] },
  { id: 's-pool', r: 'santafe', n: 'Main pool', w: 'With a swim-up bar', i: 'waves', pos: [18, 1.2, 1] },
  { id: 's-party', r: 'santafe', n: 'Riu Pool Party', w: 'Themed party 4 nights a week', i: 'party-popper', rule: 'adult', pos: [31.5, 2.8, -1.4] },
  { id: 's-lunch', r: 'santafe', n: 'La Misión and Torote', w: 'Lunch by the pool', i: 'utensils', pos: [12, 4, 7] },
  { id: 's-pacha', r: 'santafe', n: 'Pachá nightclub', w: 'Free entry · 6 nights a week', i: 'music', rule: 'adult', pos: [37, 4.6, -20.5] },
  { id: 's-pickle', r: 'santafe', n: 'Pickleball and tennis', w: '3 pickleball courts, 1 tennis court', i: 'trophy', pos: [5, 1.2, -21] },
  { id: 'arch', r: 'sea', n: 'El Arco', w: 'Cabo’s rock arch at Land’s End, seen across the bay', i: 'mountain', pos: [-33, 6.2, 23] }
];
const AREAS = [{ t: 'Riu Palace Cabo San Lucas', pos: [-21, 12.5, -6] }, { t: 'Riu Santa Fe', pos: [20, 12.5, -6] }, { t: 'Médano Beach', pos: [3, 1.4, 14] }];
const MODEL = { state: 'idle', sel: null };
const RES_VIEW = { palace: [-20, 0, -3], santafe: [20, 0, -3] };

function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('load ' + src)); document.head.appendChild(s); }); }
async function initModel() {
  if (MODEL.state !== 'idle') return;
  MODEL.state = 'loading';
  try {
    if (!window.THREE) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js');
    if (!THREE.OrbitControls) await loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js');
    await fonts();
    buildModel();
    MODEL.state = 'ready';
    const l = $('#modelLoading'); l.style.transition = 'opacity .5s'; l.style.opacity = 0; setTimeout(() => l.remove(), 520);
  } catch (e) {
    console.error(e); MODEL.state = 'failed';
    $('#modelLoading').innerHTML = "The 3D model couldn't load.<br>Check your connection and reopen this tab.";
    MODEL.state = 'idle';
  }
}
function modelVisible() {
  const el = $('#model');
  if (el.classList.contains('full')) return !document.hidden;
  return S.screen === 'app' && S.tab === 'resorts' && !document.hidden;
}
function buildModel() {
  const T = THREE, stage = $('#modelStage');
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.06;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  stage.appendChild(renderer.domElement);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(30, 1, 1, 700);
  const controls = new T.OrbitControls(camera, renderer.domElement);
  const aniso = renderer.capabilities.getMaxAnisotropy();
  Object.assign(MODEL, { T, renderer, scene, camera, controls, stage });

  controls.enableDamping = true; controls.dampingFactor = .085;
  controls.minDistance = 20; controls.maxDistance = 190; controls.maxPolarAngle = 1.28; controls.minPolarAngle = .18;
  controls.screenSpacePanning = false; controls.rotateSpeed = .62; controls.zoomSpeed = .9; controls.panSpeed = .8;
  controls.autoRotate = !RM; controls.autoRotateSpeed = .32;
  controls.addEventListener('start', () => { controls.autoRotate = false; MODEL.fly = null; $('#modelHint').style.opacity = 0; });
  controls.addEventListener('change', () => { const t = controls.target; t.x = Math.max(-46, Math.min(46, t.x)); t.z = Math.max(-32, Math.min(32, t.z)); t.y = Math.max(0, Math.min(10, t.y)); });
  resetView(true);

  // Light: warm late-afternoon sun from the south-west, cool fill from the north-east.
  scene.add(new T.HemisphereLight(0xfff3e2, 0x9a8a75, .82));
  const sun = new T.DirectionalLight(0xffe2bf, 1.3); sun.position.set(-48, 72, 40); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -58, right: 58, top: 48, bottom: -48, near: 10, far: 220 });
  sun.shadow.bias = -.0004; sun.shadow.normalBias = .035; scene.add(sun);
  const fill = new T.DirectionalLight(0xd2e4ff, .32); fill.position.set(55, 34, -45); scene.add(fill);

  const std = (c, o = {}) => new T.MeshStandardMaterial(Object.assign({ color: new T.Color(c), roughness: .88, metalness: 0 }, o));
  const add = (mesh, cast = true, recv = true) => { mesh.castShadow = cast; mesh.receiveShadow = recv; scene.add(mesh); return mesh; };
  const box = (w, h, d, mat, x, y, z, cast = true) => { const m = add(new T.Mesh(new T.BoxGeometry(w, h, d), mat), cast); m.position.set(x, y, z); return m; };
  const canvasTex = (c, rep) => { const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = aniso; if (rep) { t.wrapS = t.wrapT = T.RepeatWrapping; } return t; };
  const G = .6;

  // Facade textures: one bay x one floor, tinted per building by the material colour.
  function facade(kind) {
    const c = mk(256, 256), x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 700; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * .03})`; x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
    if (kind === 'moorish') {
      x.fillStyle = '#5B7B93'; x.beginPath(); x.moveTo(80, 222); x.lineTo(80, 112); x.arc(128, 112, 48, Math.PI, 0); x.lineTo(176, 222); x.closePath(); x.fill();
      x.fillStyle = 'rgba(255,255,255,.28)'; x.fillRect(88, 118, 9, 98);
      x.fillStyle = 'rgba(0,0,0,.16)'; x.fillRect(62, 216, 132, 9);
      x.strokeStyle = 'rgba(0,0,0,.22)'; x.lineWidth = 3;
      for (let k = 0; k < 8; k++) { x.beginPath(); x.moveTo(66 + k * 18, 216); x.lineTo(66 + k * 18, 192); x.stroke(); }
      x.beginPath(); x.moveTo(62, 192); x.lineTo(194, 192); x.stroke();
    } else if (kind === 'adobe') {
      x.fillStyle = '#4E6A7E'; x.fillRect(88, 96, 80, 104);
      x.fillStyle = '#9C5532'; x.fillRect(80, 88, 96, 11); x.fillRect(80, 198, 96, 8);
      x.fillStyle = 'rgba(255,255,255,.22)'; x.fillRect(94, 102, 8, 92);
      x.fillStyle = 'rgba(0,0,0,.09)'; for (let k = 0; k < 4; k++) x.fillRect(30 + k * 60, 20, 6, 6);
    } else {
      x.fillStyle = '#56707F'; x.fillRect(72, 92, 112, 108); x.fillStyle = 'rgba(255,255,255,.2)'; x.fillRect(80, 98, 8, 96);
    }
    x.fillStyle = 'rgba(0,0,0,.07)'; x.fillRect(0, 250, 256, 6);
    return canvasTex(c, true);
  }
  const TEX = { moorish: facade('moorish'), adobe: facade('adobe'), plain: facade('plain') };
  function bld(x, z, w, d, h, floors, kind, color) {
    const side = span => { const t = TEX[kind].clone(); t.needsUpdate = true; t.repeat.set(Math.max(1, Math.round(span / 2.4)), floors); return std(color, { map: t }); };
    const mX = side(d), mZ = side(w), roof = std(new T.Color(color).multiplyScalar(.9));
    const m = add(new T.Mesh(new T.BoxGeometry(w, h, d), [mX, mX, roof, roof, mZ, mZ]));
    m.position.set(x, G + h / 2, z);
    box(w + .3, .32, d + .3, std(new T.Color(color).multiplyScalar(1.02)), x, G + h + .16, z);
    return m;
  }
  function dome(x, y, z, r, color) {
    add(new T.Mesh(new T.CylinderGeometry(r * .92, r * .92, r * .35, 32), std(color))).position.set(x, y + r * .17, z);
    add(new T.Mesh(new T.SphereGeometry(r, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), std(color, { roughness: .55 }))).position.set(x, y + r * .34, z);
    add(new T.Mesh(new T.SphereGeometry(r * .11, 16, 12), std('#D7B46A', { metalness: .6, roughness: .35 }))).position.set(x, y + r * 1.38, z);
  }
  function rshape(w, d, r) {
    const s = new T.Shape(), x = -w / 2, y = -d / 2; r = Math.min(r, w / 2, d / 2);
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
  }
  const WATER = std('#38C3D6', { roughness: .1, metalness: .05, emissive: new T.Color('#0E7486'), emissiveIntensity: .28 });
  const COPING = std('#FFFFFF', { roughness: .6 });
  MODEL.water = WATER;
  function flat(geo, mat, x, z, y) { const m = add(new T.Mesh(geo, mat), false, true); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); return m; }
  function pool(x, z, w, d, r) { flat(new T.ShapeGeometry(rshape(w + .7, d + .7, r + .35), 24), COPING, x, z, G + .065); flat(new T.ShapeGeometry(rshape(w, d, r), 24), WATER, x, z, G + .09); }
  function cpool(x, z, r) { flat(new T.CircleGeometry(r + .35, 40), COPING, x, z, G + .065); flat(new T.CircleGeometry(r, 40), WATER, x, z, G + .09); }
  function court(x, z, w, d, color) {
    const c = mk(512, 512 * d / w | 0), k = c.getContext('2d');
    k.fillStyle = color; k.fillRect(0, 0, c.width, c.height); k.strokeStyle = 'rgba(255,255,255,.9)'; k.lineWidth = 6;
    k.strokeRect(24, 24, c.width - 48, c.height - 48); k.beginPath(); k.moveTo(c.width / 2, 24); k.lineTo(c.width / 2, c.height - 24); k.stroke();
    box(w, .08, d, std('#ffffff', { map: canvasTex(c) }), x, G + .04, z, false);
  }
  function palapa(x, z, r) {
    for (const [dx, dz] of [[-.6, -.6], [.6, -.6], [-.6, .6], [.6, .6]]) add(new T.Mesh(new T.CylinderGeometry(.09, .09, 2.2, 8), std('#7A5A3C'))).position.set(x + dx * r * .7, G + 1.1, z + dz * r * .7);
    add(new T.Mesh(new T.ConeGeometry(r, 1.5, 12), std('#C9A46C', { roughness: 1, flatShading: true }))).position.set(x, G + 2.9, z);
  }

  // ---- Plinth, land, beach, sea
  box(86, 5, 58, std('#4A3426', { roughness: .55 }), 0, -2.5, 0, false);
  box(86.5, .3, 58.5, std('#C9A66B', { metalness: .55, roughness: .35 }), 0, -.15, 0, false);
  box(84, .6, 38, std('#C6D2A1'), 0, .3, -9, false);
  box(84, .45, 7, std('#EED8AC', { roughness: 1 }), 0, .225, 13.5, false);
  box(84, .06, 3, std('#9EA3A8'), 0, G + .03, -25.6, false);
  for (let k = -40; k < 42; k += 4) box(1.8, .07, .18, std('#FFFFFF'), k, G + .04, -25.6, false);
  box(2.6, .05, 36, std('#E8DDC8'), 0, G + .03, -7.5, false);
  // plaque on the front of the plinth
  {
    const c = mk(2048, 120), k = c.getContext('2d');
    const g = k.createLinearGradient(0, 0, 0, 120); g.addColorStop(0, '#E2C58C'); g.addColorStop(1, '#B58E4E'); k.fillStyle = g; k.fillRect(0, 0, 2048, 120);
    k.fillStyle = '#3B2A1A'; k.font = `600 46px ${MONO}`; k.textAlign = 'center'; k.textBaseline = 'middle';
    k.fillText('RIU PALACE CABO SAN LUCAS  ·  RIU SANTA FE  ·  MÉDANO BEACH, BAJA CALIFORNIA SUR', 1024, 62);
    const m = new T.Mesh(new T.PlaneGeometry(44, 2.6), std('#ffffff', { map: canvasTex(c), metalness: .4, roughness: .4 }));
    m.position.set(0, -2.4, 29.03); scene.add(m);
  }
  // sea with depth colours and gentle waves
  {
    const geo = new T.PlaneGeometry(84, 12, 84, 12); geo.rotateX(-Math.PI / 2); geo.translate(0, .3, 23);
    const pos = geo.attributes.position, cols = [], shallow = new T.Color('#67D3CF'), deep = new T.Color('#1C6596');
    for (let i = 0; i < pos.count; i++) { const k = Math.min(1, Math.max(0, (pos.getZ(i) - 17) / 11)); const c = shallow.clone().lerp(deep, Math.pow(k, .7)); cols.push(c.r, c.g, c.b); }
    geo.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    MODEL.sea = add(new T.Mesh(geo, std('#ffffff', { vertexColors: true, roughness: .18, metalness: .08 })), false, true);
    MODEL.seaBase = Float32Array.from(pos.array);
    MODEL.foam = add(new T.Mesh(new T.PlaneGeometry(84, .55), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .55 })), false, false);
    MODEL.foam.rotation.x = -Math.PI / 2; MODEL.foam.position.set(0, .47, 17.25);
  }

  // ---- Riu Palace Cabo San Lucas: white neo-Moorish wings around a pool courtyard
  const IVORY = '#F6F1E7', DOME = '#F1E6D2';
  box(24, .05, 19, std('#F2EADB'), -21, G + .03, -1, false);
  bld(-21, -19, 14, 6, 5, 2, 'moorish', IVORY); dome(-21, G + 5.3, -19, 2.7, DOME); dome(-26.2, G + 5.3, -19, 1.1, DOME); dome(-15.8, G + 5.3, -19, 1.1, DOME);
  bld(-36, -6, 5, 22, 7.2, 6, 'moorish', IVORY);
  bld(-6, -6, 5, 22, 6, 5, 'moorish', '#F3ECDF');
  bld(-29, -14, 6, 5, 3, 1, 'moorish', '#F4EEE3'); dome(-29, G + 3.3, -14, 1.5, DOME);
  bld(-13, -14, 6, 5, 3, 1, 'moorish', '#F4EEE3'); dome(-13, G + 3.3, -14, 1.5, DOME);
  bld(-21, 6, 5.5, 2.6, 2.2, 1, 'plain', '#FBF7EF');
  box(7, .22, 4, std('#D9C4A0'), -21, G + 2.6, 6);
  bld(-36, -21, 4, 3, 3, 1, 'plain', '#EFE7DA');
  court(-6, -21, 8, 4.4, '#3E7C5A');
  pool(-26, -1, 10, 6, 2.6); pool(-15.5, 1, 9, 6, 2.4);
  pool(-32.2, -5, 2, 17, .8); pool(-9.8, -5, 2, 17, .8);
  cpool(-21, -8, 1.6); cpool(-28, -5.6, .9); cpool(-15, -3.6, .9);
  add(new T.Mesh(new T.CylinderGeometry(.9, .9, .7, 24), std('#FFFFFF'))).position.set(-15.5, G + .35, 1);
  palapa(-22, 12.3, 1.9);

  // ---- Riu Santa Fe: warm adobe blocks, the water park and the party pool
  box(31, .05, 12, std('#EFDCC2'), 19.5, G + .03, 1.5, false);
  bld(14, -19, 12, 6, 4.6, 2, 'adobe', '#E8BC8C');
  bld(19.6, -19, 2.4, 2.4, 8.6, 3, 'adobe', '#E2A878');
  { const roof = add(new T.Mesh(new T.ConeGeometry(1.9, 1.7, 4), std('#B95B37', { flatShading: true }))); roof.position.set(19.6, G + 8.6 + .32 + .85, -19); roof.rotation.y = Math.PI / 4; }
  bld(6, -6, 4, 18, 5, 4, 'adobe', '#EAC59A');
  bld(37, -6, 4, 18, 5.6, 4, 'adobe', '#E2A983');
  bld(20, -12, 10, 4, 4.2, 3, 'adobe', '#EDC9A0');
  bld(10.2, -12.5, 3, 3, 2.2, 1, 'plain', '#8FD0E6');
  pool(11, -8.5, 4, 3, 1.2);
  bld(37, -20.5, 5, 3, 3, 1, 'plain', '#2A2433');
  box(5.1, .35, .1, new T.MeshBasicMaterial({ color: 0xff3fa4 }), 37, G + 2.4, -18.98, false);
  bld(28, -15, 3, 3, 6.6, 1, 'plain', '#F4F4F2');
  box(4, .3, 4, std('#FF8A3D'), 28, G + 6.9, -15);
  pool(31.5, -9.5, 5, 3.6, 1.2);
  {
    const top = G + 6.9, slideCols = ['#FFD24A', '#2FA7F5', '#FF5A36', '#2BC48A', '#B06CF2'];
    const paths = [
      [[28, top, -13.2], [31, top - 1, -13], [33.5, top - 2.4, -11.8], [32, top - 3.8, -10.8], [29.5, top - 5, -11], [30.4, G + .9, -9.6]],
      [[29.6, top, -15], [33, top - 1.4, -16.5], [35, top - 3, -14], [33.6, G + 1.2, -10.6]],
      [[26.4, top, -15], [24, top - 1.5, -12.5], [26, top - 3.4, -10.6], [29, G + 1, -9.4]],
      [[28, top, -16.6], [31.5, top - 1.2, -18.4], [34.5, top - 3.2, -17], [35.4, top - 4.8, -12.6], [33.4, G + .9, -8.6]],
      [[26.6, top - .5, -16.4], [23.5, top - 2, -16.8], [23.4, top - 4, -13.2], [27.6, G + 1, -8.6]]
    ];
    paths.forEach((p, i) => {
      const curve = new T.CatmullRomCurve3(p.map(v => new T.Vector3(...v)));
      add(new T.Mesh(new T.TubeGeometry(curve, 90, .34, 12, false), std(slideCols[i], { roughness: .35 })));
    });
    for (const [dx, dz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) add(new T.Mesh(new T.CylinderGeometry(.12, .12, 6.8, 8), std('#DADDE0'))).position.set(28 + dx, G + 3.4, -15 + dz);
  }
  pool(18, 1, 14, 6, 3);
  pool(29, 3, 7, 5, 2.2);
  box(4, 1.4, 2, std('#2B2B33'), 31.5, G + .7, -1.4);
  box(3.6, .14, .12, new T.MeshBasicMaterial({ color: 0xff3fa4 }), 31.5, G + 1.25, -.38, false);
  add(new T.Mesh(new T.CylinderGeometry(.9, .9, .7, 24), std('#FFFFFF'))).position.set(20, G + .35, 1.5);
  palapa(12, 7, 2); palapa(24, 7.4, 2);
  court(5, -21, 6, 4, '#3D6FB6');

  // ---- Palms (2 draw calls for all of them)
  {
    const spots = [];
    for (let x = -40; x <= 40; x += 3.6) if (Math.abs(x + 22) > 2.5) spots.push([x + Math.sin(x) * .6, 9.4 + Math.cos(x * 1.7) * .4]);
    spots.push([-31, 4.6], [-28, 6.6], [-14, 6.6], [-11.4, 4.2], [-24, -7.4], [-18, -7.6], [-30, -9.4], [-12, -9.6], [-25, -12], [-17, -12],
      [-40.5, -12], [-40.5, -1], [-40.5, 6], [-2.2, -14], [-2.2, -3], [-2.2, 4.5], [2.2, -14], [2.2, -2], [2.2, 6],
      [9, -2], [13.4, 4.6], [22.4, 5], [26, -4.6], [15.6, -6.4], [24.6, -7.4], [33.6, 6.6], [35, -.6], [40.6, 4], [40.6, -10], [25.6, -20.5], [8.6, -16.6], [3.8, -14.6], [15.4, -9.6]);
    const trunkGeo = new T.CylinderGeometry(.11, .19, 2.9, 7); trunkGeo.translate(0, 1.45, 0);
    const crownGeo = new T.ConeGeometry(1.55, .8, 16, 1, true);
    const cp = crownGeo.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const y = cp.getY(i); if (y > 0) continue;
      const a = Math.atan2(cp.getZ(i), cp.getX(i)), k = Math.round((a + Math.PI) / (2 * Math.PI) * 16) % 2;
      cp.setX(i, cp.getX(i) * (k ? .42 : 1)); cp.setZ(i, cp.getZ(i) * (k ? .42 : 1)); cp.setY(i, y - (k ? 0 : .35));
    }
    crownGeo.computeVertexNormals(); crownGeo.translate(0, 3.05, 0);
    const trunks = new T.InstancedMesh(trunkGeo, std('#8C6A4A'), spots.length);
    const crowns = new T.InstancedMesh(crownGeo, std('#ffffff', { flatShading: true, side: T.DoubleSide, roughness: .8 }), spots.length);
    const dm = new T.Object3D(), col = new T.Color();
    spots.forEach(([x, z], i) => {
      const s = .85 + ((i * 37) % 10) / 30;
      dm.position.set(x, G, z); dm.rotation.set(Math.sin(i * 2.3) * .1, i * 1.7, Math.cos(i * 1.3) * .1); dm.scale.set(s, s, s); dm.updateMatrix();
      trunks.setMatrixAt(i, dm.matrix); crowns.setMatrixAt(i, dm.matrix);
      crowns.setColorAt(i, col.set(['#3E8E4E', '#4A9A52', '#357F45', '#5AA45A'][i % 4]));
    });
    trunks.castShadow = crowns.castShadow = true; trunks.receiveShadow = crowns.receiveShadow = true;
    scene.add(trunks, crowns);
  }
  // ---- Beach umbrellas and loungers
  {
    const spots = [];
    for (let x = -39; x <= 39; x += 2.7) { if (Math.abs(x + 22) < 2.6) continue; spots.push([x, 12.4]); spots.push([x + 1.35, 14.6]); }
    const pole = new T.CylinderGeometry(.035, .035, 1.4, 6); pole.translate(0, .7, 0);
    const top = new T.ConeGeometry(.78, .32, 10); top.translate(0, 1.45, 0);
    const bed = new T.BoxGeometry(.4, .12, 1); bed.translate(.55, .1, .2);
    const poles = new T.InstancedMesh(pole, std('#E9E4DA'), spots.length);
    const tops = new T.InstancedMesh(top, std('#ffffff', { flatShading: true }), spots.length);
    const beds = new T.InstancedMesh(bed, std('#FFFFFF'), spots.length);
    const dm = new T.Object3D(), col = new T.Color();
    spots.forEach(([x, z], i) => {
      dm.position.set(x, .45, z); dm.rotation.set(0, (i % 5) * .3, 0); dm.updateMatrix();
      poles.setMatrixAt(i, dm.matrix); tops.setMatrixAt(i, dm.matrix); beds.setMatrixAt(i, dm.matrix);
      tops.setColorAt(i, col.set(x < 0 ? (i % 2 ? '#FBF6EC' : '#F2E3C8') : (i % 2 ? '#F06B4F' : '#F6A23C')));
    });
    [poles, tops, beds].forEach(m => { m.castShadow = true; m.receiveShadow = true; scene.add(m); });
  }
  // ---- El Arco, low-poly rock in the bay
  {
    const rock = std('#9C7A62', { flatShading: true, roughness: .95 });
    const piece = (x, y, z, sx, sy, sz, ry) => { const m = add(new T.Mesh(new T.DodecahedronGeometry(1, 1), rock)); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.y = ry; return m; };
    piece(-38.4, 1.4, 22.6, 3.2, 4.6, 2.6, .4); piece(-35.4, 1.2, 23, 1.5, 3.4, 1.7, .2); piece(-30.8, 1, 23.3, 1.25, 2.9, 1.45, .7);
    piece(-33.1, 4, 23.1, 2.9, 1.15, 1.55, 0); piece(-27.9, .5, 24.3, .9, 1.9, .9, 1.1);
  }
  // ---- Boats
  MODEL.boats = [0, 1].map(i => {
    const g = new T.Group();
    const hull = new T.Mesh(new T.BoxGeometry(2.2, .45, .85), std('#FFFFFF')); hull.position.y = .25; hull.castShadow = true;
    const cab = new T.Mesh(new T.BoxGeometry(.9, .45, .65), std(i ? '#2F6BFF' : '#FF5A36')); cab.position.set(-.2, .7, 0); cab.castShadow = true;
    g.add(hull, cab); scene.add(g); return g;
  });

  // ---- Pins and labels (HTML over the canvas)
  const pinsEl = $('#pins');
  MODEL.pinEls = PINS.map(p => {
    const el = document.createElement('button');
    el.className = `pin r-${p.r}`; el.dataset.pin = p.id; el.setAttribute('aria-label', p.n);
    el.innerHTML = `<span class="stem"></span><span class="pin-in"><span class="dot"><i data-lucide="${p.i}"></i></span><span class="lab">${esc(p.n)}</span></span>`;
    pinsEl.appendChild(el); return { p, el, v: new T.Vector3(...p.pos) };
  });
  MODEL.areaEls = AREAS.map(a => { const el = document.createElement('div'); el.className = 'area'; el.textContent = a.t; pinsEl.appendChild(el); return { el, v: new T.Vector3(...a.pos) }; });
  icons(); updatePinStates();

  const ro = new ResizeObserver(() => { const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); });
  ro.observe(stage);
  requestAnimationFrame(modelFrame);
}
const tmpV = { v: null };
function modelFrame(ms) {
  requestAnimationFrame(modelFrame);
  if (!modelVisible()) return;
  const { renderer, scene, camera, controls, T } = MODEL, t = ms / 1000;
  if (MODEL.fly) {
    const f = MODEL.fly, k = Math.min(1, (ms - f.t0) / f.dur), e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    controls.target.lerpVectors(f.fromT, f.toT, e); camera.position.lerpVectors(f.fromP, f.toP, e);
    if (k >= 1) MODEL.fly = null;
  }
  controls.update();
  if (!RM) {
    const pos = MODEL.sea.geometry.attributes.position, b = MODEL.seaBase;
    for (let i = 0; i < pos.count; i++) { const x = b[i * 3], z = b[i * 3 + 2], damp = Math.min(1, (z - 17) / 4); pos.array[i * 3 + 1] = .3 + damp * (Math.sin(x * .45 + t * 1.3) * .09 + Math.sin(z * .9 - t * 1.05 + x * .1) * .06); }
    pos.needsUpdate = true; if ((ms | 0) % 2 === 0) MODEL.sea.geometry.computeVertexNormals();
    MODEL.foam.material.opacity = .35 + .25 * Math.sin(t * 1.6);
    MODEL.water.emissiveIntensity = .24 + .06 * Math.sin(t * 2);
    MODEL.boats.forEach((g, i) => { const x = ((t * (1.4 + i * .5) + i * 40) % 100) - 50; g.position.set(i ? -x : x, .32 + Math.sin(t * 2 + i) * .06, 20.5 + i * 3.4); g.rotation.y = i ? Math.PI : 0; g.rotation.z = Math.sin(t * 1.6 + i) * .04; });
  }
  renderer.render(scene, camera);
  // pins
  if (!tmpV.v) tmpV.v = new T.Vector3();
  const w = MODEL.stage.clientWidth, h = MODEL.stage.clientHeight, v = tmpV.v;
  const dist = camera.position.distanceTo(controls.target);
  $('#pins').classList.toggle('zoomed', dist < 62);
  const place = (el, src, z) => {
    v.copy(src).project(camera);
    const on = v.z < 1 && v.x > -1.15 && v.x < 1.15 && v.y > -1.15 && v.y < 1.15;
    el.style.visibility = on ? 'visible' : 'hidden';
    if (on) { el.style.transform = `translate3d(${((v.x * .5 + .5) * w).toFixed(1)}px,${((-v.y * .5 + .5) * h).toFixed(1)}px,0)${z ? '' : ' translate(-50%,-50%)'}`; if (z) el.style.zIndex = String(1000 - Math.round(v.z * 1000)); }
  };
  MODEL.pinEls.forEach(p => place(p.el, p.v, true));
  MODEL.areaEls.forEach(a => { place(a.el, a.v, false); a.el.style.opacity = dist < 62 ? 0 : 1; });
}
function flyTo(target, dist, dur = 900) {
  if (MODEL.state !== 'ready') return;
  const { T, camera, controls } = MODEL;
  const toT = new T.Vector3(target[0], 0, target[2]);
  const dir = camera.position.clone().sub(controls.target).normalize();
  if (dir.y < .45) { dir.y = .45; dir.normalize(); }
  MODEL.fly = { t0: performance.now(), dur: RM ? 1 : dur, fromT: controls.target.clone(), toT, fromP: camera.position.clone(), toP: toT.clone().add(dir.multiplyScalar(dist)) };
  controls.autoRotate = false;
}
function flyResort(r) { flyTo(RES_VIEW[r], 66); }
function resetView(instant) {
  if (!MODEL.camera) return;
  const { T, camera, controls } = MODEL;
  if (instant === true) { controls.target.set(0, 0, -3); camera.position.set(10, 82, 100); controls.update(); return; }
  MODEL.fly = { t0: performance.now(), dur: RM ? 1 : 900, fromT: controls.target.clone(), toT: new T.Vector3(0, 0, -3), fromP: camera.position.clone(), toP: new T.Vector3(10, 82, 100) };
  clearPin();
}
function pinState(p) {
  if (p.r === 'sea') return 'neutral';
  const person = S.who !== 'all' ? findPerson(S.who) : null;
  if (!person) return 'neutral';
  return access(p.rule, person.m).s;
}
function updatePinStates() {
  if (!MODEL.pinEls) return;
  MODEL.pinEls.forEach(({ p, el }) => {
    el.classList.remove('s-ok', 's-warn', 's-no', 's-neutral');
    el.classList.add('s-' + pinState(p));
    el.classList.toggle('sel', MODEL.sel === p.id);
  });
}
function selectPin(id, keepCamera) {
  const P = PINS.find(p => p.id === id); if (!P) return;
  MODEL.sel = id; updatePinStates();
  const person = S.who !== 'all' ? findPerson(S.who) : null;
  let chip = '';
  if (P.r !== 'sea') {
    if (person) { const a = access(P.rule, person.m); chip = `<span class="chip ${a.s}">${a.s === 'ok' ? `${esc(person.m.name)}: yes` : a.l}</span>`; }
    else if (P.rule) chip = `<span class="chip ${P.rule === 'slides' ? 'warn' : P.rule === 'kids' ? '' : 'no'}">${RULE_LABEL[P.rule]}</span>`;
  }
  const card = $('#pinCard');
  card.innerHTML = `<span class="tile"><i data-lucide="${P.i}"></i></span><div class="tx"><p class="mono">${P.r === 'palace' ? 'Palace Cabo' : P.r === 'santafe' ? 'Santa Fe' : 'Across the bay'}</p><strong>${esc(P.n)}</strong><span class="d">${esc(P.w)}</span></div>${chip}<button class="x" data-act="pin-close" aria-label="Close"><i data-lucide="x"></i></button>`;
  card.classList.add('on'); $('#model').classList.add('has-card'); icons();
  if (!keepCamera) flyTo(P.pos, 44);
}
function clearPin() { MODEL.sel = null; updatePinStates(); const c = $('#pinCard'); if (c) c.classList.remove('on'); $('#model').classList.remove('has-card'); }
function toggleFull() {
  const m = $('#model'), full = !m.classList.contains('full');
  if (full) { MODEL.home = m.parentNode; MODEL.next = m.nextSibling; $('#app').appendChild(m); }
  else MODEL.home.insertBefore(m, MODEL.next);
  m.classList.toggle('full', full);
  $('#modelFullBtn').innerHTML = `<i data-lucide="${full ? 'minimize-2' : 'maximize-2'}"></i>`;
  $('#modelFullBtn').setAttribute('aria-label', full ? 'Close full screen' : 'Expand model');
  icons();
}

/* ---------- Shared plan: data ---------- */
const DEFAULT_PLAN = DAYS.flatMap((d, di) => d.items.map((it, k) => ({ id: `d${di}-${k}`, day: di, pos: k, t: it.t, title: it.title, note: it.note, place: it.where, who: it.who || '', icon: it.i, opt: !!it.opt })));
let PLAN = [];
const isExample = () => !!(S.family && S.family.example);
const shared = () => API.mode === 'server' && !isExample() && !!S.token;
const dayItems = di => PLAN.filter(p => p.day === di).sort((a, b) => a.pos - b.pos);
const canEdit = it => !shared() || API.owner || (it.family_id && it.family_id === S.myId);
const dayName = di => `${DAYS[di].wk}, Dec ${DAYS[di].d}`;
const actorHdr = () => S.me ? { 'x-member-id': S.me } : {};
async function loadPlan() {
  if (API.mode === 'server' && !isExample()) {
    try { const d = await api('plan'); PLAN = d.items; S.planCache = PLAN; save(); return; }
    catch (e) { if (S.planCache && S.planCache.length) { PLAN = S.planCache.map(p => ({ ...p })); return; } }
  }
  PLAN = (S.plan && S.plan.length ? S.plan : DEFAULT_PLAN).map(p => ({ ...p }));
}
function persistLocal() { if (!shared()) { S.plan = PLAN; save(); } else { S.planCache = PLAN; save(); } }
function rerenderPlan() { if (S.screen !== 'app' || DRAG) return; renderPlan(); renderToday(); icons(); }
async function planCall(fn) { try { await fn(); } catch (e) { toast(e.message); await loadPlan(); rerenderPlan(); } }
async function planAdd(item) {
  const tmp = Object.assign({ t: '', note: '', place: 'palace', who: '', icon: 'sparkles', opt: false }, item, { id: 'tmp' + Date.now(), pos: dayItems(item.day).length, family_id: S.myId || null });
  PLAN.push(tmp); persistLocal(); rerenderPlan();
  toast(`Added to ${dayName(item.day)}`);
  if (shared()) await planCall(async () => { const d = await api('plan', { method: 'POST', json: tmp, headers: actorHdr() }); Object.assign(tmp, d.item); persistLocal(); rerenderPlan(); pollChat(); });
}
async function planUpdate(id, fields) {
  const it = PLAN.find(p => p.id === id); if (!it) return;
  if (fields.day != null && fields.day !== it.day) it.pos = dayItems(fields.day).length;
  Object.assign(it, fields); persistLocal(); rerenderPlan();
  if (shared()) await planCall(async () => { await api(`plan/${encodeURIComponent(id)}`, { method: 'PUT', json: it, headers: actorHdr() }); pollChat(); });
}
async function planDelete(id) {
  const it = PLAN.find(p => p.id === id); if (!it) return;
  PLAN = PLAN.filter(p => p.id !== id); persistLocal(); rerenderPlan();
  toast(`Removed “${it.title}”`);
  if (shared()) await planCall(async () => { await api(`plan/${encodeURIComponent(id)}`, { method: 'DELETE', headers: actorHdr() }); pollChat(); });
}
async function planOrder(day, ids) {
  ids.forEach((id, i) => { const it = PLAN.find(p => p.id === id); if (it) { it.day = day; it.pos = i; } });
  persistLocal(); rerenderPlan();
  if (shared()) await planCall(async () => { await api('plan/order', { method: 'POST', json: { day, ids }, headers: actorHdr() }); pollChat(); });
}

/* ---------- Shared plan: view ---------- */
const WHO_CHIP = { adult: ['no', '18+'], kids: ['', 'Kids'], slides: ['warn', 'Height 1.20 m'] };
function itemHTML(it, k, editable) {
  const w = WHO_CHIP[it.who];
  return `<div class="ti" data-id="${esc(it.id)}" style="animation-delay:${k * 50}ms">
      <div class="t">${esc(it.t || '·')}</div>
      <div class="c${it.opt ? ' opt' : ''}"${editable ? ` data-item="${esc(it.id)}"` : ''}>
        <div class="row"><i data-lucide="${esc(it.icon)}"></i><div class="grow"><strong>${esc(it.title)}</strong>${it.note ? `<p>${esc(it.note)}</p>` : ''}</div>${editable ? `<button class="grip" data-grip="${esc(it.id)}" aria-label="Drag “${esc(it.title)}” to reorder or onto another day"><i data-lucide="grip-vertical"></i></button>` : ''}</div>
        <div class="chips"><span class="chip">${WHERE[it.place] || 'Palace Cabo'}</span>${w ? `<span class="chip ${w[0]}">${w[1]}</span>` : ''}${it.opt ? '<span class="chip">Optional · extra cost</span>' : ''}${editable ? `<button class="chip more" data-item="${esc(it.id)}"><i data-lucide="sliders-horizontal"></i>Options</button>` : ''}</div>
      </div>
    </div>`;
}
const timelineHTML = (items, editable) => `<div class="tl"${editable ? ' id="planList"' : ''}>${items.map((it, k) => itemHTML(it, k, editable && canEdit(it))).join('')}</div>`;
function renderPlan() {
  const st = tripState(), di = S.planDay || 0, d = DAYS[di], items = dayItems(di);
  const tip = shared() ? (API.owner ? 'You can change everything. Families can add plans and change only what they added. Drag the handle to reorder, or drop an item on another day.' : 'Everyone sees changes. You can add plans and change or move what your family added; the trip organizer looks after the rest.')
    : isExample() ? 'You can try editing here. Changes in the example stay on this phone.'
    : 'Changes stay on this phone in this preview.';
  $('#p-plan').innerHTML = `
    <div class="days" role="tablist">${DAYS.map((x, i) => `<button class="dchip${i === di ? ' on' : ''}" data-day="${i}" role="tab" aria-selected="${i === di}"><span class="mono">${x.wk}</span><b>${x.d}</b><span class="cnt">${dayItems(i).length}</span></button>`).join('')}</div>
    <div class="dhead"><p class="mono" style="margin:0 0 6px;color:var(--accent)">Day ${di + 1} of 5${st.phase === 'during' && st.day === di ? ' · Today' : ''}</p><h2>${esc(d.title)}</h2><p>${esc(d.sub)}</p></div>
    ${items.length ? timelineHTML(items, true) : `<div class="tl" id="planList"></div><div class="empty-day"><i data-lucide="calendar-plus"></i><span>Nothing planned yet for ${dayName(di)}.</span></div>`}
    <button class="btn btn-primary" data-act="plan-add"><i data-lucide="plus"></i> Add to ${dayName(di)}</button>
    <p class="note"><i data-lucide="move"></i><span>${tip}</span></p>`;
}

/* ---------- Options: catalog of things to add ---------- */
const CAT_ICON = { Eat: 'utensils', Drink: 'martini', Swim: 'waves', Play: 'trophy', Night: 'party-popper', Wellness: 'flower-2' };
const RULE_WHO = { adult: 'adult', kids: 'kids', slides: 'slides' };
const EXTRA_OPTS = [
  { title: 'Boat to El Arco', icon: 'ship', place: 'offsite', note: "Land's End and Lover's Beach. Booked separately.", opt: true, when: 'Morning' },
  { title: 'Whale watching', icon: 'fish', place: 'offsite', note: 'Whale season starts in December. Booked separately.', opt: true, when: 'Morning' },
  { title: 'Marina Cabo San Lucas', icon: 'anchor', place: 'offsite', note: 'Walk the marina, shops and restaurants in town.', when: 'Afternoon' },
  { title: 'Group dinner', icon: 'utensils', place: 'palace', note: 'À la carte at Palace Cabo. Long pants.', when: 'Evening' },
  { title: 'All 5 families, one photo', icon: 'camera', place: 'palace', note: 'Médano Beach at golden hour.', when: 'Sunset' },
  { title: 'Free time', icon: 'armchair', place: 'palace', note: 'Nothing planned. Pool, nap, repeat.', when: 'Afternoon' },
  { title: 'Airport transfer', icon: 'bus', place: 'offsite', note: 'About 45 minutes to SJD.', when: 'Midday' }
];
function catalog() {
  const groups = [{ h: 'Out and about', items: EXTRA_OPTS }];
  ['palace', 'santafe'].forEach(r => groups.push({
    h: r === 'palace' ? 'At Palace Cabo' : 'At Santa Fe',
    items: RESORTS[r].items.filter(x => x.r !== 'sfdinner').map(x => ({ title: x.n, icon: x.i || CAT_ICON[x.c], place: r, note: x.w + (x.when ? ` · ${x.when}` : ''), who: RULE_WHO[x.r] || '', opt: !!x.x, when: x.c === 'Night' ? 'Night' : /Dinner/.test(x.when || '') ? 'Evening' : x.c === 'Eat' ? 'Midday' : 'Afternoon' }))
  }));
  return groups;
}
const WHENS = ['Morning', 'Midday', 'Afternoon', 'Sunset', 'Evening', 'Night'];
let ADD = null;
function openAdd(day) {
  ADD = { day, when: '', tab: 'opts' };
  const groups = catalog();
  ADD.flat = groups.flatMap(g => g.items);
  let n = 0;
  openSheet(`<h3>Add to ${dayName(day)}</h3>
    <div class="seg2" role="tablist"><button class="on" data-addtab="opts" role="tab">Pick an option</button><button data-addtab="own" role="tab">Write your own</button></div>
    <div class="when"><span class="mono">When</span><div class="when-row">${WHENS.map(w => `<button class="wpill" data-when="${w}">${w}</button>`).join('')}</div></div>
    <div id="addOpts" class="opts">${groups.map(g => `<h4 class="mono">${g.h}</h4>${g.items.map(o => `<button class="opt" data-opt="${n++}"><span class="tile"><i data-lucide="${esc(o.icon)}"></i></span><span class="tx"><strong>${esc(o.title)}</strong><span>${esc(o.note)}</span></span><i data-lucide="plus" class="plus"></i></button>`).join('')}`).join('')}</div>
    <div id="addOwn" class="form" hidden>
      <label for="ownTitle">What</label><input id="ownTitle" maxlength="60" placeholder="Sunset tacos at the beach">
      <label for="ownTime">Time</label><input id="ownTime" maxlength="16" placeholder="6:30 PM">
      <label>Where</label><div class="pick3">${Object.keys(WHERE).map((k, i) => `<button class="${i ? '' : 'on'}" data-ownplace="${k}">${WHERE[k]}</button>`).join('')}</div>
      <label for="ownNote">Details</label><textarea id="ownNote" maxlength="220" rows="2" placeholder="Who's in, what to bring"></textarea>
      <p class="err" id="ownErr" role="alert"></p>
      <button class="btn btn-primary" data-act="own-add"><i data-lucide="plus"></i> Add to plan</button>
    </div>`);
  $('#sheet').classList.add('tall');
}
function itemSheet(id) {
  const it = PLAN.find(p => p.id === id); if (!it) return;
  ADD = { id, place: it.place, day: it.day, opt: it.opt };
  openSheet(`<h3>${esc(it.title)}</h3><p>${dayName(it.day)}${it.t ? ' · ' + esc(it.t) : ''}</p>
    <div class="form">
      <label>Day</label><div class="pick5">${DAYS.map((x, i) => `<button class="${i === it.day ? 'on' : ''}" data-itday="${i}"><span class="mono">${x.wk}</span>${x.d}</button>`).join('')}</div>
      <label for="itTime">Time</label><div class="when-row">${WHENS.map(w => `<button class="wpill${it.t === w ? ' on' : ''}" data-ittime="${w}">${w}</button>`).join('')}</div>
      <input id="itTime" maxlength="16" value="${esc(it.t)}" placeholder="Or type a time, like 10:30 AM">
      <label for="itTitle">What</label><input id="itTitle" maxlength="60" value="${esc(it.title)}">
      <label>Where</label><div class="pick3">${Object.keys(WHERE).map(k => `<button class="${it.place === k ? 'on' : ''}" data-itplace="${k}">${WHERE[k]}</button>`).join('')}</div>
      <label for="itNote">Details</label><textarea id="itNote" maxlength="220" rows="2">${esc(it.note)}</textarea>
      <button class="toggle${it.opt ? ' on' : ''}" data-act="it-opt" aria-pressed="${it.opt}"><span class="sw"></span>Optional, costs extra</button>
      <p class="err" id="itErr" role="alert"></p>
      <div class="row3"><button class="btn btn-ghost danger" data-act="it-del"><i data-lucide="trash-2"></i></button><button class="btn btn-ghost" data-act="it-dup"><i data-lucide="copy"></i> Duplicate</button><button class="btn btn-primary" data-act="it-save">Save</button></div>
    </div>`);
  $('#sheet').classList.add('tall');
}
function sheetClick(b, d) {
  if (d.addtab) { $$('.seg2 button').forEach(x => x.classList.toggle('on', x === b)); $('#addOpts').hidden = d.addtab !== 'opts'; $('#addOwn').hidden = d.addtab !== 'own'; return true; }
  if (d.when) { const on = !b.classList.contains('on'); $$('[data-when]').forEach(x => x.classList.remove('on')); b.classList.toggle('on', on); ADD.when = on ? d.when : ''; return true; }
  if (d.opt != null && ADD && ADD.flat) { const o = ADD.flat[+d.opt]; closeSheet(); planAdd({ day: ADD.day, t: ADD.when || o.when || '', title: o.title, note: o.note, place: o.place, who: o.who || '', icon: o.icon, opt: !!o.opt }); return true; }
  if (d.ownplace) { $$('[data-ownplace]').forEach(x => x.classList.toggle('on', x === b)); return true; }
  if (d.itday != null) { $$('[data-itday]').forEach(x => x.classList.toggle('on', x === b)); ADD.day = +d.itday; return true; }
  if (d.ittime) { $$('[data-ittime]').forEach(x => x.classList.toggle('on', x === b)); $('#itTime').value = d.ittime; return true; }
  if (d.itplace) { $$('[data-itplace]').forEach(x => x.classList.toggle('on', x === b)); ADD.place = d.itplace; return true; }
  if (d.act === 'it-opt') { ADD.opt = !ADD.opt; b.classList.toggle('on', ADD.opt); b.setAttribute('aria-pressed', ADD.opt); return true; }
  if (d.act === 'own-add') {
    const title = $('#ownTitle').value.trim(); if (!title) { $('#ownErr').textContent = 'Give it a name.'; $('#ownTitle').focus(); return true; }
    const place = ($('[data-ownplace].on') || {}).dataset?.ownplace || 'palace';
    closeSheet(); planAdd({ day: ADD.day, t: $('#ownTime').value.trim() || ADD.when, title, note: $('#ownNote').value.trim(), place, icon: place === 'offsite' ? 'map-pin' : 'sparkles' }); return true;
  }
  if (d.act === 'it-save') {
    const title = $('#itTitle').value.trim(); if (!title) { $('#itErr').textContent = 'Give it a name.'; return true; }
    const id = ADD.id, fields = { day: ADD.day, t: $('#itTime').value.trim(), title, note: $('#itNote').value.trim(), place: ADD.place, opt: ADD.opt };
    const moved = fields.day !== PLAN.find(p => p.id === id).day;
    closeSheet(); planUpdate(id, fields); toast(moved ? `Moved to ${dayName(fields.day)}` : 'Saved'); return true;
  }
  if (d.act === 'it-dup') { const it = PLAN.find(p => p.id === ADD.id); closeSheet(); if (it) planAdd({ ...it, day: ADD.day }); return true; }
  if (d.act === 'it-del') { const id = ADD.id; closeSheet(); planDelete(id); return true; }
  return false;
}

/* ---------- Drag and drop (pointer events: works with touch and mouse) ---------- */
let DRAG = null;
function flip(list, mutate) {
  const els = [...list.children], first = new Map(els.map(el => [el, el.getBoundingClientRect().top]));
  mutate();
  if (RM) return;
  els.forEach(el => { const dy = first.get(el) - el.getBoundingClientRect().top; if (dy && !el.classList.contains('dragging')) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' }); });
}
document.addEventListener('pointerdown', e => {
  const g = e.target.closest('[data-grip]'); if (!g || e.button > 0) return;
  e.preventDefault();
  const row = g.closest('.ti'), list = row.parentNode, r = row.getBoundingClientRect();
  const ghost = row.cloneNode(true); ghost.classList.add('ghost');
  Object.assign(ghost.style, { width: r.width + 'px', left: r.left + 'px', top: r.top + 'px' });
  document.body.appendChild(ghost);
  row.classList.add('dragging');
  DRAG = { id: g.dataset.grip, row, list, ghost, dy: e.clientY - r.top, overDay: null, pane: $('#p-plan'), y: e.clientY };
  try { g.setPointerCapture(e.pointerId); } catch (err) {}
  if (navigator.vibrate) navigator.vibrate(8);
  DRAG.scroll = setInterval(() => {
    if (!DRAG) return; const pr = DRAG.pane.getBoundingClientRect();
    if (DRAG.y < pr.top + 70) DRAG.pane.scrollTop -= 10; else if (DRAG.y > pr.bottom - 130) DRAG.pane.scrollTop += 10;
  }, 16);
});
document.addEventListener('pointermove', e => {
  if (!DRAG) return; e.preventDefault();
  const { ghost, row, list } = DRAG; DRAG.y = e.clientY;
  ghost.style.top = (e.clientY - DRAG.dy) + 'px';
  ghost.style.visibility = 'hidden'; const el = document.elementFromPoint(e.clientX, e.clientY); ghost.style.visibility = '';
  const chip = el && el.closest('.dchip'), target = chip && +chip.dataset.day !== S.planDay ? +chip.dataset.day : null;
  $$('.dchip').forEach(c => c.classList.toggle('drop', target != null && +c.dataset.day === target));
  ghost.classList.toggle('to-day', target != null);
  DRAG.overDay = target;
  if (target == null) {
    let before = null;
    for (const s of list.querySelectorAll('.ti:not(.dragging)')) { const b = s.getBoundingClientRect(); if (e.clientY < b.top + b.height / 2) { before = s; break; } }
    if (before !== row.nextElementSibling && !(before === null && row === list.lastElementChild)) flip(list, () => list.insertBefore(row, before));
  }
}, { passive: false });
function endDrag() {
  if (!DRAG) return;
  const { id, row, list, ghost, overDay } = DRAG; clearInterval(DRAG.scroll); DRAG = null;
  ghost.remove(); row.classList.remove('dragging'); $$('.dchip').forEach(c => c.classList.remove('drop'));
  if (overDay != null) { const it = PLAN.find(p => p.id === id); planUpdate(id, { day: overDay }); toast(`Moved “${it ? it.title : 'item'}” to ${dayName(overDay)}`); return; }
  const ids = [...list.querySelectorAll('.ti')].map(x => x.dataset.id), cur = dayItems(S.planDay).map(p => p.id);
  if (ids.join() !== cur.join()) planOrder(S.planDay, ids);
}
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

/* ---------- Chat ---------- */
let CHAT = [], chatLast = 0, chatTimer = null, chatReady = false;
const QUICK = ['On my way', 'At the pool', 'Dinner at 7?', 'Where is everyone?', 'Save us seats'];
function meMember() { return S.family && S.family.members.find(m => m.id === S.me); }
async function pollChat() {
  if (!shared()) return;
  try {
    const d = await api(`chat?after=${chatLast}`);
    const fresh = d.messages.filter(m => !CHAT.some(x => x.id === m.id));
    if (!chatReady) { chatReady = true; if (S.lastRead == null) { S.lastRead = fresh.length ? fresh[fresh.length - 1].id : 0; save(); } }
    if (fresh.length) {
      CHAT.push(...fresh); if (CHAT.length > 400) CHAT = CHAT.slice(-300);
      chatLast = CHAT[CHAT.length - 1].id;
      if (S.screen === 'app' && S.tab === 'chat') { drawMessages(); markRead(); }
      if (fresh.some(m => m.kind === 'plan' && m.member_id !== S.me)) { await loadPlan(); rerenderPlan(); }
      if (S.screen === 'app' && S.tab === 'today') renderTodayChat();
    }
    updateBadge();
  } catch (e) {}
}
function scheduleChat() {
  clearTimeout(chatTimer);
  const fast = S.screen === 'app' && S.tab === 'chat' && !document.hidden;
  chatTimer = setTimeout(async () => { await pollChat(); scheduleChat(); }, fast ? 2500 : 15000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { pollChat(); scheduleChat(); } });
async function reloadChat() {
  if (!shared()) return;
  try { const d = await api('chat?after=0'); CHAT = d.messages; chatLast = CHAT.length ? CHAT[CHAT.length - 1].id : 0; chatReady = true; if (S.tab === 'chat' && S.screen === 'app') { drawMessages(true); markRead(); } updateBadge(); } catch (e) {}
}
function markRead() { if (CHAT.length) { S.lastRead = CHAT[CHAT.length - 1].id; save(); } updateBadge(); }
function updateBadge() {
  const n = CHAT.filter(m => m.id > (S.lastRead || 0) && m.kind === 'text' && m.member_id !== S.me).length;
  const b = $('#chatBadge'); if (!b) return;
  b.textContent = n > 9 ? '9+' : String(n); b.hidden = !n || (S.tab === 'chat' && S.screen === 'app');
}
const hhmm = ts => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function dayLabel(ts) {
  const d = new Date(ts), t = new Date(), y = new Date(Date.now() - 864e5);
  if (d.toDateString() === t.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
function chatAvatar(m) {
  const p = m.member_id && findPerson(m.member_id);
  return p ? `<span class="av" style="${avStyle(p.m, p.i)}"></span>` : `<span class="av ini">${esc((m.name || '?')[0])}</span>`;
}
function drawMessages(scroll = true) {
  const list = $('#chatList'); if (!list) return;
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  let html = '', lastDay = '', prev = null;
  for (const m of CHAT) {
    const dl = dayLabel(m.created_at);
    if (dl !== lastDay) { html += `<div class="dsep"><span>${dl}</span></div>`; lastDay = dl; prev = null; }
    if (m.kind !== 'text') { html += `<div class="sys"${API.owner ? ` data-msg="${m.id}"` : ''}><i data-lucide="${m.kind === 'join' ? 'party-popper' : 'calendar-check'}"></i><span>${esc(m.text)}</span></div>`; prev = null; continue; }
    const mine = m.member_id === S.me, cont = prev && prev.member_id === m.member_id && m.created_at - prev.created_at < 5 * 60e3;
    const canRm = shared() && m.id < 1e15 && (API.owner || (m.family_id && m.family_id === S.myId));
    html += `<div class="msg${mine ? ' me' : ''}${cont ? ' cont' : ''}${m.pending ? ' pending' : ''}${canRm ? ' rm' : ''}"${canRm ? ` data-msg="${m.id}"` : ''}>${mine ? '' : cont ? '<span class="av sp"></span>' : chatAvatar(m)}<div class="col">${!mine && !cont ? `<span class="who">${esc(m.name)} <em>· ${esc(m.fam)}</em></span>` : ''}<div class="bub">${esc(m.text)}</div>${cont ? '' : `<span class="tm">${m.pending ? 'Sending…' : hhmm(m.created_at)}</span>`}</div></div>`;
    prev = m;
  }
  list.innerHTML = html || `<div class="chat-empty"><i data-lucide="message-circle-heart"></i><strong>Say hola to the crew</strong><span>Everyone from the five families sees this chat.</span></div>`;
  icons();
  if (scroll || atBottom) list.scrollTop = list.scrollHeight;
}
function renderChat() {
  const el = $('#p-chat');
  if (!shared()) {
    el.innerHTML = `<div class="chat-off card"><span class="tile"><i data-lucide="message-circle"></i></span><strong>Crew chat</strong><span>${isExample() ? 'Chat opens once your family is set up from the invite link.' : API.mode === 'server' ? 'Set up your family to join the chat.' : 'Chat works in the live app, opened from the invite link.'}</span>${isExample() ? '<button class="btn btn-primary" data-act="setup">Set up your family</button>' : ''}</div>`;
    return;
  }
  const me = meMember(), oth = others(), people = (S.family ? S.family.members.length : 0) + oth.reduce((a, f) => a + f.members.length, 0);
  el.innerHTML = `
    <div class="chat-head"><div><strong>Crew chat</strong><span>${1 + oth.length} ${oth.length ? 'families' : 'family'} · ${people} people</span></div>
      ${me ? `<button class="as" data-act="who-chat"><span class="av" style="${avStyle(me, S.family.members.indexOf(me))}"></span>${esc(me.name)}<i data-lucide="chevron-down"></i></button>` : ''}</div>
    <div class="chat-list" id="chatList"></div>
    <div class="chat-foot">
      ${me ? `<div class="quick">${QUICK.map(q => `<button data-quick="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <form class="composer" id="composer"><textarea id="chatIn" rows="1" maxlength="1000" placeholder="Message the crew" aria-label="Message the crew"></textarea><button type="submit" class="send" aria-label="Send"><i data-lucide="arrow-up"></i></button></form>`
      : `<div class="who-pick"><span>Who's chatting on this phone?</span><div class="who-row">${S.family.members.map((m, i) => `<button data-me="${m.id}"><span class="av" style="${avStyle(m, i)}"></span>${esc(m.name)}</button>`).join('')}</div></div>`}
    </div>`;
  drawMessages(true); markRead();
}
function renderTodayChat() {
  const box = $('#todayChat'); if (!box) return;
  const last = CHAT.filter(m => m.kind === 'text').slice(-2);
  box.innerHTML = last.length ? last.map(m => `<div class="tc">${chatAvatar(m)}<div><strong>${esc(m.name)}</strong><span>${esc(m.text)}</span></div><em>${hhmm(m.created_at)}</em></div>`).join('') : '<p class="tc-empty">No messages yet. Start the conversation.</p>';
}
async function sendChat(text) {
  text = (text || '').trim(); if (!text) return;
  const me = meMember(); if (!me) { toast("Pick who's chatting first"); return; }
  const tmp = { id: 1e15 + Date.now(), member_id: me.id, name: me.name, fam: S.family.name, kind: 'text', text, created_at: Date.now(), pending: true };
  CHAT.push(tmp); drawMessages(true);
  try { await api('chat', { method: 'POST', json: { member_id: me.id, text } }); CHAT = CHAT.filter(m => m !== tmp); await pollChat(); drawMessages(true); }
  catch (e) { CHAT = CHAT.filter(m => m !== tmp); drawMessages(true); toast(e.message); const i = $('#chatIn'); if (i && !i.value) i.value = text; }
}
document.addEventListener('submit', e => {
  if (e.target.id !== 'composer') return; e.preventDefault();
  const i = $('#chatIn'), v = i.value; i.value = ''; i.style.height = ''; sendChat(v);
});
document.addEventListener('keydown', e => {
  if (e.target.id === 'chatIn' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); }
});
document.addEventListener('input', e => { if (e.target.id === 'chatIn') { e.target.style.height = 'auto'; e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px'; } });
document.addEventListener('focusin', e => { if (e.target.id === 'chatIn') $('#s-app').classList.add('typing'); if (e.target.id === 'inviteLink') e.target.select(); });
document.addEventListener('focusout', e => { if (e.target.id === 'chatIn') setTimeout(() => $('#s-app').classList.remove('typing'), 120); });

function recordVisit() {
  let dev = '';
  try { dev = localStorage.getItem('cabocrew.dev') || ''; if (!dev) { dev = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join(''); localStorage.setItem('cabocrew.dev', dev); } } catch (e) { return; }
  fetch('/api/visit', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, hdrs()), body: JSON.stringify({ device: dev }) }).catch(() => {});
}
/* ---------- Trip album (organizer only) ---------- */
const MEDIA = new Map();   // key → { blob, url, name }
let ALBUM = null;
const KIND_LABEL = { fig: 'Figurine card', raw: 'AI figurine', photo: 'Original photo' };
const fileSafe = t => String(t).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
async function mediaBlob(key) {
  if (MEDIA.has(key)) return MEDIA.get(key);
  const [id, kind, v, fam, name] = key.split('|');
  const r = kind === 'fig'
    ? await fetch(`/api/fig/${encodeURIComponent(id)}?v=${v}&code=${encodeURIComponent(API.code)}`)
    : await fetch(`/api/media/${encodeURIComponent(id)}/${kind}`, { headers: hdrs() });
  if (!r.ok) throw new Error("Couldn't load that photo.");
  const blob = await r.blob(), item = { blob, url: URL.createObjectURL(blob), name: `cabo-crew-${fileSafe(fam)}-${fileSafe(name)}-${kind === 'fig' ? 'figurine-card' : kind === 'raw' ? 'ai-figurine' : 'original'}.jpg` };
  MEDIA.set(key, item); return item;
}
async function openAlbum(reuse) {
  openSheet(`<h3>Trip album</h3><p>Only you can see this. Tap a photo to save it.</p>
    <button class="btn btn-primary" data-act="album-zip"><i data-lucide="download"></i> Save everything (ZIP)</button>
    <div id="albumBody" class="album"><p class="mono" style="text-align:center;color:var(--ink-2)">Loading…</p></div>`);
  $('#sheet').classList.add('tall');
  try {
    if (!reuse || !ALBUM) ALBUM = (await api('album')).families;
    const keys = [];
    $('#albumBody').innerHTML = ALBUM.map(f => `<h4 class="mono">The ${esc(f.name)} family</h4>${f.members.map(m => {
      const tiles = [['fig', m.fig_v], ['raw', m.raw_v], ['photo', m.photo_v]].filter(([, v]) => v > 0)
        .map(([k, v]) => { const key = [m.id, k, v, f.name, m.name].join('|'); keys.push(key); return `<button class="atile" data-media="${esc(key)}"><img alt="${esc(m.name)}: ${KIND_LABEL[k]}" data-k="${esc(key)}"><span>${KIND_LABEL[k]}</span></button>`; }).join('');
      return `<div class="aperson"><strong>${esc(m.name)}</strong>${tiles ? `<div class="arow">${tiles}</div>` : `<span class="none">No photo yet</span>`}</div>`;
    }).join('')}`).join('') || '<p>No families yet.</p>';
    for (const key of keys) mediaBlob(key).then(it => { const im = document.querySelector(`img[data-k="${CSS.escape(key)}"]`); if (im) im.src = it.url; }).catch(() => {});
  } catch (e) { $('#albumBody').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
async function albumView(key) {
  const [, kind, , fam, name] = key.split('|');
  openSheet(`<div class="big-fig album-big"><img id="albumImg" alt="${esc(name)}: ${KIND_LABEL[kind]}"></div><h3>${esc(name)}</h3><p>The ${esc(fam)} family · ${KIND_LABEL[kind]}</p>
    <div class="row2"><button class="btn btn-ghost" data-act="album-share" data-key="${esc(key)}"><i data-lucide="share-2"></i> Share</button><button class="btn btn-primary" data-act="album-save" data-key="${esc(key)}"><i data-lucide="download"></i> Save</button></div>
    <button class="textlink" data-act="album-back">Back to album</button>`);
  try { $('#albumImg').src = (await mediaBlob(key)).url; } catch (e) { toast(e.message); }
}
function saveBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
}
async function albumSave(key) { try { const it = await mediaBlob(key); saveBlob(it.blob, it.name); toast('Saved to your Downloads'); } catch (e) { toast(e.message); } }
async function albumShare(key) {
  try {
    const it = await mediaBlob(key), file = new File([it.blob], it.name, { type: 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: it.name });
    else { saveBlob(it.blob, it.name); toast('Sharing isn’t available here, so it was saved instead'); }
  } catch (e) { if (e && e.name !== 'AbortError') toast("Couldn't share that photo."); }
}
async function albumZip(btn) {
  if (!ALBUM) return;
  btn.disabled = true; const label = btn.innerHTML; btn.textContent = 'Packing photos…';
  try {
    if (!window.JSZip) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
    const zip = new JSZip();
    for (const f of ALBUM) for (const m of f.members) for (const [k, v] of [['fig', m.fig_v], ['raw', m.raw_v], ['photo', m.photo_v]]) {
      if (!(v > 0)) continue;
      const it = await mediaBlob([m.id, k, v, f.name, m.name].join('|'));
      zip.folder(`The ${fileSafe(f.name)} family`).file(it.name, it.blob);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    saveBlob(blob, `cabo-crew-album-${new Date().toISOString().slice(0, 10)}.zip`); toast('Album saved to your Downloads');
  } catch (e) { toast("Couldn't make the ZIP. Try saving photos one by one."); }
  finally { btn.disabled = false; btn.innerHTML = label; icons(); }
}
/* ---------- Boot ---------- */
reg($('#heroCanvas'), (x, W, H, t) => drawDusk(x, W, H, t, { hz: .5, sunX: .28 }));
wireThumb();
icons();
(async () => {
  API.mode = await detect();
  await fonts();
  scenes.forEach(o => o.dirty = true);
  if (API.mode === 'locked') { $('#lockNote').hidden = false; $('#startBtn').hidden = true; }
  if (API.mode !== 'server') await loadPlan();
  if (API.mode === 'server') {
    try { await refresh(); } catch (e) { console.warn(e); }
    await loadPlan(); pollChat(); scheduleChat(); recordVisit();
    setInterval(async () => {
      if (document.hidden || S.screen !== 'app') return;
      try { if (await refresh()) { renderAll(); } } catch (e) {}
      if (!DRAG && !$('#sheet').classList.contains('on')) { const before = JSON.stringify(PLAN); await loadPlan(); if (JSON.stringify(PLAN) !== before) rerenderPlan(); }
    }, 30000);
  }
  let start = S.screen || 'intro';
  if (!S.family) start = start === 'family' ? 'family' : 'intro';
  if (API.mode === 'locked' && !(S.family && S.family.example)) start = 'intro';
  go(start);
})();
requestAnimationFrame(loop);

})();
