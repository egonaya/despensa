# Despensa

Web app (PWA) para llevar la despensa y comer según tus macros sin pensar cada día qué cocinar.

**https://egonaya.github.io/despensa/**

## Qué hace

- **Despensa**: escaneas lo que compras (cámara del móvil o código escrito); nombre, foto,
  Nutri-Score, NOVA y valores por 100 g llegan de [Open Food Facts](https://world.openfoodfacts.org).
  Cada producto se vincula a un alimento genérico para usarlo en el menú. Fruta, carne o granel
  se añaden sin código, en gramos o unidades. Avisos de caducidad y de mínimos.
- **Registrar ticket**: foto del ticket en papel (OCR con Tesseract.js en el propio móvil) o PDF del
  ticket digital (texto exacto con pdf.js). Reconoce cantidades, pesos en kg y tamaños de envase,
  relaciona cada línea con su alimento aunque venga abreviada y lo revisas antes de guardarlo.
- **Plan semanal** (sin IA): desayuno, comida y cena para 7 días. Puedes preparar el menú de la
  semana siguiente (p. ej. el sábado antes de comprar) sin perder lo que queda de la actual; cuando
  acaba la semana, la siguiente pasa a ser la actual.
  - Elige recetas según lo que tienes en casa, lo que caduca antes, la variedad (máx. 2 veces por
    semana, nunca días seguidos, pescado ≥ 3 veces) y lo que se aprovecha del batch cooking.
  - Ajusta las cantidades de cada día con un solver de mínimos cuadrados con límites para que el día
    cuadre con tus kcal y macros, descontando antes lo que aportan los suplementos.
  - Las comidas de días laborables se quedan en el tiempo que fijes (15 min por defecto) al llegar.
  - **Batch cooking** del domingo con cantidades totales, y **tareas de la noche anterior**
    (descongelar, overnight oats, bases que no aguantan desde el domingo).
  - Comensales por comida: la ración de la segunda persona se escala a sus kcal.
  - "Hecha" descuenta los ingredientes de la despensa (deshacer los devuelve). "He comido otra cosa"
    apunta lo que comiste y reajusta lo que queda del día. "Cambiar plato" propone alternativas.
- **Suplementos** (p. ej. HSN): kcal y macros por dosis, dosis al día, stock. Se marcan cada día,
  se descuentan y pasan a la compra cuando queda menos de una semana.
- **Lista de la compra**: lo que falta para el menú (por secciones del súper), lo que baja del
  mínimo, suplementos y extras a mano. "Comprado" lo pasa a la despensa.
- **Recetario** de 62 recetas mediterráneas rápidas; puedes crear las tuyas, duplicar y ocultar.
- **Alimentos**: ~90 alimentos con valores de tablas españolas; puedes añadir los tuyos o crearlos
  desde la etiqueta de un producto escaneado.
- Todo se guarda en el móvil (IndexedDB). Copia de seguridad en *Más → Copia de seguridad*.

## Probar en el ordenador

```bash
python3 -m http.server 5173 --directory despensa
```

Abre http://localhost:5173.

## Usar en el móvil

Abre la dirección en el móvil y:

- **iPhone (Safari)**: Compartir → *Añadir a pantalla de inicio*.
- **Android (Chrome)**: menú ⋮ → *Instalar app*.

Funciona sin conexión salvo la búsqueda de productos nuevos en Open Food Facts y la primera lectura
de un ticket (descarga el lector, unos 6 MB, desde jsDelivr).

## Al cambiar el código

Sube `VERSION` en `sw.js` para que los móviles descarguen la nueva versión.

## Estructura

| Archivo | Qué hace |
|---|---|
| `index.html`, `styles.css` | Interfaz |
| `js/app.js` | Arranque, despensa, escáner, lista de la compra |
| `js/views/plan.js` | Menú semanal, batch cooking, víspera, seguimiento del día |
| `js/views/more.js` | Objetivos, suplementos, recetario, alimentos, copia |
| `js/planner.js` | Elección de platos, solver de macros, preparaciones, lo que falta |
| `js/recipes.js` | Recetario base y tareas que se adelantan |
| `js/foods.js` | Tabla de alimentos y reconocimiento de productos |
| `js/db.js` | Base de datos local |
| `js/off.js` | Búsqueda en Open Food Facts |
| `js/ticket.js`, `js/views/ticket.js` | Lectura del ticket (OCR / PDF) y revisión |
| `js/scanner.js` | Lectura de códigos de barras |
| `sw.js`, `manifest.webmanifest` | Instalación y uso sin conexión |
| `vendor/zxing.min.js` | Lector de códigos para Safari (licencia Apache 2.0) |
