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

function urlDe(metodo, extra = {}, datos = actual()) {
  const parametros = new URLSearchParams({
    u: datos.usuario,
    t: datos.token,
    s: datos.sal,
    v: VERSION_API,
    c: NOMBRE_CLIENTE,
    f: 'json',
    ...extra,
  });
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
