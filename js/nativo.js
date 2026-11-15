// nativo.js — Puente con la parte nativa de Android cuando Muz15 corre como APK.
//
// En el navegador (Chrome) todo esto queda en null y la app usa las funciones web.
// En la APK:
//   - SesionNativa: controles de la pantalla de bloqueo, notificación y carro
//     (complemento @capgo/capacitor-media-session, con servicio de reproducción).
//   - AppNativa: datos de la APK instalada (versión), para avisar de actualizaciones.

import { Capacitor, registerPlugin } from './vendor/capacitor-core.js';

export const esApk = Capacitor.isNativePlatform();
export const SesionNativa = esApk ? registerPlugin('MediaSession') : null;
export const AppNativa = esApk ? registerPlugin('App') : null;

const enCache = new Map();

/**
 * Android no puede leer direcciones blob: (las portadas guardadas en el teléfono),
 * así que se las pasamos como data: (la imagen escrita en texto).
 */
export async function aDataURL(url) {
  if (enCache.has(url)) return enCache.get(url);
  const blob = await (await fetch(url)).blob();
  const datos = await new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(lector.result);
    lector.onerror = () => reject(lector.error);
    lector.readAsDataURL(blob);
  });
  if (enCache.size > 20) enCache.clear();
  enCache.set(url, datos);
  return datos;
}
