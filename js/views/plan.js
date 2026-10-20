// Vista "Plan": menú semanal, batch cooking, víspera y seguimiento del día.
//
// Puede haber dos menús a la vez: el de la semana en curso ('plan') y el de la semana
// siguiente ('nextPlan'), que se prepara antes de ir a comprar sin borrar el actual.

import { $, esc, SLOTS, DOW, fmtDay, fmtDate, todayISO, addDays, dow, dec, r0, toast } from '../util.js';

let app;
let tab = 'plan'; // pestaña visible: 'plan' (esta semana) o 'nextPlan' (la siguiente)

export function init(a) {
  app = a;
  const el = $('#view-plan');
  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  el.addEventListener('submit', onSubmit);
}

const S = () => app.state;
const P = () => app.P;
const clone = (x) => structuredClone(x);
const mealLabel = (date, slot) => `${DOW[dow(date)]} ${SLOTS[slot].toLowerCase()}`;
const getPlan = (w) => S()[w];
const visible = () => (tab === 'nextPlan' && S().nextPlan ? 'nextPlan' : 'plan');
const isActive = (plan) => plan && P().planEnd(plan) >= todayISO();

function defaultStart() {
  const today = todayISO();
  const { plan, nextPlan } = S();
  if (visible() === 'nextPlan') return nextPlan.start;
  if (isActive(plan)) return addDays(P().planEnd(plan), 1);
  const d = dow(today);
  if (d === 1) return today;
  return addDays(today, d === 0 ? 1 : 8 - d);
}

function fmtMinutes(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}

// Tareas de hoy de cualquiera de los dos menús (el batch del domingo es del menú siguiente).
function todayTasks() {
  const today = todayISO();
  const out = { batch: null, tonight: [] };
  for (const w of ['plan', 'nextPlan']) {
    const plan = getPlan(w);
    if (!plan) continue;
    const prep = P().buildPrep(plan, app.ctx());
    if (prep.batchDate === today && prep.batch.length) out.batch = { w, prep, plan };
    (prep.nights.get(today) || []).forEach((t) => out.tonight.push({ w, t, plan }));
  }
  return out;
}

export function hasTasksToday() {
  const { batch, tonight } = todayTasks();
  return tonight.some(({ t, plan }) => !plan.prepDone?.[t.id])
    || !!(batch && batch.prep.batch.some((t) => !batch.plan.prepDone?.[t.id]));
}

// ---------- render ----------

function macroBars(m, cfg) {
  const row = (label, val, target, cls) => {
    const pct = target > 0 ? Math.min(100, (val / target) * 100) : 0;
    const off = target > 0 && Math.abs(val - target) / target > 0.08;
    return `<span class="lbl">${label}</span><span class="bar"><i class="${off ? 'off' : cls}" style="width:${pct}%"></i></span><span class="num">${r0(val)}/${r0(target)}</span>`;
  };
  return `<div class="bars">${row('kcal', m.kcal, cfg.kcal, 'k')}${row('P', m.p, cfg.protein, 'p')}${row('H', m.c, cfg.carbs, 'c')}${row('G', m.f, cfg.fat, 'f')}</div>`;
}

const macroChips = (m) =>
  `<span class="pill num">${r0(m.kcal)} kcal</span><span class="pill mp num">P ${r0(m.p)}</span><span class="pill mc num">H ${r0(m.c)}</span><span class="pill mf num">G ${r0(m.f)}</span>`;

function genControls(label, help) {
  return `
    <form class="card gen" data-form="generate">
      <div class="grid2">
        <label>Empieza el<input type="date" name="start" value="${defaultStart()}" required></label>
        <button class="btn primary" type="submit">${label}</button>
      </div>
      <p class="muted small">${help}</p>
    </form>`;
}

export function render() {
  const el = $('#view-plan');
  const { plan, nextPlan, config, products, supplements } = S();
  const ctx = app.ctx();
  const work = config.time.comida.work;

  if (!plan) {
    const linked = products.filter((p) => p.foodId && p.batches.length).length;
    el.innerHTML = `
      <div class="empty left">
        <b>Tu menú de la semana</b>
        Desayuno, comida y cena para 7 días, ajustados a tus ${config.kcal} kcal y tus macros, con lo que tienes en casa.
        Te digo qué cocinar el domingo y qué dejar listo la noche anterior.
      </div>
      <ul class="steps-list">
        <li class="${config.kcal !== 1800 || config.partner?.kcal ? 'ok' : ''}"><button class="linkbtn" data-act="goto" data-page="goals">Revisa tus objetivos y comensales</button></li>
        <li class="${supplements.length ? 'ok' : ''}"><button class="linkbtn" data-act="goto" data-page="supplements">Añade tus suplementos</button> <span class="muted small">(sus macros se descuentan)</span></li>
        <li class="${linked ? 'ok' : ''}">Escanea o añade lo que tienes en casa <span class="muted small">(${linked} productos listos para el menú)</span></li>
      </ul>
      ${genControls('Generar menú', `Usa primero lo que tienes en casa y lo que caduca antes. Las comidas de días laborables se quedan en ${work} min o menos al llegar.`)}`;
    return;
  }

  const w = visible();
  const shown = getPlan(w);
  const prep = P().buildPrep(shown, ctx);
  const today = todayISO();
  let html = '';

  if (nextPlan) {
    html += `
      <div class="segmented" role="tablist">
        <button role="tab" data-tab="plan" aria-selected="${w === 'plan'}">Esta semana <span class="muted small">${fmtDate(plan.start)}</span></button>
        <button role="tab" data-tab="nextPlan" aria-selected="${w === 'nextPlan'}">Próxima <span class="muted small">${fmtDate(nextPlan.start)}</span></button>
      </div>`;
  }
  html += `<h2 class="h2">${fmtDate(shown.start)} – ${fmtDate(P().planEnd(shown))}</h2>`;
  html += todayCard();

  // Batch cooking
  if (prep.batch.length) {
    const done = prep.batch.filter((x) => shown.prepDone?.[x.id]).length;
    html += `
      <details class="card batch" ${prep.batchDate >= today && done < prep.batch.length ? 'open' : ''}>
        <summary><div class="row between"><h3>Batch cooking · ${fmtDay(prep.batchDate)}</h3><span class="pill">≈ ${fmtMinutes(prep.batchMinutes)}</span></div>
        <p class="muted small">${done}/${prep.batch.length} hecho · horno, fuegos y arrocera a la vez</p></summary>
        ${prep.batch.map((x) => taskRow(x, shown, w)).join('')}
      </details>`;
  }

  html += shown.days.map((d, di) => dayCard(d, di, prep, shown, w)).join('');

  // Siguiente paso
  if (w === 'nextPlan') {
    html += `<h2 class="h2">Rehacer la semana siguiente</h2>
      ${genControls('Generar otra vez', 'Sustituye solo el menú de la semana siguiente. La semana en curso no cambia.')}`;
  } else if (nextPlan) {
    html += `<div class="card"><p>Ya tienes preparado el menú de la semana siguiente.</p><button class="btn" data-tab="nextPlan">Ver la semana siguiente</button></div>`;
  } else if (isActive(plan)) {
    html += `<h2 class="h2">Preparar la semana siguiente</h2>
      ${genControls('Generar menú', 'Esta semana se queda como está hasta el último día. Hazlo antes de ir a comprar: la lista de la compra suma lo que falta para lo que queda de esta semana y para la siguiente, y el batch cooking del domingo aparece en el menú nuevo.')}`;
  } else {
    html += `<h2 class="h2">Nuevo menú</h2>${genControls('Generar menú', `Las comidas de días laborables se quedan en ${work} min o menos al llegar.`)}`;
  }
  el.innerHTML = html;
}

function todayCard() {
  const today = todayISO();
  const ctx = app.ctx();
  const w = ['plan', 'nextPlan'].find((k) => getPlan(k)?.days.some((d) => d.date === today));
  const plan = w && getPlan(w);
  const todayDay = plan?.days.find((d) => d.date === today);
  const { batch, tonight } = todayTasks();
  if (!todayDay && !batch && !tonight.length) return '';

  let html = `<div class="card today"><h3>Hoy</h3>`;
  if (batch) {
    const label = batch.w === visible() ? 'Lo tienes abajo, paso a paso.' : '';
    html += `<p><b>Toca batch cooking</b> (≈ ${fmtMinutes(batch.prep.batchMinutes)}). ${label}</p>`;
    if (batch.w !== visible()) html += `<button class="btn small" data-tab="${batch.w}">Ver el batch cooking</button>`;
  }
  if (todayDay) {
    html += todayDay.meals.map((m, mi) => `
      <button class="today-meal ${m.done ? 'done' : ''}" data-act="open-meal" data-plan="${w}" data-day="${plan.days.indexOf(todayDay)}" data-meal="${mi}">
        <span class="lbl">${SLOTS[m.slot]}</span><span class="grow">${esc(m.off ? m.off.desc : m.name)}</span>
        ${m.done ? '<span class="tag ok">Hecha</span>' : m.off ? '' : `<span class="tag">${ctx.recipeMap.get(m.recipeId)?.min ?? '?'} min</span>`}
      </button>`).join('');
  }
  if (tonight.length) html += `<p class="muted small" style="margin-top:8px">Esta noche: ${tonight.map(({ t }) => esc(t.task)).join(' · ')}</p>`;
  return html + `</div>`;
}

function taskRow(x, plan, w) {
  const qty = x.qty.filter((q) => q.g > 0).map((q) => `${esc(app.ctx().foods.get(q.food)?.name || q.food)} ${esc(app.qtyText(q.food, q.g))}`).join(', ');
  const meals = x.meals.map((m) => mealLabel(m.date, m.slot)).join(', ');
  return `
    <label class="task ${plan.prepDone?.[x.id] ? 'done' : ''}">
      <input type="checkbox" data-prep="${esc(x.id)}" data-plan="${w}" ${plan.prepDone?.[x.id] ? 'checked' : ''}>
      <span>
        <b>${esc(x.task)}</b>${x.min ? ` <span class="muted small">· ${x.min} min</span>` : ''}
        ${qty ? `<span class="small block">${qty}</span>` : ''}
        <span class="muted small block">Para ${esc(meals)}${x.store ? ` · ${esc(x.store)}, ${x.keeps} días` : ''}</span>
      </span>
    </label>`;
}

function dayCard(d, di, prep, plan, w) {
  const { config, supplements } = S();
  const ctx = app.ctx();
  const today = todayISO();
  const m = P().dayMacros(d, ctx);
  const doneN = d.meals.filter((x) => x.done || x.off).length;
  const isOpen = d.date === today || (di === 0 && today < plan.start);
  const tonight = prep.nights.get(d.date) || [];
  const night0 = di === 0 ? (prep.nights.get(addDays(d.date, -1)) || []) : [];
  const at = `data-plan="${w}" data-day="${di}"`;

  let html = `
    <details class="day ${d.date < today ? 'past' : ''}" ${isOpen ? 'open' : ''}>
      <summary>
        <div class="dayhead"><h3>${fmtDay(d.date)}</h3><span class="pill ${doneN === d.meals.length ? 'ok' : ''}">${doneN}/${d.meals.length}</span></div>
        ${macroBars(m, config)}
      </summary>`;

  if (night0.length) {
    html += `<div class="day-block"><div class="lbl">La noche anterior (${fmtDate(addDays(d.date, -1))})</div>${night0.map((x) => taskRow(x, plan, w)).join('')}</div>`;
  }

  html += d.meals.map((meal, mi) => {
    const r = ctx.recipeMap.get(meal.recipeId);
    const mm = P().mealMacros(meal, ctx);
    const max = P().maxMinutes(config, meal.slot, d.date);
    return `
      <div class="meal ${meal.done ? 'done' : ''} ${meal.off ? 'is-off' : ''}">
        <button class="meal-main" data-act="open-meal" ${at} data-meal="${mi}">
          <span class="lbl">${SLOTS[meal.slot]}${meal.off ? ' · fuera de plan' : r ? ` · ${r.min} min${r.min > max ? ' ⚠︎' : ''}` : ''}${meal.diners > 1 ? ` · ${meal.diners} pers.` : ''}</span>
          <span class="mname">${esc(meal.off ? meal.off.desc : meal.name)}</span>
          <span class="chips-row">${macroChips(mm)}</span>
        </button>
        ${meal.off ? '' : `<label class="check"><input type="checkbox" data-act="done" ${at} data-meal="${mi}" ${meal.done ? 'checked' : ''}>Hecha</label>`}
      </div>`;
  }).join('');

  if (supplements.length) {
    html += `<div class="day-block supps"><div class="lbl">Suplementos · ${r0(P().supplementTotals(supplements).kcal)} kcal ya incluidas</div>${supplements.map((s) => `
      <label><input type="checkbox" data-supp="${esc(s.id)}" ${at} ${d.supps?.[s.id] ? 'checked' : ''}>
      ${esc(s.name)} <span class="muted small">${P().perDay(s) !== 1 ? `${dec(P().perDay(s))} × ` : ''}${esc(s.timing || '')}</span></label>`).join('')}</div>`;
  }

  if (tonight.length && di < plan.days.length - 1) {
    html += `<div class="day-block"><div class="lbl">Esta noche, para mañana</div>${tonight.map((x) => taskRow(x, plan, w)).join('')}</div>`;
  }

  const err = m.kcal - config.kcal;
  if (d.meals.some((x) => x.off) && Math.abs(err) > config.kcal * 0.05 && d.meals.some((x) => !x.done && !x.off)) {
    html += `<div class="day-block alert">Este día va ${err > 0 ? '+' : ''}${r0(err)} kcal sobre tu objetivo. <button class="btn small" data-act="rebalance" ${at}>Reajustar lo que queda</button></div>`;
  }
  return html + `</details>`;
}

// ---------- hoja de un plato ----------

function openMeal(w, di, mi) {
  const { config } = S();
  const plan = getPlan(w);
  const ctx = app.ctx();
  const day = plan.days[di];
  const meal = day.meals[mi];
  const r = ctx.recipeMap.get(meal.recipeId);
  const mm = P().mealMacros(meal, ctx);
  const portions = P().portionsOf(meal.diners, config);
  const ratio = P().partnerRatio(config);
  const prep = P().buildPrep(plan, ctx);
  const mine = (x) => x.meals.some((m) => m.date === day.date && m.slot === meal.slot);
  const ahead = [
    ...prep.batch.filter(mine).map((x) => ({ x, when: `Batch cooking del ${fmtDate(prep.batchDate)}` })),
    ...[...prep.nights].flatMap(([date, list]) => list.filter(mine).map((x) => ({ x, when: `Noche del ${fmtDate(date)}` }))),
  ];

  if (meal.off) {
    app.openSheet(`
      <div class="lbl">${SLOTS[meal.slot]} · ${fmtDay(day.date)}</div>
      <h2>Fuera de plan</h2>
      <p>${esc(meal.off.desc)}</p>
      <div class="chips-row">${macroChips(mm)}</div>
      <p class="muted small">En lugar de: ${esc(meal.name)}. No se ha descontado nada de la despensa.</p>
      <div class="row"><button class="btn" data-act="undo-off">Volver al plato del plan</button><button class="btn ghost" data-close>Cerrar</button></div>`,
    async (e) => {
      if (e.target.closest('[data-act="undo-off"]')) {
        const plan2 = clone(getPlan(w));
        plan2.days[di].meals[mi].off = null;
        P().solveDay(plan2.days[di], app.ctx());
        await app.savePlan(plan2);
        app.closeSheet();
        toast('Plato del plan recuperado');
      }
    });
    return;
  }

  const ing = meal.items.map((i) => {
    const name = ctx.foods.get(i.food)?.name || i.food;
    return `<tr><td>${esc(name)}</td><td class="num">${esc(app.qtyText(i.food, i.g))}</td>${portions !== 1 ? `<td class="num">${esc(app.qtyText(i.food, i.g * portions))}</td>` : ''}</tr>`;
  }).join('');

  app.openSheet(`
    <div class="lbl">${SLOTS[meal.slot]} · ${fmtDay(day.date)}</div>
    <h2>${esc(meal.name)}</h2>
    <div class="chips-row" style="margin:6px 0">${macroChips(mm)}</div>
    ${meal.diners > 1 ? `<p class="muted small">Ración de ${esc(config.partner?.name || 'tu pareja')}: ${r0(mm.kcal * ratio)} kcal · P ${r0(mm.p * ratio)} · H ${r0(mm.c * ratio)} · G ${r0(mm.f * ratio)}</p>` : ''}

    <table class="ing">
      <thead><tr><th>Ingrediente</th><th class="num">Tu ración</th>${portions !== 1 ? `<th class="num">Total (${meal.diners})</th>` : ''}</tr></thead>
      <tbody>${ing}</tbody>
    </table>
    <p class="muted small">Sal, especias, ajo, limón y vinagre al gusto.</p>

    ${ahead.length ? `<h3 class="h3">Adelantado</h3><ul class="plain">${ahead.map(({ x, when }) => `<li><b>${esc(when)}:</b> ${esc(x.task)}</li>`).join('')}</ul>` : ''}
    ${r ? `<h3 class="h3">Al momento · ${r.min} min</h3><ol class="steps">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}

    <label class="inline">Comensales
      <select data-act="diners">${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${n === meal.diners ? 'selected' : ''}>${n}</option>`).join('')}</select>
    </label>

    <div class="actions">
      <button class="btn primary" data-act="toggle-done">${meal.done ? 'Desmarcar (devolver a la despensa)' : 'Hecha: descontar de la despensa'}</button>
      ${meal.done ? '' : `<button class="btn" data-act="swap">Cambiar plato</button><button class="btn" data-act="off">He comido otra cosa</button>`}
    </div>
    <button class="btn ghost wide" data-close>Cerrar</button>`,
  async (e) => {
    if (e.type === 'change' && e.target.dataset.act === 'diners') {
      const plan2 = clone(getPlan(w));
      plan2.days[di].meals[mi].diners = Number(e.target.value);
      await app.savePlan(plan2);
      return openMeal(w, di, mi);
    }
    if (e.type !== 'click') return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'toggle-done') { await setDone(w, di, mi, !meal.done); openMeal(w, di, mi); }
    if (act === 'swap') openSwap(w, di, mi);
    if (act === 'off') openOff(w, di, mi);
  });
}

function openSwap(w, di, mi) {
  const plan = getPlan(w);
  const ctx = app.ctx();
  const meal = plan.days[di].meals[mi];
  const alts = P().alternatives(ctx, plan, di, mi, 10);
  app.openSheet(`
    <div class="lbl">${SLOTS[meal.slot]} · ${fmtDay(plan.days[di].date)}</div>
    <h2>Cambiar ${esc(meal.name)}</h2>
    <p class="muted small">Ordenado por lo que mejor encaja con tu despensa y el resto de la semana. Las raciones se ajustan solas a tus macros.</p>
    <div class="stack">${alts.map((r) => `
      <button class="btn left" data-pick="${esc(r.id)}">${esc(r.name)} <span class="muted small">· ${r.min} min</span></button>`).join('') || '<p class="muted">No hay otras recetas que encajen con el tiempo de esta comida.</p>'}</div>
    <button class="btn ghost wide" data-close>Cancelar</button>`,
  async (e) => {
    const id = e.target.closest('[data-pick]')?.dataset.pick;
    if (!id) return;
    const plan2 = clone(getPlan(w));
    P().replaceMeal(app.ctx(), plan2, di, mi, app.ctx().recipeMap.get(id));
    await app.savePlan(plan2);
    toast('Plato cambiado y raciones del día reajustadas');
    openMeal(w, di, mi);
  });
}

function openOff(w, di, mi) {
  const meal = getPlan(w).days[di].meals[mi];
  app.openSheet(`
    <form class="stack" data-form="off">
      <h2>¿Qué has comido?</h2>
      <p class="muted small">En lugar de ${esc(meal.name)}. Si solo sabes las kcal, reparto los macros de forma aproximada.</p>
      <label>Descripción<input name="desc" required placeholder="Menú del día: ensalada y pollo con patatas"></label>
      <div class="grid2">
        <label>kcal<input name="kcal" type="number" min="0" inputmode="numeric" required></label>
        <label>Proteína (g)<input name="p" type="number" min="0" step="any" inputmode="decimal" placeholder="opcional"></label>
        <label>Hidratos (g)<input name="c" type="number" min="0" step="any" inputmode="decimal" placeholder="opcional"></label>
        <label>Grasa (g)<input name="f" type="number" min="0" step="any" inputmode="decimal" placeholder="opcional"></label>
      </div>
      <div class="row"><button class="btn ghost" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Guardar y reajustar el día</button></div>
    </form>`,
  async (e) => {
    if (e.type !== 'submit') return;
    const f = Object.fromEntries(new FormData(e.target));
    const kcal = Number(f.kcal) || 0;
    const off = {
      desc: f.desc.trim(), kcal,
      p: f.p !== '' ? Number(f.p) : (kcal * 0.2) / 4,
      c: f.c !== '' ? Number(f.c) : (kcal * 0.45) / 4,
      f: f.f !== '' ? Number(f.f) : (kcal * 0.35) / 9,
    };
    const plan2 = clone(getPlan(w));
    plan2.days[di].meals[mi].off = off;
    P().solveDay(plan2.days[di], app.ctx());
    await app.savePlan(plan2);
    app.closeSheet();
    toast('Apuntado. He reajustado las comidas que quedan del día');
  });
}

// ---------- hecha: descontar de la despensa ----------

async function setDone(w, di, mi, done) {
  const plan = clone(getPlan(w));
  const meal = plan.days[di].meals[mi];
  const ctx = app.ctx();
  const { db } = app;
  if (done) {
    const portions = P().portionsOf(meal.diners, ctx.config);
    const used = [];
    const missing = [];
    for (const it of meal.items) {
      let grams = it.g * portions;
      const products = ctx.products
        .filter((p) => p.foodId === it.food && db.stockOf(p) > 0)
        .sort((a, b) => (db.nextExpiry(a) || '9999').localeCompare(db.nextExpiry(b) || '9999'));
      for (const p of products) {
        if (grams <= 0.5) break;
        const gpu = P().gramsPerUnit(p, ctx);
        const take = Math.min(db.stockOf(p) * gpu, grams);
        const res = await db.consume(p.id, take / gpu);
        used.push(...res.taken);
        grams -= take;
      }
      if (grams > 1 && !ctx.foods.get(it.food)?.staple) missing.push(ctx.foods.get(it.food)?.name || it.food);
    }
    meal.done = true;
    meal.used = used;
    await app.savePlan(plan);
    toast(missing.length ? `Descontado. No tenías registrado: ${missing.join(', ')}` : 'Descontado de la despensa', {
      label: 'Deshacer', run: () => setDone(w, di, mi, false),
    });
  } else {
    for (const u of meal.used || []) {
      if (await db.getProduct(u.productId)) await db.addStock(u.productId, u.qty, u.expiry);
    }
    meal.done = false;
    meal.used = null;
    await app.savePlan(plan);
    toast('Devuelto a la despensa');
  }
}

// ---------- eventos ----------

async function onClick(e) {
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) {
    tab = tabBtn.dataset.tab;
    render();
    window.scrollTo({ top: 0 });
    return;
  }
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.matches('input')) return;
  const act = btn.dataset.act;
  const w = btn.dataset.plan || 'plan';
  const di = Number(btn.dataset.day);
  const mi = Number(btn.dataset.meal);
  if (act === 'open-meal') openMeal(w, di, mi);
  if (act === 'goto') app.openMore(btn.dataset.page);
  if (act === 'rebalance') {
    const plan = clone(getPlan(w));
    P().solveDay(plan.days[di], app.ctx());
    await app.savePlan(plan);
    toast('Comidas pendientes reajustadas');
  }
}

async function onChange(e) {
  const el = e.target;
  const w = el.dataset.plan || 'plan';
  if (el.dataset.act === 'done') return setDone(w, Number(el.dataset.day), Number(el.dataset.meal), el.checked);

  if (el.dataset.prep) {
    const plan = clone(getPlan(w));
    plan.prepDone = { ...(plan.prepDone || {}), [el.dataset.prep]: el.checked };
    if (!el.checked) delete plan.prepDone[el.dataset.prep];
    return app.savePlan(plan);
  }

  if (el.dataset.supp) {
    const plan = clone(getPlan(w));
    const day = plan.days[Number(el.dataset.day)];
    day.supps = { ...(day.supps || {}), [el.dataset.supp]: el.checked };
    const s = S().supplements.find((x) => x.id === el.dataset.supp);
    if (s && s.stock != null && s.stock !== '') {
      const k = P().perDay(s);
      await app.db.saveSupplement({ ...s, stock: Math.max(0, Number(s.stock) + (el.checked ? -k : k)) });
    }
    return app.savePlan(plan);
  }
}

// Generar: si la semana en curso sigue activa y el menú empieza después de ella, se
// prepara como "semana siguiente" sin tocar la actual. Si se solapa, la sustituye.
async function onSubmit(e) {
  if (e.target.dataset.form !== 'generate') return;
  e.preventDefault();
  const start = new FormData(e.target).get('start');
  const { plan, nextPlan, prevPlan } = S();
  const ctx = app.ctx();
  if (!ctx.recipes.length) return toast('No hay recetas disponibles');
  const today = todayISO();

  if (isActive(plan) && start > P().planEnd(plan)) {
    if (nextPlan && !confirm('¿Sustituir el menú de la semana siguiente?')) return;
    const next = P().generatePlan({ ...ctx, activePlans: [plan], prevPlan: plan }, start);
    tab = 'nextPlan';
    await app.setPlans({ nextPlan: next });
  } else {
    const pending = plan && plan.days.some((d) => d.date >= today && d.meals.some((m) => !m.done && !m.off));
    if (pending && !confirm('¿Sustituir el menú de esta semana por uno nuevo?')) return;
    const keepNext = nextPlan && nextPlan.start > addDays(start, 6);
    const fresh = P().generatePlan({ ...ctx, activePlans: keepNext ? [nextPlan] : [], prevPlan: plan || prevPlan }, start);
    tab = 'plan';
    await app.setPlans({ plan: fresh, prevPlan: plan || undefined, nextPlan: keepNext ? undefined : null });
  }
  window.scrollTo({ top: 0 });
  const missing = P().planNeeds(app.activePlans(), app.ctx()).length;
  toast(missing ? `Menú listo. Te faltan ${missing} cosas: están en Compra` : 'Menú listo con lo que tienes en casa');
}

// Reajusta las raciones de los días que quedan (tras cambiar objetivos o suplementos).
export async function resolvePlan() {
  const today = todayISO();
  for (const w of ['plan', 'nextPlan']) {
    const plan = clone(getPlan(w) || null);
    if (!plan) continue;
    plan.days.filter((d) => d.date >= today).forEach((d) => P().solveDay(d, app.ctx()));
    await app.savePlan(plan);
  }
}
