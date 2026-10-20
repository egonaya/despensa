// Registrar la compra con el ticket del súper: foto o PDF → revisar → a la despensa.

import { esc, todayISO, toast, uid } from '../util.js';
import { readTicket, parseTicket } from '../ticket.js';

let app;
let rows = [];
let rawText = '';

export function init(a) {
  app = a;
  app.openTicket = open;
}

function open() {
  app.openSheet(`
    <h2>Registrar ticket</h2>
    <p class="muted">Haz una foto al ticket o sube el PDF del ticket digital. Leo los productos y los revisas antes de pasarlos a la despensa.</p>
    <div class="actions">
      <label class="btn primary">Hacer foto al ticket<input type="file" accept="image/*" capture="environment" data-ticket hidden></label>
      <label class="btn">Subir foto o PDF<input type="file" accept="image/*,application/pdf,.pdf" data-ticket hidden></label>
    </div>
    <p class="muted small">Consejos para la foto: ticket estirado sobre una mesa, con buena luz, recto y ocupando toda la imagen. Si es muy largo, haz dos fotos y regístralas por separado. El PDF del ticket digital se lee sin errores.</p>
    <p class="muted small">La primera vez descarga el lector (unos 6 MB); necesita conexión.</p>
    <button class="btn ghost wide" data-close>Cancelar</button>`,
  async (e) => {
    if (e.type !== 'change' || !e.target.matches('[data-ticket]')) return;
    const file = e.target.files[0];
    if (file) await read(file);
  });
}

async function read(file) {
  const status = (msg) => app.openSheet(`
    <h2>Leyendo el ticket</h2>
    <div class="busy"><span class="spin"></span><span>${esc(msg)}</span></div>
    <p class="muted small">En una foto tarda unos segundos. No cierres la app.</p>`);
  status('Preparando…');
  try {
    rawText = await readTicket(file, status);
    rows = parseTicket(rawText, [...app.ctx().foods.values()]);
    review();
  } catch (err) {
    app.openSheet(`
      <h2>No he podido leer el ticket</h2>
      <p>${esc(err.message || 'Algo ha fallado.')}</p>
      <div class="row"><button class="btn" data-act="retry">Probar con otra foto</button><button class="btn ghost" data-close>Cerrar</button></div>`,
    (ev) => { if (ev.target.closest('[data-act="retry"]')) open(); });
  }
}

function rowHtml(r, i) {
  return `
    <div class="ticket-row ${r.include ? '' : 'off'}" data-i="${i}">
      <label class="ticket-check"><input type="checkbox" data-f="include" ${r.include ? 'checked' : ''} aria-label="Incluir"></label>
      <div class="ticket-fields">
        <input data-f="name" value="${esc(r.name)}" aria-label="Nombre">
        <select data-f="foodId" aria-label="Alimento para el menú">${app.foodOptions(r.foodId)}</select>
        <div class="ticket-qty">
          <input data-f="qty" type="number" min="0" step="any" inputmode="decimal" value="${r.qty}" aria-label="Cantidad">
          <select data-f="unit" aria-label="Unidad">${['ud', 'g', 'ml'].map((u) => `<option ${u === r.unit ? 'selected' : ''}>${u}</option>`).join('')}</select>
          ${r.unit === 'ud' ? `<label class="suffix"><input data-f="unitGrams" type="number" min="0" step="any" inputmode="decimal" value="${r.unitGrams ?? ''}" aria-label="Gramos por unidad"><span>g/ud</span></label>` : '<span></span>'}
          <label class="suffix date"><span>Caduca</span><input data-f="expiry" type="date" value="${r.expiry || ''}" aria-label="Caduca"></label>
        </div>
        ${r.unit === 'ud' && !r.unitGrams && r.foodId ? '<span class="small warn-text">Indica cuánto pesa cada unidad para usarlo en el menú</span>' : ''}
        ${r.estimated ? '<span class="muted small">Peso por unidad estimado: corrígelo si no es así</span>' : ''}
      </div>
    </div>`;
}

function review() {
  const n = rows.filter((r) => r.include).length;
  app.openSheet(`
    <h2>Revisa la compra</h2>
    <p class="muted small">${rows.length ? `He encontrado ${rows.length} líneas y ${n} parecen comida. Corrige lo que haga falta y desmarca lo que no quieras guardar.` : 'No he encontrado productos en el texto. Puedes añadirlos a mano abajo o probar con otra foto más nítida.'}</p>
    <div id="ticket-rows">${rows.map(rowHtml).join('')}</div>
    <button class="btn ghost small" data-act="add-row">Añadir una línea</button>
    <details class="raw"><summary class="linkbtn">Ver el texto leído</summary><pre>${esc(rawText)}</pre></details>
    <div class="row sticky-actions">
      <button class="btn ghost" data-close>Cancelar</button>
      <button class="btn primary" data-act="save">Añadir ${n} a la despensa</button>
    </div>`,
  async (e) => {
    const row = e.target.closest('[data-i]');
    if (row && (e.type === 'change' || e.type === 'input') && e.target.dataset.f) {
      const r = rows[Number(row.dataset.i)];
      const f = e.target.dataset.f;
      if (f === 'include') r.include = e.target.checked;
      else if (f === 'qty' || f === 'unitGrams') r[f] = e.target.value === '' ? null : Number(e.target.value);
      else r[f] = e.target.value;
      if (f === 'foodId' && r.foodId) r.include = true;
      if (f === 'unitGrams') r.estimated = false;
      if (['include', 'unit', 'foodId'].includes(f)) {
        const y = document.querySelector('#sheet').scrollTop;
        review();
        document.querySelector('#sheet').scrollTop = y;
      }
      return;
    }
    if (e.type !== 'click') return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'add-row') {
      rows.push({ include: true, name: '', foodId: '', unit: 'ud', qty: 1, unitGrams: null, expiry: '' });
      review();
      document.querySelector('#sheet').scrollTop = 1e6;
    }
    if (act === 'save') await save();
  });
}

async function save() {
  const { db } = app;
  const ctx = app.ctx();
  const chosen = rows.filter((r) => r.include && r.name.trim() && r.qty > 0);
  if (!chosen.length) return toast('No hay nada marcado para guardar');
  for (const r of chosen) {
    const unitGrams = r.unit === 'ud' ? (r.unitGrams || ctx.foods.get(r.foodId)?.ug || null) : null;
    const expiry = r.expiry && r.expiry >= todayISO() ? r.expiry : null;
    // Si ya tienes ese alimento en el mismo formato, se suma a él; si no, producto nuevo.
    const same = ctx.products.find((p) => r.foodId && p.foodId === r.foodId && p.unit === r.unit && (p.unitGrams || null) === unitGrams);
    if (same) {
      await db.addStock(same.id, r.qty, expiry);
    } else {
      await db.saveProduct({
        id: uid(), barcode: null, name: r.name.trim(), brand: '', image: '', quantityLabel: unitGrams ? `${unitGrams} g` : '',
        category: ctx.foods.get(r.foodId)?.cat || '', foodId: r.foodId || null, unit: r.unit, unitGrams,
        per100: null, minStock: 0, nutriscore: null, nova: null,
        batches: [{ id: uid(), qty: r.qty, expiry, addedAt: Date.now() }],
      });
    }
  }
  app.closeSheet();
  await app.refresh();
  toast(`${chosen.length} productos añadidos a la despensa`);
}
