// app.js — Une todo: importar archivos, pintar la lista y conectar los botones.

import { guardarCancion, listarCanciones, obtenerAudio, borrarCancion, pedirAlmacenamientoPersistente, espacioUsado } from './db.js';
import { leerMetadatos } from './metadatos.js';
import { crearReproductor } from './reproductor.js';
import * as servidor from './servidor.js';

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
  pestanas: document.querySelectorAll('.pestana'),
  vistaTelefono: $('vista-telefono'),
  vistaServidor: $('vista-servidor'),
  formServidor: $('form-servidor'),
  servidorUrl: $('servidor-url'),
  servidorUsuario: $('servidor-usuario'),
  servidorContrasena: $('servidor-contrasena'),
  bibliotecaServidor: $('biblioteca-servidor'),
  buscar: $('buscar'),
  recargarServidor: $('recargar-servidor'),
  estadoServidor: $('estado-servidor'),
  listaServidor: $('lista-servidor'),
  desconectar: $('desconectar'),
};

// Para no dibujar miles de filas de golpe: con más resultados, hay que buscar.
const MAXIMO_EN_PANTALLA = 200;

// URLs temporales de las portadas de la lista (las liberamos al volver a pintar).
let urlsPortadas = [];
let cancionesLocales = [];
let cancionesServidor = [];   // toda la biblioteca del servidor
let visiblesServidor = [];    // las que pasan el filtro de búsqueda
const descargando = new Set(); // idServidor de las que se están bajando ahora

const reproductor = crearReproductor(el.audio, {
  obtenerFuente,
  alCambiar: pintarReproductor,
  alFallar: (mensaje) => mostrarAviso(mensaje, 5000),
});

/**
 * Direcciones del audio y la portada de una canción.
 * Si es del servidor pero ya está descargada, suena desde el teléfono (sin internet).
 */
async function obtenerFuente(cancion) {
  if (cancion.origen === 'servidor') {
    const local = localDe(cancion);
    if (!local) return { audio: servidor.urlAudio(cancion), portada: servidor.urlPortada(cancion) };
    cancion = local;
  }
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
  if (cancionesServidor.length) pintarListaServidor(); // actualiza los ✓ de descargadas
}

/** La copia guardada en el teléfono de una canción del servidor, si existe. */
function localDe(cancionServidor) {
  return cancionesLocales.find((c) => c.idServidor === cancionServidor.idServidor) ?? null;
}

function pintarLista(canciones) {
  urlsPortadas.forEach(URL.revokeObjectURL);
  urlsPortadas = [];

  el.vacio.hidden = canciones.length > 0;
  el.lista.replaceChildren(...canciones.map((cancion, i) => {
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

    return crearFila(cancion, urlDePortada(cancion), borrar, () => reproductor.reproducirLista(cancionesLocales, i));
  }));

  marcarSonando(reproductor.estado().cancion);
}

/** Una fila de canción: portada, título, artista y un botón a la derecha. */
function crearFila(cancion, portada, boton, alTocar) {
  const li = document.createElement('li');
  li.className = 'cancion';
  li.dataset.id = cancion.id;

  const img = document.createElement('img');
  img.className = 'cancion__portada';
  img.alt = '';
  img.loading = 'lazy';
  img.src = portada;
  img.onerror = () => { img.onerror = null; img.src = 'icons/portada.png'; };

  const info = document.createElement('div');
  info.className = 'cancion__info';
  info.innerHTML = '<p class="cancion__titulo"></p><p class="cancion__artista"></p>';
  info.children[0].textContent = cancion.titulo;
  info.children[1].textContent = cancion.artista;

  li.append(img, info, boton);
  li.addEventListener('click', alTocar);
  return li;
}

function urlDePortada(cancion) {
  if (!cancion.portada) return 'icons/portada.png';
  const url = URL.createObjectURL(new Blob([cancion.portada.datos], { type: cancion.portada.tipo }));
  urlsPortadas.push(url);
  return url;
}

function marcarSonando(cancion) {
  for (const li of [...el.lista.children, ...el.listaServidor.children]) {
    li.classList.toggle('cancion--sonando', li.dataset.id === cancion?.id);
  }
}

async function pintarEspacio() {
  const espacio = await espacioUsado();
  if (!espacio) return;
  const mb = (bytes) => (bytes / 1024 / 1024).toFixed(0);
  el.espacio.textContent = `Usando ${mb(espacio.usado)} MB de ${mb(espacio.total)} MB disponibles`;
}

/* ---------- Pestañas ---------- */

for (const pestana of el.pestanas) {
  pestana.addEventListener('click', () => mostrarVista(pestana.dataset.vista));
}

function mostrarVista(vista) {
  for (const pestana of el.pestanas) {
    pestana.classList.toggle('pestana--activa', pestana.dataset.vista === vista);
  }
  el.vistaTelefono.hidden = vista !== 'telefono';
  el.vistaServidor.hidden = vista !== 'servidor';
  if (vista === 'servidor') abrirServidor();
}

/* ---------- Servidor ---------- */

function abrirServidor() {
  const conectado = Boolean(servidor.configuracion());
  el.formServidor.hidden = conectado;
  el.bibliotecaServidor.hidden = !conectado;
  if (!conectado) {
    el.servidorUrl.value ||= servidor.URL_SUGERIDA;
  } else if (!cancionesServidor.length) {
    cargarServidor();
  }
}

el.formServidor.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const boton = el.formServidor.querySelector('button[type="submit"]');
  boton.disabled = true;
  boton.textContent = 'Conectando…';
  try {
    await servidor.conectar(el.servidorUrl.value, el.servidorUsuario.value, el.servidorContrasena.value);
    el.servidorContrasena.value = '';
    mostrarAviso('Conectado a tu servidor.', 3000);
    abrirServidor();
  } catch (error) {
    mostrarAviso(error.message, 6000);
  } finally {
    boton.disabled = false;
    boton.textContent = 'Conectar';
  }
});

el.desconectar.addEventListener('click', () => {
  if (!confirm('¿Desconectar el servidor? Las canciones descargadas se quedan en el teléfono.')) return;
  servidor.desconectar();
  cancionesServidor = visiblesServidor = [];
  el.listaServidor.replaceChildren();
  abrirServidor();
});

el.recargarServidor.addEventListener('click', () => cargarServidor());

async function cargarServidor() {
  el.estadoServidor.textContent = 'Cargando tu biblioteca…';
  try {
    cancionesServidor = await servidor.listarCanciones();
    pintarListaServidor();
  } catch (error) {
    el.estadoServidor.textContent = error.message;
  }
}

// Busca en título, artista y álbum, sin importar mayúsculas ni acentos.
const normalizar = (texto) => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

el.buscar.addEventListener('input', () => pintarListaServidor());

function pintarListaServidor() {
  const busqueda = normalizar(el.buscar.value.trim());
  visiblesServidor = busqueda
    ? cancionesServidor.filter((c) => normalizar(`${c.titulo} ${c.artista} ${c.album}`).includes(busqueda))
    : cancionesServidor;

  const enPantalla = visiblesServidor.slice(0, MAXIMO_EN_PANTALLA);
  el.listaServidor.replaceChildren(...enPantalla.map((cancion, i) => {
    const boton = botonDescarga(cancion);
    return crearFila(cancion, servidor.urlPortada(cancion, 96) ?? 'icons/portada.png', boton,
      () => reproductor.reproducirLista(visiblesServidor, i));
  }));

  const total = cancionesServidor.length;
  if (!total) el.estadoServidor.textContent = 'Tu servidor no tiene canciones. Copia música a C:\\Music en tu PC.';
  else if (visiblesServidor.length > MAXIMO_EN_PANTALLA) el.estadoServidor.textContent = `${visiblesServidor.length} canciones · mostrando ${MAXIMO_EN_PANTALLA}, usa el buscador`;
  else el.estadoServidor.textContent = `${visiblesServidor.length} de ${total} canciones`;

  marcarSonando(reproductor.estado().cancion);
}

// ⬇ = descargar · … = descargando · ✓ = ya está en el teléfono
function botonDescarga(cancion) {
  const boton = document.createElement('button');
  boton.className = 'cancion__accion';
  if (localDe(cancion)) {
    boton.textContent = '✓';
    boton.classList.add('cancion__accion--hecha');
    boton.setAttribute('aria-label', 'Ya está en el teléfono');
  } else if (descargando.has(cancion.idServidor)) {
    boton.textContent = '…';
    boton.disabled = true;
  } else {
    boton.textContent = '⬇';
    boton.setAttribute('aria-label', `Descargar ${cancion.titulo}`);
  }
  boton.addEventListener('click', (evento) => {
    evento.stopPropagation(); // que no empiece a sonar al descargar
    if (!localDe(cancion) && !descargando.has(cancion.idServidor)) descargarDelServidor(cancion);
  });
  return boton;
}

async function descargarDelServidor(cancion) {
  descargando.add(cancion.idServidor);
  pintarListaServidor();
  try {
    const { audio, portada } = await servidor.descargar(cancion);
    await guardarCancion({
      id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      idServidor: cancion.idServidor,
      titulo: cancion.titulo,
      artista: cancion.artista,
      album: cancion.album,
      portada,
      tipo: cancion.tipo,
      nombreArchivo: `${cancion.artista} - ${cancion.titulo}.${cancion.sufijo}`,
      agregada: Date.now(),
    }, audio);
    mostrarAviso(`"${cancion.titulo}" ya está en el teléfono.`, 3000);
    pedirAlmacenamientoPersistente();
  } catch (error) {
    mostrarAviso(`No se pudo descargar "${cancion.titulo}": ${error.message}`, 6000);
  } finally {
    descargando.delete(cancion.idServidor);
    await recargarLista();
  }
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
