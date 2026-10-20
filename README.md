# Despensa

Web app (PWA) para llevar el inventario de la despensa: escaneas lo que compras,
gastas unidades con el botón −, y la app te dice qué se acaba y qué caduca.

- **Escáner**: cámara del móvil (BarcodeDetector en Android, ZXing en iPhone) o código escrito a mano.
- **Datos del producto**: nombre, marca, foto, Nutri-Score y NOVA desde [Open Food Facts](https://world.openfoodfacts.org).
- **Stock por lotes**: cada compra guarda unidades y fecha de caducidad; al gastar se usa primero lo que antes caduca.
- **Lista de la compra**: lo que baja del mínimo entra solo; también puedes añadir cosas a mano y compartir la lista.
- **Sin servidor**: todo se guarda en el móvil (IndexedDB). Exporta una copia desde *Más*.

## Probar en el ordenador

```bash
python3 -m http.server 5173 --directory despensa
```

Abre http://localhost:5173. La cámara funciona en `localhost`.

## Usar en el móvil

Los navegadores solo permiten la cámara en páginas **https**. Sube la carpeta
`despensa/` a cualquier hosting estático con https (GitHub Pages, Netlify, Cloudflare Pages…),
abre la dirección en el móvil y:

- **iPhone (Safari)**: Compartir → *Añadir a pantalla de inicio*.
- **Android (Chrome)**: menú ⋮ → *Instalar app*.

Funciona sin conexión salvo la búsqueda de productos nuevos en Open Food Facts.

## Al cambiar el código

Sube `VERSION` en `sw.js` para que los móviles descarguen la nueva versión.

## Estructura

| Archivo | Qué hace |
|---|---|
| `index.html`, `styles.css` | Interfaz |
| `js/app.js` | Vistas y flujo (despensa, caducidad, compra, escáner) |
| `js/db.js` | Base de datos local, stock y copia de seguridad |
| `js/off.js` | Búsqueda en Open Food Facts |
| `js/scanner.js` | Lectura de códigos de barras |
| `sw.js`, `manifest.webmanifest` | Instalación y uso sin conexión |
| `vendor/zxing.min.js` | Lector de códigos para Safari (licencia Apache 2.0) |
