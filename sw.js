// sw.js — Service worker: guarda la app en el teléfono para que abra sin internet.
//
// Las canciones NO pasan por aquí (están en IndexedDB). Esto solo guarda
// los archivos de la app: HTML, CSS, JS e íconos.
//
// IMPORTANTE: cada vez que publiques cambios, sube el número de VERSION.
// Así el teléfono sabe que tiene que descargar la versión nueva.

const VERSION = 'muz15-v36';

const ARCHIVOS_APP = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/db.js',
  'js/metadatos.js',
  'js/reproductor.js',
  'js/servidor.js',
  'js/md5.js',
  'js/hoja.js',
  'js/iconos.js',
  'js/arrastrar.js',
  'js/nativo.js',
  'js/archivos.js',
  'js/reproductor-nativo.js',
  'js/ecualizador.js',
  'js/vendor/capacitor-core.js',
  'js/vendor/supabase.js',
  'js/vendor/webm-muxer.mjs',
  'js/config.js',
  'js/tema.js',
  'js/cuenta.js',
  'js/nube.js',
  'js/comprimir.js',
  'icons/icono-180.png',
  'icons/icono-192.png',
  'icons/icono-512.png',
  'icons/portada.png',
];

// Al instalar: descargamos todos los archivos de la app.
self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(ARCHIVOS_APP))
      .then(() => self.skipWaiting()),
  );
});

// Al activar: borramos las versiones viejas.
self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nombres) => Promise.all(nombres.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

// Cada petición: primero lo guardado; si no está, internet.
self.addEventListener('fetch', (evento) => {
  const { request } = evento;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return; // ej. Eruda desde el CDN: que vaya directo
  if (url.pathname.includes('/api/')) return;  // el servidor local de la PC: nunca guardar

  evento.respondWith((async () => {
    const cache = await caches.open(VERSION);

    // Abrir la app (con o sin ?debug) siempre devuelve el index guardado.
    if (request.mode === 'navigate') {
      return (await cache.match('index.html')) ?? fetch(request);
    }

    const guardado = await cache.match(request, { ignoreSearch: true });
    if (guardado) return guardado;

    const respuesta = await fetch(request);
    if (respuesta.ok) cache.put(request, respuesta.clone());
    return respuesta;
  })());
});
