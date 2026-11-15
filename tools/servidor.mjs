// servidor.mjs — Servidor local para usar Muz15 en la computadora.
// Uso:  node tools/servidor.mjs   y abre http://localhost:5150
// (El service worker solo funciona en localhost o con HTTPS, por eso no basta con abrir index.html.)
//
// Además recibe las canciones del botón "Enviar a mi PC" y las guarda en la
// carpeta de Navidrome, para que también aparezcan en el celular (pestaña Mi PC).
// Acepta envíos desde esta computadora o, por Tailscale (/muz15), de quien tenga
// usuario en tu Navidrome.

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, access, rename, rm, mkdtemp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { extname, join, normalize, basename } from 'node:path';

const PUERTO = Number(process.env.PORT) || 5150;
const RAIZ = join(import.meta.dirname, '..');
const CARPETA_MUSICA = process.env.MUZ15_MUSICA || 'C:\\Music';
const CARPETA_ENVIOS = join(CARPETA_MUSICA, 'Desde Muz15');
const CARPETA_ORIGINALES = join(homedir(), 'Videos', 'Muz15-originales');
const FFMPEG = process.env.MUZ15_FFMPEG || 'C:\\Program Files\\Navidrome\\ffmpeg.exe';
const MAXIMO_BYTES = 500 * 1024 * 1024; // 500 MB por archivo
const NAVIDROME = process.env.MUZ15_NAVIDROME || 'http://127.0.0.1:4533';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
};

const LOCALES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const EXTENSIONES_AUDIO = new Set(['.mp3', '.m4a', '.aac', '.wav', '.mp4', '.m4v', '.mov', '.flac', '.ogg']);
const EXTENSIONES_VIDEO = new Set(['.mp4', '.m4v', '.mov']);

function json(respuesta, codigo, datos) {
  respuesta.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8' });
  respuesta.end(JSON.stringify(datos));
}

// Quita caracteres que Windows no permite en nombres de archivo.
function nombreSeguro(nombre) {
  return nombre.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 150);
}

const existe = (ruta) => access(ruta).then(() => true, () => false);

/** Corre ffmpeg y espera a que termine. */
function ffmpeg(argumentos) {
  return new Promise((resolve, reject) => {
    const proceso = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...argumentos], { windowsHide: true });
    let errores = '';
    proceso.stderr.on('data', (d) => { errores += d; });
    proceso.on('error', reject);
    proceso.on('close', (codigo) => (codigo === 0 ? resolve() : reject(new Error(errores.trim() || `ffmpeg salió con ${codigo}`))));
  });
}

/**
 * Deja la canción lista en la carpeta de Navidrome, AL MOMENTO (sin esperar a la
 * tarea que revisa cada minuto):
 *  - videos → MP3 con portada (un cuadro del video) y con el título/artista de Muz15;
 *  - audio  → igual que llegó, pero con el título/artista de Muz15 escritos adentro.
 * Se arma en una carpeta temporal y se mueve al final, para que Navidrome nunca
 * vea un archivo a medias.
 */
async function prepararCancion(entrada, extension, base, { titulo, artista, album }) {
  const datos = [];
  if (titulo) datos.push('-metadata', `title=${titulo}`);
  if (artista) datos.push('-metadata', `artist=${artista}`);
  if (album) datos.push('-metadata', `album=${album}`);
  const temporal = await mkdtemp(join(tmpdir(), 'muz15-'));
  try {
    if (EXTENSIONES_VIDEO.has(extension)) {
      const portada = join(temporal, 'portada.jpg');
      await ffmpeg(['-ss', '3', '-i', entrada, '-frames:v', '1', '-vf', "crop='min(iw,ih)':'min(iw,ih)',scale=600:600", portada]).catch(() => {});
      const conPortada = await existe(portada);
      const salida = join(temporal, `${base}.mp3`);
      await ffmpeg([
        '-i', entrada, ...(conPortada ? ['-i', portada] : []),
        '-map', '0:a:0', ...(conPortada ? ['-map', '1:v:0', '-c:v', 'copy', '-disposition:v', 'attached_pic'] : []),
        '-c:a', 'libmp3lame', '-q:a', '2', '-map_metadata', '0', '-id3v2_version', '3', ...datos, salida,
      ]);
      await mkdir(CARPETA_ENVIOS, { recursive: true });
      await rename(salida, join(CARPETA_ENVIOS, `${base}.mp3`)).catch(async () => {
        await writeFile(join(CARPETA_ENVIOS, `${base}.mp3`), await readFile(salida));
      });
      // El video original se guarda aparte (no se borra), como hace el convertidor.
      await mkdir(CARPETA_ORIGINALES, { recursive: true });
      await writeFile(join(CARPETA_ORIGINALES, basename(entrada)), await readFile(entrada));
      return `${base}.mp3`;
    }
    // Audio: copia sin volver a comprimir, solo con los datos de Muz15 adentro.
    const salida = join(temporal, `${base}${extension}`);
    try {
      await ffmpeg(['-i', entrada, '-map', '0', '-c', 'copy', ...datos, salida]);
    } catch {
      await writeFile(salida, await readFile(entrada)); // si no se pudo, tal cual
    }
    await mkdir(CARPETA_ENVIOS, { recursive: true });
    await writeFile(join(CARPETA_ENVIOS, `${base}${extension}`), await readFile(salida));
    return `${base}${extension}`;
  } finally {
    await rm(temporal, { recursive: true, force: true });
  }
}

/**
 * ¿Viene de esta misma PC? Lo que llega por Tailscale también entra por 127.0.0.1,
 * pero trae x-forwarded-for y el nombre de la PC en Tailscale, así que no cuenta.
 */
function esDeEstaPC(pedido) {
  const host = (pedido.headers.host ?? '').split(':')[0];
  return LOCALES.has(pedido.socket.remoteAddress)
    && !pedido.headers['x-forwarded-for']
    && ['localhost', '127.0.0.1', '[::1]'].includes(host);
}

// Usuarios de Navidrome ya revisados (para no preguntarle en cada canción).
const llavesValidas = new Map(); // "u|t|s" → vence (ms)

/** Desde el cel: vale si el usuario/llave es de alguien de tu Navidrome. */
async function esUsuarioDeNavidrome(parametros) {
  const u = parametros.get('u');
  const t = parametros.get('t');
  const s = parametros.get('s');
  if (!u || !t || !s) return false;
  const llave = `${u}|${t}|${s}`;
  if ((llavesValidas.get(llave) ?? 0) > Date.now()) return true;
  try {
    const consulta = new URLSearchParams({ u, t, s, v: '1.16.1', c: 'muz15-pc', f: 'json' });
    const respuesta = await fetch(`${NAVIDROME}/rest/ping.view?${consulta}`);
    const datos = await respuesta.json();
    if (datos?.['subsonic-response']?.status !== 'ok') return false;
    llavesValidas.set(llave, Date.now() + 10 * 60 * 1000);
    return true;
  } catch {
    return false;
  }
}

const puedeSubir = async (pedido, parametros) => esDeEstaPC(pedido) || esUsuarioDeNavidrome(parametros);

async function recibirCancion(pedido, respuesta) {
  const parametros = new URL(pedido.url, 'http://x').searchParams;
  if (!await puedeSubir(pedido, parametros)) {
    pedido.resume();
    return json(respuesta, 403, { error: 'Necesitas tu usuario de Mi PC' });
  }

  const nombre = nombreSeguro(parametros.get('nombre') ?? '');
  const extension = extname(nombre).toLowerCase();
  if (!nombre || !EXTENSIONES_AUDIO.has(extension)) return json(respuesta, 400, { error: 'Nombre o tipo de archivo no válido' });
  const base = nombre.slice(0, -extension.length);

  // ¿Ya está? (los videos quedan como .mp3)
  const destino = join(CARPETA_ENVIOS, nombre);
  const comoMp3 = join(CARPETA_ENVIOS, `${base}.mp3`);
  if (await existe(destino) || (EXTENSIONES_VIDEO.has(extension) && await existe(comoMp3))) {
    pedido.resume();
    return json(respuesta, 200, { ya: true });
  }

  const partes = [];
  let total = 0;
  for await (const parte of pedido) {
    total += parte.length;
    if (total > MAXIMO_BYTES) return json(respuesta, 413, { error: 'Archivo demasiado grande' });
    partes.push(parte);
  }

  // Se guarda primero fuera de la carpeta de Navidrome y se prepara ahí mismo.
  const recibido = join(await mkdtemp(join(tmpdir(), 'muz15-recibido-')), nombre);
  await writeFile(recibido, Buffer.concat(partes));
  try {
    const listo = await prepararCancion(recibido, extension, base, {
      titulo: parametros.get('titulo') ?? '',
      artista: parametros.get('artista') ?? '',
      album: parametros.get('album') ?? '',
    });
    console.log(`Lista en Navidrome: ${listo}`);
    json(respuesta, 200, { guardada: true, archivo: listo });
  } catch (error) {
    console.error('No se pudo preparar', nombre, error.message);
    json(respuesta, 500, { error: `No se pudo preparar la canción: ${error.message}` });
  } finally {
    await rm(join(recibido, '..'), { recursive: true, force: true });
  }
}

createServer(async (pedido, respuesta) => {
  const url = new URL(pedido.url, 'http://x');
  const ruta = decodeURIComponent(url.pathname);

  // El cel llama desde la página de GitHub: hay que dejarlo (CORS).
  respuesta.setHeader('Access-Control-Allow-Origin', '*');
  respuesta.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  respuesta.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (pedido.method === 'OPTIONS') return respuesta.writeHead(204).end();

  try {
    // Por Tailscale llega como /muz15/api/…; aquí mismo, como /api/…
    if (ruta.endsWith('/api/estado')) {
      return json(respuesta, 200, { enviarAPC: await puedeSubir(pedido, url.searchParams), carpeta: CARPETA_ENVIOS });
    }
    if (ruta.endsWith('/api/subir') && pedido.method === 'POST') return await recibirCancion(pedido, respuesta);
  } catch (error) {
    console.error(error);
    return json(respuesta, 500, { error: error.message });
  }

  // La app en sí solo se sirve en esta PC (por Tailscale solo está la parte de subir).
  if (!esDeEstaPC(pedido)) return respuesta.writeHead(404).end('No encontrado');

  const archivo = normalize(join(RAIZ, ruta.endsWith('/') ? `${ruta}index.html` : ruta));
  if (!archivo.startsWith(RAIZ)) return respuesta.writeHead(403).end();
  try {
    const contenido = await readFile(archivo);
    respuesta.writeHead(200, { 'Content-Type': TIPOS[extname(archivo)] ?? 'application/octet-stream' });
    respuesta.end(contenido);
  } catch {
    respuesta.writeHead(404).end('No encontrado');
  }
}).listen(PUERTO, () => console.log(`Muz15 en http://localhost:${PUERTO}  ·  "Enviar a mi PC" guarda en ${CARPETA_ENVIOS}`));
