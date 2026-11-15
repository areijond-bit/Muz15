// servidor.mjs — Servidor local para probar Muz15 en la computadora.
// Uso:  node tools/servidor.mjs   y abre http://localhost:5150
// (El service worker solo funciona en localhost o con HTTPS, por eso no basta con abrir index.html.)

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const PUERTO = Number(process.env.PORT) || 5150;
const RAIZ = join(import.meta.dirname, '..');
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
};

createServer(async (pedido, respuesta) => {
  let ruta = decodeURIComponent(new URL(pedido.url, 'http://x').pathname);
  if (ruta.endsWith('/')) ruta += 'index.html';
  const archivo = normalize(join(RAIZ, ruta));
  if (!archivo.startsWith(RAIZ)) return respuesta.writeHead(403).end();
  try {
    const contenido = await readFile(archivo);
    respuesta.writeHead(200, { 'Content-Type': TIPOS[extname(archivo)] ?? 'application/octet-stream' });
    respuesta.end(contenido);
  } catch {
    respuesta.writeHead(404).end('No encontrado');
  }
}).listen(PUERTO, () => console.log(`Muz15 en http://localhost:${PUERTO}`));
