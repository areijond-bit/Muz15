// archivos.js — Las canciones como archivos del teléfono (solo en la APK nueva).
//
// El reproductor nativo de Android no puede leer el almacenamiento de la página
// (IndexedDB), así que en la APK cada canción vive como archivo:
//   musica/<id>.mp3   y   portadas/<id>.jpg
// Los datos (título, artista, listas…) siguen en IndexedDB como siempre.
//
// Las canciones guardadas antes se trasladan solas la primera vez (trasladar()).

import { Capacitor, registerPlugin } from './vendor/capacitor-core.js';

/** true si esta APK trae el reproductor nativo (desde la APK 1.6). */
export const hayReproductorNativo = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Reproductor');
export const Reproductor = hayReproductorNativo ? registerPlugin('Reproductor') : null;

// (Hubo un "plan B" para volver al reproductor de la página; ya no hace falta.)
try { localStorage.removeItem('muz15-usar-reproductor-anterior'); } catch { /* nada */ }

const TAMANO_PEDAZO = 768 * 1024; // se manda en pedazos para no trabar la app

const extensionDe = (cancion) => {
  const delNombre = cancion.nombreArchivo?.match(/\.[a-z0-9]{2,4}$/i)?.[0];
  if (delNombre) return delNombre.toLowerCase();
  return { 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/wav': '.wav' }[cancion.tipo] ?? '.mp3';
};

export const rutaAudio = (cancion) => `musica/${cancion.id}${extensionDe(cancion)}`;
export const rutaPortada = (cancion) => `portadas/${cancion.id}.jpg`;

// La dirección file:// de la carpeta de Muz15 (se pregunta una vez).
let prefijo = null;
async function prefijoArchivos() {
  if (!prefijo) {
    const { url } = await Reproductor.existe({ ruta: 'x' });
    prefijo = url.slice(0, -1); // quita la "x"
  }
  return prefijo;
}

/** Dirección file:// de un archivo de Muz15 (para el reproductor nativo). */
export async function urlDe(ruta) {
  return (await prefijoArchivos()) + ruta;
}

// Pasa bytes a base64 en partes (btoa con todo de golpe se ahoga con varios MB).
function aBase64(bytes) {
  let binario = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binario);
}

/** Guarda un ArrayBuffer como archivo, en pedazos. */
export async function escribir(ruta, buffer) {
  const bytes = new Uint8Array(buffer);
  if (!bytes.length) throw new Error('Archivo vacío');
  for (let desde = 0; desde < bytes.length; desde += TAMANO_PEDAZO) {
    await Reproductor.escribir({
      ruta,
      base64: aBase64(bytes.subarray(desde, desde + TAMANO_PEDAZO)),
      agregar: desde > 0,
    });
  }
  const { bytes: escritos } = await Reproductor.existe({ ruta });
  if (escritos !== bytes.length) throw new Error('El archivo no se guardó completo');
}

/** Baja un archivo directo al teléfono (sin pasar los MB por la página). */
export async function descargar(url, ruta) {
  return Reproductor.descargar({ url, ruta });
}

export async function existe(ruta) {
  return (await Reproductor.existe({ ruta })).existe;
}

export async function borrar(ruta) {
  await Reproductor.borrar({ ruta }).catch(() => {});
}

/**
 * Libera la copia que quedó dentro de la página de las canciones que ya viven
 * como archivo, solo si el archivo existe y no está vacío.
 * @returns {Promise<number>} cuántas se liberaron
 */
export async function liberarCopias(canciones, { tieneCopia, liberarAudio }) {
  let liberadas = 0;
  for (const cancion of canciones.filter((c) => c.enArchivo)) {
    try {
      if (!await tieneCopia(cancion.id)) continue;
      const { existe: hay, bytes } = await Reproductor.existe({ ruta: rutaAudio(cancion) });
      if (!hay || !bytes) continue; // sin archivo bueno, la copia se queda
      await liberarAudio(cancion.id);
      liberadas++;
    } catch (error) {
      console.warn('No se pudo liberar', cancion.titulo, error.message);
    }
  }
  return liberadas;
}

/**
 * Traslada a archivos las canciones que todavía están dentro de la página.
 * Al terminar cada una, libera el espacio que ocupaba allá.
 * @param {object[]} canciones
 * @param {{ obtenerAudio, actualizarCancion, liberarAudio, alAvanzar }} ayudas
 * @returns {Promise<number>} cuántas se trasladaron
 */
export async function trasladar(canciones, { obtenerAudio, actualizarCancion, liberarAudio, alAvanzar }) {
  const pendientes = canciones.filter((c) => !c.enArchivo);
  for (const [i, cancion] of pendientes.entries()) {
    alAvanzar?.(i + 1, pendientes.length, cancion);
    try {
      const blob = await obtenerAudio(cancion);
      await escribir(rutaAudio(cancion), await blob.arrayBuffer());
      if (cancion.portada?.datos?.byteLength) await escribir(rutaPortada(cancion), cancion.portada.datos);
      await actualizarCancion({ ...cancion, enArchivo: true });
      await liberarAudio(cancion.id); // ya está a salvo como archivo
    } catch (error) {
      console.warn('No se pudo trasladar', cancion.titulo, error.message);
    }
  }
  return pendientes.length;
}

/**
 * Lee un archivo de Muz15 como Blob (para subirlo a tu PC). La página no puede
 * abrir file:// directo, pero la APK lo sirve en /_capacitor_file_/….
 */
export async function leer(ruta) {
  const respuesta = await fetch(Capacitor.convertFileSrc(await urlDe(ruta)));
  if (!respuesta.ok) throw new Error(`No se pudo leer ${ruta}`);
  return respuesta.blob();
}
