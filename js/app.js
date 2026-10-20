import * as db from './db.js';
import { lookup } from './off.js';
import { startScanner } from './scanner.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const SOON_DAYS = 7;

const state = {
  view: 'pantry',
  filter: 'all',
  query: '',
  products: [],
  shopping: [],
};

// ---------- utilidades ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

function daysUntil(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((Date.UTC(y, m - 1, d) - today) / 86400000);
}

function expiryLabel(iso) {
  const days = daysUntil(iso);
  if (days === null) return '';
  if (days < 0) return days === -1 ? 'Caducó ayer' : `Caducó hace ${-days} días`;
  if (days === 0) return 'Caduca hoy';
  if (days === 1) return 'Caduca mañana';
  if (days <= 30) return `Caduca en ${days} días`;
  return 'Caduca el ' + new Date(iso + 'T00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

const expiryClass = (iso) => {
  const days = daysUntil(iso);
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

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

const byName = (a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
const lowProducts = () => state.products.filter(db.isLow).sort(byName);

// ---------- carga y render ----------

async function refresh() {
  [state.products, state.shopping] = await Promise.all([db.allProducts(), db.allShopping()]);
  render();
}

function render() {
  renderPantry();
  renderExpiry();
  renderShopping();
  renderMore();
  renderBadges();
}

function renderBadges() {
  const pending = lowProducts().length + state.shopping.filter((s) => !s.done).length;
  const badge = $('#shopping-count');
  badge.hidden = !pending;
  badge.textContent = pending;
  const urgent = state.products.some((p) => p.batches.some((b) => b.expiry && daysUntil(b.expiry) <= 2));
  $('#expiry-dot').hidden = !urgent;

  const total = state.products.reduce((n, p) => n + db.stockOf(p), 0);
  $('#view-subtitle').textContent = state.view === 'pantry' && state.products.length
    ? `${total} ${total === 1 ? 'unidad' : 'unidades'}` : '';
}

function renderPantry() {
  const q = state.query.trim().toLowerCase();
  let items = state.products.filter((p) =>
    !q || [p.name, p.brand, p.category].some((v) => v?.toLowerCase().includes(q)));

  if (state.filter === 'low') items = items.filter((p) => db.isLow(p) && db.stockOf(p) > 0);
  if (state.filter === 'empty') items = items.filter((p) => db.stockOf(p) === 0);
  if (state.filter === 'expiring') items = items.filter((p) => { const d = daysUntil(db.nextExpiry(p)); return d !== null && d <= SOON_DAYS; });

  // Primero lo que hay, luego lo agotado.
  items.sort((a, b) => (db.stockOf(b) > 0) - (db.stockOf(a) > 0) || byName(a, b));

  const list = $('#pantry-list');
  if (!state.products.length) {
    list.innerHTML = `<li class="empty"><b>Tu despensa está vacía</b>Pulsa el botón verde para escanear lo que has comprado.</li>`;
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
    if (p.nutriscore) tags.push(`<span class="ns ns-${p.nutriscore}">${p.nutriscore.toUpperCase()}</span>`);
    const meta = [p.brand, p.quantityLabel].filter(Boolean).join(' · ');
    return `
      <li class="item" data-id="${esc(p.id)}">
        ${thumb(p)}
        <div class="item-main">
          <div class="item-name">${esc(p.name)}</div>
          ${meta ? `<div class="item-meta">${esc(meta)}</div>` : ''}
          ${tags.length ? `<div class="tags">${tags.join('')}</div>` : ''}
        </div>
        <div class="stepper">
          <button data-act="minus" aria-label="Gastar una" ${stock ? '' : 'disabled'}>−</button>
          <span class="count">${stock}</span>
          <button data-act="plus" aria-label="Añadir una">+</button>
        </div>
      </li>`;
  }).join('');
}

function renderExpiry() {
  const rows = [];
  for (const p of state.products) {
    for (const b of p.batches) if (b.expiry) rows.push({ p, b, days: daysUntil(b.expiry) });
  }
  rows.sort((x, y) => x.b.expiry.localeCompare(y.b.expiry));

  const groups = [
    { title: 'Caducado', cls: 'danger', test: (d) => d < 0 },
    { title: 'Próximos 3 días', cls: 'warn', test: (d) => d >= 0 && d <= 3 },
    { title: 'Esta semana', cls: 'warn', test: (d) => d > 3 && d <= SOON_DAYS },
    { title: 'Este mes', cls: '', test: (d) => d > SOON_DAYS && d <= 30 },
    { title: 'Más adelante', cls: '', test: (d) => d > 30 },
  ];

  const el = $('#expiry-list');
  if (!rows.length) {
    el.innerHTML = `<div class="empty"><b>Sin fechas de caducidad</b>Añade la fecha al guardar un producto y aquí verás lo que tienes que gastar antes.</div>`;
    return;
  }
  el.innerHTML = groups.map((g) => {
    const items = rows.filter((r) => g.test(r.days));
    if (!items.length) return '';
    return `<h3 class="group-title ${g.cls}">${g.title}</h3><ul class="list">` + items.map(({ p, b }) => `
      <li class="item" data-id="${esc(p.id)}">
        ${thumb(p)}
        <div class="item-main">
          <div class="item-name">${esc(p.name)}</div>
          <div class="tags"><span class="tag ${expiryClass(b.expiry)}">${esc(expiryLabel(b.expiry))}</span>
          <span class="tag">${b.qty} ${b.qty === 1 ? 'ud.' : 'uds.'}</span></div>
        </div>
      </li>`).join('') + '</ul>';
  }).join('');
}

function renderShopping() {
  const low = lowProducts();
  const extras = [...state.shopping].sort((a, b) => a.done - b.done || a.createdAt - b.createdAt);
  const el = $('#shopping-list');

  if (!low.length && !extras.length) {
    el.innerHTML = `<div class="empty"><b>No falta nada</b>Cuando algo baje del mínimo aparecerá aquí solo.</div>`;
    $('#share-list').hidden = true;
    return;
  }
  $('#share-list').hidden = false;

  let html = '';
  if (low.length) {
    html += `<h3 class="group-title">Se está acabando</h3>` + low.map((p) => {
      const stock = db.stockOf(p);
      return `
      <div class="check-item" data-id="${esc(p.id)}">
        ${thumb(p)}
        <div class="item-main">
          <div class="item-name">${esc(p.name)}</div>
          <div class="item-meta">${stock ? `Quedan ${stock}` : 'Agotado'} · mínimo ${p.minStock ?? 1}</div>
        </div>
        <button class="btn small primary" data-act="bought">Comprado</button>
      </div>`;
    }).join('');
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

function renderMore() {
  const total = state.products.reduce((n, p) => n + db.stockOf(p), 0);
  const expiring = state.products.filter((p) => { const d = daysUntil(db.nextExpiry(p)); return d !== null && d <= SOON_DAYS; }).length;
  $('#stats').innerHTML = `
    <div><b>${state.products.length}</b><span>productos</span></div>
    <div><b>${total}</b><span>unidades</span></div>
    <div><b>${expiring}</b><span>caducan pronto</span></div>`;
}

// ---------- navegación ----------

function show(view) {
  state.view = view;
  $$('.view').forEach((v) => { v.hidden = v.id !== `view-${view}`; });
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  $('#view-title').textContent = $(`#view-${view}`).dataset.title;
  renderBadges();
  window.scrollTo({ top: 0 });
}

$$('.tab').forEach((t) => t.addEventListener('click', () => show(t.dataset.view)));

$$('.chip').forEach((c) => c.addEventListener('click', () => {
  state.filter = c.dataset.filter;
  $$('.chip').forEach((x) => x.classList.toggle('active', x === c));
  renderPantry();
}));

$('#search').addEventListener('input', (e) => { state.query = e.target.value; renderPantry(); });

// Cerrar hojas con los botones [data-close] o tocando fuera.
$$('dialog').forEach((d) => {
  d.addEventListener('click', (e) => {
    if (e.target === d || e.target.closest('[data-close]')) d.close();
  });
});

// ---------- lista de la despensa / caducidad ----------

async function onListClick(e) {
  const li = e.target.closest('[data-id]');
  if (!li) return;
  const id = li.dataset.id;
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'minus') {
    const p = await db.consume(id, 1);
    if (db.stockOf(p) === 0) toast(`${p.name}: agotado, añadido a la compra`);
    else if (db.isLow(p)) toast(`${p.name}: se está acabando`);
    await refresh();
  } else if (act === 'plus') {
    openStock(await db.getProduct(id));
  } else if (act === 'bought') {
    const p = await db.getProduct(id);
    openStock(p, Math.max(1, (p.minStock ?? 1) - db.stockOf(p)));
  } else {
    openDetail(id);
  }
}
$('#pantry-list').addEventListener('click', onListClick);
$('#expiry-list').addEventListener('click', onListClick);

// ---------- lista de la compra ----------

$('#shopping-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#shopping-input');
  const name = input.value.trim();
  if (!name) return;
  await db.saveShopping({ id: db.uid(), name, done: false });
  input.value = '';
  await refresh();
});

$('#shopping-list').addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'clear-done') {
    await Promise.all(state.shopping.filter((s) => s.done).map((s) => db.deleteShopping(s.id)));
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
  return onListClick(e);
});

$('#share-list').addEventListener('click', async () => {
  const lines = [
    ...lowProducts().map((p) => `• ${p.name}${p.brand ? ` (${p.brand})` : ''}`),
    ...state.shopping.filter((s) => !s.done).map((s) => `• ${s.name}`),
  ];
  const text = `Lista de la compra\n${lines.join('\n')}`;
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

const openManual = () => { scannerSheet.close(); openProductForm({ barcode: '' }); };
$('#manual-add').addEventListener('click', openManual);
$('#manual-add-2').addEventListener('click', openManual);

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
  openProductForm({ barcode: code, ...(info || {}) }, note);
}

// ---------- formulario de producto ----------

const productSheet = $('#product-sheet');
const productForm = $('#product-form');
let editing = null; // producto en edición, o datos del nuevo

function openProductForm(data, note = '', isEdit = false) {
  editing = { ...data, isEdit };
  productForm.reset();
  const f = productForm.elements;
  f.name.value = data.name || '';
  f.brand.value = data.brand || '';
  f.quantityLabel.value = data.quantityLabel || '';
  f.category.value = data.category || '';
  f.minStock.value = data.minStock ?? 1;
  f.barcode.value = data.barcode || '';
  f.qty.value = 1;
  f.expiry.value = '';
  f.expiry.min = todayISO();
  $('#pf-initial').hidden = isEdit;
  $('#pf-title').textContent = isEdit ? 'Editar producto' : (data.name ? 'Producto encontrado' : 'Nuevo producto');
  $('#pf-note').textContent = note;
  $('#pf-scores').innerHTML = scores(data);
  const img = $('#pf-image');
  img.hidden = !data.image;
  if (data.image) img.src = data.image;
  productSheet.showModal();
  if (!data.name) setTimeout(() => f.name.focus(), 250);
}

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

  const base = editing.isEdit ? await db.getProduct(editing.id) : {
    id: db.uid(), image: editing.image || '', nutriscore: editing.nutriscore || null,
    nova: editing.nova || null, batches: [],
  };
  const product = {
    ...base,
    name: f.name.value.trim(),
    brand: f.brand.value.trim(),
    quantityLabel: f.quantityLabel.value.trim(),
    category: f.category.value.trim(),
    minStock: Math.max(0, parseInt(f.minStock.value, 10) || 0),
    barcode,
  };
  const qty = parseInt(f.qty.value, 10) || 0;
  if (!editing.isEdit && qty > 0) product.batches.push({ id: db.uid(), qty, expiry: f.expiry.value || null, addedAt: Date.now() });

  await db.saveProduct(product);
  productSheet.close();
  toast(editing.isEdit ? 'Guardado' : `${product.name} añadido a la despensa`);
  await refresh();
  if (editing.isEdit) openDetail(product.id);
});

// ---------- añadir unidades ----------

const stockSheet = $('#stock-sheet');
const stockForm = $('#stock-form');
let stockTarget = null;

function openStock(product, qty = 1) {
  stockTarget = product;
  stockForm.reset();
  stockForm.elements.qty.value = qty;
  stockForm.elements.expiry.min = todayISO();
  $('#sf-title').textContent = product.name;
  const stock = db.stockOf(product);
  $('#sf-note').textContent = `Ahora tienes ${stock} ${stock === 1 ? 'unidad' : 'unidades'}`;
  const img = $('#sf-image');
  img.hidden = !product.image;
  if (product.image) img.src = product.image;
  if ($('#detail-sheet').open) $('#detail-sheet').close();
  stockSheet.showModal();
}

stockForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const qty = parseInt(stockForm.elements.qty.value, 10);
  if (!(qty > 0)) return;
  const p = await db.addStock(stockTarget.id, qty, stockForm.elements.expiry.value);
  stockSheet.close();
  toast(`${p.name}: ahora tienes ${db.stockOf(p)}`);
  await refresh();
});

// ---------- detalle ----------

const detailSheet = $('#detail-sheet');

async function openDetail(id) {
  const p = await db.getProduct(id);
  if (!p) return;
  const stock = db.stockOf(p);
  const batches = [...p.batches].sort((a, b) => (a.expiry || '9999').localeCompare(b.expiry || '9999'));
  const meta = [p.brand, p.quantityLabel, p.category].filter(Boolean).join(' · ');

  $('#detail-body').innerHTML = `
    <div class="sheet-head">
      ${p.image ? `<img src="${esc(p.image)}" alt="">` : thumb(p)}
      <div>
        <h2>${esc(p.name)}</h2>
        ${meta ? `<p class="muted small">${esc(meta)}</p>` : ''}
        <div class="scores">${scores(p)}</div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="row" style="align-items:center">
        <div style="flex:1">
          <b style="font-size:1.4rem">${stock}</b> ${stock === 1 ? 'unidad' : 'unidades'}
          <div class="muted small">Avisar con menos de ${p.minStock ?? 1}</div>
        </div>
        <div class="stepper">
          <button data-act="minus" aria-label="Gastar una" ${stock ? '' : 'disabled'}>−</button>
          <button data-act="plus" aria-label="Añadir">+</button>
        </div>
      </div>
      ${batches.length ? `<div>${batches.map((b) => `
        <div class="batch">
          <div class="grow">
            <b>${b.qty}</b> ${b.qty === 1 ? 'ud.' : 'uds.'}
            <span class="tag ${expiryClass(b.expiry)}">${b.expiry ? esc(expiryLabel(b.expiry)) : 'Sin fecha'}</span>
          </div>
          <button class="icon-btn" data-batch="${esc(b.id)}" aria-label="Quitar este lote">
            <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>
          </button>
        </div>`).join('')}</div>` : ''}
    </div>

    ${p.nutriscore || p.nova ? `<p class="muted small">
      ${p.nutriscore ? `Nutri-Score ${p.nutriscore.toUpperCase()}: calidad nutricional, de A (mejor) a E. ` : ''}
      ${p.nova ? `NOVA ${p.nova}: grado de procesado, de 1 (sin procesar) a 4 (ultraprocesado).` : ''}
    </p>` : ''}

    <div class="row">
      <button class="btn" data-act="edit">Editar</button>
      <button class="btn danger" data-act="delete">Eliminar</button>
    </div>
    ${p.barcode ? `<p class="muted small" style="text-align:center">Código ${esc(p.barcode)}${p.nutriscore || p.image ? ` · <a href="https://world.openfoodfacts.org/product/${encodeURIComponent(p.barcode)}" target="_blank" rel="noopener">Ver en Open Food Facts</a>` : ''}</p>` : ''}
    <button class="btn ghost wide" data-close>Cerrar</button>`;

  detailSheet.dataset.id = id;
  if (!detailSheet.open) detailSheet.showModal();
}

detailSheet.addEventListener('click', async (e) => {
  const id = detailSheet.dataset.id;
  const batchBtn = e.target.closest('[data-batch]');
  if (batchBtn) {
    await db.removeBatch(id, batchBtn.dataset.batch);
    await refresh();
    return openDetail(id);
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'minus') { await db.consume(id, 1); await refresh(); openDetail(id); }
  if (act === 'plus') openStock(await db.getProduct(id));
  if (act === 'edit') {
    const p = await db.getProduct(id);
    detailSheet.close();
    openProductForm(p, '', true);
  }
  if (act === 'delete') {
    const p = await db.getProduct(id);
    if (!confirm(`¿Eliminar "${p.name}" de la despensa?`)) return;
    await db.deleteProduct(id);
    detailSheet.close();
    toast('Producto eliminado');
    await refresh();
  }
});

// ---------- copia de seguridad ----------

$('#export').addEventListener('click', async () => {
  const data = await db.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const name = `despensa-${todayISO()}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Copia de Despensa' }); return; } catch { /* cancelado */ }
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('#import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!confirm(`Esto sustituye tu despensa actual por ${data.products?.length ?? 0} productos de la copia. ¿Continuar?`)) return;
    await db.importAll(data);
    toast('Copia restaurada');
    await refresh();
  } catch (err) {
    toast(err.message || 'No se pudo leer el archivo');
  }
});

// ---------- arranque ----------

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
navigator.storage?.persist?.();

// Al volver a la app (p. ej. al día siguiente) recalcula los avisos de caducidad.
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

refresh();
