// db.js — Guarda las canciones en IndexedDB para que funcionen sin internet.
//
// Hay dos "tablas" (object stores):
//   - canciones: los datos ligeros (título, artista, portada...). Se cargan todos para la lista.
//   - audios:    el archivo de audio completo. Solo se lee cuando vas a reproducir esa canción.
// Las separamos para que abrir la app no cargue en memoria todos los MB de música.
//
// El audio se guarda como ArrayBuffer (no como Blob) porque Safari en iOS
// ha tenido fallos guardando Blobs en IndexedDB; el ArrayBuffer siempre funciona.

const NOMBRE_DB = 'muz15';
const VERSION_DB = 2; // 2: se agregaron las listas
const CANCIONES = 'canciones';
const AUDIOS = 'audios';
const LISTAS = 'listas'; // { id, nombre, canciones: [id, id, ...], creada }

let promesaDB = null;

/** Abre (o crea la primera vez) la base de datos. */
function abrirDB() {
  if (!promesaDB) {
    promesaDB = new Promise((resolve, reject) => {
      const pedido = indexedDB.open(NOMBRE_DB, VERSION_DB);

      // Solo corre la primera vez o cuando subimos VERSION_DB.
      pedido.onupgradeneeded = () => {
        const db = pedido.result;
        if (!db.objectStoreNames.contains(CANCIONES)) {
          db.createObjectStore(CANCIONES, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(AUDIOS)) {
          db.createObjectStore(AUDIOS); // clave = id de la canción
        }
        if (!db.objectStoreNames.contains(LISTAS)) {
          db.createObjectStore(LISTAS, { keyPath: 'id' });
        }
      };

      pedido.onsuccess = () => {
        const db = pedido.result;
        // Si una versión nueva de la app necesita actualizar la base, le cedemos el paso.
        db.onversionchange = () => { db.close(); promesaDB = null; };
        resolve(db);
      };
      pedido.onerror = () => reject(pedido.error);
    });
  }
  return promesaDB;
}

/* ---------- Avisar cambios (para la nube) ---------- */
// Cada cambio hecho en ESTE dispositivo lleva "cambiada" (cuándo) y avisa con el
// evento "muz15-cambio"; nube.js lo sube a tu Google Drive. Lo que llega de la nube
// se guarda con { desdeNube: true }: no se marca ni se avisa (si no, rebotaría).

// Datos que son solo de este dispositivo (no se comparan ni se suben).
const SOLO_DE_AQUI = new Set(['portada', 'enArchivo', 'cambiada', 'nube']);

/** Lo que se sincroniza de una canción o lista, para saber si de verdad cambió. */
export function firmaDatos(objeto) {
  if (!objeto) return '';
  const datos = Object.keys(objeto).filter((k) => !SOLO_DE_AQUI.has(k)).sort().map((k) => [k, objeto[k]]);
  const portada = objeto.portada?.datos?.byteLength ?? 0;
  return JSON.stringify(datos) + portada;
}

function avisar(tipo, id, borrada = false) {
  try { window.dispatchEvent(new CustomEvent('muz15-cambio', { detail: { tipo, id, borrada } })); } catch { /* nada */ }
}

/** Convierte un pedido de IndexedDB (con callbacks) en una promesa. */
function comoPromesa(pedido) {
  return new Promise((resolve, reject) => {
    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => reject(pedido.error);
  });
}

/** Espera a que una transacción termine de escribir. */
function transaccionTerminada(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Guarda una canción nueva.
 * @param {object} cancion  datos: { id, titulo, artista, album, tipo, portada, agregada }
 * @param {ArrayBuffer} audio  el archivo de audio completo
 */
export async function guardarCancion(cancion, audio, { desdeNube = false } = {}) {
  const db = await abrirDB();
  const tx = db.transaction([CANCIONES, AUDIOS], 'readwrite');
  tx.objectStore(CANCIONES).put(desdeNube ? cancion : { ...cancion, cambiada: Date.now() });
  tx.objectStore(AUDIOS).put(audio, cancion.id);
  await transaccionTerminada(tx);
  if (!desdeNube) avisar('cancion', cancion.id);
}

/** Cambia los datos de una canción (título, artista, portada, vínculo...) sin tocar su audio. */
export async function actualizarCancion(cancion, { desdeNube = false } = {}) {
  const db = await abrirDB();
  const tx = db.transaction(CANCIONES, 'readwrite');
  const almacen = tx.objectStore(CANCIONES);
  let cambio = false;
  if (desdeNube) {
    almacen.put(cancion);
  } else {
    // Solo se marca si cambió algo que se comparte (no, por ejemplo, "ya es archivo").
    almacen.get(cancion.id).onsuccess = (evento) => {
      const antes = evento.target.result;
      cambio = firmaDatos(antes) !== firmaDatos(cancion);
      almacen.put(cambio ? { ...cancion, cambiada: Date.now() } : { ...cancion, cambiada: antes?.cambiada ?? cancion.cambiada });
    };
  }
  await transaccionTerminada(tx);
  if (cambio) avisar('cancion', cancion.id);
}

/** Devuelve todas las canciones (sin el audio), en el orden en que se importaron. */
export async function listarCanciones() {
  const db = await abrirDB();
  const lista = await comoPromesa(db.transaction(CANCIONES).objectStore(CANCIONES).getAll());
  // "orden" existe cuando las acomodaste arrastrando; si no, por fecha de importación.
  const posicion = (c) => c.orden ?? c.agregada;
  return lista.sort((a, b) => posicion(a) - posicion(b) || a.agregada - b.agregada);
}

/** Guarda el orden en que acomodaste las canciones (ids de la primera a la última). */
export async function guardarOrden(ids) {
  const db = await abrirDB();
  const tx = db.transaction(CANCIONES, 'readwrite');
  const almacen = tx.objectStore(CANCIONES);
  const cambiadas = [];
  ids.forEach((id, i) => {
    almacen.get(id).onsuccess = (evento) => {
      const cancion = evento.target.result;
      if (cancion && cancion.orden !== i) {
        almacen.put({ ...cancion, orden: i, cambiada: Date.now() });
        cambiadas.push(id);
      }
    };
  });
  await transaccionTerminada(tx);
  cambiadas.forEach((id) => avisar('cancion', id));
}

/** Devuelve el audio de una canción como Blob, listo para el <audio>. */
export async function obtenerAudio(cancion) {
  const db = await abrirDB();
  const buffer = await comoPromesa(db.transaction(AUDIOS).objectStore(AUDIOS).get(cancion.id));
  if (!buffer) throw new Error(`No se encontró el audio de "${cancion.titulo}"`);
  return new Blob([buffer], { type: cancion.tipo });
}

/**
 * Deja vacío el audio guardado en la página (cuando ya vive como archivo del
 * teléfono, en la APK con reproductor nativo). Así no ocupa doble espacio.
 */
export async function liberarAudio(id) {
  const db = await abrirDB();
  const tx = db.transaction(AUDIOS, 'readwrite');
  tx.objectStore(AUDIOS).put(new ArrayBuffer(0), id);
  await transaccionTerminada(tx);
}

/** ¿Todavía guarda la página el audio de esta canción (no vacío)? */
export async function tieneAudio(id) {
  const db = await abrirDB();
  const buffer = await comoPromesa(db.transaction(AUDIOS).objectStore(AUDIOS).get(id));
  return Boolean(buffer?.byteLength);
}

/** Borra una canción, su audio, y la saca de todas las listas. */
export async function borrarCancion(id, { desdeNube = false } = {}) {
  const db = await abrirDB();
  const tx = db.transaction([CANCIONES, AUDIOS, LISTAS], 'readwrite');
  tx.objectStore(CANCIONES).delete(id);
  tx.objectStore(AUDIOS).delete(id);
  const listas = tx.objectStore(LISTAS);
  listas.getAll().onsuccess = (evento) => {
    for (const lista of evento.target.result) {
      if (lista.canciones.includes(id)) {
        const sinElla = { ...lista, canciones: lista.canciones.filter((c) => c !== id) };
        listas.put(desdeNube ? sinElla : { ...sinElla, cambiada: Date.now() });
        if (!desdeNube) setTimeout(() => avisar('lista', lista.id));
      }
    }
  };
  await transaccionTerminada(tx);
  if (!desdeNube) avisar('cancion', id, true);
}

/* ---------- Listas (playlists) ---------- */

/** Todas las listas, de la más nueva a la más vieja. */
export async function listarListas() {
  const db = await abrirDB();
  const listas = await comoPromesa(db.transaction(LISTAS).objectStore(LISTAS).getAll());
  return listas.sort((a, b) => b.creada - a.creada);
}

/** Crea o actualiza una lista completa. */
export async function guardarLista(lista, { desdeNube = false } = {}) {
  const db = await abrirDB();
  const tx = db.transaction(LISTAS, 'readwrite');
  const almacen = tx.objectStore(LISTAS);
  let cambio = false;
  if (desdeNube) {
    almacen.put(lista);
  } else {
    almacen.get(lista.id).onsuccess = (evento) => {
      const antes = evento.target.result;
      cambio = firmaDatos(antes) !== firmaDatos(lista);
      almacen.put(cambio ? { ...lista, cambiada: Date.now() } : { ...lista, cambiada: antes?.cambiada ?? lista.cambiada });
    };
  }
  await transaccionTerminada(tx);
  if (cambio) avisar('lista', lista.id);
}

export async function borrarLista(id, { desdeNube = false } = {}) {
  const db = await abrirDB();
  const tx = db.transaction(LISTAS, 'readwrite');
  tx.objectStore(LISTAS).delete(id);
  await transaccionTerminada(tx);
  if (!desdeNube) avisar('lista', id, true);
}

/**
 * Le pide al navegador que no borre nuestros datos cuando falte espacio.
 * En iOS esto ayuda sobre todo cuando la app está instalada en la pantalla de inicio.
 * Devuelve true si el navegador aceptó.
 */
export async function pedirAlmacenamientoPersistente() {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

/** Cuánto espacio usamos y cuánto hay disponible (en bytes), si el navegador lo dice. */
export async function espacioUsado() {
  if (!navigator.storage?.estimate) return null;
  const { usage, quota } = await navigator.storage.estimate();
  return { usado: usage, total: quota };
}
