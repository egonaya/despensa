import * as db from './db.js';
import { FOODS, guessFood, SHOP_SECTIONS } from './foods.js';
import { RECIPES } from './recipes.js';
import * as P from './planner.js';
import { lookup } from './off.js';
import { startScanner } from './scanner.js';
import { $, $$, esc, todayISO, addDays, daysUntil, dec, fmtGrams, norm, toast, uid } from './util.js';
import * as planView from './views/plan.js';
import * as moreView from './views/more.js';

const SOON_DAYS = 7;

const state = {
  view: 'plan',
  filter: 'all',
  query: '',
  products: [],
  shopping: [],
  supplements: [],
  customRecipes: [],
  customFoods: [],
  config: P.withDefaults(),
  plan: null,
  prevPlan: null,
  ctx: null,
};

// ---------- contexto para el planificador ----------

function buildCtx() {
  const foods = new Map(FOODS.map((f) => [f.id, f]));
  state.customFoods.forEach((f) => foods.set(f.id, { tags: [], kw: [], step: 5, ...f }));
  const recipeMap = new Map(RECIPES.map((r) => [r.id, r]));
  state.customRecipes.forEach((r) => recipeMap.set(r.id, { prep: [], night: [], ...r }));
  return {
    config: state.config,
    supplements: state.supplements,
    products: state.products,
    foods,
    recipes: [...recipeMap.values()],
    recipeMap,
    labelNutr: P.labelNutrition(state.products),
    prevPlan: state.prevPlan,
  };
}

// ---------- utilidades de presentación ----------

const byName = (a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
const lowProducts = () => state.products.filter((p) => db.isLow(p)).sort(byName);
const lowSupplements = () => state.supplements.filter((s) => s.stock != null && s.stock !== '' && Number(s.stock) < P.perDay(s) * 7);

function qtyText(foodId, g) {
  const food = state.ctx.foods.get(foodId);
  if (!food) return fmtGrams(g);
  if (food.u === 'ud' && food.ug) {
    // Redondeo hacia arriba a medias unidades: 7,9 huevos → 8; 0,4 aguacates → 0,5.
    const n = Math.max(0.5, Math.ceil((g / food.ug) * 2 - 0.3) / 2);
    return `${dec(n)} ud.`;
  }
  return fmtGrams(g, food.u === 'ml' ? 'ml' : 'g');
}

function stockText(p) {
  const n = db.stockOf(p);
  return p.unit === 'ud' ? dec(n, n % 1 ? 1 : 0) : fmtGrams(n, p.unit);
}

function expiryLabel(isoDate) {
  const days = daysUntil(isoDate);
  if (days === null) return '';
  if (days < 0) return days === -1 ? 'Caducó ayer' : `Caducó hace ${-days} días`;
  if (days === 0) return 'Caduca hoy';
  if (days === 1) return 'Caduca mañana';
  if (days <= 30) return `Caduca en ${days} días`;
  return 'Caduca el ' + new Date(isoDate + 'T00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

const expiryClass = (isoDate) => {
  const days = daysUntil(isoDate);
  if (days === null) return '';
  if (days < 0) return 'danger';
  if (days <= SOON_DAYS) return 'warn';
  return '';
};

const initial = (name) => esc((name || '?').trim().charAt(0).toUpperCase());

function thumb(product, cls = 'thumb') {
  return product.image
    ? `<img class="${cls}" src="${esc(product.image)}" alt="" loading="lazy" data-initial="${initial(product.name)}">`
    : `<div class="${cls} placeholder">${initial(product.name)}</div>`;
}

// Si una foto no carga (p. ej. sin conexión), muestra la inicial del producto.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.initial) return;
  img.replaceWith(Object.assign(document.createElement('div'), { className: `${img.className} placeholder`, textContent: img.dataset.initial }));
}, true);

function scores(product) {
  let html = '';
  if (product.nutriscore) html += `<span class="ns ns-${product.nutriscore}" title="Nutri-Score">Nutri-Score ${product.nutriscore.toUpperCase()}</span>`;
  if (product.nova) html += `<span class="ns nova-${product.nova}" title="Grado de procesado NOVA">NOVA ${product.nova}</span>`;
  return html;
}

function foodOptions(selected, { allowNone = true, newFromLabel = false } = {}) {
  const groups = new Map();
  [...state.ctx.foods.values()].sort(byName).forEach((f) => {
    const cat = f.cat || 'Otros';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(f);
  });
  let html = allowNone ? `<option value="">— Ninguno (no se usa en el menú) —</option>` : '';
  if (newFromLabel) html += `<option value="__new">➕ Crear alimento nuevo con su etiqueta</option>`;
  for (const cat of SHOP_SECTIONS) {
    const list = groups.get(cat);
    if (!list) continue;
    html += `<optgroup label="${esc(cat)}">${list.map((f) => `<option value="${esc(f.id)}" ${f.id === selected ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</optgroup>`;
  }
  return html;
}

// ---------- carga y render ----------

async function refresh() {
  const [products, shopping, supplements, customRecipes, customFoods, config, plan, prevPlan] = await Promise.all([
    db.allProducts(), db.allShopping(), db.allSupplements(), db.allRecipes(), db.allFoods(),
    db.getSetting('config'), db.getSetting('plan'), db.getSetting('prevPlan'),
  ]);
  Object.assign(state, { products, shopping, supplements, customRecipes, customFoods, plan, prevPlan, config: P.withDefaults(config || {}) });
  state.ctx = buildCtx();
  render();
}

function render() {
  if (state.view === 'plan') planView.render();
  if (state.view === 'pantry') renderPantry();
  if (state.view === 'shopping') renderShopping();
  if (state.view === 'more') moreView.render();
  renderBadges();
}

function renderBadges() {
  const pending = shoppingCount();
  const badge = $('#shopping-count');
  badge.hidden = !pending;
  badge.textContent = pending;
  const urgent = state.products.some((p) => p.batches.some((b) => b.expiry && daysUntil(b.expiry) <= 2));
  $('#expiry-dot').hidden = !urgent;
  $('#plan-dot').hidden = !planView.hasTasksToday();

  const sub = $('#view-subtitle');
  if (state.view === 'pantry') {
    const n = state.products.filter((p) => db.stockOf(p) > 0).length;
    sub.textContent = n ? `${n} ${n === 1 ? 'producto' : 'productos'}` : '';
  } else if (state.view === 'plan') {
    sub.textContent = `${state.config.kcal} kcal`;
  } else sub.textContent = '';
}

function shoppingCount() {
  return P.planNeeds(state.plan, state.ctx).length + lowProducts().length + lowSupplements().length
    + state.shopping.filter((s) => !s.done).length;
}

// ---------- navegación ----------

let backHandler = null;
function setBack(fn, title) {
  backHandler = fn;
  $('#back').hidden = !fn;
  $('#view-title').textContent = title || $(`#view-${state.view}`).dataset.title;
}
$('#back').addEventListener('click', () => backHandler?.());

function show(view) {
  state.view = view;
  $$('.view').forEach((v) => { v.hidden = v.id !== `view-${view}`; });
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  setBack(null);
  if (view === 'more') moreView.reset();
  render();
  window.scrollTo({ top: 0 });
}

$$('.tab').forEach((t) => t.addEventListener('click', () => show(t.dataset.view)));

$$('.chip[data-filter]').forEach((c) => c.addEventListener('click', () => {
  state.filter = c.dataset.filter;
  $$('.chip[data-filter]').forEach((x) => x.classList.toggle('active', x === c));
  renderPantry();
}));

$('#search').addEventListener('input', (e) => { state.query = e.target.value; renderPantry(); });

// Cerrar hojas con los botones [data-close] o tocando fuera.
$$('dialog').forEach((d) => {
  d.addEventListener('click', (e) => {
    if (e.target === d || e.target.closest('[data-close]')) d.close();
  });
});

// ---------- hoja genérica ----------

const sheet = $('#sheet');
let sheetHandler = null;

function openSheet(html, onClick) {
  $('#sheet-body').innerHTML = html;
  sheetHandler = onClick || null;
  if (!sheet.open) sheet.showModal();
  sheet.scrollTop = 0;
}
const closeSheet = () => sheet.open && sheet.close();
sheet.addEventListener('click', (e) => sheetHandler?.(e));
sheet.addEventListener('submit', (e) => { e.preventDefault(); sheetHandler?.(e); });
sheet.addEventListener('change', (e) => sheetHandler?.(e));

// ---------- despensa ----------

function renderPantry() {
  const q = norm(state.query);
  let items = state.products.filter((p) => !q || [p.name, p.brand, p.category].some((v) => norm(v).includes(q)));

  if (state.filter === 'low') items = items.filter((p) => db.isLow(p) && db.stockOf(p) > 0);
  if (state.filter === 'empty') items = items.filter((p) => db.stockOf(p) === 0);
  if (state.filter === 'expiring') items = items.filter((p) => { const d = daysUntil(db.nextExpiry(p)); return d !== null && d <= SOON_DAYS; });
  if (state.filter === 'unlinked') items = items.filter((p) => !p.foodId);

  items.sort((a, b) => (db.stockOf(b) > 0) - (db.stockOf(a) > 0)
    || (db.nextExpiry(a) || '9999').localeCompare(db.nextExpiry(b) || '9999') * (state.filter === 'expiring' ? 1 : 0)
    || byName(a, b));

  const soon = state.products.filter((p) => db.stockOf(p) > 0 && (daysUntil(db.nextExpiry(p)) ?? 99) <= 3);
  $('#pantry-alert').innerHTML = soon.length && state.filter === 'all' && !q
    ? `<div class="alert"><b>Caduca pronto:</b> ${soon.map((p) => `${esc(p.name)} (${esc(expiryLabel(db.nextExpiry(p)).toLowerCase())})`).join(', ')}</div>` : '';

  const list = $('#pantry-list');
  if (!state.products.length) {
    list.innerHTML = `<li class="empty"><b>Tu despensa está vacía</b>Pulsa el botón verde para escanear lo que has comprado, o añade a mano la fruta, la carne o lo que vaya a granel.</li>`;
    return;
  }
  if (!items.length) {
    list.innerHTML = `<li class="empty">Nada por aquí.</li>`;
    return;
  }

  list.innerHTML = items.map((p) => {
    const stock = db.stockOf(p);
    const exp = db.nextExpiry(p);
    const tags = [];
    if (stock === 0) tags.push('<span class="tag danger">Agotado</span>');
    else if (db.isLow(p)) tags.push('<span class="tag warn">Se acaba</span>');
    if (exp && stock > 0) {
      const cls = expiryClass(exp);
      if (cls) tags.push(`<span class="tag ${cls}">${esc(expiryLabel(exp))}</span>`);
    }
    if (!p.foodId) tags.push('<span class="tag">Sin vincular al menú</span>');
    if (p.nutriscore) tags.push(`<span class="ns ns-${p.nutriscore}">${p.nutriscore.toUpperCase()}</span>`);
    const meta = [p.brand, p.quantityLabel].filter(Boolean).join(' · ');
    const control = p.unit === 'ud'
      ? `<div class="stepper">
          <button data-act="minus" aria-label="Gastar una" ${stock ? '' : 'disabled'}>−</button>
          <span class="count">${stockText(p)}</span>
          <button data-act="plus" aria-label="Añadir">+</button>
        </div>`
      : `<div class="amount">${stockText(p)}</div>`;
    return `
      <li class="item" data-id="${esc(p.id)}">
        ${thumb(p)}
        <div class="item-main">
          <div class="item-name">${esc(p.name)}</div>
          ${meta ? `<div class="item-meta">${esc(meta)}</div>` : ''}
          ${tags.length ? `<div class="tags">${tags.join('')}</div>` : ''}
        </div>
        ${control}
      </li>`;
  }).join('');
}

async function onPantryClick(e) {
  const li = e.target.closest('[data-id]');
  if (!li) return;
  const id = li.dataset.id;
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'minus') {
    const { product: p } = await db.consume(id, 1);
    if (db.stockOf(p) === 0) toast(`${p.name}: agotado, añadido a la compra`);
    else if (db.isLow(p)) toast(`${p.name}: se está acabando`);
    await refresh();
  } else if (act === 'plus') {
    openStock(await db.getProduct(id));
  } else {
    openProduct(id);
  }
}
$('#pantry-list').addEventListener('click', onPantryClick);
$('#manual-add-pantry').addEventListener('click', () => openProductForm({ barcode: '' }));

// ---------- detalle de producto ----------

async function openProduct(id) {
  const p = await db.getProduct(id);
  if (!p) return;
  const stock = db.stockOf(p);
  const batches = [...p.batches].sort((a, b) => (a.expiry || '9999').localeCompare(b.expiry || '9999'));
  const meta = [p.brand, p.quantityLabel, p.category].filter(Boolean).join(' · ');
  const food = p.foodId && state.ctx.foods.get(p.foodId);
  const n = p.per100 || food;
  const unitLabel = p.unit === 'ud' ? (stock === 1 ? 'unidad' : 'unidades') : p.unit;

  openSheet(`
    <div class="sheet-head">
      ${p.image ? `<img src="${esc(p.image)}" alt="">` : thumb(p)}
      <div>
        <h2>${esc(p.name)}</h2>
        ${meta ? `<p class="muted small">${esc(meta)}</p>` : ''}
        <div class="scores">${scores(p)}</div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      ${p.unit === 'ud' ? `
      <div class="row center">
        <div class="grow">
          <b class="big">${stockText(p)}</b> ${unitLabel}
          <div class="muted small">${p.minStock ? `Avisar con menos de ${dec(p.minStock)}` : 'Sin aviso de mínimo'}${p.unitGrams ? ` · ${fmtGrams(p.unitGrams)} cada una` : ''}</div>
        </div>
        <div class="stepper">
          <button data-act="minus" aria-label="Gastar una" ${stock ? '' : 'disabled'}>−</button>
          <button data-act="plus" aria-label="Añadir">+</button>
        </div>
      </div>` : `
      <form class="row center" data-form="set">
        <label class="grow">Cantidad en casa (${p.unit})<input name="qty" type="number" min="0" step="any" value="${Math.round(stock)}" inputmode="decimal"></label>
        <button class="btn" type="submit">Guardar</button>
        <button class="btn" type="button" data-act="plus">Añadir</button>
      </form>`}
      ${batches.length ? `<div>${batches.map((b) => `
        <div class="batch">
          <div class="grow">
            <b>${p.unit === 'ud' ? dec(b.qty, b.qty % 1 ? 1 : 0) : fmtGrams(b.qty, p.unit)}</b>
            <span class="tag ${expiryClass(b.expiry)}">${b.expiry ? esc(expiryLabel(b.expiry)) : 'Sin fecha'}</span>
          </div>
          <button class="icon-btn" data-batch="${esc(b.id)}" aria-label="Quitar este lote">
            <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>
          </button>
        </div>`).join('')}</div>` : ''}
    </div>

    <div class="card">
      <label>Alimento para el menú
        <select data-act="link">${foodOptions(p.foodId)}</select>
      </label>
      ${n ? `<p class="muted small">Por 100 ${p.unit === 'ml' ? 'ml' : 'g'}${p.per100 ? ' (etiqueta)' : ''}: ${Math.round(n.kcal)} kcal · P ${dec(n.p)} · H ${dec(n.c)} · G ${dec(n.f)}</p>` : ''}
      ${!p.foodId ? '<p class="muted small">Vincúlalo a un alimento para que el planificador lo use y lo descuente al cocinar.</p>' : ''}
    </div>

    ${p.nutriscore || p.nova ? `<p class="muted small">
      ${p.nutriscore ? `Nutri-Score ${p.nutriscore.toUpperCase()}: calidad nutricional, de A (mejor) a E. ` : ''}
      ${p.nova ? `NOVA ${p.nova}: grado de procesado, de 1 (sin procesar) a 4 (ultraprocesado).` : ''}
    </p>` : ''}

    <div class="row">
      <button class="btn" data-act="edit">Editar</button>
      <button class="btn danger" data-act="delete">Eliminar</button>
    </div>
    ${p.barcode ? `<p class="muted small center-text">Código ${esc(p.barcode)}${p.nutriscore || p.image ? ` · <a href="https://world.openfoodfacts.org/product/${encodeURIComponent(p.barcode)}" target="_blank" rel="noopener">Ver en Open Food Facts</a>` : ''}</p>` : ''}
    <button class="btn ghost wide" data-close>Cerrar</button>`,
  async (e) => {
    if (e.type === 'change' && e.target.dataset.act === 'link') {
      const prod = await db.getProduct(id);
      prod.foodId = e.target.value || null;
      const f = state.ctx.foods.get(prod.foodId);
      if (f && prod.unit === 'ud' && !prod.unitGrams && f.ug) prod.unitGrams = f.ug;
      await db.saveProduct(prod);
      toast(f ? `Vinculado a ${f.name}` : 'Ya no se usa en el menú');
      await refresh();
      return openProduct(id);
    }
    if (e.type === 'submit' && e.target.dataset.form === 'set') {
      const qty = Number(new FormData(e.target).get('qty'));
      if (qty >= 0) { await db.setStock(id, qty); toast('Cantidad actualizada'); await refresh(); openProduct(id); }
      return;
    }
    if (e.type !== 'click') return;
    const batchBtn = e.target.closest('[data-batch]');
    if (batchBtn) {
      await db.removeBatch(id, batchBtn.dataset.batch);
      await refresh();
      return openProduct(id);
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'minus') { await db.consume(id, 1); await refresh(); openProduct(id); }
    if (act === 'plus') openStock(await db.getProduct(id));
    if (act === 'edit') { closeSheet(); openProductForm(await db.getProduct(id), '', true); }
    if (act === 'delete') {
      const prod = await db.getProduct(id);
      if (!confirm(`¿Eliminar "${prod.name}" de la despensa?`)) return;
      await db.deleteProduct(id);
      closeSheet();
      toast('Producto eliminado');
      await refresh();
    }
  });
}

// ---------- lista de la compra ----------

function renderShopping() {
  const needs = P.planNeeds(state.plan, state.ctx);
  const low = lowProducts().filter((p) => !needs.some((n) => n.food.id === p.foodId));
  const supps = lowSupplements();
  const extras = [...state.shopping].sort((a, b) => a.done - b.done || a.createdAt - b.createdAt);
  const el = $('#shopping-list');

  if (!needs.length && !low.length && !supps.length && !extras.length) {
    el.innerHTML = `<div class="empty"><b>No falta nada</b>Cuando genere el menú, aquí aparecerá lo que te falta para hacerlo. Lo que baje del mínimo también entra solo.</div>`;
    $('#share-list').hidden = true;
    return;
  }
  $('#share-list').hidden = false;

  let html = '';
  if (needs.length) {
    html += `<h3 class="group-title">Para el menú de la semana</h3>`;
    for (const section of SHOP_SECTIONS) {
      const group = needs.filter((n) => (n.food.cat || 'Otros') === section).sort((a, b) => byName(a.food, b.food));
      if (!group.length) continue;
      html += `<div class="section-label">${esc(section)}</div>` + group.map((n) => `
        <div class="check-item" data-need="${esc(n.food.id)}">
          <div class="item-main">
            <div class="item-name">${esc(n.food.name)}</div>
            <div class="item-meta">${esc(qtyText(n.food.id, n.missing))}${n.have > 0 ? ` · tienes ${esc(qtyText(n.food.id, n.have))}` : ''}</div>
          </div>
          <button class="btn small primary" data-act="bought-need">Comprado</button>
        </div>`).join('');
    }
  }
  if (low.length) {
    html += `<h3 class="group-title">Se está acabando</h3>` + low.map((p) => `
      <div class="check-item" data-id="${esc(p.id)}">
        ${thumb(p)}
        <div class="item-main">
          <div class="item-name">${esc(p.name)}</div>
          <div class="item-meta">${db.stockOf(p) ? `Quedan ${stockText(p)}` : 'Agotado'} · mínimo ${dec(p.minStock ?? 1)}</div>
        </div>
        <button class="btn small primary" data-act="bought">Comprado</button>
      </div>`).join('');
  }
  if (supps.length) {
    html += `<h3 class="group-title">Suplementos</h3>` + supps.map((s) => `
      <div class="check-item" data-supp="${esc(s.id)}">
        <div class="item-main">
          <div class="item-name">${esc(s.name)}</div>
          <div class="item-meta">${esc(s.brand || 'HSN')} · quedan ${dec(s.stock)} dosis (${Math.floor(s.stock / Math.max(1, P.perDay(s)))} días)</div>
        </div>
        <button class="btn small primary" data-act="bought-supp">Comprado</button>
      </div>`).join('');
  }
  if (extras.length) {
    html += `<h3 class="group-title">Añadido a mano</h3>` + extras.map((s) => `
      <div class="check-item ${s.done ? 'done' : ''}" data-shop="${esc(s.id)}">
        <input type="checkbox" ${s.done ? 'checked' : ''} aria-label="Marcar ${esc(s.name)}">
        <div class="item-main"><div class="item-name">${esc(s.name)}</div></div>
        <button class="icon-btn" data-act="delete" aria-label="Quitar">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </div>`).join('');
    if (extras.some((s) => s.done)) html += `<button class="btn ghost small" data-act="clear-done">Quitar los marcados</button>`;
  }
  el.innerHTML = html;
}

$('#shopping-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#shopping-input');
  const name = input.value.trim();
  if (!name) return;
  await db.saveShopping({ id: uid(), name, done: false });
  input.value = '';
  await refresh();
});

// Al comprar algo del menú se añade a la despensa como producto genérico de ese alimento.
async function addFoodToPantry(foodId, grams) {
  const food = state.ctx.foods.get(foodId);
  const unit = food.u === 'ud' ? 'ud' : food.u;
  const qty = unit === 'ud' ? grams / food.ug : grams;
  const expiry = food.keeps && food.keeps <= 30 ? addDays(todayISO(), food.keeps) : null;
  let product = state.products.find((p) => p.foodId === foodId && !p.barcode && p.unit === unit);
  if (product) {
    product = await db.addStock(product.id, qty, expiry);
  } else {
    product = await db.saveProduct({
      id: uid(), barcode: null, name: food.name, brand: '', image: '', quantityLabel: '', category: food.cat,
      foodId, unit, unitGrams: food.ug || null, per100: null, minStock: 0, nutriscore: null, nova: null,
      batches: [{ id: uid(), qty, expiry, addedAt: Date.now() }],
    });
  }
  return { product, qty };
}

$('#shopping-list').addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'clear-done') {
    await Promise.all(state.shopping.filter((s) => s.done).map((s) => db.deleteShopping(s.id)));
    return refresh();
  }
  if (act === 'bought-need') {
    const foodId = e.target.closest('[data-need]').dataset.need;
    const need = P.planNeeds(state.plan, state.ctx).find((n) => n.food.id === foodId);
    const { product, qty } = await addFoodToPantry(foodId, need.missing);
    await refresh();
    toast(`${need.food.name}: ${qtyText(foodId, need.missing)} a la despensa`, {
      label: 'Deshacer',
      run: async () => { await db.consume(product.id, qty); await refresh(); },
    });
    return;
  }
  if (act === 'bought-supp') {
    const s = state.supplements.find((x) => x.id === e.target.closest('[data-supp]').dataset.supp);
    const add = prompt(`¿Cuántas dosis trae el envase de ${s.name}?`, s.packDoses || '');
    const n = Number(add);
    if (!(n > 0)) return;
    await db.saveSupplement({ ...s, stock: Number(s.stock || 0) + n, packDoses: n });
    toast(`${s.name}: ahora quedan ${dec(Number(s.stock || 0) + n)} dosis`);
    return refresh();
  }
  const shopRow = e.target.closest('[data-shop]');
  if (shopRow) {
    const item = state.shopping.find((s) => s.id === shopRow.dataset.shop);
    if (act === 'delete') await db.deleteShopping(item.id);
    else if (e.target.matches('input[type=checkbox]')) await db.saveShopping({ ...item, done: e.target.checked });
    else return;
    return refresh();
  }
  const row = e.target.closest('[data-id]');
  if (!row) return;
  const p = await db.getProduct(row.dataset.id);
  if (act === 'bought') openStock(p, Math.max(1, (p.minStock ?? 1) - db.stockOf(p)));
  else openProduct(p.id);
});

$('#share-list').addEventListener('click', async () => {
  const lines = [];
  const needs = P.planNeeds(state.plan, state.ctx);
  for (const section of SHOP_SECTIONS) {
    const group = needs.filter((n) => (n.food.cat || 'Otros') === section);
    if (group.length) lines.push(`\n${section}`, ...group.map((n) => `• ${n.food.name}: ${qtyText(n.food.id, n.missing)}`));
  }
  const low = lowProducts().filter((p) => !needs.some((n) => n.food.id === p.foodId));
  const others = [
    ...low.map((p) => `• ${p.name}${p.brand ? ` (${p.brand})` : ''}`),
    ...lowSupplements().map((s) => `• ${s.name} (${s.brand || 'HSN'})`),
    ...state.shopping.filter((s) => !s.done).map((s) => `• ${s.name}`),
  ];
  if (others.length) lines.push('\nOtros', ...others);
  const text = `Lista de la compra${lines.join('\n')}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Lista de la compra', text });
    else { await navigator.clipboard.writeText(text); toast('Lista copiada'); }
  } catch { /* el usuario canceló */ }
});

// ---------- escáner ----------

let stopScan = null;
const scannerSheet = $('#scanner-sheet');

async function openScanner() {
  scannerSheet.showModal();
  $('#manual-code').value = '';
  const status = $('#scanner-status');
  status.textContent = 'Abriendo la cámara…';
  try {
    stopScan = await startScanner($('#scanner-video'), (code) => handleCode(code));
    if (scannerSheet.open) status.textContent = 'Apunta al código de barras';
    else closeScanner();
  } catch (err) {
    status.textContent = err.name === 'NotAllowedError'
      ? 'Sin permiso para la cámara. Escribe el código abajo.'
      : (err.message || 'No se pudo abrir la cámara. Escribe el código abajo.');
  }
}

function closeScanner() {
  stopScan?.();
  stopScan = null;
}

scannerSheet.addEventListener('close', closeScanner);
$('#scan-btn').addEventListener('click', openScanner);

$('#manual-code-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('#manual-code').value.replace(/\D/g, '');
  if (code.length >= 6) handleCode(code);
  else toast('Escribe un código de barras válido');
});

$('#manual-add').addEventListener('click', () => { scannerSheet.close(); openProductForm({ barcode: '' }); });

async function handleCode(code) {
  closeScanner();
  $('#scanner-status').textContent = `Código ${code}…`;

  const existing = await db.findByBarcode(code);
  if (existing) {
    scannerSheet.close();
    openStock(existing);
    return;
  }

  $('#scanner-status').textContent = 'Buscando en Open Food Facts…';
  let info = null;
  let note = '';
  try {
    info = await lookup(code);
    if (!info) note = 'No está en Open Food Facts. Rellena los datos a mano.';
  } catch {
    note = 'Sin conexión. Rellena los datos a mano.';
  }
  scannerSheet.close();
  const food = info && guessFood(`${info.name} ${info.category}`, [...state.ctx.foods.values()]);
  openProductForm({ barcode: code, unit: 'ud', ...(info || {}), foodId: food?.id || (info?.per100 ? '__new' : '') }, note);
}

// ---------- formulario de producto ----------

const productSheet = $('#product-sheet');
const productForm = $('#product-form');
let editing = null;

function syncUnitFields() {
  const f = productForm.elements;
  const unit = f.unit.value;
  $('#pf-ug-wrap').hidden = unit !== 'ud';
  $('#pf-qty-label').textContent = unit === 'ud' ? 'Unidades' : `Cantidad (${unit})`;
  $('#pf-min-label').textContent = unit === 'ud' ? 'Avisar con menos de (ud.)' : `Avisar con menos de (${unit})`;
}

function openProductForm(data, note = '', isEdit = false) {
  editing = { ...data, isEdit };
  productForm.reset();
  const f = productForm.elements;
  $('#pf-food').innerHTML = foodOptions(data.foodId, { newFromLabel: !!data.per100 });
  f.foodId.value = data.foodId || '';
  f.name.value = data.name || '';
  f.brand.value = data.brand || '';
  f.quantityLabel.value = data.quantityLabel || '';
  f.category.value = data.category || '';
  f.unit.value = data.unit || 'ud';
  f.unitGrams.value = data.unitGrams || '';
  f.minStock.value = data.minStock ?? (f.unit.value === 'ud' ? 1 : 0);
  f.barcode.value = data.barcode || '';
  f.qty.value = 1;
  f.expiry.value = '';
  f.expiry.min = todayISO();
  syncUnitFields();
  $('#pf-initial').hidden = isEdit;
  $('#pf-title').textContent = isEdit ? 'Editar producto' : (data.name ? 'Producto encontrado' : 'Nuevo producto');
  $('#pf-note').textContent = note || (!isEdit && !data.barcode ? 'Elige primero el alimento: rellena el nombre y la unidad.' : '');
  $('#pf-scores').innerHTML = scores(data);
  const img = $('#pf-image');
  img.hidden = !data.image;
  if (data.image) img.src = data.image;
  productSheet.showModal();
}

productForm.elements.unit.addEventListener('change', syncUnitFields);

// Al elegir alimento en un producto sin código, propone nombre, unidad y caducidad.
productForm.elements.foodId.addEventListener('change', () => {
  const f = productForm.elements;
  const food = state.ctx.foods.get(f.foodId.value);
  if (!food || editing.barcode || editing.isEdit) return;
  if (!f.name.value || state.ctx.foods.has(editing.lastAutoFood) && f.name.value === state.ctx.foods.get(editing.lastAutoFood).name) f.name.value = food.name;
  editing.lastAutoFood = food.id;
  f.unit.value = food.u === 'ud' ? 'ud' : food.u;
  f.unitGrams.value = food.ug || '';
  f.category.value = food.cat;
  f.minStock.value = 0;
  f.qty.value = food.u === 'ud' ? 6 : 500;
  if (food.keeps && food.keeps <= 30) f.expiry.value = addDays(todayISO(), food.keeps);
  syncUnitFields();
});

productForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = productForm.elements;
  const barcode = f.barcode.value.replace(/\D/g, '') || null;

  if (!editing.isEdit && barcode) {
    const dup = await db.findByBarcode(barcode);
    if (dup) {
      productSheet.close();
      openStock(dup);
      toast('Ese producto ya estaba en tu despensa');
      return;
    }
  }

  let foodId = f.foodId.value || null;
  if (foodId === '__new' && editing.per100) {
    const food = {
      id: `u_${uid()}`, name: f.name.value.trim(), cat: 'Otros', ...editing.per100,
      u: f.unit.value === 'ml' ? 'ml' : 'g', ug: null, step: 5, keeps: null,
      kw: [norm(f.name.value)], tags: [], custom: true,
    };
    await db.saveFood(food);
    foodId = food.id;
  }

  const base = editing.isEdit ? await db.getProduct(editing.id) : {
    id: uid(), image: editing.image || '', nutriscore: editing.nutriscore || null,
    nova: editing.nova || null, per100: editing.per100 || null, batches: [],
  };
  const product = {
    ...base,
    name: f.name.value.trim(),
    brand: f.brand.value.trim(),
    quantityLabel: f.quantityLabel.value.trim(),
    category: f.category.value.trim(),
    unit: f.unit.value,
    unitGrams: f.unit.value === 'ud' ? (Number(f.unitGrams.value) || null) : null,
    minStock: Math.max(0, Number(f.minStock.value) || 0),
    foodId,
    barcode,
  };
  const qty = Number(f.qty.value) || 0;
  if (!editing.isEdit && qty > 0) product.batches.push({ id: uid(), qty, expiry: f.expiry.value || null, addedAt: Date.now() });

  await db.saveProduct(product);
  productSheet.close();
  toast(editing.isEdit ? 'Guardado' : `${product.name} añadido a la despensa`);
  await refresh();
  if (editing.isEdit) openProduct(product.id);
});

// ---------- añadir cantidad ----------

const stockSheet = $('#stock-sheet');
const stockForm = $('#stock-form');
let stockTarget = null;

function openStock(product, qty) {
  stockTarget = product;
  stockForm.reset();
  const ud = product.unit === 'ud';
  stockForm.elements.qty.value = qty ?? (ud ? 1 : 500);
  stockForm.elements.expiry.min = todayISO();
  const food = state.ctx.foods.get(product.foodId);
  if (food?.keeps && food.keeps <= 30) stockForm.elements.expiry.value = addDays(todayISO(), food.keeps);
  $('#sf-qty-label').textContent = ud ? 'Unidades' : `Cantidad (${product.unit})`;
  $('#sf-title').textContent = product.name;
  $('#sf-note').textContent = `Ahora tienes ${stockText(product)}${ud ? (db.stockOf(product) === 1 ? ' unidad' : ' unidades') : ''}`;
  const img = $('#sf-image');
  img.hidden = !product.image;
  if (product.image) img.src = product.image;
  closeSheet();
  stockSheet.showModal();
}

stockForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const qty = Number(stockForm.elements.qty.value);
  if (!(qty > 0)) return;
  const p = await db.addStock(stockTarget.id, qty, stockForm.elements.expiry.value);
  stockSheet.close();
  toast(`${p.name}: ahora tienes ${stockText(p)}`);
  await refresh();
});

// ---------- API para las vistas ----------

export const app = {
  state, db, P,
  refresh, render, show, setBack, openSheet, closeSheet, openStock, openProduct, openProductForm,
  qtyText, stockText, thumb, foodOptions, expiryLabel, expiryClass,
  ctx: () => state.ctx,
  async saveConfig(config) { await db.setSetting('config', config); await refresh(); },
  async savePlan(plan) { state.plan = plan; await db.setSetting('plan', plan); await refresh(); },
};

planView.init(app);
moreView.init(app);

// ---------- arranque ----------

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
navigator.storage?.persist?.();

// Al volver a la app (p. ej. al día siguiente) recalcula avisos y "hoy".
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

refresh();
