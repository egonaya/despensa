// Utilidades compartidas por todas las vistas.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const SLOTS = { desayuno: 'Desayuno', comida: 'Comida', cena: 'Cena' };
export const SLOT_ORDER = ['desayuno', 'comida', 'cena'];
export const DOW = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const DOWL = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MON = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const todayISO = () => iso(new Date());
export function parseISO(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export function addDays(s, n) {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}
export const diffDays = (a, b) => Math.round((parseISO(a) - parseISO(b)) / 864e5);
export const daysUntil = (s) => (s ? diffDays(s, todayISO()) : null);
export const dow = (s) => parseISO(s).getDay();
export const fmtDate = (s) => { const d = parseISO(s); return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; };
export const fmtDay = (s) => { const d = parseISO(s); return `${DOWL[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; };

export const r0 = (n) => Math.round(Number(n) || 0);
export const dec = (n, k = 1) => (Math.round((Number(n) || 0) * 10 ** k) / 10 ** k).toString().replace('.', ',');

export function fmtGrams(g, unit = 'g') {
  g = Number(g) || 0;
  if (g >= 1000) return `${dec(g / 1000, 2)} ${unit === 'ml' ? 'l' : 'kg'}`;
  return `${r0(g)} ${unit}`;
}

export const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

let toastTimer;
export function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = '';
  el.append(Object.assign(document.createElement('span'), { textContent: msg }));
  if (action) {
    const b = Object.assign(document.createElement('button'), { className: 'toast-btn', textContent: action.label });
    b.onclick = () => { el.classList.remove('show'); action.run(); };
    el.append(b);
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 6000 : 2600);
}
