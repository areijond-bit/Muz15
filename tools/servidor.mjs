// servidor.mjs — Servidor local para usar Muz15 en la computadora.
// Uso:  node tools/servidor.mjs   y abre http://localhost:5150
// (El service worker solo funciona en localhost o con HTTPS, por eso no basta con abrir index.html.)
//
// Además recibe las canciones del botón "Enviar a mi PC" y las guarda en la
// carpeta de Navidrome, para que también aparezcan en el celular (pestaña Mi PC).
// Solo acepta envíos desde esta misma computadora.

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const PUERTO = Number(process.env.PORT) || 5150;
const RAIZ = join(import.meta.dirname, '..');
const CARPETA_MUSICA = process.env.MUZ15_MUSICA || 'C:\\Music';
const CARPETA_ENVIOS = join(CARPETA_MUSICA, 'Desde Muz15');
const MAXIMO_BYTES = 500 * 1024 * 1024; // 500 MB por archivo

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

async function recibirCancion(pedido, respuesta) {
  if (!LOCALES.has(pedido.socket.remoteAddress)) return json(respuesta, 403, { error: 'Solo desde esta PC' });

  const nombre = nombreSeguro(new URL(pedido.url, 'http://x').searchParams.get('nombre') ?? '');
  const extension = extname(nombre).toLowerCase();
  if (!nombre || !EXTENSIONES_AUDIO.has(extension)) return json(respuesta, 400, { error: 'Nombre o tipo de archivo no válido' });

  // ¿Ya está? (los videos se convierten a .mp3 y el original se va de la carpeta)
  const destino = join(CARPETA_ENVIOS, nombre);
  const comoMp3 = destino.slice(0, -extension.length) + '.mp3';
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

  await mkdir(CARPETA_ENVIOS, { recursive: true });
  await writeFile(destino, Buffer.concat(partes));
  console.log(`Recibida: ${nombre}`);
  json(respuesta, 200, { guardada: true });
}

createServer(async (pedido, respuesta) => {
  const ruta = decodeURIComponent(new URL(pedido.url, 'http://x').pathname);

  try {
    if (ruta === '/api/estado') {
      return json(respuesta, 200, { enviarAPC: LOCALES.has(pedido.socket.remoteAddress), carpeta: CARPETA_ENVIOS });
    }
    if (ruta === '/api/subir' && pedido.method === 'POST') return await recibirCancion(pedido, respuesta);
  } catch (error) {
    console.error(error);
    return json(respuesta, 500, { error: error.message });
  }

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
