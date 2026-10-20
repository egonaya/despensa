// Base de datos local (IndexedDB). Todo se guarda en el dispositivo.
//
// products:    { id, barcode, name, brand, image, quantityLabel, nutriscore, nova, category,
//                foodId, unit ('ud' | 'g' | 'ml'), unitGrams, per100, minStock,
//                batches: [{ id, qty, expiry, addedAt }], createdAt, updatedAt }
// shopping:    { id, name, done, createdAt }        (artículos añadidos a mano)
// supplements: { id, name, brand, dose, kcal, protein, carbs, fat, perDay, timing, stock, barcode, notes }
// recipes:     recetas propias (mismo formato que js/recipes.js)
// foods:       alimentos propios (mismo formato que js/foods.js)
// settings:    { key, value }   → 'config' (objetivos y preferencias) y 'plan' (menú de la semana)

import { uid } from './util.js';

export { uid };

const DB_NAME = 'despensa';
const DB_VERSION = 2;
const STORES = ['products', 'shopping', 'supplements', 'recipes', 'foods', 'settings'];

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('products')) {
          db.createObjectStore('products', { keyPath: 'id' }).createIndex('barcode', 'barcode', { unique: false });
        }
        for (const name of ['shopping', 'supplements', 'recipes', 'foods']) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

const getAll = async (name) => request((await store(name)).getAll());
const put = async (name, value) => { await request((await store(name, 'readwrite')).put(value)); return value; };
const del = async (name, id) => request((await store(name, 'readwrite')).delete(id));

const EPS = 0.001;
export const stockOf = (product) => {
  const n = product.batches.reduce((sum, b) => sum + b.qty, 0);
  return Math.round(n * 100) / 100;
};

// Fecha de caducidad más próxima entre los lotes que quedan, o null.
export const nextExpiry = (product) =>
  product.batches.map((b) => b.expiry).filter(Boolean).sort()[0] || null;

// "Se acaba" cuando quedan menos unidades que el mínimo (mínimo 0 = no avisar nunca).
export const isLow = (product) => stockOf(product) < (product.minStock ?? (product.unit === 'ud' ? 1 : 0));

// ---- productos ----

// Productos guardados con la versión anterior: sin unidad ni alimento vinculado.
const upgradeProduct = (p) => ({ unit: 'ud', unitGrams: null, foodId: null, per100: null, ...p });

export const allProducts = async () => (await getAll('products')).map(upgradeProduct);

export async function getProduct(id) {
  const p = await request((await store('products')).get(id));
  return p && upgradeProduct(p);
}

export async function findByBarcode(barcode) {
  const p = await request((await store('products')).index('barcode').get(barcode));
  return p && upgradeProduct(p);
}

export async function saveProduct(product) {
  product.updatedAt = Date.now();
  product.createdAt ??= product.updatedAt;
  return put('products', product);
}

export const deleteProduct = (id) => del('products', id);

export async function addStock(id, qty, expiry) {
  const product = await getProduct(id);
  product.batches.push({ id: uid(), qty, expiry: expiry || null, addedAt: Date.now() });
  return saveProduct(product);
}

// Gasta cantidad (admite decimales) empezando por el lote que antes caduca.
// Devuelve lo que se ha quitado de cada lote, para poder deshacerlo.
export async function consume(id, qty = 1) {
  const product = await getProduct(id);
  product.batches.sort((a, b) => (a.expiry || '9999').localeCompare(b.expiry || '9999') || a.addedAt - b.addedAt);
  let left = qty;
  const taken = [];
  for (const batch of product.batches) {
    if (left <= EPS) break;
    const take = Math.min(batch.qty, left);
    batch.qty -= take;
    left -= take;
    taken.push({ productId: id, qty: take, expiry: batch.expiry });
  }
  product.batches = product.batches.filter((b) => b.qty > EPS);
  await saveProduct(product);
  return { product, taken, missing: Math.max(0, left) };
}

// Fija la cantidad total: quita de lo que antes caduca o añade un lote nuevo.
export async function setStock(id, qty, expiry) {
  const product = await getProduct(id);
  const diff = qty - stockOf(product);
  if (diff < -EPS) return (await consume(id, -diff)).product;
  if (diff > EPS) return addStock(id, diff, expiry);
  return product;
}

export async function removeBatch(productId, batchId) {
  const product = await getProduct(productId);
  product.batches = product.batches.filter((b) => b.id !== batchId);
  return saveProduct(product);
}

// ---- lista de la compra (extras manuales) ----

export const allShopping = () => getAll('shopping');
export async function saveShopping(item) {
  item.createdAt ??= Date.now();
  return put('shopping', item);
}
export const deleteShopping = (id) => del('shopping', id);

// ---- suplementos, recetas y alimentos propios ----

export const allSupplements = () => getAll('supplements');
export const saveSupplement = (s) => put('supplements', s);
export const deleteSupplement = (id) => del('supplements', id);

export const allRecipes = () => getAll('recipes');
export const saveRecipe = (r) => put('recipes', r);
export const deleteRecipe = (id) => del('recipes', id);

export const allFoods = () => getAll('foods');
export const saveFood = (f) => put('foods', f);
export const deleteFood = (id) => del('foods', id);

// ---- ajustes y plan ----

export async function getSetting(key) {
  const row = await request((await store('settings')).get(key));
  return row?.value ?? null;
}
export const setSetting = (key, value) => put('settings', { key, value });

// ---- copia de seguridad ----

export async function exportAll() {
  const data = { app: 'despensa', version: 2, exportedAt: new Date().toISOString() };
  for (const name of STORES) data[name] = await getAll(name);
  return data;
}

// Copia completa: sustituye todo. Archivo de ajustes (sin productos): solo los fusiona.
export const isFullBackup = (data) => Array.isArray(data?.products);

export async function importAll(data) {
  if (data?.app !== 'despensa') throw new Error('El archivo no es una copia de Despensa.');
  const db = await open();
  const full = isFullBackup(data);
  const tx = db.transaction(STORES, 'readwrite');
  for (const name of STORES) {
    const rows = data[name];
    if (full) tx.objectStore(name).clear();
    if (Array.isArray(rows)) rows.forEach((row) => tx.objectStore(name).put(row));
  }
  if (!full && data.config) tx.objectStore('settings').put({ key: 'config', value: data.config });
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
}
