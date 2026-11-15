// app.js — Une todo: importar archivos, pintar la lista y conectar los botones.

import {
  guardarCancion, listarCanciones, obtenerAudio, borrarCancion, pedirAlmacenamientoPersistente, espacioUsado,
  listarListas, guardarLista as guardarListaEnTelefono, borrarLista as borrarListaEnTelefono,
  actualizarCancion, guardarOrden, liberarAudio, tieneAudio,
} from './db.js';
import { activarArrastre } from './arrastrar.js';
import { leerMetadatos } from './metadatos.js';
import { crearReproductor } from './reproductor.js';
import { crearReproductorNativo } from './reproductor-nativo.js';
import {
  hayReproductorNativo, Reproductor, rutaAudio, rutaPortada, urlDe, trasladar, liberarCopias,
  borrar as borrarArchivo,
} from './archivos.js';
import * as servidor from './servidor.js';
import { abrirHoja, confirmar } from './hoja.js';
import { esApk, AppNativa } from './nativo.js';
import { crearEcualizador, BANDAS, PERFILES, MAXIMO_DB, OPCIONES_TOPE_DB } from './ecualizador.js';

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
  listasPC: $('listas-pc'),
  tituloListasTelefono: $('titulo-listas-telefono'),
  refrescar: $('refrescar'),
  refrescarTexto: $('refrescar-texto'),
  buscarListas: $('buscar-listas'),
  estadoListasPC: $('estado-listas-pc'),
  listasServidor: $('listas-servidor'),
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

// En la APK nueva suena el reproductor nativo de Android (sigue aunque cierres la
// app); en el navegador y en APKs viejas, el reproductor de la página.
const reproductor = hayReproductorNativo
  ? crearReproductorNativo({
    fuente: fuenteNativa,
    alProgreso: pintarProgreso,
    alCambiar: pintarReproductor,
    alFallar: (mensaje) => mostrarAviso(mensaje, 5000),
  })
  : crearReproductor([el.audio, el.audio2], {
    alProgreso: pintarProgreso,
    obtenerFuente,
    alCambiar: pintarReproductor,
    alFallar: (mensaje) => mostrarAviso(mensaje, 5000),
  });

const PORTADA_POR_DEFECTO = new URL('icons/portada.png', location.href).href;

/**
 * Para el reproductor nativo: de dónde sacar el audio y la portada.
 * Del teléfono → archivo; de Mi PC sin descargar → tu servidor.
 */
async function fuenteNativa(cancion) {
  if (cancion.origen === 'servidor') {
    const local = localDe(cancion);
    if (!local) {
      const portada = servidor.urlPortada(cancion) ?? PORTADA_POR_DEFECTO;
      return { url: servidor.urlAudio(cancion), portada, portadaPantalla: portada };
    }
    cancion = local;
  }
  if (!cancion.enArchivo) await asegurarArchivos(); // por si aún no se trasladó
  return {
    url: await urlDe(rutaAudio(cancion)),
    portada: cancion.portada ? await urlDe(rutaPortada(cancion)) : PORTADA_POR_DEFECTO,
    portadaPantalla: urlDePortada(cancion),
  };
}

/* ---------- Canciones como archivos (APK con reproductor nativo) ---------- */
// Las canciones nuevas (importadas o bajadas) y las de antes se pasan a archivos
// del teléfono para que el reproductor nativo pueda leerlas. Solo una vez cada una.

let trasladando = null;
const CLAVE_COPIAS_LIBERADAS = 'muz15-copias-liberadas';
function asegurarArchivos() {
  if (!hayReproductorNativo) return Promise.resolve();
  if (!trasladando) {
    trasladando = (async () => {
      const pendientes = cancionesLocales.filter((c) => !c.enArchivo);
      if (pendientes.length) {
        const muchas = pendientes.length > 3;
        await trasladar(pendientes, {
          obtenerAudio,
          actualizarCancion,
          liberarAudio, // ya a salvo como archivo: no ocupa doble espacio
          alAvanzar: (i, total) => {
            if (muchas) mostrarAviso(`Preparando tus canciones para el reproductor nuevo: ${i} de ${total}…`);
          },
        });
        cancionesLocales = await listarCanciones();
        if (muchas) mostrarAviso('Listo: tus canciones ya están en el reproductor nuevo.', 4000);
      }
      // Las que se trasladaron antes (con la APK 1.6) todavía tienen la copia de la
      // página: se libera, solo si su archivo está bien.
      if (!localStorage.getItem(CLAVE_COPIAS_LIBERADAS)) {
        const liberadas = await liberarCopias(cancionesLocales, { tieneCopia: tieneAudio, liberarAudio });
        try { localStorage.setItem(CLAVE_COPIAS_LIBERADAS, '1'); } catch { /* nada */ }
        if (liberadas) {
          mostrarAviso(`Se liberó el espacio doble de ${liberadas} canciones.`, 4000);
          pintarEspacio();
        }
      }
    })().finally(() => { trasladando = null; });
  }
  return trasladando;
}

/** Borra la canción de la biblioteca y, en la APK nueva, también sus archivos. */
async function borrarCancionCompleta(cancion) {
  await borrarCancion(cancion.id);
  if (hayReproductorNativo) {
    await borrarArchivo(rutaAudio(cancion));
    await borrarArchivo(rutaPortada(cancion));
  }
}

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
  // Por si cambiaron títulos, orden o vínculos de lo que está sonando.
  const listaSonando = listas.find((l) => l.id === listaQueSuena);
  reproductor.refrescar(listaSonando ? cancionesParaReproducir(listaSonando) : cancionesLocales);
  pintarLista(cancionesLocales);
  pintarListas();
  pintarEspacio();
  if (cancionesServidor.length) pintarListaServidor(); // actualiza los ✓ de descargadas
  programarRespaldo();
  // APK nueva: las canciones recién importadas o bajadas pasan a archivos del teléfono.
  if (hayReproductorNativo && cancionesLocales.some((c) => !c.enArchivo)) asegurarArchivos();
}

/* ---------- Respaldo de tus descargas en tu PC ---------- */
// Cada dispositivo guarda en tu servidor una lista privada y oculta con lo que
// tiene descargado ("Muz15 · Descargas (…)"). Si un día este teléfono aparece
// vacío (por la razón que sea), Muz15 ofrece bajarlo todo de nuevo con un toque.

const PREFIJO_RESPALDO = 'Muz15 · Descargas';
// Las listas internas de Muz15 (respaldo, diagnóstico) empiezan con "Muz15 · " y no se muestran.
const esRespaldo = (album) => album.nombre.startsWith('Muz15 · ');
const modeloTelefono = navigator.userAgent.match(/Android [^;)]+; ([^;)]+?)(?: Build|\))/)?.[1]?.trim();
const nombreRespaldo = `${PREFIJO_RESPALDO} (${[modeloTelefono, esApk ? 'APK' : 'navegador'].filter(Boolean).join(' · ')})`;
let temporizadorRespaldo;

function programarRespaldo() {
  clearTimeout(temporizadorRespaldo);
  temporizadorRespaldo = setTimeout(respaldarDescargas, 3000);
}

async function respaldarDescargas() {
  const ids = cancionesLocales.map((c) => c.idServidor).filter(Boolean);
  // Nunca guardamos un respaldo vacío: si el teléfono quedó vacío, el respaldo
  // anterior es justo lo que sirve para recuperarlo.
  if (!ids.length || !servidor.configuracion()) return;
  try {
    const existente = (await servidor.listarPlaylists()).find((p) => p.nombre === nombreRespaldo);
    await servidor.guardarPlaylist({ idServidor: existente?.idServidor, nombre: nombreRespaldo, idsCanciones: ids, publico: false });
  } catch (error) {
    console.warn('No se pudo respaldar la lista de descargas:', error.message);
  }
}

/* ---------- Registro de diagnóstico ---------- */
// Cada vez que se abre Muz15 anota en tu servidor (lista oculta "Muz15 · Diagnóstico")
// qué encontró guardado en el teléfono. Sirve para averiguar por qué un teléfono
// pierde sus descargas: se ve en qué apertura bajaron a 0 y qué más cambió.

const CLAVE_INSTALACION = 'muz15-instalacion';
const MAXIMO_REGISTROS = 40;

async function registrarDiagnostico() {
  if (!servidor.configuracion()) return;
  try {
    // Un id que vive en el almacenamiento: si cambia, el teléfono borró los datos de la app.
    let instalacion = localStorage.getItem(CLAVE_INSTALACION);
    const instalacionNueva = !instalacion;
    if (!instalacion) {
      instalacion = Math.random().toString(36).slice(2, 8);
      localStorage.setItem(CLAVE_INSTALACION, instalacion);
    }
    const espacio = await espacioUsado();
    const registro = {
      t: new Date().toISOString(),
      inst: instalacion,
      instNueva: instalacionNueva,
      apk: esApk ? (versionApk?.nombre ?? 'sí') : 'no',
      app: await versionWeb(),
      url: location.href,
      canciones: cancionesLocales.length,
      listas: listas.length,
      persistente: await navigator.storage?.persisted?.().catch(() => null) ?? null,
      usadoMB: espacio ? Math.round(espacio.usado / 1048576) : null,
      totalMB: espacio ? Math.round(espacio.total / 1048576) : null,
      bases: await indexedDB.databases?.().then((d) => d.map((x) => `${x.name}@${x.version}`)).catch(() => null) ?? null,
      // APK con reproductor nativo: estado de los efectos (ecualizador, eco, volumen seguro).
      nativo: hayReproductorNativo ? await Reproductor.diagnostico?.().catch((e) => ({ error: e.message })) ?? null : null,
      eq: estadoEq.activo ? estadoEq.ganancias : null,
      tope: volumenSeguro.activo ? `${volumenSeguro.db}/${volumenSeguro.referencia}` : null,
      eco: estadoEco.activo,
    };
    const nombre = `Muz15 · Diagnóstico (${[modeloTelefono, esApk ? 'APK' : 'navegador'].filter(Boolean).join(' · ')})`;
    const existente = (await servidor.listarPlaylists()).find((p) => p.nombre === nombre);
    let historial = [];
    if (existente) {
      try { historial = JSON.parse(await servidor.leerComentario(existente.idServidor)); } catch { historial = []; }
    }
    historial = [...historial, registro].slice(-MAXIMO_REGISTROS);
    await servidor.guardarComentario({ idServidor: existente?.idServidor, nombre, comentario: JSON.stringify(historial) });
  } catch (error) {
    console.warn('No se pudo guardar el diagnóstico:', error.message);
  }
}

/** Si este teléfono no tiene canciones pero hay un respaldo en tu PC, ofrece recuperarlas. */
async function ofrecerRecuperacion() {
  if (cancionesLocales.length || !servidor.configuracion()) return;
  try {
    const respaldos = (await servidor.listarPlaylists()).filter((p) => p.nombre.startsWith(PREFIJO_RESPALDO) && p.total > 0);
    if (!respaldos.length) return;
    // El de este mismo dispositivo primero; si no, el más grande.
    respaldos.sort((a, b) => (b.nombre === nombreRespaldo) - (a.nombre === nombreRespaldo) || b.total - a.total);
    abrirHoja({
      titulo: 'Este teléfono no tiene canciones',
      subtitulo: 'Tu PC guardó la lista de lo que tenías descargado. ¿Lo bajo todo de nuevo?',
      acciones: respaldos.map((r) => ({
        texto: `⬇ Recuperar ${r.total} canciones — ${r.nombre.replace(PREFIJO_RESPALDO, '').trim() || 'respaldo'}`,
        alElegir: async () => {
          const canciones = await servidor.cancionesDePlaylist(r.idServidor);
          await asegurarBibliotecaServidor();
          descargarVarias(canciones.filter((c) => !localDe(c)));
        },
      })),
    });
  } catch (error) {
    console.warn('No se pudo revisar el respaldo:', error.message);
  }
}

/** La copia guardada en el teléfono de una canción del servidor, si existe. */
function localDe(cancionServidor) {
  return cancionesLocales.find((c) => c.idServidor === cancionServidor.idServidor) ?? null;
}

function pintarLista(canciones) {
  el.vacio.hidden = canciones.length > 0;
  el.lista.replaceChildren(...canciones.map((cancion, i) => {
    const menu = botonMenu(cancion, () => menuCancion(cancion));
    return crearFila(cancion, urlDePortada(cancion), menu, () => { listaQueSuena = null; reproductor.reproducirLista(cancionesLocales, i); }, { arrastrable: true });
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
      { texto: '+ Agregar a playlist o álbum', alElegir: () => elegirLista(cancion) },
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
            await borrarCancionCompleta(cancion);
            reproductor.quitar(cancion.id);
            await recargarLista();
            mostrarAviso(`"${cancion.titulo}" se borró del teléfono.`, 3000);
          },
        }),
      },
    ],
  });
}

/* Dos tipos de lista:
 *  💿 Álbum:    se guarda también en tu servidor → igual en todos tus dispositivos.
 *  🎵 Playlist: solo de este teléfono, con tus canciones descargadas.
 * Las listas de antes (sin tipo) son álbumes. */
const esPlaylist = (lista) => lista.tipo === 'playlist';
const iconoLista = (lista) => (esPlaylist(lista) ? '🎵' : '💿');
const nombreTipo = (lista) => (esPlaylist(lista) ? 'playlist' : 'álbum');

function elegirLista(cancion) {
  abrirHoja({
    titulo: 'Agregar a…',
    subtitulo: cancion.titulo,
    acciones: [
      { texto: '+ Nueva playlist (solo este teléfono)', alElegir: () => crearLista(cancion, 'playlist') },
      { texto: '+ Nuevo álbum (en todos tus dispositivos)', alElegir: () => crearLista(cancion, 'album') },
      ...listas.map((lista) => ({
        texto: `${iconoLista(lista)} ${lista.nombre}${lista.canciones.includes(cancion.id) ? '  ✓' : ''}`,
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

/**
 * Pide un nombre y crea un álbum o una playlist (con una canción adentro, si se da).
 * @param {'album' | 'playlist'} tipo
 */
function crearLista(cancionInicial, tipo = 'album') {
  const palabra = tipo === 'playlist' ? 'playlist' : 'álbum';
  abrirHoja({
    titulo: tipo === 'playlist' ? 'Nueva playlist' : 'Nuevo álbum',
    subtitulo: tipo === 'playlist'
      ? 'Solo en este teléfono, con tus canciones descargadas.'
      : 'Se guarda en tu PC: lo verás en todos tus dispositivos.',
    entrada: {
      placeholder: 'Nombre (ej. Para el carro)',
      textoBoton: tipo === 'playlist' ? 'Crear playlist' : 'Crear álbum',
      alAceptar: async (nombre) => {
        const lista = {
          id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
          tipo,
          nombre,
          canciones: cancionInicial ? [cancionInicial.id] : [],
          vinculos: {},
          publico: false,
          creada: Date.now(),
        };
        await guardarLista(lista);
        await recargarLista();
        mostrarAviso(cancionInicial ? `${palabra[0].toUpperCase() + palabra.slice(1)} "${nombre}" creado con "${cancionInicial.titulo}".` : `"${nombre}" creado.`, 3000);
      },
    },
  });
}

/* ---------- Álbumes en tu servidor (iguales en todos lados) ---------- */
// Cada álbum se guarda en el teléfono Y como playlist en tu servidor Navidrome.
// Así, en cualquier dispositivo, en Álbumes → "En Mi PC" aparecen todos y los
// bajas con un toque. Las playlists (🎵) son solo del teléfono y no se suben.
// Las canciones que solo existen en el teléfono (importadas a mano y que no
// están en C:\Music) no pueden ir en la copia del servidor.

let playlistsServidor = [];
const subidasPendientes = new Map(); // id de lista → temporizador

/** Guarda la lista en el teléfono y, en un momento, también en tu servidor. */
async function guardarLista(lista, { subir = true } = {}) {
  await guardarListaEnTelefono(lista);
  if (!subir || esPlaylist(lista) || !servidor.configuracion()) return; // las playlists no se suben
  clearTimeout(subidasPendientes.get(lista.id));
  // Esperamos un poco: si haces varios cambios seguidos, se sube una sola vez.
  // Y nunca dos subidas de la misma lista a la vez: van en fila.
  subidasPendientes.set(lista.id, setTimeout(() => {
    const enFila = (subidasEnCurso.get(lista.id) ?? Promise.resolve()).then(() => subirLista(lista.id));
    subidasEnCurso.set(lista.id, enFila);
  }, 800));
}
const subidasEnCurso = new Map(); // id de lista → promesa de la subida en curso

async function borrarLista(id) {
  const lista = listas.find((l) => l.id === id);
  await borrarListaEnTelefono(id);
  if (lista?.idServidor && servidor.configuracion()) {
    servidor.borrarPlaylist(lista.idServidor)
      .then(() => cargarPlaylistsServidor())
      .catch((error) => console.warn('No se pudo borrar la playlist en tu PC:', error.message));
  }
}

async function asegurarBibliotecaServidor() {
  if (!cancionesServidor.length) cancionesServidor = await servidor.listarCanciones();
}

/** El id en el servidor de una canción del teléfono (o de su gemela con el mismo título). */
function idEnServidor(cancion) {
  if (cancion.idServidor) return cancion.idServidor;
  const clave = tituloBase(cancion.titulo);
  const artista = ARTISTAS_DESCONOCIDOS.has(cancion.artista) ? null : normalizar(cancion.artista);
  const gemela = cancionesServidor.find((s) => tituloBase(s.titulo) === clave
    && (!artista || ARTISTAS_DESCONOCIDOS.has(s.artista) || normalizar(s.artista) === artista));
  return gemela?.idServidor ?? null;
}

// Canciones de un álbum que todavía no están en tu servidor: en la PC se envían
// solas a C:\Music y reintentamos hasta que Navidrome las detecte (y las
// convierta, si eran video). Unos minutos como máximo.
const MAXIMO_REINTENTOS = 8;
const ESPERA_REINTENTO_MS = 40000;
const reintentos = new Map(); // id de lista → cuántas veces se reintentó
const subiendo = new Set();   // listas que se están subiendo ahora mismo

async function enviarFaltantesAPC(lista) {
  const faltan = cancionesDe(lista).filter((c) => !idEnServidor(c));
  if (!faltan.length || !puedeEnviarAPC) return 0;
  const veces = reintentos.get(lista.id) ?? 0;
  if (veces === 0) {
    mostrarAviso(`"${lista.nombre}": enviando ${faltan.length} canciones a tu PC para que estén en todos tus dispositivos…`, 5000);
    for (const cancion of faltan) {
      try { await enviarCancionAPC(cancion); } catch (error) { console.warn('No se pudo enviar', cancion.titulo, error.message); }
    }
  }
  if (veces < MAXIMO_REINTENTOS) {
    reintentos.set(lista.id, veces + 1);
    setTimeout(() => {
      cancionesServidor = []; // volver a leer tu biblioteca: ya deberían estar
      subirLista(lista.id);
    }, ESPERA_REINTENTO_MS);
  }
  return faltan.length;
}

async function subirLista(id) {
  subidasPendientes.delete(id);
  const lista = (await listarListas()).find((l) => l.id === id);
  if (!lista || esPlaylist(lista)) return;
  subiendo.add(id);
  try {
    await asegurarBibliotecaServidor();
    const faltan = await enviarFaltantesAPC(lista);
    if (!faltan) reintentos.delete(id);
    let idsCanciones = cancionesDe(lista).map(idEnServidor).filter(Boolean);
    // Los vínculos del álbum, con los ids del servidor.
    const vinculos = {};
    for (const [a, b] of Object.entries(lista.vinculos ?? {})) {
      const [ida, idb] = [porId(a), porId(b)].map((c) => c && idEnServidor(c));
      if (ida && idb) vinculos[ida] = idb;
    }
    let idDestino = lista.idServidor;
    if (!idDestino) {
      // ¿Ya existe allá una playlist con ese nombre (hecha desde otro dispositivo)?
      // Entonces se juntan: primero lo que ya tenía, luego lo nuevo de aquí.
      const mismoNombre = (await servidor.listarPlaylists()).find((p) => normalizar(p.nombre) === normalizar(lista.nombre));
      if (mismoNombre) {
        idDestino = mismoNombre.idServidor;
        const yaEstaban = (await servidor.cancionesDePlaylist(idDestino)).map((c) => c.idServidor);
        idsCanciones = [...new Set([...yaEstaban, ...idsCanciones])];
      }
    }
    const idServidor = await servidor.guardarPlaylist({
      idServidor: idDestino, nombre: lista.nombre, idsCanciones, vinculos, publico: Boolean(lista.publico),
    });
    // Anotamos el id y la "fecha de cambio" del servidor: así la revisión automática
    // no confunde nuestro propio cambio con uno hecho en otro dispositivo.
    // Releemos la lista: pudo cambiar mientras se subía (y ese cambio ya tiene su propia subida pendiente).
    const { cambiada } = await servidor.obtenerPlaylist(idServidor);
    const ultima = (await listarListas()).find((l) => l.id === id);
    if (ultima) await guardarListaEnTelefono({ ...ultima, idServidor, cambiadaServidor: cambiada });
    const enMemoria = listas.find((l) => l.id === id);
    if (enMemoria) Object.assign(enMemoria, { idServidor, cambiadaServidor: cambiada });
    await cargarPlaylistsServidor();
  } catch (error) {
    console.warn('No se pudo guardar la lista en tu PC:', error.message);
  } finally {
    subiendo.delete(id);
  }
}

/* ---------- Álbumes al día solos ---------- */
// Al abrir Muz15, al volver a ella y cada minuto, se revisa si algún álbum que
// tienes en este dispositivo cambió en otro lado (canciones, orden, nombre,
// vínculos). Si sí, se bajan las canciones nuevas y el álbum se pone al día.

const REVISAR_ALBUMES_CADA_MS = 60000;
let revisandoAlbumes = false;

async function actualizarAlbumesSolos() {
  if (revisandoAlbumes || !servidor.configuracion() || descargaMasiva || document.visibilityState !== 'visible') return;
  revisandoAlbumes = true;
  try {
    const enServidor = await servidor.listarPlaylists();
    await asegurarBibliotecaServidor();
    for (const lista of listas) {
      if (esPlaylist(lista) || !lista.idServidor) continue;
      // En la PC: si el álbum tiene canciones que tu servidor no tiene, se envían.
      if (puedeEnviarAPC && !reintentos.has(lista.id) && !subiendo.has(lista.id)
        && cancionesDe(lista).some((c) => !idEnServidor(c))) {
        subirLista(lista.id);
        continue;
      }
      // Si se está subiendo un cambio hecho aquí, no lo pisamos con lo de allá.
      if (subiendo.has(lista.id) || subidasPendientes.has(lista.id)) continue;
      const allá = enServidor.find((p) => p.idServidor === lista.idServidor);
      if (!allá || allá.cambiada === lista.cambiadaServidor) continue;
      await descargarPlaylist(allá, { silencioso: true });
    }
  } catch (error) {
    console.warn('No se pudieron revisar los álbumes:', error.message);
  } finally {
    revisandoAlbumes = false;
  }
}

/**
 * Recarga forzada (deslizar hacia abajo en Álbumes): vuelve a leer tu biblioteca
 * y tus álbumes del servidor, y pone al día TODOS los de este dispositivo aunque
 * parezca que no cambiaron.
 */
async function recargarAlbumesAFuerza() {
  if (!servidor.configuracion()) {
    mostrarAviso('Conéctate a tu PC (pestaña Mi PC) para actualizar los álbumes.', 4000);
    return;
  }
  cancionesServidor = [];
  for (const lista of listas) lista.cambiadaServidor = null; // que todos se revisen
  await cargarPlaylistsServidor();
  await actualizarAlbumesSolos();
  mostrarAviso('Álbumes actualizados.', 2500);
}

// Gesto de deslizar: solo cuenta si la página ya está hasta arriba.
const DISTANCIA_PARA_RECARGAR = 80;
let inicioDeslizar = null;
let recargando = false;

el.vistaListas.addEventListener('touchstart', (evento) => {
  inicioDeslizar = window.scrollY <= 0 && tipoVista === 'album' && !recargando ? evento.touches[0].clientY : null;
}, { passive: true });

el.vistaListas.addEventListener('touchmove', (evento) => {
  if (inicioDeslizar === null) return;
  const distancia = Math.max(0, evento.touches[0].clientY - inicioDeslizar);
  const alto = Math.min(distancia / 2, 60); // se estira la mitad de lo que mueves el dedo
  el.refrescar.style.height = `${alto}px`;
  const listo = distancia >= DISTANCIA_PARA_RECARGAR;
  el.refrescar.classList.toggle('refrescar--listo', listo);
  el.refrescarTexto.textContent = listo ? 'Suelta para actualizar' : 'Desliza para actualizar';
}, { passive: true });

el.vistaListas.addEventListener('touchend', async () => {
  if (inicioDeslizar === null) return;
  inicioDeslizar = null;
  const listo = el.refrescar.classList.contains('refrescar--listo');
  el.refrescar.classList.remove('refrescar--listo');
  if (!listo) {
    el.refrescar.style.height = '0';
    return;
  }
  recargando = true;
  el.refrescar.style.height = '48px';
  el.refrescar.classList.add('refrescar--cargando');
  el.refrescarTexto.textContent = 'Actualizando…';
  try {
    await recargarAlbumesAFuerza();
  } finally {
    recargando = false;
    el.refrescar.classList.remove('refrescar--cargando');
    el.refrescar.style.height = '0';
  }
});

setInterval(actualizarAlbumesSolos, REVISAR_ALBUMES_CADA_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') actualizarAlbumesSolos();
});

async function cargarPlaylistsServidor() {
  if (!servidor.configuracion() || tipoVista === 'playlist') {
    el.listasPC.hidden = true;
    return;
  }
  el.listasPC.hidden = false;
  try {
    playlistsServidor = (await servidor.listarPlaylists()).filter((p) => !esRespaldo(p)); // los respaldos van ocultos
    el.estadoListasPC.textContent = '';
  } catch (error) {
    el.estadoListasPC.textContent = error.message;
  }
  pintarPlaylistsServidor();
  subirListasSinCopia();
}

// Las listas hechas antes de esta función (o sin conexión) se suben una vez.
let yaSeSubieronLasViejas = false;
function subirListasSinCopia() {
  if (yaSeSubieronLasViejas) return;
  yaSeSubieronLasViejas = true;
  for (const lista of listas) {
    if (!lista.idServidor && !esPlaylist(lista)) subirLista(lista.id);
  }
}

el.buscarListas.addEventListener('input', () => pintarPlaylistsServidor());

function pintarPlaylistsServidor() {
  const busqueda = normalizar(el.buscarListas.value.trim());
  const visibles = playlistsServidor.filter((p) => !busqueda || normalizar(p.nombre).includes(busqueda));
  if (!playlistsServidor.length && !el.estadoListasPC.textContent) {
    el.estadoListasPC.textContent = 'Todavía no hay álbumes en tu PC. Los que crees aquí se guardan allá solos.';
  }
  el.listasServidor.replaceChildren(...visibles.map((playlist) => {
    const local = listas.find((l) => l.idServidor === playlist.idServidor);
    const completa = local && cancionesDe(local).length >= playlist.total;
    const boton = document.createElement('button');
    boton.className = 'cancion__accion';
    if (descargandoPlaylist.has(playlist.idServidor)) {
      boton.textContent = '…';
      boton.disabled = true;
    } else if (completa) {
      boton.textContent = '✓';
      boton.classList.add('cancion__accion--hecha');
      boton.setAttribute('aria-label', 'Ya está en este teléfono');
    } else {
      boton.textContent = local ? '⟳' : '⬇';
      boton.setAttribute('aria-label', `Descargar playlist ${playlist.nombre}`);
    }
    boton.addEventListener('click', (evento) => {
      evento.stopPropagation();
      if (!completa) descargarPlaylist(playlist);
    });
    const portada = playlist.portadaId ? servidor.urlPortada({ portadaId: playlist.portadaId }, 96) : 'icons/portada.png';
    const detalles = [
      playlist.publico ? '🌐 Público' : '🔒 Privado',
      `${playlist.total} ${playlist.total === 1 ? 'canción' : 'canciones'}`,
      playlist.mio ? '' : `de ${playlist.dueno}`,
      local ? 'en este teléfono' : '',
    ].filter(Boolean).join(' · ');
    return crearFila(
      { id: `pl-${playlist.idServidor}`, titulo: playlist.nombre, artista: detalles },
      portada,
      boton,
      () => (local ? (listaAbierta = local.id, pintarListas()) : descargarPlaylist(playlist)),
    );
  }));
}

const descargandoPlaylist = new Set();

/** Baja las canciones que falten y arma (o pone al día) la lista en este teléfono. */
/**
 * Baja las canciones que falten y arma (o pone al día) el álbum en este dispositivo.
 * Con silencioso (revisión automática) solo avisa si de verdad cambió algo.
 */
async function descargarPlaylist(playlist, { silencioso = false } = {}) {
  if (descargandoPlaylist.has(playlist.idServidor)) return;
  descargandoPlaylist.add(playlist.idServidor);
  pintarPlaylistsServidor();
  const bloqueo = silencioso ? null : await navigator.wakeLock?.request('screen').catch(() => null);
  try {
    const completo = await servidor.obtenerPlaylist(playlist.idServidor);
    await asegurarBibliotecaServidor();
    // La canción de este dispositivo que corresponde a una del servidor: la bajada
    // de allá, o una importada aquí con el mismo título (así no se duplica).
    const local = (idServidor) => cancionesLocales.find((c) => c.idServidor === idServidor)
      ?? cancionesLocales.find((c) => !c.idServidor && idEnServidor(c) === idServidor);
    const faltan = completo.canciones.filter((c) => !local(c.idServidor));
    let fallidas = 0;
    for (const [i, cancion] of faltan.entries()) {
      mostrarAviso(`"${completo.nombre}": descargando ${i + 1} de ${faltan.length}…`);
      if (!await descargarDelServidor(cancion, { silencioso: true })) fallidas++;
    }
    await recargarLista();

    // Ids del servidor → canciones de este dispositivo (para el orden y los vínculos).
    let ids = completo.canciones.map((c) => local(c.idServidor)?.id).filter(Boolean);
    const existente = listas.find((l) => l.idServidor === playlist.idServidor);
    // Nunca se quitan canciones de aquí que tu servidor todavía no tiene (por ejemplo,
    // las que se están enviando desde la PC): se quedan al final.
    const soloAqui = (existente ? cancionesDe(existente) : []).filter((c) => !idEnServidor(c)).map((c) => c.id);
    ids = [...new Set([...ids, ...soloAqui])];
    const vinculos = {};
    for (const [a, b] of Object.entries(completo.vinculos)) {
      if (local(a) && local(b)) vinculos[local(a).id] = local(b).id;
    }
    const datos = {
      tipo: 'album', nombre: completo.nombre, canciones: ids, vinculos,
      publico: completo.publico, idServidor: playlist.idServidor, cambiadaServidor: completo.cambiada,
    };
    const antes = existente ? JSON.stringify([existente.nombre, existente.canciones, existente.vinculos ?? {}]) : null;
    const lista = existente
      ? { ...existente, ...datos }
      : { id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`, creada: Date.now(), ...datos };
    await guardarLista(lista, { subir: false }); // viene del servidor: no hace falta subirla
    await recargarLista();

    const cambio = antes !== JSON.stringify([lista.nombre, lista.canciones, lista.vinculos]);
    if (fallidas) {
      mostrarAviso(`"${completo.nombre}": ${fallidas} canciones no se pudieron bajar. Toca ⟳ para reintentar.`, 5000);
    } else if (!silencioso) {
      mostrarAviso(`Álbum "${completo.nombre}" descargado: ${ids.length} canciones (ya están en Descargadas).`, 5000);
    } else if (cambio) {
      mostrarAviso(`Álbum "${completo.nombre}" actualizado${faltan.length ? ` (${faltan.length} canciones nuevas)` : ''}.`, 4000);
    }
  } catch (error) {
    if (!silencioso) mostrarAviso(`No se pudo descargar "${playlist.nombre}": ${error.message}`, 6000);
    else console.warn('Revisión de álbum:', error.message);
  } finally {
    bloqueo?.release();
    descargandoPlaylist.delete(playlist.idServidor);
    pintarPlaylistsServidor();
  }
}

// Qué pestaña se está viendo: 'album' (💿 Álbumes) o 'playlist' (🎵 Playlists).
let tipoVista = 'album';
// De dónde viene lo que suena: id de una lista, o null (Descargadas / Mi PC).
let listaQueSuena = null;

el.nuevaLista.addEventListener('click', () => crearLista(null, tipoVista));
el.volverListas.addEventListener('click', () => { listaAbierta = null; pintarListas(); });

/** Las canciones de una lista, en su orden (ignorando las que ya no existen). */
function cancionesDe(lista) {
  return lista.canciones.map((id) => cancionesLocales.find((c) => c.id === id)).filter(Boolean);
}

/**
 * Las canciones de una lista listas para sonar: con los vínculos (⛓) de ESA
 * lista. Si la lista no dice nada de una canción, vale su vínculo de Descargadas.
 */
function cancionesParaReproducir(lista) {
  const propios = lista.vinculos ?? {};
  return cancionesDe(lista).map((c) => (c.id in propios ? { ...c, siguienteFija: propios[c.id] } : c));
}

function reproducirDeLista(lista, desde) {
  listaQueSuena = lista.id;
  reproductor.reproducirLista(cancionesParaReproducir(lista), desde);
}

function pintarListas() {
  const abierta = listas.find((l) => l.id === listaAbierta);
  if (!abierta) listaAbierta = null;
  el.indiceListas.hidden = Boolean(abierta);
  el.detalleLista.hidden = !abierta;

  if (!abierta) {
    const delTipo = listas.filter((l) => (tipoVista === 'playlist') === esPlaylist(l));
    el.nuevaLista.textContent = tipoVista === 'playlist' ? '+ Nueva playlist' : '+ Nuevo álbum';
    el.tituloListasTelefono.textContent = tipoVista === 'playlist' ? 'Tus playlists (solo este teléfono)' : 'Álbumes en este teléfono';
    el.sinListas.innerHTML = tipoVista === 'playlist'
      ? 'Arma playlists con tus canciones de <strong>Descargadas</strong> (⋯ → Agregar a playlist o álbum). Solo viven en este teléfono.'
      : 'Los álbumes se guardan en tu PC y los ves en todos tus dispositivos. Crea uno o descarga los de abajo.';
    el.sinListas.hidden = delTipo.length > 0;
    el.listas.replaceChildren(...delTipo.map((lista) => {
      const canciones = cancionesDe(lista);
      const detalles = [`${canciones.length} ${canciones.length === 1 ? 'canción' : 'canciones'}`];
      if (!esPlaylist(lista)) detalles.unshift(lista.publico ? '🌐 Público' : '🔒 Privado');
      return crearFila(
        { id: lista.id, titulo: `${iconoLista(lista)} ${lista.nombre}`, artista: detalles.join(' · ') },
        canciones[0] ? urlDePortada(canciones[0]) : 'icons/portada.png',
        botonMenu({ titulo: lista.nombre }, () => menuLista(lista)),
        () => { listaAbierta = lista.id; pintarListas(); },
      );
    }));
    return;
  }

  const canciones = cancionesParaReproducir(abierta);
  el.nombreLista.textContent = `${iconoLista(abierta)} ${abierta.nombre}`;
  el.listaVacia.hidden = canciones.length > 0;
  el.reproducirLista.disabled = canciones.length === 0;
  el.cancionesLista.replaceChildren(...canciones.map((cancion, i) => {
    const menu = botonMenu(cancion, () => menuCancionEnLista(abierta, cancion));
    return crearFila(cancion, urlDePortada(cancion), menu, () => reproducirDeLista(abierta, i), { arrastrable: true });
  }));
  marcarSonando(reproductor.estado().cancion);
}

/* ---------- Vincular dentro de un álbum o playlist ---------- */

function menuCancionEnLista(lista, cancion) {
  const siguiente = porId(lista.vinculos?.[cancion.id]);
  abrirHoja({
    titulo: cancion.titulo,
    subtitulo: cancion.artista,
    acciones: [
      siguiente
        ? { texto: `⛓ Quitar vínculo con "${siguiente.titulo}"`, alElegir: () => vincularEnLista(lista, cancion, null) }
        : { texto: `⛓ Vincular en este ${nombreTipo(lista)}: que siempre siga otra`, alElegir: () => elegirVinculoEnLista(lista, cancion) },
      { texto: '✎ Editar título, artista y portada', alElegir: () => editarCancion(cancion) },
      { texto: `Quitar de "${lista.nombre}"`, alElegir: () => quitarDeLista(lista, cancion) },
    ],
  });
}

function elegirVinculoEnLista(lista, cancion) {
  const vinculos = lista.vinculos ?? {};
  // ¿Siguiendo los vínculos desde "desde" se llega a "cancion"? (para no hacer círculos)
  const llegaA = (desde) => {
    const vistos = new Set();
    for (let id = desde; id && !vistos.has(id); id = vinculos[id]) {
      if (id === cancion.id) return true;
      vistos.add(id);
    }
    return false;
  };
  const opciones = cancionesDe(lista).filter((c) => c.id !== cancion.id && !llegaA(c.id));
  abrirHoja({
    titulo: '¿Qué canción va después?',
    subtitulo: `En "${lista.nombre}", después de "${cancion.titulo}" siempre sonará la que elijas.`,
    acciones: opciones.map((otra) => ({
      texto: `${otra.titulo} — ${otra.artista}`,
      alElegir: () => vincularEnLista(lista, cancion, otra),
    })),
  });
}

async function vincularEnLista(lista, cancion, siguiente) {
  const vinculos = { ...(lista.vinculos ?? {}) };
  if (siguiente) {
    // Una canción solo va pegada detrás de una: si ya tenía otra antes, se suelta.
    for (const [a, b] of Object.entries(vinculos)) if (b === siguiente.id) delete vinculos[a];
    vinculos[cancion.id] = siguiente.id;
  } else {
    delete vinculos[cancion.id];
  }
  await guardarLista({ ...lista, vinculos });
  await recargarLista();
  mostrarAviso(siguiente
    ? `En "${lista.nombre}": después de "${cancion.titulo}" siempre sonará "${siguiente.titulo}".`
    : `Se quitó el vínculo de "${cancion.titulo}" en "${lista.nombre}".`, 4000);
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
});

el.reproducirLista.addEventListener('click', () => {
  const lista = listas.find((l) => l.id === listaAbierta);
  if (lista && cancionesDe(lista).length) reproducirDeLista(lista, 0);
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
  const palabra = nombreTipo(lista);
  const publicoPrivado = esPlaylist(lista) ? [] : [{
    texto: lista.publico
      ? '🔒 Hacer privado (solo tú lo ves)'
      : '🌐 Hacer público (lo ve cualquiera con cuenta en tu Navidrome)',
    alElegir: async () => {
      await guardarLista({ ...lista, publico: !lista.publico });
      await recargarLista();
      mostrarAviso(lista.publico ? `"${lista.nombre}" ahora es privado.` : `"${lista.nombre}" ahora es público.`, 3000);
    },
  }];
  // Un álbum se puede quitar solo de este teléfono y seguir en tu PC y tus otros dispositivos.
  const quitarDeAqui = esPlaylist(lista) || !lista.idServidor ? [] : [{
    texto: 'Quitar de este teléfono (sigue en tu PC)',
    alElegir: async () => {
      await borrarListaEnTelefono(lista.id);
      if (listaAbierta === lista.id) listaAbierta = null;
      await recargarLista();
      mostrarAviso(`"${lista.nombre}" se quitó de este teléfono. Lo puedes volver a bajar desde "En Mi PC".`, 4000);
    },
  }];
  abrirHoja({
    titulo: `${iconoLista(lista)} ${lista.nombre}`,
    subtitulo: esPlaylist(lista) ? 'Playlist: solo en este teléfono.' : `Álbum: está en tu PC · ${lista.publico ? 'público' : 'privado'}.`,
    acciones: [
      ...publicoPrivado,
      ...quitarDeAqui,
      {
        texto: 'Cambiar nombre',
        alElegir: () => abrirHoja({
          titulo: 'Cambiar nombre',
          entrada: {
            placeholder: `Nombre del ${palabra}`,
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
        texto: `Borrar ${palabra}`,
        peligro: true,
        alElegir: () => confirmar({
          titulo: `¿Borrar ${esPlaylist(lista) ? 'la playlist' : 'el álbum'} "${lista.nombre}"?`,
          subtitulo: esPlaylist(lista)
            ? 'Las canciones se quedan en Descargadas.'
            : 'Se borra también de tu PC y de tus otros dispositivos. Las canciones se quedan en Descargadas.',
          textoBoton: `Borrar ${palabra}`,
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
  el.vistaListas.hidden = vista !== 'listas' && vista !== 'playlists';
  el.vistaServidor.hidden = vista !== 'servidor';
  if (vista === 'servidor') abrirServidor();
  if (vista === 'listas' || vista === 'playlists') {
    const tipo = vista === 'playlists' ? 'playlist' : 'album';
    if (tipo !== tipoVista) listaAbierta = null; // cambiaste de pestaña: vuelve al índice
    tipoVista = tipo;
    pintarListas();
    cargarPlaylistsServidor();
  }
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
    ofrecerRecuperacion();
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
      () => { listaQueSuena = null; reproductor.reproducirLista(visiblesServidor, i); });
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
  if (cancion) guardarUltima(!sonando); // cambió de canción o se pausó: guardar ya
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
  segundoActual = actual;
  guardarUltima();
  if (arrastrando) return;
  el.progreso.max = duracion;
  el.progreso.value = actual;
}

/* ---------- Retomar la última canción ---------- */
// Se recuerda qué sonaba, de dónde (Descargadas o un álbum/playlist) y en qué
// segundo. Al abrir Muz15 queda lista abajo, pausada: le das ▶ y sigue.

const CLAVE_ULTIMA = 'muz15-ultima';
let segundoActual = 0;
let ultimoGuardado = 0;

let retomando = false; // mientras se carga la última canción, no sobrescribir su segundo con 0

function guardarUltima(ahoraMismo = false) {
  if (retomando) return;
  const { cancion } = reproductor.estado();
  if (!cancion || cancion.origen === 'servidor' && !localDe(cancion)) return; // sin descargar: necesitaría internet
  if (!ahoraMismo && Date.now() - ultimoGuardado < 4000) return;
  ultimoGuardado = Date.now();
  try {
    localStorage.setItem(CLAVE_ULTIMA, JSON.stringify({
      id: cancion.id,
      idServidor: cancion.idServidor ?? null,
      lista: listaQueSuena,
      segundo: Math.floor(segundoActual),
    }));
  } catch { /* nada */ }
}

async function retomarUltima() {
  let ultima;
  try { ultima = JSON.parse(localStorage.getItem(CLAVE_ULTIMA)); } catch { return; }
  if (!ultima || reproductor.estado().cancion) return;
  const lista = listas.find((l) => l.id === ultima.lista);
  const canciones = lista ? cancionesParaReproducir(lista) : cancionesLocales;
  const i = canciones.findIndex((c) => c.id === ultima.id || (ultima.idServidor && c.idServidor === ultima.idServidor));
  if (i === -1) return;
  listaQueSuena = lista?.id ?? null;
  retomando = true;
  try {
    await reproductor.prepararLista(canciones, i, ultima.segundo ?? 0);
  } finally {
    setTimeout(() => { retomando = false; }, 1500); // ya se movió al segundo guardado
  }
}

// Al pausar o salir de la app se guarda en ese momento (no cada 4 s).
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') guardarUltima(true); });
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

let puedeEnviarAPC = false; // true solo en la PC con tools/servidor.mjs
fetch('api/estado')
  .then((respuesta) => (respuesta.ok ? respuesta.json() : null))
  .then((estado) => {
    puedeEnviarAPC = Boolean(estado?.enviarAPC);
    el.enviarPC.hidden = !puedeEnviarAPC;
  })
  .catch(() => { /* en el celular no existe: el botón se queda oculto */ });

/** Copia una canción a C:\Music. @returns {'nueva' | 'ya'} */
async function enviarCancionAPC(cancion) {
  const respuesta = await fetch(`api/subir?nombre=${encodeURIComponent(nombreParaPC(cancion))}`, {
    method: 'POST',
    body: await obtenerAudio(cancion),
  });
  const resultado = await respuesta.json();
  if (!respuesta.ok) throw new Error(resultado.error);
  return resultado.ya ? 'ya' : 'nueva';
}

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
      if (await enviarCancionAPC(cancion) === 'ya') yaEstaban++;
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

/** @returns {Promise<boolean>} true si hay una APK más nueva (y ya se mostró el aviso) */
async function revisarActualizacion() {
  if (!esApk || !AppNativa) return false;
  try {
    const info = await AppNativa.getInfo();
    versionApk = { numero: Number(info.build), nombre: info.version };
    const ultima = await (await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { cache: 'no-store' })).json();
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
      return true;
    }
  } catch (error) {
    console.warn('No se pudo revisar si hay versión nueva:', error.message);
  }
  return false;
}
const revisarActualizacionLista = revisarActualizacion(); // también deja anotada la versión de la APK

/* ---------- Botón Atrás de Android (solo APK) ---------- */
// Antes, Atrás en la pantalla principal cerraba Muz15 del todo y cortaba la música.
// Ahora: primero cierra el menú abierto, luego regresa del álbum/playlist, y si
// ya no hay a dónde regresar, MINIMIZA la app (como el botón de inicio): la
// música sigue sonando.
AppNativa?.addListener('backButton', () => {
  const hojaAbierta = [...document.querySelectorAll('.hoja-fondo')].at(-1);
  if (hojaAbierta) return hojaAbierta.click(); // tocar el fondo = cerrar la hoja
  if (listaAbierta) {
    listaAbierta = null;
    return pintarListas();
  }
  AppNativa.minimizeApp();
});

/** La versión de la app guardada en el teléfono (ej. "v14"). */
async function versionWeb() {
  try {
    return (await caches.keys()).find((k) => k.startsWith('muz15-'))?.replace('muz15-', '') ?? null;
  } catch {
    return null;
  }
}

/**
 * ⚙ → Buscar actualizaciones: revisa la app (pantallas y funciones) y, en la
 * APK, también si hay una APK nueva. Lo nuevo de la app se aplica solo.
 */
async function buscarActualizaciones() {
  if (!navigator.onLine) return mostrarAviso('Sin internet: conéctate para buscar actualizaciones.', 4000);
  mostrarAviso('Buscando actualizaciones…');

  let hayAppNueva = false;
  try {
    const registro = await navigator.serviceWorker?.getRegistration();
    if (registro) {
      await registro.update();
      hayAppNueva = Boolean(registro.installing || registro.waiting);
    }
  } catch (error) {
    console.warn('No se pudo revisar la app:', error.message);
  }

  const hayApkNueva = await revisarActualizacion(); // si la hay, ya abrió su aviso

  if (hayAppNueva) {
    // Al terminar de bajar, la app se recarga sola (o pregunta, si está sonando música).
    mostrarAviso('Hay mejoras nuevas: se aplican en unos segundos.', 6000);
  } else if (!hayApkNueva) {
    const partes = [`app ${await versionWeb() ?? ''}`.trim()];
    if (versionApk) partes.push(`APK ${versionApk.nombre}`);
    mostrarAviso(`Ya tienes la versión más nueva (${partes.join(' · ')}).`, 4000);
  }
}

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
  // Para saber en cuál Muz15 estás: la APK y la de Chrome guardan canciones por separado.
  const donde = esApk ? `APK ${versionApk?.nombre ?? ''}`.trim() : 'Navegador (no es la APK)';
  const version = `Estás en: ${donde} · ${cancionesLocales.length} canciones guardadas aquí`;
  abrirHoja({
    titulo: 'Ajustes',
    subtitulo: version,
    acciones: [
      { texto: `🎚 Ecualizador${estadoEq.activo ? `  ·  ${nombrePerfil()}` : ''}`, alElegir: abrirEcualizador },
      { texto: `🛡 Volumen seguro  ·  ${volumenSeguro.activo ? `${volumenSeguro.db} dB` : 'desactivado'}`, alElegir: abrirVolumenSeguro },
      { texto: `🎧 Modo eco${estadoEco.activo ? '  ·  activado' : ''}`, alElegir: abrirModoEco },
      { texto: '⇄ Transición entre canciones', alElegir: elegirTransicion },
      { texto: '🧹 Quitar canciones repetidas', alElegir: quitarRepetidas },
      { texto: '⟳ Buscar actualizaciones', alElegir: buscarActualizaciones },
    ],
  });
});

/* ---------- Quitar repetidas ---------- */
// Dos canciones son "la misma" si su título coincide quitando lo que va entre
// paréntesis, como "(Remasterizado 2007)" o "(1)", y no tienen artistas distintos.
// De cada grupo se queda la mejor copia: la que tiene artista, luego la que está
// en una lista o vinculada, luego la que tiene portada, y si no la más antigua.

const ARTISTAS_DESCONOCIDOS = new Set([SIN_ARTISTA, '[Unknown Artist]', '']);
// Solo se ignoran los paréntesis que NO cambian la canción: "(HQ)", "(Remasterizado
// 2007)", "(Official Video)", "(1)"... Los demás sí cuentan: "Aquí & Ahora (Y Después)"
// y "Aquí & Ahora (Los Primeros Tres Minutos)" son canciones distintas.
const PARENTESIS_QUE_SOBRAN = /[([](?:\s*\d+\s*|[^)\]]*\b(?:remaster\w*|remasterizad\w*|hq|hd|4k|official|oficial|video|audio|lyrics?|letra|visualizer|explicit)\b[^)\]]*)[)\]]/g;
const tituloBase = (titulo) => normalizar(titulo).replace(PARENTESIS_QUE_SOBRAN, '').replace(/[^a-z0-9]+/g, ' ').trim();
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
    const cambiar = (id) => (idsSobran.has(id) ? queda.id : id);
    for (const lista of listas) {
      const vinculos = Object.entries(lista.vinculos ?? {});
      const tocaVinculos = vinculos.some(([a, b]) => idsSobran.has(a) || idsSobran.has(b));
      if (!lista.canciones.some((id) => idsSobran.has(id)) && !tocaVinculos) continue;
      // También en memoria, para que el siguiente grupo parta de la lista ya corregida.
      lista.canciones = [...new Set(lista.canciones.map(cambiar))];
      lista.vinculos = Object.fromEntries(vinculos.map(([a, b]) => [cambiar(a), cambiar(b)]).filter(([a, b]) => a !== b));
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
      await borrarCancionCompleta(sobra);
      reproductor.quitar(sobra.id);
    }
  }
  await recargarLista();
  mostrarAviso(`Listo: se borraron ${total} ${total === 1 ? 'canción repetida' : 'canciones repetidas'}.`, 4000);
}

function elegirTransicion() {
  if (hayReproductorNativo) {
    abrirHoja({
      titulo: 'Transición entre canciones',
      subtitulo: 'Con el reproductor nuevo las canciones van siempre pegadas, sin pausa entre ellas. '
        + 'El fundido todavía no está disponible en la APK.',
    });
    return;
  }
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

// En la APK nueva los efectos los hace Android (DynamicsProcessing) en el
// reproductor nativo; en el navegador, Web Audio sobre los <audio>.
const ecualizador = hayReproductorNativo ? crearEfectosNativos() : crearEcualizador([el.audio, el.audio2]);

function crearEfectosNativos() {
  let ganancias = BANDAS.map(() => 0);
  let lados = BANDAS.map(() => 0);
  let umbralDb = null;
  let pendiente = null;
  // Juntamos los cambios seguidos (al arrastrar una barra) en un solo envío.
  const mandar = () => {
    clearTimeout(pendiente);
    pendiente = setTimeout(() => {
      Reproductor.efectos({ ganancias, lados, umbralDb }).catch((error) => console.warn('Efectos:', error.message));
      // Unos segundos después, anotamos en el registro si los efectos quedaron aplicados.
      clearTimeout(diagnosticoPendiente);
      diagnosticoPendiente = setTimeout(() => registrarDiagnostico(), 5000);
    }, 60);
  };
  let diagnosticoPendiente = null;
  return {
    conectado: true,
    conectar() {},
    aplicar(nuevas) { ganancias = nuevas.map((g) => Math.max(-MAXIMO_DB, Math.min(MAXIMO_DB, g))); mandar(); },
    ponerTope(db, referencia = 100) { umbralDb = db === null ? null : Math.min(0, db - referencia); mandar(); },
    ponerEco(nuevos) { lados = nuevos.map((l) => Math.max(-1, Math.min(1, l))); mandar(); },
  };
}
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

/* ---------- Modo eco ---------- */
// Como el ecualizador, pero cada barra es horizontal: mueve esa zona del sonido
// (bajos, voz, guitarra, platillos…) hacia el oído izquierdo o el derecho.
// Solo en la APK con reproductor nativo (Android ecualiza cada oído por separado).

const CLAVE_ECO = 'muz15-eco';
const PERFILES_ECO = {
  centro: { nombre: 'Centro', lados: [0, 0, 0, 0, 0, 0, 0, 0] },
  abierto: { nombre: 'Abierto', lados: [0, -0.4, 0.4, -0.4, 0.4, -0.4, 0.4, 0] },
  bajosIzq: { nombre: 'Bajos izq · brillo der', lados: [-0.8, -0.6, -0.3, 0, 0, 0.3, 0.6, 0.8] },
  vozCentro: { nombre: 'Voz al centro, instrumentos a los lados', lados: [-0.6, 0.6, 0, 0, 0, -0.6, 0.6, -0.6] },
  giro: { nombre: 'De izquierda a derecha', lados: [-1, -0.7, -0.4, -0.1, 0.1, 0.4, 0.7, 1] },
};
// Animación: el sonido va y viene solo entre "desde" y "hasta" (-1 izq … 1 der),
// con un ciclo de "segundos". "ola" = cada zona va un poco detrás de la anterior.
const ANIMACION_INICIAL = { activo: false, desde: -0.8, hasta: 0.8, segundos: 8, ola: false };
let estadoEco = { activo: false, perfil: 'centro', lados: [...PERFILES_ECO.centro.lados], animacion: { ...ANIMACION_INICIAL } };
try {
  const guardado = JSON.parse(localStorage.getItem(CLAVE_ECO));
  if (guardado?.lados?.length === BANDAS.length) {
    estadoEco = { ...estadoEco, ...guardado, animacion: { ...ANIMACION_INICIAL, ...guardado.animacion } };
  }
} catch { /* nada */ }

function enviarAnimacion() {
  if (!hayReproductorNativo) return;
  const { activo, desde, hasta, segundos, ola } = estadoEco.animacion;
  Reproductor.animarEco({ activo: estadoEco.activo && activo, desde, hasta, segundos, ola })
    .catch((error) => console.warn('Animación de eco:', error.message));
}

function aplicarEco() {
  ecualizador.ponerEco(estadoEco.activo ? estadoEco.lados : BANDAS.map(() => 0));
  enviarAnimacion();
  try { localStorage.setItem(CLAVE_ECO, JSON.stringify(estadoEco)); } catch { /* nada */ }
}
if (estadoEco.activo) {
  ecualizador.ponerEco(estadoEco.lados);
  enviarAnimacion();
}

// Qué suele sonar en cada zona (para que sepas qué estás moviendo).
const QUE_SUENA = ['Bombo', 'Bajo', 'Cuerpo', 'Voz', 'Guitarra', 'Ataque', 'Platillos', 'Aire'];

function abrirModoEco() {
  if (!hayReproductorNativo) {
    abrirHoja({
      titulo: '🎧 Modo eco',
      subtitulo: 'Solo funciona en la APK nueva de Muz15 (con el reproductor nativo). Actualízala desde ⚙ → Buscar actualizaciones.',
    });
    return;
  }
  const panel = document.createElement('div');
  panel.className = 'eq';
  panel.innerHTML = `
    <label class="eq__interruptor">
      <span>Modo eco</span>
      <input type="checkbox" role="switch">
    </label>
    <div class="eco__bandas"></div>
    <div class="eq__perfiles"></div>
    <div class="eco__animacion">
      <label class="eq__interruptor">
        <span>Animación (va y viene sola)</span>
        <input type="checkbox" role="switch" name="animar">
      </label>
      <label class="eco__banda">
        <span class="eco__nombre"><strong>Desde</strong></span>
        <span class="eco__lado">Izq</span>
        <input type="range" min="-1" max="1" step="0.05" name="desde" aria-label="Desde qué tan a la izquierda">
        <span class="eco__lado">Der</span>
      </label>
      <label class="eco__banda">
        <span class="eco__nombre"><strong>Hasta</strong></span>
        <span class="eco__lado">Izq</span>
        <input type="range" min="-1" max="1" step="0.05" name="hasta" aria-label="Hasta qué tan a la derecha">
        <span class="eco__lado">Der</span>
      </label>
      <label class="eco__banda">
        <span class="eco__nombre"><strong>Ciclo</strong> <span class="eco__segundos"></span></span>
        <span class="eco__lado">1 s</span>
        <input type="range" min="1" max="30" step="1" name="segundos" aria-label="Segundos que dura cada ida y vuelta">
        <span class="eco__lado">30 s</span>
      </label>
      <div class="eq__perfiles eco__estilos">
        <button type="button" class="eq__perfil" data-ola="no">Todas juntas</button>
        <button type="button" class="eq__perfil" data-ola="si">En ola</button>
      </div>
    </div>`;
  const interruptor = panel.querySelector('input[role="switch"]');
  const bandas = panel.querySelector('.eco__bandas');
  const perfiles = panel.querySelector('.eq__perfiles');
  const animacion = panel.querySelector('.eco__animacion');
  const anim = {
    interruptor: animacion.querySelector('[name="animar"]'),
    desde: animacion.querySelector('[name="desde"]'),
    hasta: animacion.querySelector('[name="hasta"]'),
    segundos: animacion.querySelector('[name="segundos"]'),
    textoSegundos: animacion.querySelector('.eco__segundos'),
    estilos: animacion.querySelectorAll('.eco__estilos button'),
  };

  // Cualquier cambio en la animación la enciende (y al modo eco) y se manda al reproductor.
  const cambiarAnimacion = (cambios) => {
    estadoEco.animacion = { ...estadoEco.animacion, ...cambios };
    if (estadoEco.animacion.activo) estadoEco.activo = true;
    aplicarEco();
    pintar();
  };
  anim.interruptor.addEventListener('change', () => cambiarAnimacion({ activo: anim.interruptor.checked }));
  anim.desde.addEventListener('input', () => cambiarAnimacion({ desde: Number(anim.desde.value), activo: true }));
  anim.hasta.addEventListener('input', () => cambiarAnimacion({ hasta: Number(anim.hasta.value), activo: true }));
  anim.segundos.addEventListener('input', () => cambiarAnimacion({ segundos: Number(anim.segundos.value), activo: true }));
  for (const boton of anim.estilos) {
    boton.addEventListener('click', () => cambiarAnimacion({ ola: boton.dataset.ola === 'si', activo: true }));
  }

  const controles = BANDAS.map((hz, i) => {
    const fila = document.createElement('label');
    fila.className = 'eco__banda';
    fila.innerHTML = `
      <span class="eco__nombre"><strong>${QUE_SUENA[i]}</strong> ${etiquetaHz(hz)}</span>
      <span class="eco__lado">Izq</span>
      <input type="range" min="-1" max="1" step="0.05" aria-label="${QUE_SUENA[i]}: izquierda o derecha">
      <span class="eco__lado">Der</span>`;
    const barra = fila.querySelector('input');
    barra.addEventListener('input', () => {
      estadoEco.lados[i] = Number(barra.value);
      estadoEco.perfil = 'personalizado';
      estadoEco.activo = true;
      aplicarEco();
      pintar();
    });
    // Doble toque: regresa esa zona al centro.
    barra.addEventListener('dblclick', () => {
      estadoEco.lados[i] = 0;
      aplicarEco();
      pintar();
    });
    bandas.append(fila);
    return barra;
  });

  for (const [clave, { nombre, lados }] of Object.entries(PERFILES_ECO)) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'eq__perfil';
    boton.dataset.perfil = clave;
    boton.textContent = nombre;
    boton.addEventListener('click', () => {
      estadoEco = { ...estadoEco, activo: clave !== 'centro' || estadoEco.activo, perfil: clave, lados: [...lados] };
      aplicarEco();
      pintar();
    });
    perfiles.append(boton);
  }

  interruptor.addEventListener('change', () => {
    estadoEco.activo = interruptor.checked;
    aplicarEco();
    pintar();
  });

  function pintar() {
    interruptor.checked = estadoEco.activo;
    panel.classList.toggle('eq--apagado', !estadoEco.activo);
    controles.forEach((barra, i) => { barra.value = estadoEco.lados[i]; });
    const a = estadoEco.animacion;
    anim.interruptor.checked = a.activo;
    anim.desde.value = a.desde;
    anim.hasta.value = a.hasta;
    anim.segundos.value = a.segundos;
    anim.textoSegundos.textContent = `${a.segundos} s`;
    for (const boton of anim.estilos) boton.classList.toggle('eq__perfil--activo', a.activo && (boton.dataset.ola === 'si') === a.ola);
    // Mientras se anima, las barras de arriba no mandan (se mueven solas).
    bandas.classList.toggle('eco__bandas--animando', estadoEco.activo && a.activo);
    for (const boton of perfiles.children) {
      boton.classList.toggle('eq__perfil--activo', boton.dataset.perfil === estadoEco.perfil);
    }
  }

  pintar();
  abrirHoja({
    titulo: '🎧 Modo eco',
    subtitulo: 'Mueve cada zona del sonido hacia un oído (o enciende la animación para que vaya y venga sola). Doble toque en una barra = al centro. Mejor con audífonos.',
    contenido: panel,
  });
}

/* ---------- Volumen seguro ---------- */
// Un tope para el volumen máximo que sale de Muz15, sin importar el ecualizador.
// Los dB son aproximados: tomando 100 dB como el máximo del teléfono con
// audífonos comunes (ver ecualizador.js).

const CLAVE_VOLUMEN_SEGURO = 'muz15-volumen-seguro';
// referencia: los dB que dan TUS audífonos con la música al máximo (100 hasta que calibres).
let volumenSeguro = { activo: false, db: 85, referencia: 100 };
// Una calibración razonable cae entre 75 y 105 dB. Fuera de eso casi seguro se midió
// mal (por ejemplo, con la APK 1.6 cuyos efectos no se aplicaban) y frena de más.
const REFERENCIA_MINIMA = 75;
const REFERENCIA_MAXIMA = 105;
let calibracionReiniciada = false;
try {
  const guardado = JSON.parse(localStorage.getItem(CLAVE_VOLUMEN_SEGURO));
  if (guardado && OPCIONES_TOPE_DB.includes(guardado.db)) volumenSeguro = { ...volumenSeguro, ...guardado };
  if (volumenSeguro.referencia < REFERENCIA_MINIMA || volumenSeguro.referencia > REFERENCIA_MAXIMA) {
    volumenSeguro.referencia = 100;
    calibracionReiniciada = true;
    localStorage.setItem(CLAVE_VOLUMEN_SEGURO, JSON.stringify(volumenSeguro));
  }
} catch { /* nada */ }
if (calibracionReiniciada) {
  setTimeout(() => mostrarAviso('Se reinició la calibración del volumen seguro (había quedado mal). Vuelve a calibrar en ⚙ si quieres.', 8000), 2500);
}

function aplicarVolumenSeguro() {
  ecualizador.ponerTope(volumenSeguro.activo ? volumenSeguro.db : null, volumenSeguro.referencia);
  try { localStorage.setItem(CLAVE_VOLUMEN_SEGURO, JSON.stringify(volumenSeguro)); } catch { /* nada */ }
}

/**
 * Calibrar: con el tope puesto y una canción fuerte, tu app de audífonos marca
 * X dB. Si marca menos que el tope elegido, la escala de Muz15 se ajusta para que
 * el número que eliges sea el que de verdad llega (aprox.) a tus audífonos.
 */
function calibrarVolumenSeguro() {
  abrirHoja({
    titulo: '📏 Calibrar con tus audífonos',
    subtitulo: `1) Deja el volumen seguro en ${volumenSeguro.db} dB. 2) Pon una canción fuerte con el volumen del cel al máximo. `
      + '3) Escribe cuántos dB marca tu app de audífonos (Soundcore, etc.).',
    entrada: {
      placeholder: `Ej. 70`,
      numero: true,
      textoBoton: 'Calibrar',
      alAceptar: (texto) => {
        const medido = Number(texto.replace(',', '.'));
        if (!Number.isFinite(medido) || medido < 40 || medido > 130) {
          mostrarAviso('Escribe solo el número de dB que marca tu app (ej. 70).', 4000);
          return;
        }
        // Lo que llega al máximo = lo medido + lo que el tope estaba frenando.
        const referencia = Math.round(medido - volumenSeguro.db + volumenSeguro.referencia);
        if (referencia < REFERENCIA_MINIMA || referencia > REFERENCIA_MAXIMA) {
          mostrarAviso(`Ese número no cuadra (daría ${referencia} dB al máximo). Revisa que el volumen seguro esté en ${volumenSeguro.db} dB, `
            + 'que la canción sea fuerte y el volumen del cel al máximo, y vuelve a intentar.', 9000);
          return;
        }
        volumenSeguro = { ...volumenSeguro, activo: true, referencia };
        aplicarVolumenSeguro();
        mostrarAviso(`Calibrado: tus audífonos dan unos ${volumenSeguro.referencia} dB al máximo. Ahora ${volumenSeguro.db} dB en Muz15 ≈ ${volumenSeguro.db} dB en tu app.`, 7000);
      },
    },
  });
}

if (volumenSeguro.activo) {
  ecualizador.ponerTope(volumenSeguro.db, volumenSeguro.referencia);
  // Igual que el ecualizador: el procesador de audio se enciende con el primer toque.
  document.addEventListener('pointerdown', () => ecualizador.conectar(), { once: true, capture: true });
}

function abrirVolumenSeguro() {
  const panel = document.createElement('div');
  panel.className = 'eq';
  panel.innerHTML = `
    <label class="eq__interruptor">
      <span>Volumen seguro</span>
      <input type="checkbox" role="switch">
    </label>
    <p class="formulario__nota volumen__nota">Mientras la música no llegue al tope suena igual; solo lo que intente pasarse se frena ahí, aunque subas el ecualizador. Los dB son aproximados (medidos como con audífonos comunes al volumen máximo del teléfono); con bocinas o audífonos muy potentes puede sonar más fuerte.</p>
    <div class="eq__perfiles volumen__opciones"></div>`;

  const interruptor = panel.querySelector('input[role="switch"]');
  const opciones = panel.querySelector('.volumen__opciones');

  for (const db of OPCIONES_TOPE_DB) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'eq__perfil';
    boton.dataset.db = db;
    boton.textContent = `${db} dB`;
    boton.addEventListener('click', () => {
      ecualizador.conectar(); // estamos dentro de un toque: el navegador lo permite
      volumenSeguro = { ...volumenSeguro, activo: true, db }; // conserva la calibración
      aplicarVolumenSeguro();
      pintar();
      mostrarAviso(`Volumen seguro: máximo ${db} dB.`, 2500);
    });
    opciones.append(boton);
  }

  interruptor.addEventListener('change', () => {
    if (interruptor.checked) ecualizador.conectar();
    volumenSeguro = { ...volumenSeguro, activo: interruptor.checked };
    aplicarVolumenSeguro();
    pintar();
  });

  function pintar() {
    interruptor.checked = volumenSeguro.activo;
    panel.classList.toggle('eq--apagado', !volumenSeguro.activo);
    for (const boton of opciones.children) {
      boton.classList.toggle('eq__perfil--activo', volumenSeguro.activo && Number(boton.dataset.db) === volumenSeguro.db);
    }
  }

  pintar();
  const calibrado = volumenSeguro.referencia !== 100 ? ` Calibrado para tus audífonos (${volumenSeguro.referencia} dB al máximo).` : '';
  abrirHoja({
    titulo: '🛡 Volumen seguro',
    subtitulo: `Elige el volumen máximo. 85 dB o menos es lo recomendado para escuchar por horas.${calibrado}`,
    contenido: panel,
    acciones: [
      { texto: '📏 Calibrar con mis audífonos', alElegir: calibrarVolumenSeguro },
      ...(volumenSeguro.referencia !== 100 ? [{
        texto: 'Quitar calibración',
        alElegir: () => {
          volumenSeguro = { ...volumenSeguro, referencia: 100 };
          aplicarVolumenSeguro();
          mostrarAviso('Calibración quitada.', 2500);
        },
      }] : []),
    ],
  });
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

// Pide al sistema que nunca borre las canciones guardadas por falta de espacio.
pedirAlmacenamientoPersistente();

recargarLista()
  .then(async () => {
    if (hayReproductorNativo) {
      // Si la cerraste con música, el reproductor nativo siguió: mostramos lo que suena.
      const yaSonaba = await reproductor.adoptarColaExistente((id) => cancionesLocales.find((c) => c.id === id)
        ?? cancionesServidor.find((c) => c.id === id));
      await asegurarArchivos(); // la primera vez: pasa tus canciones a archivos del teléfono
      if (!yaSonaba) retomarUltima();
    } else {
      retomarUltima();
    }
    ofrecerRecuperacion();
    avisarSiEsLaVersionDeChrome();
    actualizarAlbumesSolos();
    await revisarActualizacionLista; // para anotar la versión de la APK
    registrarDiagnostico();
  })
  .catch((error) => {
    console.error(error);
    mostrarAviso(`No se pudo abrir la biblioteca: ${error.message}`);
  });

// La APK y la Muz15 instalada desde Chrome son apps DISTINTAS en Android: cada una
// guarda sus propias canciones. Si estás en la de Chrome, te lo decimos.
function avisarSiEsLaVersionDeChrome() {
  const esAndroid = /Android/i.test(navigator.userAgent);
  const instaladaDesdeChrome = matchMedia('(display-mode: standalone)').matches;
  if (esApk || !esAndroid || !instaladaDesdeChrome) return;
  abrirHoja({
    titulo: 'Estás en la Muz15 de Chrome',
    subtitulo: 'Esta NO es la APK. Son dos apps distintas y cada una guarda sus propias canciones; '
      + 'por eso a veces parece que se borraron. Usa la APK y quita esta de tu pantalla de inicio '
      + '(mantén presionado el ícono → Desinstalar).',
    acciones: [{ texto: 'Entendido', alElegir: () => {} }],
  });
}
