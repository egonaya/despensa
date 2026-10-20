// Lectura de tickets de supermercado sin IA.
//
// - PDF (ticket digital): se extrae el texto con pdf.js, que es exacto.
// - Foto (ticket en papel): se reconoce el texto con Tesseract.js (OCR en el propio móvil).
// Después se buscan las líneas de producto y se relacionan con tus alimentos. Siempre se
// revisan antes de guardar: el OCR de una foto puede leer mal alguna línea.

import { norm, addDays, todayISO } from './util.js';
import { guessFood } from './foods.js';

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const TESS_WORKER = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js';
const TESS_CORE = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1';
const TESS_LANG = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/spa@1.0.0/4.0.0_best_int';
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

const loaded = new Map();
function loadScript(src) {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { loaded.delete(src); reject(new Error('No se pudo descargar el lector de tickets. Comprueba la conexión.')); };
      document.head.appendChild(s);
    }));
  }
  return loaded.get(src);
}

// ---------- extraer texto ----------

export async function readTicket(file, onProgress = () => {}) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf) {
    onProgress('Leyendo el PDF…');
    const { text, pages } = await pdfText(file);
    // Un PDF escaneado no trae texto: se pasa por el OCR página a página.
    if (text.replace(/\s/g, '').length > 40) return text;
    let all = '';
    for (const [i, canvas] of pages.entries()) all += `${await ocr(canvas, (p) => onProgress(`Leyendo página ${i + 1}… ${p}%`))}\n`;
    return all;
  }
  const canvas = await prepareImage(file);
  return ocr(canvas, (p) => onProgress(`Leyendo el ticket… ${p}%`));
}

async function pdfText(file) {
  await loadScript(PDFJS);
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  let text = '';
  const pages = [];
  for (let n = 1; n <= Math.min(doc.numPages, 6); n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    // Rehace las líneas agrupando los trozos por su altura en la página.
    const rows = new Map();
    for (const it of content.items) {
      if (!it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 3);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: it.transform[4], s: it.str });
    }
    text += [...rows.entries()].sort((a, b) => b[0] - a[0])
      .map(([, parts]) => parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(' ')).join('\n') + '\n';
    if (!text.trim()) {
      const viewport = page.getViewport({ scale: 2.5 });
      const canvas = Object.assign(document.createElement('canvas'), { width: viewport.width, height: viewport.height });
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      pages.push(canvas);
    }
  }
  return { text, pages };
}

// Escala de grises, tamaño adecuado y algo de contraste: el OCR acierta bastante más.
async function prepareImage(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(async () => {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    await img.decode();
    return img;
  });
  const w0 = bitmap.width;
  const h0 = bitmap.height;
  const scale = Math.min(2.5, Math.max(1, 1800 / Math.min(w0, h0 * 0.6)), 4000 / Math.max(w0, h0));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(w0 * scale), height: Math.round(h0 * scale) });
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = Math.max(0, Math.min(255, (y - 128) * 1.6 + 140));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  g.putImageData(img, 0, 0);
  return canvas;
}

async function ocr(canvas, onProgress) {
  await loadScript(TESSERACT);
  const worker = await window.Tesseract.createWorker('spa', 1, {
    workerPath: TESS_WORKER, corePath: TESS_CORE, langPath: TESS_LANG,
    logger: (m) => { if (m.status === 'recognizing text') onProgress(Math.round(m.progress * 100)); },
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
    const { data } = await worker.recognize(canvas);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

// ---------- interpretar las líneas ----------

const PRICE_END = /(?:\s+-?\d{1,4}[.,]\d{2}\s*(?:€|eur)?\s*[a-e*]?)+\s*$/i;
const SKIP = /\b(total|subtotal|iva|base imp|cuota|tarjeta|efectivo|cambio|entregad|factura|nif|cif|tel[eé]fono|gracias|ticket|operaci[oó]n|importe|descuento|dto|ahorr|club|cup[oó]n|puntos|visa|mastercard|contactless|autoriz|terminal|comercio|caja|cajer|atendid|s\.a\.|s\.l\.|retail|precio|cantidad|descripci[oó]n|p\.\s*unit|devoluci|bolsa|www|http|horario|c\/|avda|calle|fecha|hora)\b/i;
const STOP = new Set(['de', 'del', 'con', 'la', 'el', 'en', 'y', 'al', 'sin', 'para', 'los', 'las', 'un', 'una', 'x', 'ud', 'uds', 'kg', 'gr', 'g', 'ml', 'l', 'eur']);

// Pesos típicos cuando el ticket no dice cuánto pesaba (se pueden corregir al revisar).
const PIECE_G = {
  brocoli: 500, lechuga: 250, calabacin: 300, pepino: 300, berenjena: 350, coliflor: 900, pimiento: 200,
  puerro: 200, espinacas: 300, champinones: 250, esparragos: 250, judias_verdes: 500, zanahoria: 1000,
  cebolla: 1000, patata: 2000, tomate: 1000, pollo_pechuga: 500, pollo_muslo: 600, pavo_pechuga: 400,
  pavo_picado: 400, ternera_magra: 400, ternera_picada: 400, cerdo_solomillo: 500, cerdo_lomo: 500,
  merluza: 400, bacalao: 400, lubina: 400, salmon: 300, sepia: 400, gambas: 400, mejillones: 1000,
  boniato: 1000, frutos_rojos: 300, verduras_wok: 450,
  // Envases habituales cuando el ticket no indica el tamaño.
  tomate_triturado: 400, garbanzos: 400, lentejas: 400, alubias: 400, arroz: 1000, arroz_integral: 1000,
  pasta: 500, pasta_integral: 500, cuscus: 500, quinoa: 500, avena: 500, harina_maiz: 1000,
  pan_integral: 450, leche: 1000, bebida_avena: 1000, claras: 1000, skyr: 450, queso_batido: 500,
  queso_fresco: 250, mozzarella: 125, aceite: 1000, tofu: 400,
};

const toNum = (s) => Number(String(s).replace(',', '.'));
const tokens = (s) => norm(s).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter((t) => t.length >= 2 && !STOP.has(t));

// Los tickets abrevian ("PECH. POLLO", "TOM. TRIT."): se aceptan prefijos de 4 letras o más.
function fuzzyFood(name, foods) {
  const exact = guessFood(name, foods);
  if (exact) return exact;
  const toks = tokens(name);
  // Con 3 letras ("TOM.") solo vale dentro de una frase de dos palabras ("tomate triturado").
  const wordOk = (w, min) => toks.findIndex((t) => t === w || (t.length >= min && (w.startsWith(t) || t.startsWith(w.slice(0, Math.max(4, w.length - 2))))));
  let best = null;
  let bestScore = 0;
  for (const food of foods) {
    for (const kw of food.kw || []) {
      const words = kw.split(' ').filter((w) => !STOP.has(w));
      if (!words.length) continue;
      const pos = words.map((w) => wordOk(w, words.length > 1 ? 3 : 4));
      if (pos.some((i) => i < 0)) continue;
      const score = kw.length + (words.length > 1 ? 5 : 0) - Math.min(...pos);
      if (score > bestScore) { bestScore = score; best = food; }
    }
  }
  return best;
}

const pretty = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()).replace(/\s+/g, ' ').trim();

export function parseTicket(text, foods) {
  const items = [];
  let pendingName = null; // línea con nombre pero sin precio (puede llevar el peso debajo)

  const addItem = (raw, extra = {}) => {
    let name = raw;
    let count = 1;
    const lead = name.match(/^(\d{1,2})\s+(?=\D)/);
    if (lead) { count = Number(lead[1]); name = name.slice(lead[0].length); }
    name = name.replace(PRICE_END, '').replace(/\s+\d+\s*[x×]\s*\d+[.,]\d{2}.*$/i, '').replace(/[*€]/g, ' ').trim()
      // El OCR confunde la G con un 6: "5006" → "500g", "1K6" → "1kg".
      .replace(/\b(\d{1,3}0)6\b/g, '$1g').replace(/\b(\d)K6\b/gi, '$1kg');
    if (!/[a-záéíóúñ]{3,}/i.test(name)) return null;
    const pack = name.match(/(\d+(?:[.,]\d+)?)\s*(kg|grs?|g|lt?|ml|cl)\b/i);
    let packGrams = null;
    if (pack) {
      const n = toNum(pack[1]);
      const u = pack[2].toLowerCase();
      packGrams = u === 'kg' || u === 'l' || u === 'lt' ? n * 1000 : u === 'cl' ? n * 10 : n;
    }
    const units = name.match(/\b(\d{1,2})\s*(?:ud|uds|u|unid)\b|\bx\s?(\d{1,2})\b/i);
    const packUnits = /docena/i.test(name) ? 12 : units ? Number(units[1] || units[2]) : null;
    const item = { raw, name: pretty(name), count, packGrams, packUnits, grams: null, ...extra };
    items.push(item);
    return item;
  };

  for (const line of String(text).split(/\r?\n/)) {
    const l = line.replace(/\s+/g, ' ').trim();
    if (l.length < 3) continue;
    const letters = (l.match(/[a-záéíóúñ]{3,}/gi) || []).filter((w) => !/^(kg|eur)$/i.test(w));

    // "0,524 kg x 6,95 €/kg 3,64": peso del producto anterior.
    const kg = l.match(/(\d+[.,]\d{1,3})\s*kg/i);
    if (kg && letters.length === 0) {
      const grams = toNum(kg[1]) * 1000;
      const last = pendingName ? addItem(pendingName) : items[items.length - 1];
      if (last && !last.grams) last.grams = grams;
      pendingName = null;
      continue;
    }
    // "2 x 0,79": unidades del producto anterior.
    const mult = l.match(/^(\d{1,2})\s*[x×]\s*\d+[.,]\d{2}/i);
    if (mult && letters.length === 0) {
      const last = items[items.length - 1];
      if (last && last.count === 1) last.count = Number(mult[1]);
      continue;
    }
    if (!letters.length || SKIP.test(l)) { pendingName = null; continue; }

    if (PRICE_END.test(l) || /^\d{1,2}\s+\D/.test(l)) {
      if (pendingName && /^\d{1,2}\s+\D/.test(pendingName)) addItem(pendingName);
      pendingName = null;
      if (PRICE_END.test(l)) addItem(l);
      else pendingName = l;
    } else {
      pendingName = l;
    }
  }
  if (pendingName && /^\d{1,2}\s+\D/.test(pendingName)) addItem(pendingName);

  // Convierte cada línea en una propuesta de producto para la despensa.
  const today = todayISO();
  const merged = new Map();
  for (const it of items) {
    const food = fuzzyFood(it.name, foods);
    let unit = 'ud';
    let qty = it.count;
    let unitGrams = it.packGrams;
    let estimated = false;
    if (it.grams) {
      unit = food?.u === 'ml' ? 'ml' : 'g';
      qty = Math.round(it.grams);
      unitGrams = null;
    } else if (food?.u === 'ud' && food.ug) {
      qty = it.count * (it.packUnits || (it.packGrams ? Math.max(1, Math.round(it.packGrams / food.ug)) : 1));
      unitGrams = food.ug;
    } else if (food && !unitGrams) {
      unitGrams = PIECE_G[food.id] || null;
      estimated = !!unitGrams;
    }
    const key = `${it.name}|${unit}|${unitGrams}`;
    if (merged.has(key)) { merged.get(key).qty += qty; continue; }
    merged.set(key, {
      include: !!food, name: food && it.name.length < 4 ? food.name : it.name, raw: it.raw,
      foodId: food?.id || '', unit, qty, unitGrams, estimated,
      expiry: food?.keeps && food.keeps <= 30 ? addDays(today, food.keeps) : '',
    });
  }
  return [...merged.values()];
}
