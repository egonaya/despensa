// Lector de códigos de barras con la cámara.
// Usa BarcodeDetector nativo cuando existe (Chrome Android) y ZXing en el resto (Safari iOS).

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'];

let zxingLoading;
function loadZxing() {
  zxingLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'vendor/zxing.min.js';
    script.onload = () => resolve(window.ZXing);
    script.onerror = () => reject(new Error('No se pudo cargar el lector de códigos.'));
    document.head.appendChild(script);
  });
  return zxingLoading;
}

async function nativeDetector() {
  if (!('BarcodeDetector' in window)) return null;
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats();
    const formats = FORMATS.filter((f) => supported.includes(f));
    return formats.length ? new window.BarcodeDetector({ formats }) : null;
  } catch {
    return null;
  }
}

// Empieza a escanear en <video>. Llama a onCode(código) una vez y devuelve stop().
export async function startScanner(video, onCode) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Este navegador no permite usar la cámara. Abre la app con https.');
  }
  let stopped = false;
  let found = false;
  const emit = (code) => {
    if (found || stopped || !code) return;
    found = true;
    navigator.vibrate?.(60);
    onCode(code);
  };

  const detector = await nativeDetector();
  if (detector) {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
    });
    video.srcObject = stream;
    await video.play();
    const tick = async () => {
      if (stopped || found) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length) emit(codes[0].rawValue);
      } catch { /* fotograma no listo */ }
      setTimeout(tick, 150);
    };
    tick();
    return () => {
      stopped = true;
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    };
  }

  const ZXing = await loadZxing();
  const hints = new Map([[ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.UPC_A,
    ZXing.BarcodeFormat.UPC_E, ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39,
  ]]]);
  const reader = new ZXing.BrowserMultiFormatReader(hints, 200);
  await reader.decodeFromConstraints(
    { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    video,
    (result) => { if (result) emit(result.getText()); },
  );
  return () => {
    stopped = true;
    reader.reset();
  };
}
