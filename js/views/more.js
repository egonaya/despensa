// Vista "Más": objetivos, suplementos, recetario, alimentos y copia de seguridad.

import { $, esc, SLOTS, SLOT_ORDER, DOWL, todayISO, dec, r0, norm, toast, uid } from '../util.js';
import { PREP } from '../recipes.js';
import { SHOP_SECTIONS } from '../foods.js';
import { resolvePlan } from './plan.js';

let app;
let page = 'home';
let recipeFilter = 'all';
let recipeQuery = '';
let foodQuery = '';

const S = () => app.state;
const P = () => app.P;

const PAGES = {
  home: { title: 'Más', render: renderHome },
  goals: { title: 'Objetivos', render: renderGoals },
  supplements: { title: 'Suplementos', render: renderSupplements },
  recipes: { title: 'Recetario', render: renderRecipes },
  foods: { title: 'Alimentos', render: renderFoods },
  backup: { title: 'Copia de seguridad', render: renderBackup },
};

export function init(a) {
  app = a;
  app.openMore = (p) => { app.show('more'); open(p); };
  const el = $('#view-more');
  el.addEventListener('click', onClick);
  el.addEventListener('submit', onSubmit);
  el.addEventListener('input', onInput);
  el.addEventListener('change', onChange);
}

export function reset() { page = 'home'; }

function open(p) {
  page = p;
  render();
  window.scrollTo({ top: 0 });
}

export function render() {
  const def = PAGES[page] || PAGES.home;
  app.setBack(page === 'home' ? null : () => open('home'), def.title);
  $('#view-more').innerHTML = def.render();
}

// ---------- inicio ----------

function renderHome() {
  const { config, supplements, customRecipes, customFoods, products } = S();
  const ctx = app.ctx();
  const units = products.filter((p) => app.db.stockOf(p) > 0).length;
  const row = (p, title, sub) => `
    <button class="nav-row" data-open="${p}">
      <span class="grow"><b>${title}</b><span class="muted small block">${sub}</span></span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
    </button>`;
  return `
    <div class="card stats">
      <div><b>${units}</b><span>productos en casa</span></div>
      <div><b>${ctx.recipes.length}</b><span>recetas</span></div>
      <div><b>${supplements.length}</b><span>suplementos</span></div>
    </div>
    <div class="card list-card">
      ${row('goals', 'Objetivos y preferencias', `${config.kcal} kcal · P ${config.protein} · H ${config.carbs} · G ${config.fat}`)}
      ${row('supplements', 'Suplementos', supplements.length ? supplements.map((s) => esc(s.name)).join(', ') : 'Añade lo que tomas de HSN')}
      ${row('recipes', 'Recetario', `${ctx.recipes.length} recetas${customRecipes.length ? `, ${customRecipes.length} tuyas` : ''}`)}
      ${row('foods', 'Alimentos', `${ctx.foods.size} alimentos${customFoods.length ? `, ${customFoods.length} tuyos` : ''}`)}
      ${row('backup', 'Copia de seguridad', 'Exportar o importar tus datos')}
    </div>
    <p class="muted small">Datos de productos de <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a> (ODbL). Valores de alimentos genéricos según tablas españolas de composición. Orientativo: no sustituye el consejo de un profesional sanitario.</p>`;
}

// ---------- objetivos ----------

const TAGS = [
  ['pescado', 'Pescado'], ['azul', 'Pescado azul'], ['marisco', 'Marisco'], ['carne', 'Carne'],
  ['roja', 'Carne roja'], ['cerdo', 'Cerdo'], ['lacteo', 'Lácteos'], ['huevo', 'Huevo'], ['legumbre', 'Legumbres'],
];

function renderGoals() {
  const c = S().config;
  const s = P().supplementTotals(S().supplements);
  const kcalFromMacros = r0(c.protein * 4 + c.carbs * 4 + c.fat * 9);
  const ex = new Set(c.exclude || []);
  const num = (name, value, extra = '') => `<input name="${name}" type="number" inputmode="decimal" step="any" min="0" value="${value ?? ''}" ${extra}>`;
  const timeRow = (slot) => `
    <tr><td>${SLOTS[slot]}</td>
    <td>${num(`t_${slot}_work`, c.time[slot].work)}</td>
    <td>${num(`t_${slot}_free`, c.time[slot].free)}</td></tr>`;
  const foods = [...app.ctx().foods.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));

  return `
    <form class="stack" data-form="goals">
      <div class="card">
        <h2>Tu objetivo diario</h2>
        <div class="grid2">
          <label>kcal${num('kcal', c.kcal, 'required')}</label>
          <label>Proteína (g)${num('protein', c.protein, 'required')}</label>
          <label>Hidratos (g)${num('carbs', c.carbs, 'required')}</label>
          <label>Grasa (g)${num('fat', c.fat, 'required')}</label>
        </div>
        <p class="muted small">Tus macros suman ${kcalFromMacros} kcal. Los suplementos aportan ${r0(s.kcal)} kcal y ${r0(s.p)} g de proteína al día y ya se descuentan de la comida.</p>
      </div>

      <div class="card">
        <h2>Reparto entre comidas (%)</h2>
        <div class="grid3">
          ${SLOT_ORDER.map((sl) => `<label>${SLOTS[sl]}${num(`split_${sl}`, Math.round(c.split[sl] * 100))}</label>`).join('')}
        </div>
      </div>

      <div class="card">
        <h2>Comensales</h2>
        <div class="grid3">
          ${SLOT_ORDER.map((sl) => `<label>${SLOTS[sl]}<select name="d_${sl}">${[1, 2, 3, 4, 5, 6].map((n) => `<option ${n === c.diners[sl] ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`).join('')}
        </div>
        <div class="grid2">
          <label>Segunda persona<input name="partnerName" value="${esc(c.partner.name || '')}" placeholder="Mi mujer"></label>
          <label>Sus kcal diarias${num('partnerKcal', c.partner.kcal)}</label>
        </div>
        <p class="muted small">Su ración se calcula en proporción a sus kcal (${dec(P().partnerRatio(c), 2)} de la tuya). La lista de la compra suma las dos.</p>
      </div>

      <div class="card">
        <h2>Tiempo al momento de comer (min)</h2>
        <table class="mini">
          <thead><tr><th></th><th>Días de trabajo</th><th>Días libres</th></tr></thead>
          <tbody>${SLOT_ORDER.map(timeRow).join('')}</tbody>
        </table>
        <div class="lbl" style="margin-top:8px">Días que trabajas fuera</div>
        <div class="daypick">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<label><input type="checkbox" name="work" value="${d}" ${c.workDays.includes(d) ? 'checked' : ''}><span>${DOWL[d].slice(0, 2)}</span></label>`).join('')}</div>
        <label>Día de batch cooking
          <select name="batchDow">${[0, 1, 2, 3, 4, 5, 6].map((d) => `<option value="${d}" ${d === c.batchDow ? 'selected' : ''}>${DOWL[d]}</option>`).join('')}</select>
        </label>
      </div>

      <div class="card">
        <h2>No quiero en el menú</h2>
        <div class="tagpick">${TAGS.map(([t, label]) => `<label><input type="checkbox" name="exTag" value="tag:${t}" ${ex.has(`tag:${t}`) ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div>
        <details>
          <summary class="linkbtn">Alimentos concretos (${[...ex].filter((x) => !x.startsWith('tag:')).length})</summary>
          <div class="checklist">${foods.map((f) => `<label><input type="checkbox" name="exFood" value="${esc(f.id)}" ${ex.has(f.id) ? 'checked' : ''}> ${esc(f.name)}</label>`).join('')}</div>
        </details>
      </div>

      <button class="btn primary wide" type="submit">Guardar</button>
    </form>`;
}

async function saveGoals(form) {
  const fd = new FormData(form);
  const n = (k) => Number(fd.get(k)) || 0;
  const c = S().config;
  const split = Object.fromEntries(SLOT_ORDER.map((sl) => [sl, n(`split_${sl}`)]));
  const total = Object.values(split).reduce((a, b) => a + b, 0) || 100;
  const config = {
    ...c,
    kcal: n('kcal'), protein: n('protein'), carbs: n('carbs'), fat: n('fat'),
    split: Object.fromEntries(Object.entries(split).map(([k, v]) => [k, v / total])),
    diners: Object.fromEntries(SLOT_ORDER.map((sl) => [sl, n(`d_${sl}`) || 1])),
    partner: { ...c.partner, name: String(fd.get('partnerName') || '').trim(), kcal: n('partnerKcal') || null },
    time: Object.fromEntries(SLOT_ORDER.map((sl) => [sl, { work: n(`t_${sl}_work`), free: n(`t_${sl}_free`) }])),
    workDays: fd.getAll('work').map(Number),
    batchDow: n('batchDow'),
    exclude: [...fd.getAll('exTag'), ...fd.getAll('exFood')],
  };
  await app.saveConfig(config);
  if (S().plan) await resolvePlan();
  toast(S().plan ? 'Guardado. Raciones del menú reajustadas' : 'Guardado');
  open('home');
}

// ---------- suplementos ----------

const TIMINGS = ['Desayuno', 'Comida', 'Cena', 'Pre-entreno', 'Post-entreno', 'Antes de dormir'];

function renderSupplements() {
  const list = S().supplements;
  const t = P().supplementTotals(list);
  return `
    <p class="muted">Sus kcal y macros se restan de tu objetivo antes de calcular las comidas. Al marcarlos en el plan se descuentan las dosis, y cuando queda menos de una semana pasan a la lista de la compra.</p>
    <div class="card">
      <div class="row between"><b>Al día</b><span class="chips-row"><span class="pill num">${r0(t.kcal)} kcal</span><span class="pill mp num">P ${r0(t.p)}</span><span class="pill mc num">H ${r0(t.c)}</span><span class="pill mf num">G ${r0(t.f)}</span></span></div>
    </div>
    <ul class="list">${list.map((s) => `
      <li class="item" data-supp="${esc(s.id)}">
        <div class="thumb placeholder">${esc((s.name || '?').charAt(0))}</div>
        <div class="item-main">
          <div class="item-name">${esc(s.name)}</div>
          <div class="item-meta">${esc([s.brand, s.dose, s.timing].filter(Boolean).join(' · '))}</div>
          <div class="tags">${+s.kcal ? `<span class="tag">${r0(s.kcal)} kcal</span>` : ''}${+s.protein ? `<span class="tag">P ${dec(s.protein)}</span>` : ''}${s.stock != null && s.stock !== '' ? `<span class="tag ${Number(s.stock) < P().perDay(s) * 7 ? 'warn' : ''}">Quedan ${dec(s.stock)} dosis</span>` : ''}</div>
        </div>
      </li>`).join('')}</ul>
    <button class="btn primary wide" data-act="new-supp">Añadir suplemento</button>`;
}

function openSupplement(s = {}) {
  const num = (name, v, ph = '') => `<input name="${name}" type="number" step="any" min="0" inputmode="decimal" value="${v ?? ''}" placeholder="${ph}">`;
  app.openSheet(`
    <form class="stack" data-form="supp">
      <h2>${s.id ? 'Editar suplemento' : 'Nuevo suplemento'}</h2>
      <label>Nombre<input name="name" required value="${esc(s.name || '')}" placeholder="Evolate 2.0 chocolate"></label>
      <div class="grid2">
        <label>Marca<input name="brand" value="${esc(s.brand ?? 'HSN')}"></label>
        <label>Dosis<input name="dose" value="${esc(s.dose || '')}" placeholder="1 cazo (30 g)"></label>
      </div>
      <div class="lbl">Por dosis</div>
      <div class="grid2">
        <label>kcal${num('kcal', s.kcal, '0')}</label>
        <label>Proteína (g)${num('protein', s.protein, '0')}</label>
        <label>Hidratos (g)${num('carbs', s.carbs, '0')}</label>
        <label>Grasa (g)${num('fat', s.fat, '0')}</label>
      </div>
      <div class="grid2">
        <label>Dosis al día${num('perDay', s.perDay ?? 1)}</label>
        <label>Cuándo<select name="timing">${TIMINGS.map((t) => `<option ${t === s.timing ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Dosis que te quedan${num('stock', s.stock, 'opcional')}</label>
        <label>Código de barras<input name="barcode" inputmode="numeric" value="${esc(s.barcode || '')}"></label>
      </div>
      <label>Notas<textarea name="notes" rows="2">${esc(s.notes || '')}</textarea></label>
      <div class="row">
        ${s.id ? '<button class="btn danger" type="button" data-act="del">Eliminar</button>' : ''}
        <button class="btn ghost" type="button" data-close>Cancelar</button>
        <button class="btn primary" type="submit">Guardar</button>
      </div>
    </form>`,
  async (e) => {
    if (e.type === 'click' && e.target.closest('[data-act="del"]')) {
      if (!confirm(`¿Eliminar ${s.name}?`)) return;
      await app.db.deleteSupplement(s.id);
      app.closeSheet();
      await afterSupplements();
      return;
    }
    if (e.type !== 'submit') return;
    const f = Object.fromEntries(new FormData(e.target));
    const n = (k) => (f[k] === '' ? null : Number(f[k]));
    await app.db.saveSupplement({
      ...s, id: s.id || uid(), name: f.name.trim(), brand: f.brand.trim(), dose: f.dose.trim(),
      kcal: n('kcal') || 0, protein: n('protein') || 0, carbs: n('carbs') || 0, fat: n('fat') || 0,
      perDay: n('perDay') ?? 1, timing: f.timing, stock: n('stock'), barcode: f.barcode.trim(), notes: f.notes.trim(),
    });
    app.closeSheet();
    await afterSupplements();
  });
}

async function afterSupplements() {
  await app.refresh();
  if (S().plan) await resolvePlan();
  toast('Guardado');
}

// ---------- recetario ----------

function recipeMacros(r) {
  return P().itemsMacros(r.ing, app.ctx());
}

function renderRecipes() {
  const ctx = app.ctx();
  const hidden = new Set(S().config.hiddenRecipes || []);
  const q = norm(recipeQuery);
  let list = ctx.recipes.filter((r) => !q || norm(r.name).includes(q) || r.ing.some((i) => norm(ctx.foods.get(i.food)?.name).includes(q)));
  if (SLOT_ORDER.includes(recipeFilter)) list = list.filter((r) => r.slots.includes(recipeFilter));
  if (recipeFilter === 'mine') list = list.filter((r) => !r.builtin);
  if (recipeFilter === 'hidden') list = list.filter((r) => hidden.has(r.id));
  list.sort((a, b) => SLOT_ORDER.indexOf(a.slots[0]) - SLOT_ORDER.indexOf(b.slots[0]) || a.name.localeCompare(b.name, 'es'));
  const chip = (id, label) => `<button class="chip ${recipeFilter === id ? 'active' : ''}" data-rfilter="${id}">${label}</button>`;
  return `
    <div class="search">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input data-input="recipe-q" type="search" placeholder="Buscar receta o ingrediente" value="${esc(recipeQuery)}" autocomplete="off">
    </div>
    <div class="chips">${chip('all', 'Todas')}${chip('desayuno', 'Desayunos')}${chip('comida', 'Comidas')}${chip('cena', 'Cenas')}${chip('mine', 'Mías')}${chip('hidden', 'Ocultas')}</div>
    <button class="btn primary wide" data-act="new-recipe" style="margin:0 0 12px">Nueva receta</button>
    <ul class="list" id="recipe-list">${list.map((r) => {
      const m = recipeMacros(r);
      return `
      <li class="item ${hidden.has(r.id) ? 'muted-row' : ''}" data-recipe="${esc(r.id)}">
        <div class="item-main">
          <div class="item-name">${esc(r.name)}</div>
          <div class="item-meta">${r.slots.map((s) => SLOTS[s]).join(', ')} · ${r.min} min al momento${r.prep.length ? ' · se adelanta' : ''}</div>
          <div class="tags"><span class="tag">${r0(m.kcal)} kcal base</span><span class="tag">P ${r0(m.p)}</span>${r.builtin ? '' : '<span class="tag ok">Tuya</span>'}${hidden.has(r.id) ? '<span class="tag">Oculta</span>' : ''}</div>
        </div>
      </li>`;
    }).join('') || '<li class="empty">Ninguna receta coincide.</li>'}</ul>`;
}

function openRecipe(id) {
  const ctx = app.ctx();
  const r = ctx.recipeMap.get(id);
  const hidden = (S().config.hiddenRecipes || []).includes(id);
  const m = recipeMacros(r);
  const ROLE = { P: 'proteína', C: 'hidratos', F: 'grasa', V: 'fijo' };
  app.openSheet(`
    <div class="lbl">${r.slots.map((s) => SLOTS[s]).join(' · ')}${r.builtin ? '' : ' · tuya'}</div>
    <h2>${esc(r.name)}</h2>
    <div class="chips-row" style="margin:6px 0"><span class="pill num">${r0(m.kcal)} kcal</span><span class="pill mp num">P ${r0(m.p)}</span><span class="pill mc num">H ${r0(m.c)}</span><span class="pill mf num">G ${r0(m.f)}</span></div>
    <p class="muted small">Ración base para una persona. En el menú, las cantidades de proteína, hidratos y grasa se ajustan a tus macros de ese día.</p>
    <table class="ing"><tbody>${r.ing.map((i) => `<tr><td>${esc(ctx.foods.get(i.food)?.name || i.food)}</td><td class="num">${esc(app.qtyText(i.food, i.g))}</td><td class="muted small">${ROLE[i.role]}</td></tr>`).join('')}</tbody></table>
    ${r.prep.length ? `<h3 class="h3">Se adelanta</h3><ul class="plain">${r.prep.map((k) => `<li>${esc(PREP[k]?.task || k)} <span class="muted small">(aguanta ${PREP[k]?.keeps} días)</span></li>`).join('')}</ul>` : ''}
    ${r.night.length ? `<h3 class="h3">La noche anterior</h3><ul class="plain">${r.night.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    <h3 class="h3">Al momento · ${r.min} min</h3>
    <ol class="steps">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <div class="actions">
      ${r.builtin ? '<button class="btn" data-act="dup">Duplicar y editar</button>' : '<button class="btn" data-act="edit">Editar</button>'}
      <button class="btn" data-act="hide">${hidden ? 'Volver a usar en el menú' : 'No usar en el menú'}</button>
      ${r.builtin ? '' : '<button class="btn danger" data-act="del">Eliminar</button>'}
    </div>
    <button class="btn ghost wide" data-close>Cerrar</button>`,
  async (e) => {
    if (e.type !== 'click') return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'dup') openRecipeEditor({ ...structuredClone(r), id: null, name: `${r.name} (mía)`, builtin: false });
    if (act === 'edit') openRecipeEditor(structuredClone(r));
    if (act === 'hide') {
      const c = S().config;
      const set = new Set(c.hiddenRecipes || []);
      if (set.has(id)) set.delete(id); else set.add(id);
      await app.saveConfig({ ...c, hiddenRecipes: [...set] });
      openRecipe(id);
    }
    if (act === 'del') {
      if (!confirm(`¿Eliminar la receta "${r.name}"?`)) return;
      await app.db.deleteRecipe(id);
      app.closeSheet();
      await app.refresh();
      toast('Receta eliminada');
    }
  });
}

function ingRow(i = { food: '', g: '', role: 'P' }) {
  return `
    <div class="ing-row">
      <select name="food" required><option value="">Alimento…</option>${app.foodOptions(i.food, { allowNone: false })}</select>
      <input name="g" type="number" min="1" step="any" inputmode="decimal" value="${i.g}" placeholder="g" required>
      <select name="role">${[['P', 'Proteína'], ['C', 'Hidratos'], ['F', 'Grasa'], ['V', 'Fijo']].map(([v, l]) => `<option value="${v}" ${v === i.role ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="icon-btn" type="button" data-act="del-ing" aria-label="Quitar ingrediente"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    </div>`;
}

function openRecipeEditor(r = {}) {
  const slots = new Set(r.slots || ['comida']);
  app.openSheet(`
    <form class="stack" data-form="recipe">
      <h2>${r.id ? 'Editar receta' : 'Nueva receta'}</h2>
      <label>Nombre<input name="name" required value="${esc(r.name || '')}"></label>
      <div class="tagpick">${SLOT_ORDER.map((s) => `<label><input type="checkbox" name="slots" value="${s}" ${slots.has(s) ? 'checked' : ''}><span>${SLOTS[s]}</span></label>`).join('')}</div>
      <label>Minutos al momento de comer (con lo adelantado hecho)<input name="min" type="number" min="0" inputmode="numeric" required value="${r.min ?? 10}"></label>
      <div class="lbl">Ingredientes por persona (en crudo)</div>
      <p class="muted small">El papel indica qué se ajusta a tus macros: proteína, hidratos o grasa. "Fijo" no cambia (verdura, especias…). En los que van por unidades, escribe su peso: 2 huevos = 110 g.</p>
      <div id="ing-rows">${(r.ing?.length ? r.ing : [undefined, undefined, undefined]).map((i) => ingRow(i)).join('')}</div>
      <button class="btn ghost small" type="button" data-act="add-ing">Añadir ingrediente</button>
      <label>Pasos al momento (uno por línea)<textarea name="steps" rows="4">${esc((r.steps || []).join('\n'))}</textarea></label>
      <details ${r.prep?.length ? 'open' : ''}>
        <summary class="linkbtn">Qué se puede adelantar (${r.prep?.length || 0})</summary>
        <div class="checklist">${Object.entries(PREP).map(([k, p]) => `<label><input type="checkbox" name="prep" value="${k}" ${r.prep?.includes(k) ? 'checked' : ''}> ${esc(p.task)}</label>`).join('')}</div>
      </details>
      <label>Para la noche anterior (uno por línea)<textarea name="night" rows="2" placeholder="Pasa el pescado del congelador a la nevera">${esc((r.night || []).join('\n'))}</textarea></label>
      <div class="row"><button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Guardar receta</button></div>
    </form>`,
  async (e) => {
    if (e.type === 'click') {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'add-ing') $('#ing-rows').insertAdjacentHTML('beforeend', ingRow());
      if (act === 'del-ing') e.target.closest('.ing-row').remove();
      return;
    }
    if (e.type !== 'submit') return;
    const form = e.target;
    const fd = new FormData(form);
    const ing = [...form.querySelectorAll('.ing-row')].map((row) => ({
      food: row.querySelector('[name=food]').value,
      g: Number(row.querySelector('[name=g]').value),
      role: row.querySelector('[name=role]').value,
    })).filter((i) => i.food && i.g > 0);
    const slotsSel = fd.getAll('slots');
    if (!slotsSel.length) return toast('Elige al menos una comida del día');
    if (!ing.some((i) => i.role !== 'V')) return toast('Marca al menos un ingrediente como proteína, hidratos o grasa');
    const lines = (k) => String(fd.get(k) || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const recipe = {
      id: r.id && !r.builtin ? r.id : `u_${uid()}`,
      name: String(fd.get('name')).trim(), slots: slotsSel, min: Number(fd.get('min')) || 0,
      ing, steps: lines('steps'), prep: fd.getAll('prep'), night: lines('night'), builtin: false,
    };
    await app.db.saveRecipe(recipe);
    app.closeSheet();
    await app.refresh();
    toast('Receta guardada: ya puede salir en el menú');
    if (page === 'recipes') render();
  });
}

// ---------- alimentos ----------

function renderFoods() {
  const q = norm(foodQuery);
  const foods = [...app.ctx().foods.values()]
    .filter((f) => !q || norm(f.name).includes(q))
    .sort((a, b) => (a.builtin === b.builtin ? a.name.localeCompare(b.name, 'es') : a.builtin ? 1 : -1));
  return `
    <p class="muted">Valores por 100 g (o 100 ml). Los productos que escaneas se vinculan a uno de estos alimentos; si el producto trae etiqueta, el menú usa sus valores reales.</p>
    <div class="search">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input data-input="food-q" type="search" placeholder="Buscar alimento" value="${esc(foodQuery)}" autocomplete="off">
    </div>
    <button class="btn primary wide" data-act="new-food" style="margin:0 0 12px">Nuevo alimento</button>
    <ul class="list" id="food-list">${foods.map((f) => `
      <li class="item compact" data-food="${esc(f.id)}">
        <div class="item-main">
          <div class="item-name">${esc(f.name)}</div>
          <div class="item-meta">${esc(f.cat)} · ${r0(f.kcal)} kcal · P ${dec(f.p)} · H ${dec(f.c)} · G ${dec(f.f)}${f.u === 'ud' && f.ug ? ` · ${f.ug} g/ud.` : ''}</div>
        </div>
        ${f.builtin ? '' : '<span class="tag ok">Tuyo</span>'}
      </li>`).join('')}</ul>`;
}

function openFood(f = {}) {
  const editable = !f.builtin;
  const num = (name, v) => `<input name="${name}" type="number" step="any" min="0" inputmode="decimal" value="${v ?? ''}" required ${editable ? '' : 'disabled'}>`;
  app.openSheet(`
    <form class="stack" data-form="food">
      <h2>${f.id ? esc(f.name) : 'Nuevo alimento'}</h2>
      ${editable ? '' : '<p class="muted small">Alimento de la tabla base: no se puede editar. Crea uno tuyo si necesitas otros valores.</p>'}
      <label>Nombre<input name="name" required value="${esc(f.name || '')}" ${editable ? '' : 'disabled'}></label>
      <label>Sección del súper<select name="cat" ${editable ? '' : 'disabled'}>${SHOP_SECTIONS.map((s) => `<option ${s === (f.cat || 'Otros') ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <div class="lbl">Por 100 g o 100 ml</div>
      <div class="grid2">
        <label>kcal${num('kcal', f.kcal)}</label>
        <label>Proteína (g)${num('p', f.p)}</label>
        <label>Hidratos (g)${num('c', f.c)}</label>
        <label>Grasa (g)${num('f', f.f)}</label>
      </div>
      <div class="grid2">
        <label>Se cuenta en<select name="u" ${editable ? '' : 'disabled'}>${[['g', 'Gramos'], ['ml', 'Mililitros'], ['ud', 'Unidades']].map(([v, l]) => `<option value="${v}" ${v === (f.u || 'g') ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Peso por unidad (g)<input name="ug" type="number" step="any" min="0" value="${f.ug ?? ''}" ${editable ? '' : 'disabled'}></label>
        <label>Aguanta (días)<input name="keeps" type="number" min="0" value="${f.keeps ?? ''}" ${editable ? '' : 'disabled'}></label>
        <label>Grupos<input name="tags" value="${esc((f.tags || []).join(', '))}" placeholder="pescado, azul" ${editable ? '' : 'disabled'}></label>
      </div>
      <label>Palabras para reconocerlo al escanear<input name="kw" value="${esc((f.kw || []).join(', '))}" placeholder="kéfir, kefir natural" ${editable ? '' : 'disabled'}></label>
      <div class="row">
        ${f.id && editable ? '<button class="btn danger" type="button" data-act="del">Eliminar</button>' : ''}
        <button class="btn ghost" type="button" data-close>${editable ? 'Cancelar' : 'Cerrar'}</button>
        ${editable ? '<button class="btn primary" type="submit">Guardar</button>' : ''}
      </div>
    </form>`,
  async (e) => {
    if (e.type === 'click' && e.target.closest('[data-act="del"]')) {
      const used = app.ctx().recipes.some((r) => r.ing.some((i) => i.food === f.id));
      if (used) return toast('Lo usa alguna receta: quítalo de ella antes');
      if (!confirm(`¿Eliminar ${f.name}?`)) return;
      await app.db.deleteFood(f.id);
      app.closeSheet();
      await app.refresh();
      return;
    }
    if (e.type !== 'submit') return;
    const d = Object.fromEntries(new FormData(e.target));
    const list = (s) => String(s || '').split(',').map((x) => norm(x)).filter(Boolean);
    await app.db.saveFood({
      id: f.id || `u_${uid()}`, name: d.name.trim(), cat: d.cat,
      kcal: Number(d.kcal), p: Number(d.p), c: Number(d.c), f: Number(d.f),
      u: d.u, ug: Number(d.ug) || null, step: d.u === 'ud' ? null : 5, keeps: Number(d.keeps) || null,
      tags: list(d.tags), kw: [norm(d.name), ...list(d.kw)], custom: true,
    });
    app.closeSheet();
    await app.refresh();
    toast('Alimento guardado');
  });
}

// ---------- copia ----------

function renderBackup() {
  return `
    <div class="card">
      <h2>Exportar</h2>
      <p class="muted">Los datos solo están en este dispositivo. Guarda una copia de vez en cuando, o úsala para pasarlos a otro móvil.</p>
      <button class="btn" data-act="export">Exportar copia</button>
    </div>
    <div class="card">
      <h2>Importar</h2>
      <p class="muted">Una copia completa sustituye todo lo que hay en la app. Un archivo de ajustes (objetivos y suplementos) solo los añade.</p>
      <label class="btn">Elegir archivo<input id="import" type="file" accept="application/json,.json" hidden></label>
    </div>`;
}

async function exportData() {
  const data = await app.db.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const name = `despensa-${todayISO()}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Copia de Despensa' }); return; } catch { /* cancelado */ }
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    const full = app.db.isFullBackup(data);
    const msg = full
      ? `Esto sustituye todos tus datos por los de la copia (${data.products.length} productos). ¿Continuar?`
      : `Se añadirán tus objetivos${data.supplements?.length ? ` y ${data.supplements.length} suplementos` : ''}. ¿Continuar?`;
    if (!confirm(msg)) return;
    await app.db.importAll(data);
    await app.refresh();
    if (S().plan) await resolvePlan();
    toast(full ? 'Copia restaurada' : 'Ajustes importados');
    open('home');
  } catch (err) {
    toast(err.message || 'No se pudo leer el archivo');
  }
}

// ---------- eventos ----------

function onClick(e) {
  const t = e.target;
  const openBtn = t.closest('[data-open]');
  if (openBtn) return open(openBtn.dataset.open);
  const rf = t.closest('[data-rfilter]');
  if (rf) { recipeFilter = rf.dataset.rfilter; return render(); }
  const act = t.closest('[data-act]')?.dataset.act;
  if (act === 'new-supp') return openSupplement();
  if (act === 'new-recipe') return openRecipeEditor();
  if (act === 'new-food') return openFood();
  if (act === 'export') return exportData();
  const supp = t.closest('[data-supp]');
  if (supp) return openSupplement(S().supplements.find((s) => s.id === supp.dataset.supp));
  const rec = t.closest('[data-recipe]');
  if (rec) return openRecipe(rec.dataset.recipe);
  const food = t.closest('[data-food]');
  if (food) return openFood(app.ctx().foods.get(food.dataset.food));
}

function onSubmit(e) {
  if (e.target.dataset.form === 'goals') { e.preventDefault(); saveGoals(e.target); }
}

// Al buscar solo se repinta la lista, para no perder el foco del campo.
function onInput(e) {
  const which = e.target.dataset.input;
  if (!which) return;
  if (which === 'recipe-q') recipeQuery = e.target.value;
  if (which === 'food-q') foodQuery = e.target.value;
  const tmp = document.createElement('div');
  tmp.innerHTML = PAGES[page].render();
  const id = which === 'recipe-q' ? '#recipe-list' : '#food-list';
  $(id).replaceWith(tmp.querySelector(id));
}

function onChange(e) {
  if (e.target.id === 'import' && e.target.files[0]) {
    importData(e.target.files[0]);
    e.target.value = '';
  }
}
