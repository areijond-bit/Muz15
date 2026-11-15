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

const reproductor = crearReproductor(el.audio, {
  obtenerAudio,
  alCambiar: pintarReproductor,
});

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
      await guardarCancion({
        id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
        titulo: meta.titulo,
        artista: meta.artista,
        album: meta.album,
        portada: meta.portada,
        tipo: archivo.type || tipoPorExtension(archivo.name),
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

function tipoPorExtension(nombre) {
  const extension = nombre.split('.').pop().toLowerCase();
  return { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav' }[extension] || 'audio/mpeg';
}

/* ---------- Lista ---------- */

async function recargarLista() {
  const canciones = await listarCanciones();
  reproductor.cargarLista(canciones);
  pintarLista(canciones);
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
      await recargarLista();
    });

    li.append(img, info, borrar);
    li.addEventListener('click', () => reproductor.reproducir(i));
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

el.alternar.addEventListener('click', () => reproductor.alternar());
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
