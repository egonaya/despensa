// Tabla de alimentos: valores por 100 g (o 100 ml) en crudo y escurrido, según tablas
// españolas de composición (BEDCA) y etiquetas habituales de supermercado.
//
// [id, nombre, sección, kcal, proteína, hidratos, grasa, opciones]
// opciones: u = 'g' | 'ml' | 'ud'   (unidad en la que se cuenta)
//           ug = gramos por unidad   (para 'ud': un huevo, un plátano…)
//           step = redondeo en gramos al calcular raciones
//           keeps = días que aguanta en casa tras comprarlo (para la caducidad por defecto)
//           kw = palabras para reconocerlo en el nombre de un producto escaneado
//           tags = grupos (pescado, carne, lácteo…) para excluir o variar
//           staple = básico de cocina que no cuenta como "falta" si no lo tienes registrado

import { norm } from './util.js';

const RAW = [
  // ---- carne y aves ----
  ['pollo_pechuga', 'Pechuga de pollo', 'Carnicería', 110, 23, 0, 1.5, { step: 10, keeps: 3, kw: ['pechuga pollo', 'pollo pechuga', 'filete pollo', 'pollo fileteada', 'pollo'], tags: ['carne', 'ave'] }],
  ['pollo_muslo', 'Contramuslo de pollo sin piel', 'Carnicería', 125, 19, 0, 5.5, { step: 10, keeps: 3, kw: ['contramuslo', 'muslo pollo', 'muslo deshuesado'], tags: ['carne', 'ave'] }],
  ['pavo_pechuga', 'Pechuga de pavo', 'Carnicería', 105, 24, 0, 1, { step: 10, keeps: 3, kw: ['pechuga pavo', 'dado pavo', 'filete pavo'], tags: ['carne', 'ave'] }],
  ['pavo_picado', 'Carne picada de pavo', 'Carnicería', 130, 21, 0, 5, { step: 10, keeps: 2, kw: ['pavo picado', 'picada pavo', 'burger pavo'], tags: ['carne', 'ave'] }],
  ['ternera_magra', 'Ternera magra (filete)', 'Carnicería', 125, 22, 0, 4, { step: 10, keeps: 3, kw: ['ternera', 'filete ternera', 'anojo', 'aguja ternera'], tags: ['carne', 'roja'] }],
  ['ternera_picada', 'Carne picada de ternera magra', 'Carnicería', 135, 20, 0, 6, { step: 10, keeps: 2, kw: ['picada ternera', 'hamburguesa ternera', 'carne picada', 'burger meat'], tags: ['carne', 'roja'] }],
  ['cerdo_solomillo', 'Solomillo de cerdo', 'Carnicería', 115, 21, 0, 3.5, { step: 10, keeps: 3, kw: ['solomillo cerdo', 'solomillo'], tags: ['carne', 'cerdo'] }],
  ['cerdo_lomo', 'Lomo de cerdo', 'Carnicería', 145, 22, 0, 6.5, { step: 10, keeps: 3, kw: ['lomo cerdo', 'cinta lomo', 'lomo fresco'], tags: ['carne', 'cerdo'] }],
  ['jamon_serrano', 'Jamón serrano', 'Carnicería', 240, 30, 0, 13, { step: 5, keeps: 30, kw: ['jamon serrano', 'jamon curado', 'jamon reserva', 'jamon bodega'], tags: ['carne', 'cerdo'] }],
  ['pavo_fiambre', 'Fiambre de pechuga de pavo', 'Carnicería', 100, 18, 2.5, 2, { step: 10, keeps: 10, kw: ['pavo loncha', 'pechuga pavo loncha', 'jamon cocido pavo', 'fiambre pavo', 'pavo en loncha', 'pechuga de pavo cocida'], tags: ['carne', 'ave'] }],

  // ---- pescado y marisco ----
  ['merluza', 'Merluza', 'Pescadería', 75, 16.5, 0, 1, { step: 10, keeps: 2, kw: ['merluza'], tags: ['pescado', 'blanco'] }],
  ['bacalao', 'Bacalao fresco', 'Pescadería', 80, 18, 0, 0.7, { step: 10, keeps: 2, kw: ['bacalao'], tags: ['pescado', 'blanco'] }],
  ['lubina', 'Lubina', 'Pescadería', 97, 18.4, 0, 2.6, { step: 10, keeps: 2, kw: ['lubina', 'dorada'], tags: ['pescado', 'blanco'] }],
  ['salmon', 'Salmón', 'Pescadería', 200, 20, 0, 13, { step: 10, keeps: 2, kw: ['salmon'], tags: ['pescado', 'azul'] }],
  ['sepia', 'Sepia o calamar limpio', 'Pescadería', 75, 16, 0.7, 0.9, { step: 10, keeps: 2, kw: ['sepia', 'calamar', 'pota', 'poton', 'chipiron'], tags: ['pescado', 'marisco'] }],
  ['gambas', 'Gambas o langostinos pelados', 'Congelados', 85, 18, 0, 1, { step: 10, keeps: 90, kw: ['gamba', 'langostino', 'camaron'], tags: ['pescado', 'marisco'] }],
  ['mejillones', 'Mejillones (carne)', 'Pescadería', 85, 12, 3.5, 2.2, { step: 10, keeps: 2, kw: ['mejillon'], tags: ['pescado', 'marisco'] }],
  ['atun_lata', 'Atún al natural (escurrido)', 'Despensa', 105, 24, 0, 1, { step: 4, keeps: 365, kw: ['atun natural', 'atun al natural', 'atun claro natural', 'bonito natural'], tags: ['pescado', 'conserva'] }],
  ['atun_aceite', 'Atún en aceite (escurrido)', 'Despensa', 190, 26, 0, 9.5, { step: 4, keeps: 365, kw: ['atun aceite', 'atun en aceite', 'atun claro en aceite', 'bonito en aceite'], tags: ['pescado', 'conserva'] }],
  ['sardinas_lata', 'Sardinillas en aceite (escurridas)', 'Despensa', 210, 24, 0, 12.5, { step: 5, keeps: 365, kw: ['sardina', 'sardinilla'], tags: ['pescado', 'azul', 'conserva'] }],
  ['caballa_lata', 'Caballa en conserva (escurrida)', 'Despensa', 200, 20, 0, 13, { step: 5, keeps: 365, kw: ['caballa', 'filete caballa'], tags: ['pescado', 'azul', 'conserva'] }],

  // ---- huevos y lácteos ----
  ['huevo', 'Huevo', 'Lácteos y huevos', 143, 12.6, 0.7, 9.5, { u: 'ud', ug: 55, keeps: 21, kw: ['huevo'], tags: ['huevo'] }],
  ['claras', 'Claras de huevo líquidas', 'Lácteos y huevos', 48, 10.5, 0.7, 0.2, { u: 'ml', step: 10, keeps: 7, kw: ['clara'], tags: ['huevo'] }],
  ['leche', 'Leche semidesnatada', 'Lácteos y huevos', 46, 3.2, 4.7, 1.6, { u: 'ml', step: 10, keeps: 7, kw: ['leche semi', 'leche semidesnatada', 'leche desnatada', 'leche'], tags: ['lacteo'] }],
  ['bebida_avena', 'Bebida de avena', 'Lácteos y huevos', 45, 1, 7, 1.5, { u: 'ml', step: 10, keeps: 7, kw: ['bebida avena', 'leche de avena', 'avena bebida'], tags: [] }],
  ['yogur_natural', 'Yogur natural', 'Lácteos y huevos', 55, 3.1, 4.9, 2.6, { u: 'ud', ug: 125, keeps: 21, kw: ['yogur natural', 'yogur'], tags: ['lacteo'] }],
  ['skyr', 'Skyr natural', 'Lácteos y huevos', 62, 11, 4, 0.2, { step: 10, keeps: 21, kw: ['skyr', 'yogur proteico', 'griego 0'], tags: ['lacteo'] }],
  ['queso_batido', 'Queso batido 0 %', 'Lácteos y huevos', 46, 8, 3.6, 0.2, { step: 10, keeps: 14, kw: ['queso batido', 'queso fresco batido', 'quark'], tags: ['lacteo'] }],
  ['queso_fresco', 'Queso fresco light (tipo Burgos)', 'Lácteos y huevos', 110, 13, 3, 5, { step: 10, keeps: 10, kw: ['queso fresco', 'burgos', 'requeson'], tags: ['lacteo'] }],
  ['mozzarella', 'Mozzarella light', 'Lácteos y huevos', 160, 19, 1.5, 9, { step: 10, keeps: 10, kw: ['mozzarella'], tags: ['lacteo'] }],
  ['parmesano', 'Queso parmesano', 'Lácteos y huevos', 400, 33, 0, 29, { step: 5, keeps: 60, kw: ['parmesano', 'grana padano'], tags: ['lacteo'] }],
  ['queso_curado', 'Queso curado o semicurado', 'Lácteos y huevos', 390, 26, 0.5, 32, { step: 5, keeps: 60, kw: ['queso curado', 'queso semicurado', 'manchego', 'queso tierno', 'queso'], tags: ['lacteo'] }],
  ['queso_untar', 'Queso de untar light', 'Lácteos y huevos', 145, 7.5, 4, 11, { step: 5, keeps: 14, kw: ['queso untar', 'queso crema', 'philadelphia'], tags: ['lacteo'] }],
  ['tofu', 'Tofu firme', 'Otros', 130, 13, 2, 8, { step: 10, keeps: 10, kw: ['tofu'], tags: ['vegetal'] }],

  // ---- legumbres ----
  ['garbanzos', 'Garbanzos cocidos (bote)', 'Despensa', 125, 7, 16, 2.5, { step: 10, keeps: 365, kw: ['garbanzo'], tags: ['legumbre'] }],
  ['lentejas', 'Lentejas cocidas (bote)', 'Despensa', 95, 7, 13, 0.5, { step: 10, keeps: 365, kw: ['lenteja'], tags: ['legumbre'] }],
  ['alubias', 'Alubias cocidas (bote)', 'Despensa', 90, 6.5, 12, 0.5, { step: 10, keeps: 365, kw: ['alubia', 'judia blanca', 'judion', 'frijol'], tags: ['legumbre'] }],

  // ---- cereales, pan y tubérculos ----
  ['arroz', 'Arroz (basmati o redondo)', 'Despensa', 355, 7.5, 78, 0.8, { step: 5, keeps: 365, kw: ['arroz basmati', 'arroz vaporizado', 'arroz redondo', 'arroz largo', 'arroz'], tags: ['cereal'] }],
  ['arroz_integral', 'Arroz integral', 'Despensa', 350, 7.5, 73, 2.7, { step: 5, keeps: 365, kw: ['arroz integral'], tags: ['cereal'] }],
  ['pasta', 'Pasta (espaguetis, macarrones…)', 'Despensa', 355, 12.5, 71, 1.5, { step: 5, keeps: 365, kw: ['espagueti', 'macarron', 'rigatoni', 'tallarin', 'penne', 'fusilli', 'pasta', 'hélice', 'helice'], tags: ['cereal'] }],
  ['pasta_integral', 'Pasta integral', 'Despensa', 345, 13.5, 64, 2.5, { step: 5, keeps: 365, kw: ['espagueti integral', 'pasta integral', 'macarron integral'], tags: ['cereal'] }],
  ['cuscus', 'Cuscús', 'Despensa', 360, 12.5, 73, 1.1, { step: 5, keeps: 365, kw: ['cuscu'], tags: ['cereal'] }],
  ['quinoa', 'Quinoa', 'Despensa', 365, 14, 64, 6, { step: 5, keeps: 365, kw: ['quinoa'], tags: ['cereal'] }],
  ['avena', 'Copos de avena', 'Despensa', 375, 13.5, 60, 7, { step: 5, keeps: 180, kw: ['avena', 'copos'], tags: ['cereal'] }],
  ['pan_integral', 'Pan integral de molde', 'Panadería', 245, 10, 41, 3.5, { step: 10, keeps: 10, kw: ['pan integral', 'pan molde', 'pan de molde', 'pan sesamo', 'pan semillas', 'pan sandwich'], tags: ['cereal'] }],
  ['pan_barra', 'Pan de barra', 'Panadería', 270, 9, 55, 1.2, { step: 10, keeps: 2, kw: ['barra', 'baguette', 'chapata', 'pan rustico', 'hogaza'], tags: ['cereal'] }],
  ['tortitas', 'Tortitas de arroz o maíz', 'Despensa', 385, 8, 80, 2.8, { u: 'ud', ug: 8, keeps: 90, kw: ['tortita'], tags: ['cereal'] }],
  ['wrap', 'Tortilla de trigo integral (wrap)', 'Panadería', 300, 9, 48, 7, { u: 'ud', ug: 60, keeps: 30, kw: ['wrap', 'tortilla trigo', 'fajita', 'tortilla de trigo'], tags: ['cereal'] }],
  ['harina_maiz', 'Harina de maíz precocida', 'Despensa', 360, 7, 77, 1.5, { step: 5, keeps: 365, kw: ['harina maiz', 'arepa', 'harina pan'], tags: ['cereal'] }],
  ['patata', 'Patata', 'Frutería', 80, 2, 17, 0.1, { step: 25, keeps: 21, kw: ['patata'], tags: [] }],
  ['boniato', 'Boniato', 'Frutería', 86, 1.6, 20, 0.1, { step: 25, keeps: 21, kw: ['boniato', 'batata'], tags: [] }],

  // ---- fruta ----
  ['platano', 'Plátano', 'Frutería', 95, 1.2, 21, 0.3, { u: 'ud', ug: 120, keeps: 6, kw: ['platano', 'banana'], tags: ['fruta'] }],
  ['manzana', 'Manzana', 'Frutería', 52, 0.3, 12, 0.2, { u: 'ud', ug: 150, keeps: 21, kw: ['manzana'], tags: ['fruta'] }],
  ['pera', 'Pera', 'Frutería', 55, 0.4, 12, 0.1, { u: 'ud', ug: 150, keeps: 10, kw: ['pera'], tags: ['fruta'] }],
  ['naranja', 'Naranja', 'Frutería', 45, 0.9, 9, 0.2, { u: 'ud', ug: 140, keeps: 14, kw: ['naranja'], tags: ['fruta'] }],
  ['mandarina', 'Mandarina', 'Frutería', 50, 0.8, 11, 0.3, { u: 'ud', ug: 70, keeps: 14, kw: ['mandarina', 'clementina'], tags: ['fruta'] }],
  ['kiwi', 'Kiwi', 'Frutería', 61, 1.1, 12, 0.5, { u: 'ud', ug: 75, keeps: 14, kw: ['kiwi'], tags: ['fruta'] }],
  ['frutos_rojos', 'Frutos rojos congelados', 'Congelados', 45, 1, 8, 0.3, { step: 10, keeps: 180, kw: ['fruto rojo', 'frutos del bosque', 'arandano', 'fresa', 'frambuesa'], tags: ['fruta'] }],

  // ---- verdura ----
  ['brocoli', 'Brócoli', 'Frutería', 35, 3, 4, 0.4, { step: 25, keeps: 5, kw: ['brocoli', 'brecol'], tags: ['verdura'] }],
  ['calabacin', 'Calabacín', 'Frutería', 17, 1.2, 2.5, 0.3, { step: 25, keeps: 7, kw: ['calabacin'], tags: ['verdura'] }],
  ['pimiento', 'Pimiento rojo o verde', 'Frutería', 31, 1, 5, 0.3, { step: 20, keeps: 7, kw: ['pimiento'], tags: ['verdura'] }],
  ['cebolla', 'Cebolla', 'Frutería', 40, 1.1, 8, 0.1, { step: 10, keeps: 30, kw: ['cebolla'], tags: ['verdura'] }],
  ['puerro', 'Puerro', 'Frutería', 42, 1.5, 8, 0.3, { step: 10, keeps: 10, kw: ['puerro'], tags: ['verdura'] }],
  ['tomate', 'Tomate', 'Frutería', 20, 0.9, 3.5, 0.2, { step: 20, keeps: 7, kw: ['tomate rama', 'tomate pera', 'tomate ensalada', 'tomate cherry', 'tomate'], tags: ['verdura'] }],
  ['tomate_triturado', 'Tomate triturado (bote)', 'Despensa', 32, 1.3, 5.5, 0.2, { step: 10, keeps: 365, kw: ['tomate triturado', 'tomate natural triturado', 'tomate troceado', 'salsa tomate'], tags: [] }],
  ['espinacas', 'Espinacas frescas', 'Frutería', 23, 2.9, 1.4, 0.4, { step: 25, keeps: 4, kw: ['espinaca', 'acelga'], tags: ['verdura'] }],
  ['judias_verdes', 'Judías verdes', 'Frutería', 31, 1.8, 5, 0.2, { step: 25, keeps: 5, kw: ['judia verde', 'judias verdes', 'judia plana'], tags: ['verdura'] }],
  ['champinones', 'Champiñones o setas', 'Frutería', 22, 3.1, 2, 0.3, { step: 25, keeps: 4, kw: ['champinon', 'seta'], tags: ['verdura'] }],
  ['zanahoria', 'Zanahoria', 'Frutería', 41, 0.9, 8, 0.2, { step: 10, keeps: 21, kw: ['zanahoria'], tags: ['verdura'] }],
  ['lechuga', 'Lechuga o mezcla de ensalada', 'Frutería', 17, 1.3, 2, 0.2, { step: 10, keeps: 5, kw: ['lechuga', 'cogollo', 'canonigo', 'rucula', 'brotes', 'ensalada', 'escarola'], tags: ['verdura'] }],
  ['pepino', 'Pepino', 'Frutería', 15, 0.7, 2.5, 0.1, { step: 20, keeps: 7, kw: ['pepino'], tags: ['verdura'] }],
  ['berenjena', 'Berenjena', 'Frutería', 25, 1, 4, 0.2, { step: 25, keeps: 7, kw: ['berenjena'], tags: ['verdura'] }],
  ['coliflor', 'Coliflor', 'Frutería', 25, 1.9, 3, 0.3, { step: 25, keeps: 7, kw: ['coliflor'], tags: ['verdura'] }],
  ['esparragos', 'Espárragos verdes', 'Frutería', 20, 2.2, 2, 0.1, { step: 25, keeps: 4, kw: ['esparrago'], tags: ['verdura'] }],
  ['verduras_wok', 'Verduras para saltear (congeladas)', 'Congelados', 40, 2, 6, 0.5, { step: 25, keeps: 180, kw: ['salteado', 'verduras congeladas', 'menestra', 'wok', 'verdura para saltear'], tags: ['verdura'] }],

  // ---- grasas ----
  ['aceite', 'Aceite de oliva virgen extra', 'Despensa', 884, 0, 0, 100, { step: 5, keeps: 365, kw: ['aceite oliva', 'aceite'], tags: [], staple: true }],
  ['aguacate', 'Aguacate', 'Frutería', 160, 2, 2, 15, { u: 'ud', ug: 140, keeps: 5, kw: ['aguacate'], tags: [] }],
  ['nueces', 'Nueces peladas', 'Despensa', 650, 15, 7, 65, { step: 5, keeps: 180, kw: ['nuez', 'nuece'], tags: ['frutos secos'] }],
  ['almendras', 'Almendras', 'Despensa', 600, 21, 6, 52, { step: 5, keeps: 180, kw: ['almendra'], tags: ['frutos secos'] }],
  ['crema_cacahuete', 'Crema de cacahuete', 'Despensa', 600, 25, 12, 50, { step: 5, keeps: 180, kw: ['crema cacahuete', 'mantequilla cacahuete', 'crema de cacahuete'], tags: ['frutos secos'] }],
  ['aceitunas', 'Aceitunas', 'Despensa', 140, 1, 1, 14, { step: 5, keeps: 180, kw: ['aceituna'], tags: [] }],

  // ---- otros ----
  ['cacao', 'Cacao puro en polvo', 'Despensa', 350, 22, 15, 12, { step: 5, keeps: 365, kw: ['cacao puro', 'cacao en polvo', 'cacao desgrasado'], tags: [] }],
  ['miel', 'Miel', 'Despensa', 305, 0.3, 80, 0, { step: 5, keeps: 365, kw: ['miel'], tags: [] }],
  ['salsa_soja', 'Salsa de soja', 'Despensa', 60, 8, 6, 0, { u: 'ml', step: 5, keeps: 365, kw: ['salsa soja', 'soja'], tags: [], staple: true }],
  ['caldo', 'Caldo de pollo o verduras', 'Despensa', 8, 0.6, 0.6, 0.3, { u: 'ml', step: 50, keeps: 365, kw: ['caldo'], tags: [] }],
  ['chocolate', 'Chocolate negro 74–85 %', 'Despensa', 570, 9, 25, 45, { step: 5, keeps: 180, kw: ['chocolate negro'], tags: [] }],
];

export const FOODS = RAW.map(([id, name, cat, kcal, p, c, f, o = {}]) => ({
  id, name, cat, kcal, p, c, f,
  u: o.u || 'g', ug: o.ug || null, step: o.step || (o.u === 'ud' ? null : 5),
  keeps: o.keeps ?? null, kw: (o.kw || []).map(norm), tags: o.tags || [], staple: !!o.staple, builtin: true,
}));

export const SHOP_SECTIONS = ['Frutería', 'Carnicería', 'Pescadería', 'Lácteos y huevos', 'Panadería', 'Despensa', 'Congelados', 'Otros', 'HSN'];

// Busca el alimento genérico que mejor encaja con el nombre de un producto.
export function guessFood(name, foods) {
  // "Sardinillas en aceite de oliva": el aceite es el líquido de gobierno, no el producto.
  const n = ` ${norm(name)} `.replace(/[^a-z0-9% ]/g, ' ');
  const inOil = / en aceite /.test(n);
  let best = null;
  let bestScore = 0;
  for (const food of foods) {
    if (inOil && food.id === 'aceite') continue;
    for (const kw of food.kw || []) {
      // Coincidencia por palabras completas; las frases largas pesan más y,
      // a igualdad, gana lo que aparece antes en el nombre.
      const words = kw.split(' ');
      const found = words.map((w) => n.search(new RegExp(`\\b${w.replace(/s$/, '')}(s|es)?\\b`)));
      if (found.every((i) => i >= 0)) {
        const score = kw.length + (words.length > 1 ? 5 : 0) - Math.min(...found) / 3;
        if (score > bestScore) { bestScore = score; best = food; }
      }
    }
  }
  return best;
}
