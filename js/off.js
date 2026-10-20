// Consulta de productos en Open Food Facts (la base de datos abierta que usa Yuka).
// https://openfoodfacts.github.io/openfoodfacts-server/api/

const FIELDS = [
  'product_name', 'product_name_es', 'generic_name_es', 'brands', 'quantity',
  'image_front_small_url', 'image_front_url', 'nutriscore_grade', 'nova_group', 'categories',
  'nutriments', 'product_quantity', 'product_quantity_unit',
].join(',');

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

function per100(n = {}) {
  const kcal = num(n['energy-kcal_100g']) ?? (num(n.energy_100g) != null ? num(n.energy_100g) / 4.184 : null);
  const p = num(n.proteins_100g);
  const c = num(n.carbohydrates_100g);
  const f = num(n.fat_100g);
  if ([kcal, p, c, f].some((v) => v == null)) return null;
  return { kcal: Math.round(kcal), p, c, f };
}

const firstBrand = (brands) => (brands || '').split(',')[0].trim();
// La categoría más concreta, descartando etiquetas internas en otro idioma ("fr:Nuttela").
const firstCategory = (categories) =>
  (categories || '').split(',').map((c) => c.trim()).filter((c) => c && !/^[a-z]{2}:/.test(c)).pop() || '';

// Devuelve los datos del producto, null si no existe, o lanza un error si no hay conexión.
export async function lookup(barcode) {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${FIELDS}&lc=es`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Open Food Facts respondió ${res.status}`);
    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;
    const p = data.product;
    const grade = (p.nutriscore_grade || '').toLowerCase();
    return {
      name: p.product_name_es || p.product_name || p.generic_name_es || '',
      brand: firstBrand(p.brands),
      quantityLabel: p.quantity || '',
      image: p.image_front_small_url || p.image_front_url || '',
      nutriscore: /^[a-e]$/.test(grade) ? grade : null,
      nova: [1, 2, 3, 4].includes(Number(p.nova_group)) ? Number(p.nova_group) : null,
      category: firstCategory(p.categories),
      per100: per100(p.nutriments),
      // Peso del envase en g o ml (para saber cuánto hay en casa).
      unitGrams: ['g', 'ml'].includes(String(p.product_quantity_unit || 'g').toLowerCase()) ? num(p.product_quantity) : null,
    };
  } finally {
    clearTimeout(timer);
  }
}
