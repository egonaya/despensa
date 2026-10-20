// Planificador semanal sin IA.
//
// 1. Elige platos por día y comida puntuando cada receta: lo que hay en casa, lo que
//    caduca antes, aprovechar lo que se cocina el domingo, variedad y tiempo disponible.
// 2. Ajusta las cantidades de cada día con un pequeño solver (mínimos cuadrados con
//    límites) para que el día cuadre con tus kcal y macros, descontando los suplementos.
// 3. Organiza el batch cooking del domingo y lo que hay que dejar listo la noche anterior.

import { PREP } from './recipes.js';
import { addDays, diffDays, dow, todayISO, uid, SLOT_ORDER } from './util.js';

export const DEFAULT_CONFIG = {
  kcal: 1800, protein: 140, carbs: 180, fat: 60,
  split: { desayuno: 0.25, comida: 0.4, cena: 0.35 },
  partner: { name: '', kcal: null },
  diners: { desayuno: 1, comida: 1, cena: 1 },
  workDays: [1, 2, 3, 4, 5],
  time: {
    desayuno: { work: 10, free: 20 },
    comida: { work: 15, free: 45 },
    cena: { work: 20, free: 45 },
  },
  batchDow: 0,
  exclude: [],
  hiddenRecipes: [],
};

export const withDefaults = (c = {}) => ({
  ...DEFAULT_CONFIG, ...c,
  split: { ...DEFAULT_CONFIG.split, ...(c.split || {}) },
  partner: { ...DEFAULT_CONFIG.partner, ...(c.partner || {}) },
  diners: { ...DEFAULT_CONFIG.diners, ...(c.diners || {}) },
  time: {
    desayuno: { ...DEFAULT_CONFIG.time.desayuno, ...(c.time?.desayuno || {}) },
    comida: { ...DEFAULT_CONFIG.time.comida, ...(c.time?.comida || {}) },
    cena: { ...DEFAULT_CONFIG.time.cena, ...(c.time?.cena || {}) },
  },
});

// ---------- raciones y nutrición ----------

export const partnerRatio = (config) => {
  const pk = Number(config.partner?.kcal);
  return pk > 0 && config.kcal > 0 ? pk / config.kcal : 1;
};

// Raciones equivalentes: 1 comensal = 1; 2 = 1 + la ración de tu pareja; el resto, como tú.
export const portionsOf = (diners, config) => (diners <= 1 ? 1 : 1 + partnerRatio(config) + (diners - 2));

export const perDay = (s) => (s.perDay == null || s.perDay === '' ? 1 : Math.max(0, Number(s.perDay)));

export function supplementTotals(supplements) {
  return supplements.reduce((a, s) => {
    const k = perDay(s);
    return { kcal: a.kcal + (+s.kcal || 0) * k, p: a.p + (+s.protein || 0) * k, c: a.c + (+s.carbs || 0) * k, f: a.f + (+s.fat || 0) * k };
  }, { kcal: 0, p: 0, c: 0, f: 0 });
}

export function foodTargets(config, supplements) {
  const s = supplementTotals(supplements);
  return { kcal: config.kcal - s.kcal, p: config.protein - s.p, c: config.carbs - s.c, f: config.fat - s.f };
}

// Valores por 100 g: si tienes en casa un producto con etiqueta de Open Food Facts
// vinculado a ese alimento, se usan sus valores reales.
export function nutrOf(foodId, ctx) {
  if (ctx.labelNutr?.has(foodId)) return ctx.labelNutr.get(foodId);
  return ctx.foods.get(foodId) || { kcal: 0, p: 0, c: 0, f: 0 };
}

export function itemsMacros(items, ctx, factor = 1) {
  const t = { kcal: 0, p: 0, c: 0, f: 0 };
  for (const it of items) {
    const n = nutrOf(it.food, ctx);
    const g = (it.g * factor) / 100;
    t.kcal += n.kcal * g; t.p += n.p * g; t.c += n.c * g; t.f += n.f * g;
  }
  return t;
}

export const mealMacros = (meal, ctx) =>
  (meal.off ? { kcal: +meal.off.kcal || 0, p: +meal.off.p || 0, c: +meal.off.c || 0, f: +meal.off.f || 0 } : itemsMacros(meal.items, ctx));

export function dayMacros(day, ctx) {
  const s = supplementTotals(ctx.supplements);
  return day.meals.reduce((a, m) => {
    const x = mealMacros(m, ctx);
    return { kcal: a.kcal + x.kcal, p: a.p + x.p, c: a.c + x.c, f: a.f + x.f };
  }, s);
}

// ---------- despensa ----------

export function gramsPerUnit(product, ctx) {
  if (product.unit !== 'ud') return 1;
  return Number(product.unitGrams) || ctx.foods.get(product.foodId)?.ug || 100;
}

export function stockByFood(ctx) {
  const stock = new Map();
  const expiry = new Map();
  for (const p of ctx.products) {
    if (!p.foodId) continue;
    const amount = p.batches.reduce((s, b) => s + b.qty, 0) * gramsPerUnit(p, ctx);
    if (amount <= 0) continue;
    stock.set(p.foodId, (stock.get(p.foodId) || 0) + amount);
    const first = p.batches.map((b) => b.expiry).filter(Boolean).sort()[0];
    if (first && (!expiry.has(p.foodId) || first < expiry.get(p.foodId))) expiry.set(p.foodId, first);
  }
  return { stock, expiry };
}

export function labelNutrition(products) {
  const map = new Map();
  for (const p of products) {
    if (p.foodId && p.per100 && p.batches.some((b) => b.qty > 0) && !map.has(p.foodId)) map.set(p.foodId, p.per100);
  }
  return map;
}

// ---------- elegir platos ----------

export const isWorkDay = (config, date) => config.workDays.includes(dow(date));
export const maxMinutes = (config, slot, date) => config.time[slot][isWorkDay(config, date) ? 'work' : 'free'];

export function usableRecipes(ctx) {
  const ex = new Set(ctx.config.exclude || []);
  const hidden = new Set(ctx.config.hiddenRecipes || []);
  return ctx.recipes.filter((r) => !hidden.has(r.id) && r.ing.every((i) => {
    const food = ctx.foods.get(i.food);
    return food && !ex.has(i.food) && !food.tags.some((t) => ex.has(`tag:${t}`));
  }));
}

export function candidatesFor(ctx, slot, date) {
  const max = maxMinutes(ctx.config, slot, date);
  return usableRecipes(ctx).filter((r) => r.slots.includes(slot) && r.min <= max);
}

const ROLE_W = { P: 2, C: 2, V: 1, F: 0.5 };
const mainProtein = (r) => r.ing.filter((i) => i.role === 'P').sort((a, b) => b.g - a.g)[0]?.food;

function scoreRecipe(r, slot, date, st, ctx) {
  const portions = portionsOf(ctx.config.diners[slot], ctx.config);

  // Variedad: como mucho 2 veces por semana y nunca en días seguidos.
  const used = st.chosen.filter((c) => c.recipeId === r.id);
  if (used.length >= 2) return -Infinity;
  if (used.some((c) => Math.abs(diffDays(c.date, date)) <= 1)) return -Infinity;

  let s = 0;

  // Lo que hay en casa.
  let need = 0;
  let have = 0;
  for (const i of r.ing) {
    const food = ctx.foods.get(i.food);
    if (food.staple) continue;
    const w = ROLE_W[i.role] || 1;
    need += w;
    have += w * Math.min(1, (st.stock.get(i.food) || 0) / (i.g * portions));
  }
  s += 5 * (need ? have / need : 1);

  // Lo que caduca pronto, cuanto antes mejor.
  for (const i of r.ing) {
    const e = st.expiry.get(i.food);
    if (!e || !(st.stock.get(i.food) > 0)) continue;
    const left = diffDays(e, date);
    if (left >= 0 && left <= 4) s += (5 - left) * 0.6;
  }

  // Aprovechar lo que ya se cocina (mismas bases 2-3 veces, no más).
  for (const key of r.prep) {
    const keeps = PREP[key]?.keeps ?? 3;
    const uses = st.chosen.filter((c) => c.prep.includes(key) && Math.abs(diffDays(c.date, date)) <= keeps).length;
    if (uses >= 1 && uses <= 2) s += 1.3;
    else if (uses >= 3) s -= 1.5;
  }

  s -= 2.5 * used.length;
  if (st.lastWeek.has(r.id)) s -= 1;

  // No repetir la proteína principal el mismo día ni en la misma comida del día anterior.
  const mp = mainProtein(r);
  if (st.chosen.some((c) => c.date === date && c.main === mp)) s -= 2;
  if (st.chosen.some((c) => c.slot === slot && c.main === mp && diffDays(date, c.date) === 1)) s -= 1;

  // Pescado: buscar 3 o más a la semana en comidas y cenas.
  if (slot !== 'desayuno' && ctx.foods.get(mp)?.tags.includes('pescado')) {
    const fish = st.chosen.filter((c) => c.fish).length;
    if (fish < 3) s += 0.8;
  }

  // Que la receta tenga una proporción de proteína parecida a tu objetivo.
  const m = itemsMacros(r.ing, ctx);
  if (m.kcal > 0) s -= 8 * Math.abs((m.p * 4) / m.kcal - st.proteinShare);

  return s + Math.random() * 1.2;
}

function reserve(r, slot, st, ctx) {
  const portions = portionsOf(ctx.config.diners[slot], ctx.config);
  for (const i of r.ing) st.stock.set(i.food, Math.max(0, (st.stock.get(i.food) || 0) - i.g * portions));
}

function pickRecipe(ctx, slot, date, st, exceptId) {
  let best = null;
  let bestScore = -Infinity;
  for (const r of candidatesFor(ctx, slot, date)) {
    if (r.id === exceptId) continue;
    const s = scoreRecipe(r, slot, date, st, ctx);
    if (s > bestScore) { bestScore = s; best = r; }
  }
  return best;
}

function newState(ctx, plan) {
  const { stock, expiry } = stockByFood(ctx);
  // Lo que aún van a gastar las comidas pendientes de los otros menús activos
  // (p. ej. el fin de semana de la semana en curso) no está disponible para este.
  const today = todayISO();
  for (const other of ctx.activePlans || []) {
    if (other.id === plan.id) continue;
    for (const d of other.days) {
      if (d.date < today) continue;
      for (const m of d.meals) {
        if (m.done || m.off) continue;
        const portions = portionsOf(m.diners, ctx.config);
        m.items.forEach((i) => stock.set(i.food, Math.max(0, (stock.get(i.food) || 0) - i.g * portions)));
      }
    }
  }
  const t = foodTargets(ctx.config, ctx.supplements);
  return {
    stock, expiry, chosen: [],
    lastWeek: new Set((ctx.prevPlan?.days || []).flatMap((d) => d.meals.map((m) => m.recipeId))),
    proteinShare: t.kcal > 0 ? (t.p * 4) / t.kcal : 0.3,
    plan,
  };
}

const chosenEntry = (r, slot, date, ctx) => ({
  recipeId: r.id, slot, date, prep: r.prep, main: mainProtein(r),
  fish: ctx.foods.get(mainProtein(r))?.tags.includes('pescado'),
});

export const planEnd = (plan) => addDays(plan.start, plan.days.length - 1);

export function batchDateFor(start, config) {
  if (dow(addDays(start, -1)) === config.batchDow) return addDays(start, -1);
  for (let i = 0; i < 7; i++) if (dow(addDays(start, i)) === config.batchDow) return addDays(start, i);
  return null;
}

export function generatePlan(ctx, start) {
  const plan = { id: uid(), start, batchDate: batchDateFor(start, ctx.config), created: todayISO(), days: [], prepDone: {} };
  const st = newState(ctx, plan);
  for (let d = 0; d < 7; d++) {
    const date = addDays(start, d);
    const day = { date, meals: [], supps: {} };
    for (const slot of SLOT_ORDER) {
      const r = pickRecipe(ctx, slot, date, st);
      if (!r) continue;
      st.chosen.push(chosenEntry(r, slot, date, ctx));
      reserve(r, slot, st, ctx);
      day.meals.push(newMeal(r, slot, ctx));
    }
    solveDay(day, ctx);
    plan.days.push(day);
  }
  return plan;
}

function newMeal(r, slot, ctx) {
  return {
    id: uid(), slot, recipeId: r.id, name: r.name, diners: ctx.config.diners[slot] || 1,
    items: r.ing.map((i) => ({ food: i.food, g: i.g })), done: false, used: null, off: null,
  };
}

// Alternativas para cambiar un plato, de mejor a peor.
export function alternatives(ctx, plan, dayIndex, mealIndex, limit = 8) {
  const day = plan.days[dayIndex];
  const meal = day.meals[mealIndex];
  const st = newState(ctx, plan);
  plan.days.forEach((d) => d.meals.forEach((m) => {
    if (m === meal || m.off) return;
    const r = ctx.recipeMap.get(m.recipeId);
    if (r) { st.chosen.push(chosenEntry(r, m.slot, d.date, ctx)); if (!m.done) reserve(r, m.slot, st, ctx); }
  }));
  return candidatesFor(ctx, meal.slot, day.date)
    .filter((r) => r.id !== meal.recipeId)
    .map((r) => ({ r, s: scoreRecipe(r, meal.slot, day.date, st, ctx) }))
    .filter((x) => x.s > -Infinity)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.r);
}

export function replaceMeal(ctx, plan, dayIndex, mealIndex, recipe) {
  const day = plan.days[dayIndex];
  const old = day.meals[mealIndex];
  day.meals[mealIndex] = { ...newMeal(recipe, old.slot, ctx), diners: old.diners };
  solveDay(day, ctx);
}

// ---------- ajustar raciones a los macros ----------

const BOUNDS = { P: [0.6, 2.2], C: [0.4, 2.2], F: [0, 2.5] };

// Reajusta las comidas pendientes del día (las hechas o "fuera de plan" quedan fijas).
export function solveDay(day, ctx) {
  const target = foodTargets(ctx.config, ctx.supplements);
  const keys = ['kcal', 'p', 'c', 'f'];
  const weights = { kcal: 2, p: 3, c: 1, f: 1 };
  const free = day.meals.filter((m) => !m.done && !m.off && ctx.recipeMap.has(m.recipeId));
  if (!free.length) return;

  const fixed = { kcal: 0, p: 0, c: 0, f: 0 };
  day.meals.filter((m) => !free.includes(m)).forEach((m) => {
    const x = mealMacros(m, ctx);
    keys.forEach((k) => { fixed[k] += x[k]; });
  });

  // Variables: un factor por comida y rol (P, C, F) que multiplica la receta base.
  const vars = [];
  const base = free.map((m) => {
    const r = ctx.recipeMap.get(m.recipeId);
    const constant = itemsMacros(r.ing.filter((i) => i.role === 'V'), ctx);
    for (const role of ['P', 'C', 'F']) {
      const ing = r.ing.filter((i) => i.role === role);
      if (ing.length) vars.push({ meal: m, role, a: itemsMacros(ing, ctx), x: 1 });
    }
    return { meal: m, r, constant };
  });

  // Filas del problema de mínimos cuadrados: totales del día y reparto entre comidas.
  const rows = keys.map((k) => ({
    w: weights[k] / Math.max(1, target[k]) ** 2,
    c: fixed[k] + base.reduce((s, b) => s + b.constant[k], 0) - target[k],
    coef: vars.map((v) => v.a[k]),
  }));
  const fixedShare = day.meals.filter((m) => !free.includes(m)).reduce((s, m) => s + (ctx.config.split[m.slot] || 0), 0);
  const leftKcal = Math.max(0, target.kcal - fixed.kcal);
  for (const b of base) {
    const share = (ctx.config.split[b.meal.slot] || 1 / 3) / Math.max(0.01, 1 - fixedShare);
    rows.push({
      w: 0.4 / Math.max(1, target.kcal) ** 2,
      c: b.constant.kcal - share * leftKcal,
      coef: vars.map((v) => (v.meal === b.meal ? v.a.kcal : 0)),
    });
  }

  // Descenso por coordenadas con límites (problema convexo pequeño: converge rápido).
  const rho = 0.02;
  const res = rows.map((row) => row.c + row.coef.reduce((s, a, i) => s + a * vars[i].x, 0));
  for (let sweep = 0; sweep < 300; sweep++) {
    let moved = 0;
    vars.forEach((v, i) => {
      let g = 2 * rho * (v.x - 1);
      let h = 2 * rho;
      rows.forEach((row, j) => { g += 2 * row.w * row.coef[i] * res[j]; h += 2 * row.w * row.coef[i] ** 2; });
      const [lo, hi] = BOUNDS[v.role];
      const nx = Math.min(hi, Math.max(lo, v.x - g / h));
      const delta = nx - v.x;
      if (delta) {
        v.x = nx;
        rows.forEach((row, j) => { res[j] += row.coef[i] * delta; });
        moved += Math.abs(delta);
      }
    });
    if (moved < 1e-5) break;
  }

  for (const b of base) {
    const scale = { V: 1 };
    vars.filter((v) => v.meal === b.meal).forEach((v) => { scale[v.role] = v.x; });
    b.meal.items = b.r.ing
      .map((i) => ({ food: i.food, g: roundGrams(i.g * (scale[i.role] ?? 1), ctx.foods.get(i.food)) }))
      .filter((i) => i.g > 0);
  }
  fixRounding(day, free, target, ctx);
}

// Al redondear (huevos enteros, wraps…) el día se desvía un poco: se compensa con los
// ingredientes que se pesan en gramos (arroz, pasta, aceite…), primero hidratos y grasa.
function fixRounding(day, free, target, ctx) {
  const supp = supplementTotals(ctx.supplements);
  for (let pass = 0; pass < 4; pass++) {
    const total = dayMacros(day, ctx).kcal - supp.kcal;
    const err = total - target.kcal;
    if (Math.abs(err) <= target.kcal * 0.02) return;
    const options = [];
    for (const m of free) {
      const r = ctx.recipeMap.get(m.recipeId);
      for (const it of m.items) {
        const food = ctx.foods.get(it.food);
        const role = r.ing.find((i) => i.food === it.food)?.role;
        if (food.u === 'ud' || !['C', 'F', 'P'].includes(role)) continue;
        options.push({ it, food, role, kcalPerG: nutrOf(it.food, ctx).kcal / 100 });
      }
    }
    options.sort((a, b) => 'CFP'.indexOf(a.role) - 'CFP'.indexOf(b.role) || b.kcalPerG - a.kcalPerG);
    const o = options.filter((x) => x.kcalPerG > 0.5)[pass];
    if (!o) return;
    const step = o.food.step || 5;
    const wanted = o.it.g - err / o.kcalPerG;
    o.it.g = Math.max(step, Math.round(Math.min(wanted, o.it.g * 1.6) / step) * step);
  }
}

function roundGrams(g, food) {
  if (food.u === 'ud' && food.ug) {
    const step = food.ug >= 100 ? 0.5 : 1;
    const units = Math.max(step, Math.round(g / food.ug / step) * step);
    return units * food.ug;
  }
  const step = food.step || 5;
  return Math.round(g / step) * step;
}

// ---------- batch cooking y víspera ----------

export function buildPrep(plan, ctx) {
  const batch = new Map();
  const nights = new Map(); // fecha -> Map(clave -> tarea)
  const addTo = (map, key, make) => { if (!map.has(key)) map.set(key, make()); return map.get(key); };
  const nightTasks = (date) => addTo(nights, date, () => new Map());
  const label = (date, slot) => ({ date, slot });

  const meals = plan.days.flatMap((d) => d.meals.filter((m) => !m.off).map((m) => ({ ...m, date: d.date })));
  for (const m of meals) {
    const r = ctx.recipeMap.get(m.recipeId);
    if (!r) continue;
    const portions = portionsOf(m.diners, ctx.config);

    for (const key of r.prep) {
      const def = PREP[key];
      if (!def) continue;
      const qty = m.items.filter((i) => def.foods.includes(i.food)).map((i) => ({ food: i.food, g: i.g * portions }));
      const d = plan.batchDate ? diffDays(m.date, plan.batchDate) : -1;
      let task;
      if (d >= 0 && d <= def.keeps && !(d === 0 && m.slot === 'desayuno')) {
        task = addTo(batch, key, () => ({ id: `b:${key}`, key, ...def, qty: [], meals: [] }));
      } else {
        // Reutiliza una tanda de una noche anterior si aún aguanta; si no, la noche antes del plato.
        let found = null;
        for (const [date, tasks] of nights) {
          const t = tasks.get(key);
          if (t && date < m.date && diffDays(m.date, date) <= def.keeps) found = t;
        }
        const date = addDays(m.date, -1);
        task = found || addTo(nightTasks(date), key, () => ({ id: `n:${date}:${key}`, key, date, ...def, qty: [], meals: [] }));
      }
      qty.forEach((q) => {
        const prev = task.qty.find((x) => x.food === q.food);
        if (prev) prev.g += q.g; else task.qty.push({ ...q });
      });
      task.meals.push(label(m.date, m.slot));
    }

    for (const text of r.night) {
      const date = addDays(m.date, -1);
      const t = addTo(nightTasks(date), `t:${text}`, () => ({ id: `n:${date}:${text}`, date, task: text, qty: [], meals: [] }));
      t.meals.push(label(m.date, m.slot));
    }
  }

  const batchList = [...batch.values()];
  const totalMin = batchList.reduce((s, t) => s + t.min, 0);
  const longest = batchList.reduce((s, t) => Math.max(s, t.min), 0);
  return {
    batchDate: plan.batchDate,
    batch: batchList,
    batchMinutes: Math.round(Math.max(longest, totalMin * 0.55) / 5) * 5,
    nights: new Map([...nights].map(([date, tasks]) => [date, [...tasks.values()]])),
  };
}

// ---------- lo que falta comprar ----------

// Acepta uno o varios menús (semana en curso + la siguiente) y suma lo que piden.
export function planNeeds(plans, ctx) {
  plans = (Array.isArray(plans) ? plans : [plans]).filter(Boolean);
  if (!plans.length) return [];
  const from = todayISO();
  const need = new Map();
  for (const d of plans.flatMap((p) => p.days)) {
    if (d.date < from) continue;
    for (const m of d.meals) {
      if (m.done || m.off) continue;
      const portions = portionsOf(m.diners, ctx.config);
      m.items.forEach((i) => need.set(i.food, (need.get(i.food) || 0) + i.g * portions));
    }
  }
  const { stock } = stockByFood(ctx);
  const out = [];
  for (const [foodId, g] of need) {
    const food = ctx.foods.get(foodId);
    if (!food) continue;
    const have = stock.get(foodId) || 0;
    const missing = g - have;
    if (missing <= Math.max(2, g * 0.02)) continue;
    // Básicos como el aceite: solo si no tienes nada registrado.
    if (food.staple && have > 0) continue;
    out.push({ food, need: g, have, missing: roundUpBuy(missing, food) });
  }
  return out;
}

export function roundUpBuy(g, food) {
  if (food.u === 'ud' && food.ug) return Math.ceil(g / food.ug - 0.05) * food.ug;
  const step = g >= 300 ? 100 : g >= 100 ? 50 : 10;
  return Math.ceil(g / step) * step;
}
