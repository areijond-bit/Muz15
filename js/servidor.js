// servidor.js — Habla con tu servidor Navidrome (protocolo Subsonic).
//
// Inicio de sesión: la contraseña NUNCA se guarda ni se envía. Al conectar
// calculamos un "token" = md5(contraseña + sal) y guardamos solo el token y la
// sal en este teléfono. Con eso basta para las siguientes veces.

import { md5 } from './md5.js';

const CLAVE_AJUSTES = 'muz15-servidor';
const VERSION_API = '1.16.1';
const NOMBRE_CLIENTE = 'muz15';
const CANCIONES_POR_PAGINA = 500;

export const URL_SUGERIDA = 'https://a44nitrov15.tail87902d.ts.net';

/* ---------- Ajustes guardados ---------- */

/** @returns {{url: string, usuario: string, token: string, sal: string} | null} */
export function configuracion() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_AJUSTES)) ?? null;
  } catch {
    return null;
  }
}

function guardarConfiguracion(datos) {
  try {
    localStorage.setItem(CLAVE_AJUSTES, JSON.stringify(datos));
  } catch {
    // Sin almacenamiento (modo privado): la conexión dura solo esta sesión.
  }
  enMemoria = datos;
}

let enMemoria = null;
const actual = () => enMemoria ?? configuracion();

/** Prueba usuario y contraseña. Si funcionan, los recuerda (como token). */
export async function conectar(url, usuario, contrasena) {
  const limpia = url.trim().replace(/\/+$/, '');
  const sal = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const datos = { url: limpia, usuario: usuario.trim(), token: md5(contrasena + sal), sal };
  await llamar('ping', {}, datos); // lanza error si algo está mal
  guardarConfiguracion(datos);
}

export function desconectar() {
  try { localStorage.removeItem(CLAVE_AJUSTES); } catch { /* nada */ }
  enMemoria = null;
}

/* ---------- Llamadas a la API ---------- */

// "extra" puede traer listas (ej. songId: [a, b, c]): se repite el parámetro.
function urlDe(metodo, extra = {}, datos = actual()) {
  const parametros = new URLSearchParams({
    u: datos.usuario,
    t: datos.token,
    s: datos.sal,
    v: VERSION_API,
    c: NOMBRE_CLIENTE,
    f: 'json',
  });
  for (const [clave, valor] of Object.entries(extra)) {
    for (const v of [valor].flat()) parametros.append(clave, v);
  }
  return `${datos.url}/rest/${metodo}?${parametros}`;
}

async function llamar(metodo, extra, datos) {
  let respuesta;
  try {
    // Si la PC está apagada, Tailscale puede tardar mucho en rendirse: cortamos a los 15 s.
    respuesta = await fetch(urlDe(metodo, extra, datos), { signal: AbortSignal.timeout(15000) });
  } catch {
    throw new Error('No se pudo conectar. ¿Está prendida la PC y Tailscale activado en este teléfono?');
  }
  if (!respuesta.ok) throw new Error(`El servidor respondió ${respuesta.status}`);

  const json = (await respuesta.json())['subsonic-response'];
  if (json?.status !== 'ok') {
    // Código 40 = usuario o contraseña incorrectos
    const mensaje = json?.error?.code === 40 ? 'Usuario o contraseña incorrectos' : json?.error?.message;
    throw new Error(mensaje || 'Respuesta rara del servidor');
  }
  return json;
}

/* ---------- Canciones ---------- */

// Convierte una canción de Navidrome al formato que usa Muz15.
function aCancion(s) {
  return {
    id: `servidor-${s.id}`,
    idServidor: s.id,
    origen: 'servidor',
    titulo: s.title || 'Sin título',
    artista: s.artist || 'Artista desconocido',
    album: s.album || '',
    portadaId: s.coverArt ?? null,
    tipo: s.contentType || 'audio/mpeg',
    sufijo: s.suffix || 'mp3',
    duracion: s.duration ?? 0,
    tamano: s.size ?? 0, // bytes del archivo original
  };
}

/** Trae TODAS las canciones del servidor, ordenadas por artista y título. */
export async function listarCanciones() {
  const todas = [];
  for (let desde = 0; ; desde += CANCIONES_POR_PAGINA) {
    // Navidrome devuelve todo cuando la búsqueda va vacía.
    const json = await llamar('search3', {
      query: '',
      songCount: CANCIONES_POR_PAGINA,
      songOffset: desde,
      artistCount: 0,
      albumCount: 0,
    });
    const pagina = json.searchResult3?.song ?? [];
    todas.push(...pagina.map(aCancion));
    if (pagina.length < CANCIONES_POR_PAGINA) break;
  }
  const comparar = (a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' });
  return todas.sort((a, b) => comparar(a.artista, b.artista) || comparar(a.titulo, b.titulo));
}

/* ---------- Álbumes (playlists de Navidrome) ---------- */
// Viven en el servidor, así que son los mismos en el cel, la PC o donde abras Muz15.
// En el comentario de la playlist viaja lo que Navidrome no guarda por sí solo:
//   v: los vínculos ("después de A siempre suena B")
//   d: los datos de cada canción tal como los editó el dueño del álbum
//      (título, artista, álbum), para que en los demás dispositivos se vean igual.
// Formato:  muz15:{"v":[["idA","idB"], ...], "d":{"id":{"t":"…","a":"…","al":"…"}}}

const PREFIJO_COMENTARIO = 'muz15:';

/** Lee lo guardado en el comentario: { vinculos: {idA: idB}, datos: {id: {t, a, al}} } */
function leerComentarioMuz15(comentario) {
  if (!comentario?.startsWith(PREFIJO_COMENTARIO)) return { vinculos: {}, datos: {} };
  try {
    const guardado = JSON.parse(comentario.slice(PREFIJO_COMENTARIO.length));
    return { vinculos: Object.fromEntries(guardado.v ?? []), datos: guardado.d ?? {} };
  } catch {
    return { vinculos: {}, datos: {} };
  }
}

const aAlbum = (p) => ({
  idServidor: p.id,
  nombre: p.name,
  total: p.songCount ?? 0,
  portadaId: p.coverArt ?? null,
  publico: Boolean(p.public),
  cambiada: p.changed ?? null, // cambia cada vez que alguien lo modifica
  dueno: p.owner ?? '',
  mio: !p.owner || p.owner === actual()?.usuario,
});

/** Todos los álbumes (los tuyos y los públicos de otros), ordenados por nombre. */
export async function listarPlaylists() {
  const json = await llamar('getPlaylists', {});
  return (json.playlists?.playlist ?? [])
    .map(aAlbum)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
}

/** Un álbum completo: datos, canciones en orden y vínculos. */
export async function obtenerPlaylist(idServidor) {
  const { playlist } = await llamar('getPlaylist', { id: idServidor });
  const { vinculos, datos } = leerComentarioMuz15(playlist.comment);
  // Las canciones con los datos que editó el dueño del álbum (si los editó).
  const canciones = (playlist.entry ?? []).map(aCancion).map((c) => {
    const d = datos[c.idServidor];
    return d ? { ...c, titulo: d.t || c.titulo, artista: d.a || c.artista, album: d.al ?? c.album } : c;
  });
  return { ...aAlbum(playlist), canciones, vinculos, datos };
}

/** Las canciones de un álbum, en su orden. */
export async function cancionesDePlaylist(idServidor) {
  return (await obtenerPlaylist(idServidor)).canciones;
}

/**
 * Crea el álbum (si no trae idServidor) o reemplaza sus canciones, nombre,
 * vínculos y si es público.
 * @param {{idServidor?: string, nombre: string, idsCanciones: string[], vinculos?: Object<string,string>,
 *          datos?: Object<string, {t: string, a: string, al: string}>, publico?: boolean}} album
 * @returns {Promise<string>} el id del álbum en el servidor
 */
export async function guardarPlaylist({ idServidor, nombre, idsCanciones, vinculos = {}, datos = {}, publico = false }) {
  let id = idServidor;
  if (!id) {
    const json = await llamar('createPlaylist', { name: nombre, songId: idsCanciones });
    id = json.playlist?.id ?? (await listarPlaylists()).find((p) => p.nombre === nombre)?.idServidor;
  } else {
    // Con playlistId, createPlaylist reemplaza todas las canciones en el nuevo orden.
    await llamar('createPlaylist', { playlistId: id, songId: idsCanciones });
  }
  const pares = Object.entries(vinculos);
  const hayDatos = Object.keys(datos).length > 0;
  const extra = {};
  if (pares.length) extra.v = pares;
  if (hayDatos) extra.d = datos;
  await llamar('updatePlaylist', {
    playlistId: id,
    name: nombre,
    public: String(publico),
    comment: pares.length || hayDatos ? PREFIJO_COMENTARIO + JSON.stringify(extra) : '',
  });
  return id;
}

/** El comentario tal cual de una playlist (para el registro de diagnóstico). */
export async function leerComentario(idServidor) {
  const { playlist } = await llamar('getPlaylist', { id: idServidor });
  return playlist.comment ?? '';
}

/** Crea (si hace falta) una playlist vacía y le pone un comentario. Devuelve su id. */
export async function guardarComentario({ idServidor, nombre, comentario, publico = false }) {
  let id = idServidor;
  if (!id) {
    const json = await llamar('createPlaylist', { name: nombre });
    id = json.playlist?.id ?? (await listarPlaylists()).find((p) => p.nombre === nombre)?.idServidor;
  }
  await llamar('updatePlaylist', { playlistId: id, comment: comentario, public: String(publico) });
  return id;
}

/* ---------- Datos de las canciones para todos (como el título de un video) ---------- */
// Cuando alguien edita el título, artista o álbum de una canción que está en tu
// servidor, se guarda aquí (una lista oculta y pública) y TODOS los dispositivos lo
// aplican: en Mi PC y en sus copias descargadas.  { idCancion: { t, a, al, c } }

const NOMBRE_DATOS = 'Muz15 · Datos de canciones';

// Cada usuario guarda sus ediciones en SU lista oculta (Navidrome solo deja al dueño
// cambiarla); al leer se juntan las de todos y gana el cambio más reciente.
async function leerUnaLista(lista) {
  try { return JSON.parse(await leerComentario(lista.idServidor)) ?? {}; } catch { return {}; }
}

/** @returns {Promise<{idServidor: string|null, cambiada: string, datos: object}>} idServidor = la tuya */
export async function leerDatosGlobales() {
  const listas = (await listarPlaylists()).filter((p) => p.nombre === NOMBRE_DATOS);
  const datos = {};
  for (const lista of listas) {
    for (const [id, dato] of Object.entries(await leerUnaLista(lista))) {
      if (!datos[id] || (dato.c ?? 0) > (datos[id].c ?? 0)) datos[id] = dato;
    }
  }
  return {
    idServidor: listas.find((p) => p.mio)?.idServidor ?? null,
    cambiada: listas.map((p) => p.cambiada ?? '').sort().join('|'),
    datos,
  };
}

/** Guarda la edición de una canción para todos. */
export async function guardarDatoGlobal(idCancion, { titulo, artista, album }) {
  const mia = (await listarPlaylists()).find((p) => p.nombre === NOMBRE_DATOS && p.mio);
  const datos = mia ? await leerUnaLista(mia) : {};
  datos[idCancion] = { t: titulo, a: artista, al: album ?? '', c: Date.now() };
  await guardarComentario({ idServidor: mia?.idServidor ?? null, nombre: NOMBRE_DATOS, comentario: JSON.stringify(datos), publico: true });
}

/** Aplica los datos globales a canciones del servidor (las de Mi PC). */
export function conDatosGlobales(canciones, datos) {
  return canciones.map((c) => {
    const d = datos[c.idServidor];
    return d ? { ...c, titulo: d.t || c.titulo, artista: d.a || c.artista, album: d.al ?? c.album } : c;
  });
}

/** Usuario y llave (sin contraseña) para que la PC sepa que eres tú al subir canciones. */
export function credenciales() {
  const datos = actual();
  return datos ? { u: datos.usuario, t: datos.token, s: datos.sal, url: datos.url } : null;
}

/** Le pide a Navidrome que busque canciones nuevas ya (sin esperar a que lo note solo). */
export async function escanear() {
  await llamar('startScan', {});
}

export async function borrarPlaylist(idServidor) {
  await llamar('deletePlaylist', { id: idServidor });
}

/** Dirección para escuchar la canción en vivo (sin descargarla). */
export function urlAudio(cancion) {
  return urlDe('stream', { id: cancion.idServidor, format: 'raw' });
}

/** Dirección de la portada, o null si no tiene. */
export function urlPortada(cancion, tamano = 512) {
  return cancion.portadaId ? urlDe('getCoverArt', { id: cancion.portadaId, size: tamano }) : null;
}

/**
 * Descarga el archivo original y su portada para guardarlos en el teléfono.
 * @returns {Promise<{audio: ArrayBuffer, portada: {datos: ArrayBuffer, tipo: string} | null}>}
 */
export async function descargar(cancion) {
  const respuesta = await fetch(urlDe('download', { id: cancion.idServidor }));
  if (!respuesta.ok) throw new Error(`No se pudo descargar (${respuesta.status})`);
  const audio = await respuesta.arrayBuffer();

  let portada = null;
  const urlImagen = urlPortada(cancion, 600);
  if (urlImagen) {
    try {
      const imagen = await fetch(urlImagen);
      if (imagen.ok) portada = { datos: await imagen.arrayBuffer(), tipo: imagen.headers.get('content-type') || 'image/jpeg' };
    } catch {
      // Sin portada no pasa nada: se usa la de por defecto.
    }
  }
  return { audio, portada };
}
