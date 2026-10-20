// Base de datos local (IndexedDB). Todo se guarda en el dispositivo.
//
// products: { id, barcode, name, brand, image, quantityLabel, nutriscore, nova,
//             category, minStock, batches: [{ id, qty, expiry, addedAt }],
//             createdAt, updatedAt }
// shopping: { id, name, done, createdAt }   (artículos añadidos a mano)

const DB_NAME = 'despensa';
const DB_VERSION = 1;

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        const products = db.createObjectStore('products', { keyPath: 'id' });
        products.createIndex('barcode', 'barcode', { unique: false });
        db.createObjectStore('shopping', { keyPath: 'id' });
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

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export const stockOf = (product) => product.batches.reduce((sum, b) => sum + b.qty, 0);

// Fecha de caducidad más próxima entre los lotes que quedan, o null.
export const nextExpiry = (product) =>
  product.batches.map((b) => b.expiry).filter(Boolean).sort()[0] || null;

// "Se acaba" cuando quedan menos unidades que el mínimo (mínimo 0 = no avisar nunca).
export const isLow = (product) => stockOf(product) < (product.minStock ?? 1);

// ---- productos ----

export async function allProducts() {
  return request((await store('products')).getAll());
}

export async function getProduct(id) {
  return request((await store('products')).get(id));
}

export async function findByBarcode(barcode) {
  return request((await store('products')).index('barcode').get(barcode));
}

export async function saveProduct(product) {
  product.updatedAt = Date.now();
  product.createdAt ??= product.updatedAt;
  await request((await store('products', 'readwrite')).put(product));
  return product;
}

export async function deleteProduct(id) {
  await request((await store('products', 'readwrite')).delete(id));
}

export async function addStock(id, qty, expiry) {
  const product = await getProduct(id);
  product.batches.push({ id: uid(), qty, expiry: expiry || null, addedAt: Date.now() });
  return saveProduct(product);
}

// Gasta unidades empezando por el lote que antes caduca (los sin fecha, al final).
export async function consume(id, qty = 1) {
  const product = await getProduct(id);
  product.batches.sort((a, b) => (a.expiry || '9999').localeCompare(b.expiry || '9999') || a.addedAt - b.addedAt);
  let left = qty;
  for (const batch of product.batches) {
    const take = Math.min(batch.qty, left);
    batch.qty -= take;
    left -= take;
    if (!left) break;
  }
  product.batches = product.batches.filter((b) => b.qty > 0);
  return saveProduct(product);
}

export async function removeBatch(productId, batchId) {
  const product = await getProduct(productId);
  product.batches = product.batches.filter((b) => b.id !== batchId);
  return saveProduct(product);
}

// ---- lista de la compra (extras manuales) ----

export async function allShopping() {
  return request((await store('shopping')).getAll());
}

export async function saveShopping(item) {
  item.createdAt ??= Date.now();
  await request((await store('shopping', 'readwrite')).put(item));
  return item;
}

export async function deleteShopping(id) {
  await request((await store('shopping', 'readwrite')).delete(id));
}

// ---- copia de seguridad ----

export async function exportAll() {
  return { app: 'despensa', version: 1, exportedAt: new Date().toISOString(),
    products: await allProducts(), shopping: await allShopping() };
}

export async function importAll(data) {
  if (data?.app !== 'despensa' || !Array.isArray(data.products)) throw new Error('El archivo no es una copia de Despensa.');
  const db = await open();
  const tx = db.transaction(['products', 'shopping'], 'readwrite');
  tx.objectStore('products').clear();
  tx.objectStore('shopping').clear();
  data.products.forEach((p) => tx.objectStore('products').put(p));
  (data.shopping || []).forEach((s) => tx.objectStore('shopping').put(s));
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
}
