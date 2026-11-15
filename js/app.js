// app.js — Une todo: importar archivos, pintar la lista y conectar los botones.

import {
  guardarCancion, listarCanciones, obtenerAudio, borrarCancion, pedirAlmacenamientoPersistente, espacioUsado,
  listarListas, guardarLista, borrarLista, actualizarCancion, guardarOrden,
} from './db.js';
import { activarArrastre } from './arrastrar.js';
import { leerMetadatos } from './metadatos.js';
import { crearReproductor } from './reproductor.js';
import * as servidor from './servidor.js';
import { abrirHoja, confirmar } from './hoja.js';
import { esApk, AppNativa } from './nativo.js';
import { crearEcualizador, BANDAS, PERFILES, MAXIMO_DB } from './ecualizador.js';

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
  audio2: $('audio2'),
  ajustes: $('ajustes'),
  enviarPC: $('enviar-pc'),
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
  descargarTodas: $('descargar-todas'),
  aleatorio: $('aleatorio'),
  vistaListas: $('vista-listas'),
  indiceListas: $('indice-listas'),
  nuevaLista: $('nueva-lista'),
  listas: $('listas'),
  sinListas: $('sin-listas'),
  detalleLista: $('detalle-lista'),
  volverListas: $('volver-listas'),
  nombreLista: $('nombre-lista'),
  opcionesLista: $('opciones-lista'),
  reproducirLista: $('reproducir-lista'),
  cancionesLista: $('canciones-lista'),
  listaVacia: $('lista-vacia'),
};

// Para no dibujar miles de filas de golpe: con más resultados, hay que buscar.
const MAXIMO_EN_PANTALLA = 200;

// Portadas de las canciones del teléfono: id → URL temporal (se reusan entre vistas).
const portadas = new Map();
let cancionesLocales = [];
let listas = [];
let listaAbierta = null; // id de la lista que se está viendo
let cancionesServidor = [];   // toda la biblioteca del servidor
let visiblesServidor = [];    // las que pasan el filtro de búsqueda
const descargando = new Set(); // idServidor de las que se están bajando ahora

const reproductor = crearReproductor([el.audio, el.audio2], {
  alProgreso: pintarProgreso,
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
    video.onseeked = async () => terminar(await recortarCuadrado(video, video.videoWidth, video.videoHeight));
    video.src = url;
  });
}

/**
 * Recorta el centro de una imagen o video en un cuadrado de hasta 600 px y lo
 * devuelve como portada JPEG ({datos, tipo}), o null si no se pudo.
 */
function recortarCuadrado(fuente, ancho, alto) {
  const lado = Math.min(ancho, alto);
  if (!lado) return Promise.resolve(null);
  const tamano = Math.min(lado, 600);
  const lienzo = document.createElement('canvas');
  lienzo.width = lienzo.height = tamano;
  lienzo.getContext('2d').drawImage(fuente, (ancho - lado) / 2, (alto - lado) / 2, lado, lado, 0, 0, tamano, tamano);
  return new Promise((resolve) => {
    lienzo.toBlob(async (blob) => {
      resolve(blob ? { datos: await blob.arrayBuffer(), tipo: 'image/jpeg' } : null);
    }, 'image/jpeg', 0.85);
  });
}

/** Convierte una foto elegida por el usuario en portada cuadrada. */
async function portadaDeImagen(archivo) {
  const imagen = await createImageBitmap(archivo);
  const portada = await recortarCuadrado(imagen, imagen.width, imagen.height);
  imagen.close();
  return portada;
}

/* ---------- Lista ---------- */

async function recargarLista() {
  [cancionesLocales, listas] = await Promise.all([listarCanciones(), listarListas()]);
  liberarPortadasHuerfanas();
  reproductor.refrescar(cancionesLocales); // por si cambiaron títulos o vínculos
  pintarLista(cancionesLocales);
  pintarListas();
  pintarEspacio();
  if (cancionesServidor.length) pintarListaServidor(); // actualiza los ✓ de descargadas
}

/** La copia guardada en el teléfono de una canción del servidor, si existe. */
function localDe(cancionServidor) {
  return cancionesLocales.find((c) => c.idServidor === cancionServidor.idServidor) ?? null;
}

function pintarLista(canciones) {
  el.vacio.hidden = canciones.length > 0;
  el.lista.replaceChildren(...canciones.map((cancion, i) => {
    const menu = botonMenu(cancion, () => menuCancion(cancion));
    return crearFila(cancion, urlDePortada(cancion), menu, () => reproductor.reproducirLista(cancionesLocales, i), { arrastrable: true });
  }));

  marcarSonando(reproductor.estado().cancion);
}

/** Botón ⋯ al final de una fila. */
function botonMenu(cancion, alTocar) {
  const boton = document.createElement('button');
  boton.className = 'cancion__borrar';
  boton.setAttribute('aria-label', `Opciones de ${cancion.titulo}`);
  boton.textContent = '⋯';
  boton.addEventListener('click', (evento) => {
    evento.stopPropagation(); // que no empiece a sonar
    alTocar();
  });
  return boton;
}

/* ---------- Menú de una canción ---------- */

function menuCancion(cancion) {
  abrirHoja({
    titulo: cancion.titulo,
    subtitulo: cancion.artista,
    acciones: [
      { texto: '+ Agregar a una lista', alElegir: () => elegirLista(cancion) },
      { texto: '✎ Editar título, artista y portada', alElegir: () => editarCancion(cancion) },
      cancion.siguienteFija && porId(cancion.siguienteFija)
        ? { texto: `⛓ Quitar vínculo con "${porId(cancion.siguienteFija).titulo}"`, alElegir: () => vincular(cancion, null) }
        : { texto: '⛓ Vincular: que siempre siga otra canción', alElegir: () => elegirVinculo(cancion) },
      {
        texto: 'Borrar del teléfono',
        peligro: true,
        alElegir: () => confirmar({
          titulo: `¿Borrar "${cancion.titulo}"?`,
          subtitulo: 'Se borra de este teléfono y de tus listas. Si está en tu PC, la puedes volver a descargar.',
          textoBoton: 'Borrar',
          alConfirmar: async () => {
            await borrarCancion(cancion.id);
            reproductor.quitar(cancion.id);
            await recargarLista();
            mostrarAviso(`"${cancion.titulo}" se borró del teléfono.`, 3000);
          },
        }),
      },
    ],
  });
}

function elegirLista(cancion) {
  abrirHoja({
    titulo: 'Agregar a una lista',
    subtitulo: cancion.titulo,
    acciones: [
      { texto: '+ Nueva lista', alElegir: () => crearLista(cancion) },
      ...listas.map((lista) => ({
        texto: lista.canciones.includes(cancion.id) ? `${lista.nombre}  ✓` : lista.nombre,
        alElegir: () => agregarALista(lista, cancion),
      })),
    ],
  });
}

const porId = (id) => cancionesLocales.find((c) => c.id === id) ?? null;

/* ---------- Editar una canción ---------- */

const SIN_ARTISTA = 'Artista desconocido';

function editarCancion(cancion) {
  let nuevaPortada; // undefined = no se cambió

  const formulario = document.createElement('form');
  formulario.className = 'hoja__formulario editor';
  formulario.innerHTML = `
    <div class="editor__portada">
      <img class="editor__imagen" alt="Portada">
      <label class="boton boton--secundario">
        Cambiar portada
        <input type="file" accept="image/*" hidden>
      </label>
    </div>
    <label class="campo"><span class="campo__etiqueta">Título</span><input class="campo__entrada" name="titulo" required maxlength="120"></label>
    <label class="campo"><span class="campo__etiqueta">Artista</span><input class="campo__entrada" name="artista" required maxlength="120"></label>
    <label class="campo"><span class="campo__etiqueta">Álbum</span><input class="campo__entrada" name="album" maxlength="120"></label>
    <label class="casilla" hidden><input type="checkbox" name="todas"> <span></span></label>
    <button class="boton boton--primario boton--ancho" type="submit">Guardar</button>`;

  const imagen = formulario.querySelector('.editor__imagen');
  const campos = formulario.elements;
  imagen.src = urlDePortada(cancion);
  campos.titulo.value = cancion.titulo;
  campos.artista.value = cancion.artista === SIN_ARTISTA ? '' : cancion.artista;
  campos.album.value = cancion.album ?? '';

  // Si hay otras canciones sin artista, ofrece ponerles el mismo de un jalón.
  const sinArtista = cancionesLocales.filter((c) => c.artista === SIN_ARTISTA && c.id !== cancion.id);
  const casilla = formulario.querySelector('.casilla');
  if (sinArtista.length) {
    casilla.hidden = false;
    casilla.querySelector('span').textContent = `Poner este artista también en las otras ${sinArtista.length} canciones sin artista`;
  }

  formulario.querySelector('input[type="file"]').addEventListener('change', async (evento) => {
    const archivo = evento.target.files[0];
    if (!archivo) return;
    try {
      nuevaPortada = await portadaDeImagen(archivo);
      imagen.src = URL.createObjectURL(new Blob([nuevaPortada.datos], { type: nuevaPortada.tipo }));
    } catch (error) {
      mostrarAviso(`No se pudo usar esa imagen: ${error.message}`, 5000);
    }
  });

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    cerrar();
    const artista = campos.artista.value.trim();
    const cambios = {
      titulo: campos.titulo.value.trim(),
      artista,
      album: campos.album.value.trim(),
      ...(nuevaPortada !== undefined && { portada: nuevaPortada }),
    };
    if (portadas.has(cancion.id) && nuevaPortada !== undefined) {
      URL.revokeObjectURL(portadas.get(cancion.id));
      portadas.delete(cancion.id);
    }
    await actualizarCancion({ ...cancion, ...cambios });
    if (campos.todas.checked) {
      for (const otra of sinArtista) await actualizarCancion({ ...otra, artista });
    }
    await recargarLista();
    mostrarAviso('Cambios guardados.', 2500);
  });

  const cerrar = abrirHoja({ titulo: 'Editar canción', contenido: formulario });
}

/* ---------- Vincular canciones ---------- */
// "A → B": cuando termina A (o pulsas siguiente), siempre suena B, en modo
// continuo o aleatorio. Sirve para canciones con transición pegada.

/** ¿Seguir la cadena desde "desde" llega a "hasta"? (para no hacer círculos) */
function cadenaLlegaA(desde, hasta) {
  const vistos = new Set();
  for (let c = desde; c && !vistos.has(c.id); c = porId(c.siguienteFija)) {
    if (c.id === hasta.id) return true;
    vistos.add(c.id);
  }
  return false;
}

function elegirVinculo(cancion) {
  const opciones = cancionesLocales.filter((c) => c.id !== cancion.id && !cadenaLlegaA(c, cancion));
  abrirHoja({
    titulo: '¿Qué canción va después?',
    subtitulo: `Después de "${cancion.titulo}" siempre sonará la que elijas.`,
    acciones: opciones.map((otra) => ({
      texto: `${otra.titulo} — ${otra.artista}`,
      alElegir: () => vincular(cancion, otra),
    })),
  });
}

async function vincular(cancion, siguiente) {
  // Una canción solo puede ir pegada detrás de una: si ya tenía otra antes, se suelta.
  if (siguiente) {
    for (const otra of cancionesLocales) {
      if (otra.siguienteFija === siguiente.id && otra.id !== cancion.id) {
        await actualizarCancion({ ...otra, siguienteFija: null });
      }
    }
  }
  await actualizarCancion({ ...cancion, siguienteFija: siguiente?.id ?? null });
  await recargarLista();
  mostrarAviso(siguiente
    ? `Listo: después de "${cancion.titulo}" siempre sonará "${siguiente.titulo}".`
    : `Se quitó el vínculo de "${cancion.titulo}".`, 4000);
}

/** Texto bajo el título: el artista, y si tiene vínculo, a qué canción lleva. */
function subtitulo(cancion) {
  const siguiente = cancion.siguienteFija && porId(cancion.siguienteFija);
  return siguiente ? `${cancion.artista}  ·  ⛓ luego "${siguiente.titulo}"` : cancion.artista;
}

async function agregarALista(lista, cancion) {
  if (lista.canciones.includes(cancion.id)) {
    mostrarAviso(`Ya está en "${lista.nombre}".`, 3000);
    return;
  }
  await guardarLista({ ...lista, canciones: [...lista.canciones, cancion.id] });
  await recargarLista();
  mostrarAviso(`Agregada a "${lista.nombre}".`, 3000);
}

/** Pide un nombre y crea la lista (con una canción adentro, si se da). */
function crearLista(cancionInicial) {
  abrirHoja({
    titulo: 'Nueva lista',
    entrada: {
      placeholder: 'Nombre (ej. Para el carro)',
      textoBoton: 'Crear lista',
      alAceptar: async (nombre) => {
        const lista = {
          id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
          nombre,
          canciones: cancionInicial ? [cancionInicial.id] : [],
          creada: Date.now(),
        };
        await guardarLista(lista);
        await recargarLista();
        mostrarAviso(cancionInicial ? `Lista "${nombre}" creada con "${cancionInicial.titulo}".` : `Lista "${nombre}" creada.`, 3000);
      },
    },
  });
}

/* ---------- Listas ---------- */

el.nuevaLista.addEventListener('click', () => crearLista(null));
el.volverListas.addEventListener('click', () => { listaAbierta = null; pintarListas(); });

/** Las canciones de una lista, en su orden (ignorando las que ya no existen). */
function cancionesDe(lista) {
  return lista.canciones.map((id) => cancionesLocales.find((c) => c.id === id)).filter(Boolean);
}

function pintarListas() {
  const abierta = listas.find((l) => l.id === listaAbierta);
  if (!abierta) listaAbierta = null;
  el.indiceListas.hidden = Boolean(abierta);
  el.detalleLista.hidden = !abierta;

  if (!abierta) {
    el.sinListas.hidden = listas.length > 0;
    el.listas.replaceChildren(...listas.map((lista) => {
      const canciones = cancionesDe(lista);
      const fila = crearFila(
        { id: lista.id, titulo: lista.nombre, artista: `${canciones.length} ${canciones.length === 1 ? 'canción' : 'canciones'}` },
        canciones[0] ? urlDePortada(canciones[0]) : 'icons/portada.png',
        botonMenu({ titulo: lista.nombre }, () => menuLista(lista)),
        () => { listaAbierta = lista.id; pintarListas(); },
      );
      return fila;
    }));
    return;
  }

  const canciones = cancionesDe(abierta);
  el.nombreLista.textContent = abierta.nombre;
  el.listaVacia.hidden = canciones.length > 0;
  el.reproducirLista.disabled = canciones.length === 0;
  el.cancionesLista.replaceChildren(...canciones.map((cancion, i) => {
    const menu = botonMenu(cancion, () => abrirHoja({
      titulo: cancion.titulo,
      subtitulo: cancion.artista,
      acciones: [{ texto: `Quitar de "${abierta.nombre}"`, alElegir: () => quitarDeLista(abierta, cancion) }],
    }));
    return crearFila(cancion, urlDePortada(cancion), menu, () => reproductor.reproducirLista(canciones, i), { arrastrable: true });
  }));
  marcarSonando(reproductor.estado().cancion);
}

/* ---------- Acomodar arrastrando ---------- */

activarArrastre(el.lista, async (ids) => {
  await guardarOrden(ids);
  await recargarLista();
});

activarArrastre(el.cancionesLista, async (ids) => {
  const lista = listas.find((l) => l.id === listaAbierta);
  if (!lista) return;
  // Las que no están en pantalla (canciones borradas) se quedan al final.
  const resto = lista.canciones.filter((id) => !ids.includes(id));
  await guardarLista({ ...lista, canciones: [...ids, ...resto] });
  await recargarLista();
  const actualizada = listas.find((l) => l.id === listaAbierta);
  if (actualizada) reproductor.refrescar(cancionesDe(actualizada));
});

el.reproducirLista.addEventListener('click', () => {
  const lista = listas.find((l) => l.id === listaAbierta);
  const canciones = lista ? cancionesDe(lista) : [];
  if (canciones.length) reproductor.reproducirLista(canciones, 0);
});

el.opcionesLista.addEventListener('click', () => {
  const lista = listas.find((l) => l.id === listaAbierta);
  if (lista) menuLista(lista);
});

async function quitarDeLista(lista, cancion) {
  await guardarLista({ ...lista, canciones: lista.canciones.filter((id) => id !== cancion.id) });
  await recargarLista();
}

function menuLista(lista) {
  abrirHoja({
    titulo: lista.nombre,
    acciones: [
      {
        texto: 'Cambiar nombre',
        alElegir: () => abrirHoja({
          titulo: 'Cambiar nombre',
          entrada: {
            placeholder: 'Nombre de la lista',
            valor: lista.nombre,
            textoBoton: 'Guardar',
            alAceptar: async (nombre) => {
              await guardarLista({ ...lista, nombre });
              await recargarLista();
            },
          },
        }),
      },
      {
        texto: 'Borrar lista',
        peligro: true,
        alElegir: () => confirmar({
          titulo: `¿Borrar la lista "${lista.nombre}"?`,
          subtitulo: 'Las canciones se quedan en Descargadas.',
          textoBoton: 'Borrar lista',
          alConfirmar: async () => {
            await borrarLista(lista.id);
            if (listaAbierta === lista.id) listaAbierta = null;
            await recargarLista();
          },
        }),
      },
    ],
  });
}

/**
 * Una fila de canción: portada, título, artista y un botón a la derecha.
 * Con arrastrable, lleva a la izquierda la agarradera ⋮⋮ para acomodarla.
 */
function crearFila(cancion, portada, boton, alTocar, { arrastrable = false } = {}) {
  const li = document.createElement('li');
  li.className = 'cancion';
  li.dataset.id = cancion.id;

  if (arrastrable) {
    const agarradera = document.createElement('span');
    agarradera.className = 'cancion__arrastre';
    agarradera.setAttribute('aria-label', 'Arrastra para mover');
    agarradera.textContent = '⋮⋮';
    li.append(agarradera);
  }

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
  // Las canciones del teléfono muestran también su vínculo, si tienen.
  info.children[1].textContent = cancion.agregada ? subtitulo(cancion) : cancion.artista;

  li.append(img, info, boton);
  li.addEventListener('click', alTocar);
  return li;
}

function urlDePortada(cancion) {
  if (!cancion.portada) return 'icons/portada.png';
  if (!portadas.has(cancion.id)) {
    portadas.set(cancion.id, URL.createObjectURL(new Blob([cancion.portada.datos], { type: cancion.portada.tipo })));
  }
  return portadas.get(cancion.id);
}

// Libera la memoria de las portadas de canciones que ya se borraron.
function liberarPortadasHuerfanas() {
  const vivas = new Set(cancionesLocales.map((c) => c.id));
  for (const [id, url] of portadas) {
    if (!vivas.has(id)) {
      URL.revokeObjectURL(url);
      portadas.delete(id);
    }
  }
}

function marcarSonando(cancion) {
  for (const li of [...el.lista.children, ...el.cancionesLista.children, ...el.listaServidor.children]) {
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
  el.vistaListas.hidden = vista !== 'listas';
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

el.desconectar.addEventListener('click', () => confirmar({
  titulo: '¿Desconectar tu PC?',
  subtitulo: 'Las canciones descargadas se quedan en el teléfono.',
  textoBoton: 'Desconectar',
  alConfirmar: () => {
    servidor.desconectar();
    cancionesServidor = visiblesServidor = [];
    el.listaServidor.replaceChildren();
    abrirServidor();
  },
}));

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

  pintarBotonDescargarTodas();
  marcarSonando(reproductor.estado().cancion);
}

/* ---------- Descargar todas ---------- */

// null cuando no hay descarga masiva; si no, su progreso.
let descargaMasiva = null;

/** Las canciones visibles (respetando el buscador) que faltan en el teléfono. */
const pendientes = () => visiblesServidor.filter((c) => !localDe(c));

const mb = (bytes) => Math.max(1, Math.round(bytes / 1024 / 1024));

function pintarBotonDescargarTodas() {
  const boton = el.descargarTodas;
  if (descargaMasiva) {
    boton.hidden = false;
    boton.textContent = `Descargando ${descargaMasiva.hechas + 1} de ${descargaMasiva.total}… · Detener`;
    return;
  }
  const faltan = pendientes();
  boton.hidden = faltan.length === 0;
  const peso = faltan.reduce((suma, c) => suma + c.tamano, 0);
  const alcance = el.buscar.value.trim() ? 'estas' : 'todas';
  boton.textContent = `⬇ Descargar ${alcance} (${faltan.length}${peso ? ` · ${mb(peso)} MB` : ''})`;
}

el.descargarTodas.addEventListener('click', async () => {
  if (descargaMasiva) {
    descargaMasiva.cancelar = true;
    return;
  }
  const faltan = pendientes();
  if (!faltan.length) return;

  // ¿Cabe en el teléfono?
  const peso = faltan.reduce((suma, c) => suma + c.tamano, 0);
  const espacio = await espacioUsado();
  if (espacio && peso > espacio.total - espacio.usado) {
    mostrarAviso(`No cabe: necesitas ${mb(peso)} MB y quedan ${mb(espacio.total - espacio.usado)} MB. Usa el buscador para bajar menos.`, 8000);
    return;
  }

  confirmar({
    titulo: `¿Descargar ${faltan.length} ${faltan.length === 1 ? 'canción' : 'canciones'}?`,
    subtitulo: `${peso ? `Son unos ${mb(peso)} MB. ` : ''}Deja Muz15 abierta hasta que termine; la pantalla se mantiene encendida mientras tanto.`,
    textoBoton: 'Descargar',
    alConfirmar: () => descargarVarias(faltan),
  });
});

async function descargarVarias(canciones) {
  descargaMasiva = { hechas: 0, total: canciones.length, fallidas: 0, cancelar: false };
  // Mantiene la pantalla encendida para que Android no pause la descarga.
  const bloqueo = await navigator.wakeLock?.request('screen').catch(() => null);

  for (const cancion of canciones) {
    if (descargaMasiva.cancelar) break;
    pintarBotonDescargarTodas();
    if (!localDe(cancion)) {
      const bien = await descargarDelServidor(cancion, { silencioso: true });
      if (!bien) descargaMasiva.fallidas++;
    }
    descargaMasiva.hechas++;
  }

  const { hechas, total, fallidas, cancelar } = descargaMasiva;
  descargaMasiva = null;
  bloqueo?.release();
  pintarListaServidor();

  const bajadas = hechas - fallidas;
  let mensaje = cancelar ? `Detenido: ${bajadas} de ${total} descargadas.` : `Listo: ${bajadas} ${bajadas === 1 ? 'canción descargada' : 'canciones descargadas'}.`;
  if (fallidas) mensaje += ` ${fallidas} fallaron (puedes volver a intentarlo).`;
  mostrarAviso(mensaje, 6000);
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

/** @returns {Promise<boolean>} true si se guardó bien */
async function descargarDelServidor(cancion, { silencioso = false } = {}) {
  let bien = false;
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
    bien = true;
    if (!silencioso) mostrarAviso(`"${cancion.titulo}" ya está en el teléfono.`, 3000);
    pedirAlmacenamientoPersistente();
  } catch (error) {
    console.error('Descarga fallida:', cancion.titulo, error);
    if (!silencioso) mostrarAviso(`No se pudo descargar "${cancion.titulo}": ${error.message}`, 6000);
  } finally {
    descargando.delete(cancion.idServidor);
    await recargarLista();
  }
  return bien;
}

/* ---------- Reproductor ---------- */

function pintarReproductor({ cancion, sonando, aleatorio, urlPortada }) {
  el.aleatorio.setAttribute('aria-pressed', String(aleatorio));
  el.aleatorio.setAttribute('aria-label', `Modo aleatorio: ${aleatorio ? 'encendido' : 'apagado'}`);
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

// Aleatorio / continuo. Se recuerda para la próxima vez que abras la app.
const CLAVE_ALEATORIO = 'muz15-aleatorio';
el.aleatorio.addEventListener('click', () => {
  const activar = !reproductor.estado().aleatorio;
  reproductor.cambiarAleatorio(activar);
  try { localStorage.setItem(CLAVE_ALEATORIO, activar ? '1' : '0'); } catch { /* nada */ }
  mostrarAviso(activar ? 'Modo aleatorio' : 'Modo continuo: en orden', 2000);
});
try {
  if (localStorage.getItem(CLAVE_ALEATORIO) === '1') reproductor.cambiarAleatorio(true);
} catch { /* nada */ }
el.anterior.addEventListener('click', () => reproductor.anterior());

// Barra de progreso: se mueve sola y también sirve para saltar a otra parte.
let arrastrando = false;
function pintarProgreso({ actual, duracion }) {
  if (arrastrando) return;
  el.progreso.max = duracion;
  el.progreso.value = actual;
}
el.progreso.addEventListener('input', () => { arrastrando = true; });
el.progreso.addEventListener('change', () => {
  reproductor.irA(Number(el.progreso.value));
  arrastrando = false;
});

/* ---------- Enviar a mi PC ---------- */
// Cuando usas Muz15 en la computadora, lo que importas vive solo en ese navegador.
// Este botón copia las canciones a la carpeta de Navidrome (C:\Music\Desde Muz15)
// para que aparezcan en el celular, en la pestaña Mi PC. Solo existe en la PC,
// porque lo atiende tools/servidor.mjs.

fetch('api/estado')
  .then((respuesta) => (respuesta.ok ? respuesta.json() : null))
  .then((estado) => { el.enviarPC.hidden = !estado?.enviarAPC; })
  .catch(() => { /* en el celular no existe: el botón se queda oculto */ });

/** Nombre del archivo en la PC: "Artista - Título.ext", con lo que editaste aquí. */
function nombreParaPC(cancion) {
  const extension = (cancion.nombreArchivo?.match(/\.[^.]+$/)?.[0] ?? '.mp3').toLowerCase();
  const base = cancion.artista && cancion.artista !== SIN_ARTISTA ? `${cancion.artista} - ${cancion.titulo}` : cancion.titulo;
  return base + extension;
}

el.enviarPC.addEventListener('click', async () => {
  // Las que bajaste de Mi PC ya están allá.
  const propias = cancionesLocales.filter((c) => !c.idServidor);
  if (!propias.length) return mostrarAviso('No hay canciones para enviar.', 3000);
  el.enviarPC.disabled = true;
  let nuevas = 0;
  let yaEstaban = 0;
  let fallidas = 0;
  for (const [i, cancion] of propias.entries()) {
    el.enviarPC.textContent = `Enviando ${i + 1} de ${propias.length}…`;
    try {
      const respuesta = await fetch(`api/subir?nombre=${encodeURIComponent(nombreParaPC(cancion))}`, {
        method: 'POST',
        body: await obtenerAudio(cancion),
      });
      const resultado = await respuesta.json();
      if (!respuesta.ok) throw new Error(resultado.error);
      if (resultado.ya) yaEstaban++;
      else nuevas++;
    } catch (error) {
      console.error('No se pudo enviar', cancion.titulo, error);
      fallidas++;
    }
  }
  el.enviarPC.disabled = false;
  el.enviarPC.textContent = '⇪ Enviar estas canciones a mi PC (para verlas en el cel)';
  let mensaje = `${nuevas} enviadas a C:\\Music`;
  if (yaEstaban) mensaje += `, ${yaEstaban} ya estaban`;
  if (fallidas) mensaje += `, ${fallidas} fallaron`;
  mostrarAviso(`${mensaje}. En un par de minutos aparecen en tu cel, en la pestaña Mi PC.`, 8000);
});

/* ---------- Actualizaciones de la APK ---------- */
// Las pantallas y la lógica se actualizan solas (la APK carga esta página de GitHub).
// Solo cuando cambia la parte nativa hay una APK nueva: aquí avisamos y la bajas
// con un toque. Se instala ENCIMA de la anterior, sin perder nada.

const REPO = 'areijond-bit/Muz15';
const DESCARGA_APK = `https://github.com/${REPO}/releases/latest/download/Muz15.apk`;
let versionApk = null; // { numero, nombre } de la APK instalada

async function revisarActualizacion() {
  if (!esApk || !AppNativa) return;
  try {
    const info = await AppNativa.getInfo();
    versionApk = { numero: Number(info.build), nombre: info.version };
    const ultima = await (await fetch(`https://api.github.com/repos/${REPO}/releases/latest`)).json();
    const numeroUltima = Number(String(ultima.tag_name ?? '').replace(/\D/g, ''));
    if (numeroUltima > versionApk.numero) {
      abrirHoja({
        titulo: 'Hay una versión nueva de Muz15',
        subtitulo: 'Se instala encima de la que tienes: no pierdes tus canciones ni tus listas.',
        acciones: [{
          texto: '⬇ Descargar e instalar',
          // Se abre en el navegador, que baja la APK; luego tócala para instalar.
          alElegir: () => { location.href = DESCARGA_APK; },
        }],
      });
    }
  } catch (error) {
    console.warn('No se pudo revisar si hay versión nueva:', error.message);
  }
}
revisarActualizacion();

/* ---------- Ajustes ---------- */

// Transición entre canciones: 0 = sin pausa (cambio instantáneo); si no, segundos de fundido.
const CLAVE_FUNDIDO = 'muz15-fundido';
const OPCIONES_FUNDIDO = [
  { segundos: 0, texto: 'Sin pausa (pegadas)' },
  { segundos: 3, texto: 'Fundido de 3 s' },
  { segundos: 6, texto: 'Fundido de 6 s' },
  { segundos: 10, texto: 'Fundido de 10 s' },
];

try {
  const guardado = Number(localStorage.getItem(CLAVE_FUNDIDO));
  if (guardado > 0) reproductor.cambiarFundido(guardado);
} catch { /* nada */ }

el.ajustes.addEventListener('click', () => {
  const version = versionApk ? `Muz15 APK ${versionApk.nombre}` : undefined;
  abrirHoja({
    titulo: 'Ajustes',
    subtitulo: version,
    acciones: [
      { texto: `🎚 Ecualizador${estadoEq.activo ? `  ·  ${nombrePerfil()}` : ''}`, alElegir: abrirEcualizador },
      { texto: '⇄ Transición entre canciones', alElegir: elegirTransicion },
      { texto: '🧹 Quitar canciones repetidas', alElegir: quitarRepetidas },
    ],
  });
});

/* ---------- Quitar repetidas ---------- */
// Dos canciones son "la misma" si su título coincide quitando lo que va entre
// paréntesis, como "(Remasterizado 2007)" o "(1)", y no tienen artistas distintos.
// De cada grupo se queda la mejor copia: la que tiene artista, luego la que está
// en una lista o vinculada, luego la que tiene portada, y si no la más antigua.

const ARTISTAS_DESCONOCIDOS = new Set([SIN_ARTISTA, '[Unknown Artist]', '']);
const tituloBase = (titulo) => normalizar(titulo).replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const enAlgunaLista = (c) => listas.some((l) => l.canciones.includes(c.id));
const estaVinculada = (c) => Boolean(c.siguienteFija) || cancionesLocales.some((o) => o.siguienteFija === c.id);

function buscarRepetidas() {
  const grupos = new Map();
  for (const cancion of cancionesLocales) {
    const clave = tituloBase(cancion.titulo);
    if (!clave) continue;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(cancion);
  }

  const resultado = [];
  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue;
    // Mismo nombre pero artistas distintos y conocidos: son canciones diferentes.
    const artistas = new Set(grupo.map((c) => c.artista).filter((a) => !ARTISTAS_DESCONOCIDOS.has(a)).map(normalizar));
    if (artistas.size > 1) continue;
    // Las listas y vínculos se pasan a la copia que queda, así que pesa más tener artista.
    const puntos = (c) => (ARTISTAS_DESCONOCIDOS.has(c.artista) ? 0 : 4)
      + (enAlgunaLista(c) ? 2 : 0) + (estaVinculada(c) ? 2 : 0) + (c.portada ? 1 : 0);
    const ordenadas = [...grupo].sort((a, b) => puntos(b) - puntos(a) || a.agregada - b.agregada);
    resultado.push({ queda: ordenadas[0], sobran: ordenadas.slice(1) });
  }
  return resultado;
}

function quitarRepetidas() {
  const repetidas = buscarRepetidas();
  const total = repetidas.reduce((suma, r) => suma + r.sobran.length, 0);
  if (!total) return mostrarAviso('No hay canciones repetidas en este teléfono.', 3000);

  const resumen = document.createElement('ul');
  resumen.className = 'repetidas';
  for (const { queda, sobran } of repetidas) {
    const li = document.createElement('li');
    li.innerHTML = '<strong></strong><span></span>';
    li.children[0].textContent = `${queda.titulo} — ${queda.artista}`;
    li.children[1].textContent = sobran.length === 1 ? 'se borra 1 copia' : `se borran ${sobran.length} copias`;
    resumen.append(li);
  }

  abrirHoja({
    titulo: `${total} ${total === 1 ? 'canción repetida' : 'canciones repetidas'}`,
    subtitulo: 'Se queda la copia de cada una que aparece abajo; tus listas y vínculos pasan a esa copia.',
    contenido: resumen,
    acciones: [{
      texto: `Borrar ${total} ${total === 1 ? 'repetida' : 'repetidas'}`,
      peligro: true,
      alElegir: () => borrarRepetidas(repetidas, total),
    }],
  });
}

async function borrarRepetidas(repetidas, total) {
  for (const { queda, sobran } of repetidas) {
    const idsSobran = new Set(sobran.map((c) => c.id));
    // Las listas apuntan ahora a la copia que se queda (sin repetirla en la lista).
    for (const lista of listas) {
      if (!lista.canciones.some((id) => idsSobran.has(id))) continue;
      // También en memoria, para que el siguiente grupo parta de la lista ya corregida.
      lista.canciones = [...new Set(lista.canciones.map((id) => (idsSobran.has(id) ? queda.id : id)))];
      await guardarLista({ ...lista });
    }
    // Y los vínculos también.
    for (const otra of cancionesLocales) {
      if (!idsSobran.has(otra.siguienteFija)) continue;
      otra.siguienteFija = otra.id === queda.id ? null : queda.id; // nunca vinculada consigo misma
      await actualizarCancion({ ...otra });
    }
    const vinculoHeredado = !queda.siguienteFija && sobran.find((c) => c.siguienteFija && c.siguienteFija !== queda.id);
    if (vinculoHeredado) {
      queda.siguienteFija = vinculoHeredado.siguienteFija;
      await actualizarCancion({ ...queda });
    }

    for (const sobra of sobran) {
      await borrarCancion(sobra.id);
      reproductor.quitar(sobra.id);
    }
  }
  await recargarLista();
  mostrarAviso(`Listo: se borraron ${total} ${total === 1 ? 'canción repetida' : 'canciones repetidas'}.`, 4000);
}

function elegirTransicion() {
  const actual = reproductor.estado().fundido;
  abrirHoja({
    titulo: 'Transición entre canciones',
    subtitulo: 'Las canciones vinculadas (⛓) siempre van pegadas, sin fundido.',
    acciones: OPCIONES_FUNDIDO.map(({ segundos, texto }) => ({
      texto: segundos === actual ? `${texto}  ✓` : texto,
      alElegir: () => {
        reproductor.cambiarFundido(segundos);
        try { localStorage.setItem(CLAVE_FUNDIDO, String(segundos)); } catch { /* nada */ }
        mostrarAviso(`Transición: ${texto.toLowerCase()}`, 2500);
      },
    })),
  });
}

/* ---------- Ecualizador ---------- */

const ecualizador = crearEcualizador([el.audio, el.audio2]);
const CLAVE_EQ = 'muz15-ecualizador';
let estadoEq = { activo: false, perfil: 'plano', ganancias: [...PERFILES.plano.ganancias] };
try {
  const guardado = JSON.parse(localStorage.getItem(CLAVE_EQ));
  if (guardado?.ganancias?.length === BANDAS.length) estadoEq = guardado;
} catch { /* nada */ }

const nombrePerfil = () => PERFILES[estadoEq.perfil]?.nombre ?? 'Personalizado';
const etiquetaHz = (hz) => (hz >= 1000 ? `${hz / 1000}k` : String(hz));

function guardarEq() {
  try { localStorage.setItem(CLAVE_EQ, JSON.stringify(estadoEq)); } catch { /* nada */ }
  ecualizador.aplicar(estadoEq.activo ? estadoEq.ganancias : BANDAS.map(() => 0));
}

// El navegador solo deja encender el procesador de audio tras un toque; si el
// ecualizador quedó activado de la vez pasada, se conecta en el primer toque.
if (estadoEq.activo) {
  ecualizador.aplicar(estadoEq.ganancias);
  document.addEventListener('pointerdown', () => ecualizador.conectar(), { once: true, capture: true });
}

function abrirEcualizador() {
  const panel = document.createElement('div');
  panel.className = 'eq';
  panel.innerHTML = `
    <label class="eq__interruptor">
      <span>Ecualizador</span>
      <input type="checkbox" role="switch">
    </label>
    <div class="eq__grafica">
      <svg class="eq__curva" viewBox="0 0 800 300" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1="150" x2="800" y2="150"/>
        <path/>
      </svg>
      <div class="eq__bandas"></div>
    </div>
    <div class="eq__perfiles"></div>`;

  const interruptor = panel.querySelector('input[role="switch"]');
  const bandas = panel.querySelector('.eq__bandas');
  const curva = panel.querySelector('.eq__curva path');
  const perfiles = panel.querySelector('.eq__perfiles');

  // Una barra vertical por banda: arriba = más fuerte, abajo = más bajito.
  const controles = BANDAS.map((hz, i) => {
    const columna = document.createElement('label');
    columna.className = 'eq__banda';
    columna.innerHTML = `<span class="eq__valor"></span><input type="range" min="-${MAXIMO_DB}" max="${MAXIMO_DB}" step="0.5" aria-label="${etiquetaHz(hz)} Hz"><span class="eq__hz">${etiquetaHz(hz)}</span>`;
    const barra = columna.querySelector('input');
    barra.addEventListener('input', () => {
      estadoEq.ganancias[i] = Number(barra.value);
      estadoEq.perfil = 'personalizado';
      if (!estadoEq.activo) encender();
      guardarEq();
      pintar();
    });
    bandas.append(columna);
    return { barra, valor: columna.querySelector('.eq__valor') };
  });

  for (const [clave, { nombre, ganancias }] of Object.entries(PERFILES)) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'eq__perfil';
    boton.dataset.perfil = clave;
    boton.textContent = nombre;
    boton.addEventListener('click', () => {
      estadoEq = { ...estadoEq, perfil: clave, ganancias: [...ganancias] };
      if (!estadoEq.activo && clave !== 'plano') encender();
      guardarEq();
      pintar();
    });
    perfiles.append(boton);
  }

  function encender() {
    ecualizador.conectar(); // estamos dentro de un toque: el navegador lo permite
    estadoEq.activo = true;
  }

  interruptor.addEventListener('change', () => {
    if (interruptor.checked) encender();
    else estadoEq.activo = false;
    guardarEq();
    pintar();
  });

  // Curva suave que pasa por los 8 puntos (como en los ecualizadores de audífonos).
  function dibujarCurva() {
    const puntos = estadoEq.ganancias.map((g, i) => [
      ((i + 0.5) / BANDAS.length) * 800,
      150 - (g / MAXIMO_DB) * 140,
    ]);
    let d = `M0,${puntos[0][1]} L${puntos[0][0]},${puntos[0][1]}`;
    for (let i = 1; i < puntos.length; i++) {
      const [x0, y0] = puntos[i - 1];
      const [x1, y1] = puntos[i];
      const medio = (x0 + x1) / 2;
      d += ` C${medio},${y0} ${medio},${y1} ${x1},${y1}`;
    }
    d += ` L800,${puntos.at(-1)[1]}`;
    curva.setAttribute('d', d);
  }

  function pintar() {
    interruptor.checked = estadoEq.activo;
    panel.classList.toggle('eq--apagado', !estadoEq.activo);
    controles.forEach(({ barra, valor }, i) => {
      barra.value = estadoEq.ganancias[i];
      const g = estadoEq.ganancias[i];
      valor.textContent = g > 0 ? `+${g}` : String(g);
    });
    for (const boton of perfiles.children) {
      boton.classList.toggle('eq__perfil--activo', boton.dataset.perfil === estadoEq.perfil);
    }
    dibujarCurva();
  }

  pintar();
  abrirHoja({
    titulo: 'Ecualizador',
    subtitulo: 'Izquierda = bajos · centro = guitarra y voz · derecha = brillo y platillos.',
    contenido: panel,
  });
}

/* ---------- Avisos ---------- */

let temporizadorAviso;
function mostrarAviso(texto, ocultarEnMs) {
  clearTimeout(temporizadorAviso);
  el.aviso.textContent = texto;
  el.aviso.hidden = false;
  if (ocultarEnMs) temporizadorAviso = setTimeout(() => { el.aviso.hidden = true; }, ocultarEnMs);
}

/* ---------- Arranque ---------- */

// Actualizaciones de la app: el teléfono guarda una copia para funcionar sin
// internet. Al abrir (o volver a) Muz15 revisamos si hay versión nueva; cuando
// termina de bajar, recargamos solos si no suena nada, o avisamos si está sonando.
if ('serviceWorker' in navigator) {
  const habiaVersion = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.register('sw.js')
    .then((registro) => {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registro.update().catch(() => {});
      });
    })
    .catch((error) => console.error('Service worker:', error));

  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!habiaVersion || recargando) return; // primera instalación: no hace falta recargar
    const aplicar = () => { recargando = true; location.reload(); };
    if (!reproductor.estado().sonando) return aplicar();
    abrirHoja({
      titulo: 'Hay mejoras nuevas en Muz15',
      subtitulo: 'Se aplican en un segundo (la canción se detiene).',
      acciones: [{ texto: '⟳ Actualizar ahora', alElegir: aplicar }],
    });
  });
}

recargarLista().catch((error) => {
  console.error(error);
  mostrarAviso(`No se pudo abrir la biblioteca: ${error.message}`);
});
