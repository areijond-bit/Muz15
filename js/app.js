// app.js — Une todo: importar archivos, pintar la lista y conectar los botones.

import { guardarCancion, listarCanciones, obtenerAudio, borrarCancion, pedirAlmacenamientoPersistente, espacioUsado } from './db.js';
import { leerMetadatos } from './metadatos.js';
import { crearReproductor } from './reproductor.js';

const $ = (id) => document.getElementById(id);
const el = {
  importar: $('importar'),
  aviso: $('aviso'),
  lista: $('lista'),
  vacio: $('vacio'),
  espacio: $('espacio'),
  portada: $('portada'),
  titulo: $('titulo'),
  artista: $('artista'),
  progreso: $('progreso'),
  anterior: $('anterior'),
  alternar: $('alternar'),
  siguiente: $('siguiente'),
  audio: $('audio'),
};

// URLs temporales de las portadas de la lista (las liberamos al volver a pintar).
let urlsPortadas = [];
let cancionesLocales = [];

const reproductor = crearReproductor(el.audio, {
  obtenerFuente,
  alCambiar: pintarReproductor,
  alFallar: (mensaje) => mostrarAviso(mensaje, 5000),
});

/** Direcciones del audio y la portada de una canción guardada en el teléfono. */
async function obtenerFuente(cancion) {
  const audio = URL.createObjectURL(await obtenerAudio(cancion));
  const portada = cancion.portada
    ? URL.createObjectURL(new Blob([cancion.portada.datos], { type: cancion.portada.tipo }))
    : null;
  return { audio, portada };
}

/* ---------- Importar ---------- */

el.importar.addEventListener('change', async () => {
  const archivos = [...el.importar.files];
  el.importar.value = ''; // permite volver a elegir el mismo archivo
  if (!archivos.length) return;

  let guardadas = 0;
  for (const [i, archivo] of archivos.entries()) {
    mostrarAviso(`Importando ${i + 1} de ${archivos.length}: ${archivo.name}`);
    try {
      const buffer = await archivo.arrayBuffer();
      const meta = leerMetadatos(buffer, archivo.name);
      if (!meta.portada && esVideo(archivo)) meta.portada = await portadaDeVideo(archivo);
      await guardarCancion({
        id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
        titulo: meta.titulo,
        artista: meta.artista,
        album: meta.album,
        portada: meta.portada,
        tipo: tipoParaGuardar(archivo),
        nombreArchivo: archivo.name,
        agregada: Date.now() + i, // + i para mantener el orden aunque sea el mismo milisegundo
      }, buffer);
      guardadas++;
    } catch (error) {
      console.error('Error importando', archivo.name, error);
      mostrarAviso(`No se pudo importar ${archivo.name}: ${error.message}`);
    }
  }

  mostrarAviso(`${guardadas} ${guardadas === 1 ? 'canción guardada' : 'canciones guardadas'} en el teléfono.`, 3000);
  pedirAlmacenamientoPersistente();
  await recargarLista();
});

const EXTENSIONES_VIDEO = ['mp4', 'm4v', 'mov'];
const extensionDe = (nombre) => nombre.split('.').pop().toLowerCase();
const esVideo = (archivo) => archivo.type.startsWith('video/') || EXTENSIONES_VIDEO.includes(extensionDe(archivo.name));

function tipoPorExtension(nombre) {
  const tipos = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', mp4: 'audio/mp4', m4v: 'audio/mp4', mov: 'video/quicktime' };
  return tipos[extensionDe(nombre)] || 'audio/mpeg';
}

// Los videos se guardan tal cual y el <audio> reproduce solo su sonido.
// Para MP4 decimos "audio/mp4" para que el teléfono lo trate como música.
function tipoParaGuardar(archivo) {
  if (archivo.type === 'video/mp4') return 'audio/mp4';
  return archivo.type || tipoPorExtension(archivo.name);
}

/**
 * Saca un cuadro del video (segundo 3, o la mitad si es más corto),
 * lo recorta en cuadrado y lo devuelve como portada JPEG.
 */
function portadaDeVideo(archivo) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(archivo);
    const terminar = (portada) => { URL.revokeObjectURL(url); resolve(portada); };
    setTimeout(() => terminar(null), 8000); // si el teléfono no puede, seguimos sin portada

    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.onerror = () => terminar(null);
    video.onloadedmetadata = () => { video.currentTime = Math.min(3, (video.duration || 0) / 2); };
    video.onseeked = () => {
      const lado = Math.min(video.videoWidth, video.videoHeight);
      if (!lado) return terminar(null);
      const tamano = Math.min(lado, 600);
      const lienzo = document.createElement('canvas');
      lienzo.width = lienzo.height = tamano;
      lienzo.getContext('2d').drawImage(
        video,
        (video.videoWidth - lado) / 2, (video.videoHeight - lado) / 2, lado, lado,
        0, 0, tamano, tamano,
      );
      lienzo.toBlob(async (blob) => {
        terminar(blob ? { datos: await blob.arrayBuffer(), tipo: 'image/jpeg' } : null);
      }, 'image/jpeg', 0.85);
    };
    video.src = url;
  });
}

/* ---------- Lista ---------- */

async function recargarLista() {
  cancionesLocales = await listarCanciones();
  pintarLista(cancionesLocales);
  pintarEspacio();
}

function pintarLista(canciones) {
  urlsPortadas.forEach(URL.revokeObjectURL);
  urlsPortadas = [];

  el.vacio.hidden = canciones.length > 0;
  el.lista.replaceChildren(...canciones.map((cancion, i) => {
    const li = document.createElement('li');
    li.className = 'cancion';
    li.dataset.id = cancion.id;

    const img = document.createElement('img');
    img.className = 'cancion__portada';
    img.alt = '';
    img.src = urlDePortada(cancion);

    const info = document.createElement('div');
    info.className = 'cancion__info';
    info.innerHTML = '<p class="cancion__titulo"></p><p class="cancion__artista"></p>';
    info.children[0].textContent = cancion.titulo;
    info.children[1].textContent = cancion.artista;

    const borrar = document.createElement('button');
    borrar.className = 'cancion__borrar';
    borrar.setAttribute('aria-label', `Borrar ${cancion.titulo}`);
    borrar.textContent = '×';
    borrar.addEventListener('click', async (evento) => {
      evento.stopPropagation(); // que no empiece a sonar al borrar
      if (!confirm(`¿Borrar "${cancion.titulo}" del teléfono?`)) return;
      await borrarCancion(cancion.id);
      reproductor.quitar(cancion.id);
      await recargarLista();
    });

    li.append(img, info, borrar);
    li.addEventListener('click', () => reproductor.reproducirLista(cancionesLocales, i));
    return li;
  }));

  marcarSonando(reproductor.estado().cancion);
}

function urlDePortada(cancion) {
  if (!cancion.portada) return 'icons/portada.png';
  const url = URL.createObjectURL(new Blob([cancion.portada.datos], { type: cancion.portada.tipo }));
  urlsPortadas.push(url);
  return url;
}

function marcarSonando(cancion) {
  for (const li of el.lista.children) {
    li.classList.toggle('cancion--sonando', li.dataset.id === cancion?.id);
  }
}

async function pintarEspacio() {
  const espacio = await espacioUsado();
  if (!espacio) return;
  const mb = (bytes) => (bytes / 1024 / 1024).toFixed(0);
  el.espacio.textContent = `Usando ${mb(espacio.usado)} MB de ${mb(espacio.total)} MB disponibles`;
}

/* ---------- Reproductor ---------- */

function pintarReproductor({ cancion, sonando, urlPortada }) {
  el.titulo.textContent = cancion?.titulo ?? 'Nada sonando';
  el.artista.textContent = cancion?.artista ?? 'Elige una canción';
  el.portada.src = urlPortada;
  el.alternar.textContent = sonando ? '⏸' : '▶';
  el.alternar.setAttribute('aria-label', sonando ? 'Pausar' : 'Reproducir');
  marcarSonando(cancion);
}

el.alternar.addEventListener('click', () => {
  // Si no ha sonado nada todavía, ▶ empieza por la primera canción del teléfono.
  if (reproductor.estado().cancion) reproductor.alternar();
  else reproductor.reproducirLista(cancionesLocales, 0);
});
el.siguiente.addEventListener('click', () => reproductor.siguiente());
el.anterior.addEventListener('click', () => reproductor.anterior());

// Barra de progreso: se mueve sola y también sirve para saltar a otra parte.
let arrastrando = false;
el.audio.addEventListener('loadedmetadata', () => { el.progreso.max = el.audio.duration || 0; });
el.audio.addEventListener('timeupdate', () => { if (!arrastrando) el.progreso.value = el.audio.currentTime; });
el.progreso.addEventListener('input', () => { arrastrando = true; });
el.progreso.addEventListener('change', () => {
  el.audio.currentTime = Number(el.progreso.value);
  arrastrando = false;
});

/* ---------- Avisos ---------- */

let temporizadorAviso;
function mostrarAviso(texto, ocultarEnMs) {
  clearTimeout(temporizadorAviso);
  el.aviso.textContent = texto;
  el.aviso.hidden = false;
  if (ocultarEnMs) temporizadorAviso = setTimeout(() => { el.aviso.hidden = true; }, ocultarEnMs);
}

/* ---------- Arranque ---------- */

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((error) => console.error('Service worker:', error));
}

recargarLista().catch((error) => {
  console.error(error);
  mostrarAviso(`No se pudo abrir la biblioteca: ${error.message}`);
});
