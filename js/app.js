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
