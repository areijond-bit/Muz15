// nube.js — Muz15 en la nube: tu perfil, tus audios y tu biblioteca iguales en
// todos tus dispositivos, y lo que suben tus amigos.
//
//  - Supabase guarda los datos (perfiles, audios, biblioteca, listas, qué escuchas)
//    y avisa al momento de cada cambio (tiempo real).
//  - Cloudflare R2 guarda los archivos (audios comprimidos, portadas, fotos).
//
// Cada audio es como un video de YouTube: tiene dueño (quien lo subió), título y
// artista. Solo el dueño los cambia, y el cambio le llega a todos.
//
// En el teléfono todo sigue guardado (IndexedDB / archivos), así que suena sin
// internet. Esto solo mantiene ese contenido igual al de tu cuenta.

import { supabase } from './cuenta.js';
import { ALMACEN } from './config.js';
import { comprimir, huella } from './comprimir.js';
import {
  listarCanciones, listarListas, guardarCancion, guardarLista, borrarLista, parchearCancion, parchearLista,
} from './db.js';

const db = () => supabase();

// Audios y perfiles se unen de varias formas (dueño, guardados, likes, comentarios):
// hay que decirle a Supabase cuál usar, si no responde "more than one relationship".
const CON_DUENO = '*, perfil:perfiles!audios_dueno_fkey(id, usuario, nombre, foto), conteo:reproducciones(veces)';

let yo = null;          // id de tu cuenta
let miPerfil = null;
let canal = null;
let ganchos = {};

/* ---------- Este dispositivo ---------- */

const CLAVE_DISPOSITIVO = 'muz15-dispositivo';
const CLAVE_BORRADAS = 'muz15-nube-borradas'; // lo que borraste aquí sin internet
const CLAVE_DUENO = 'muz15-nube-dueno';        // de quién son las marcas "ya en la nube"
const CLAVE_ULTIMA_VUELTA = 'muz15-nube-ultima';

const leer = (clave, porDefecto) => { try { return JSON.parse(localStorage.getItem(clave)) ?? porDefecto; } catch { return porDefecto; } };
const guardar = (clave, valor) => { try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* nada */ } };

const modelo = navigator.userAgent.match(/Android [^;)]+; ([^;)]+?)(?: Build|\))/)?.[1]?.trim();

/** { id, nombre } de este dispositivo ("Galaxy S24", "PC"…). */
export function dispositivo() {
  let datos = leer(CLAVE_DISPOSITIVO, null);
  if (!datos) {
    const nombre = modelo && modelo !== 'K' ? modelo : (/Android/i.test(navigator.userAgent) ? 'Celular' : 'PC');
    datos = { id: crypto.randomUUID?.() ?? String(Date.now()), nombre };
    guardar(CLAVE_DISPOSITIVO, datos);
  }
  return datos;
}

export function renombrarDispositivo(nombre) {
  guardar(CLAVE_DISPOSITIVO, { ...dispositivo(), nombre: nombre.slice(0, 40) });
}

/* ---------- Arranque ---------- */

/**
 * @param {object} opciones  funciones de la app:
 *   audioDe(cancion) → Blob         el audio guardado en este dispositivo
 *   borrarLocal(cancion)            borrar canción y archivos (sin avisar a la nube)
 *   alCambiarBiblioteca()           volver a pintar
 *   alEscuchando(fila)              lo que suena en tu cuenta (de cualquier dispositivo)
 *   alAudioNuevo(fila)              alguien subió algo
 *   avisar(texto, ms)               mensajito abajo
 */
export function iniciar(opciones) {
  ganchos = opciones;
  window.addEventListener('muz15-cambio', alCambiarAlgoAqui);
}

export const perfil = () => miPerfil;
export const conectado = () => Boolean(yo && miPerfil);

/** Se llama al entrar o salir. @returns tu perfil (null si todavía no lo creas). */
export async function conectar(usuario) {
  desuscribir();
  clearTimeout(temporizador);
  await enCurso?.catch(() => {}); // que una vuelta de la cuenta anterior no siga con la nueva
  yo = usuario?.id ?? null;
  miPerfil = null;
  if (!yo) return null;
  // Si entra otra cuenta en este dispositivo, lo de aquí se trata como nuevo (no se borra).
  if (leer(CLAVE_DUENO, null) !== yo) {
    await olvidarMarcas();
    guardar(CLAVE_DUENO, yo);
    guardar(CLAVE_BORRADAS, {});
    guardar(CLAVE_ULTIMA_VUELTA, 0);
  }
  miPerfil = await leerPerfil(yo);
  if (miPerfil) arrancar();
  return miPerfil;
}

function arrancar() {
  suscribir();
  programarVuelta(0);
}

async function olvidarMarcas() {
  // Las canciones conservan de qué audio son (así se suman a tu biblioteca sin volver a
  // subirlas); solo se olvida que ya estaban "en tu cuenta" (era la de antes, o ninguna).
  for (const c of await listarCanciones()) {
    if (c.enNube) await parchearCancion(c.id, { enNube: false });
  }
  for (const l of await listarListas()) {
    if (l.idNube || l.enNube) await parchearLista(l.id, { idNube: null, enNube: false });
  }
}

/* ---------- Perfil ---------- */

async function leerPerfil(id) {
  const { data, error } = await db().from('perfiles').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

/** "Alex Reyes!" → "alexreyes". @returns {{usuario: string, error: string|null}} */
export function limpiarUsuario(texto) {
  const usuario = texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\s+/g, '').replace(/[^a-z0-9_.]/g, '').slice(0, 20);
  if (usuario.length < 3) return { usuario, error: 'Mínimo 3 letras o números' };
  return { usuario, error: null };
}

export async function usuarioLibre(usuario) {
  const { data, error } = await db().from('perfiles').select('id').eq('usuario', usuario).maybeSingle();
  if (error) throw error;
  return !data || data.id === yo;
}

/**
 * Crea o cambia tu perfil.
 * @param {{usuario: string, nombre: string, foto?: Blob|string|null}} datos  foto: undefined = no cambiar, null = quitar, texto = dirección (la de Google)
 */
export async function guardarPerfil({ usuario, nombre, foto }) {
  let direccionFoto = miPerfil?.foto ?? null;
  if (foto === null) direccionFoto = null;
  if (foto instanceof Blob) direccionFoto = await subirArchivo('foto', foto, foto.type || 'image/jpeg');
  if (typeof foto === 'string') direccionFoto = foto; // la de tu cuenta de Google
  const { data, error } = await db().from('perfiles')
    .upsert({ id: yo, usuario, nombre: nombre.slice(0, 50), foto: direccionFoto })
    .select().single();
  if (error) throw traducir(error);
  const eraNuevo = !miPerfil;
  miPerfil = data;
  if (eraNuevo) arrancar();
  return data;
}

function traducir(error) {
  if (error?.code === '23505') return new Error('Ese nombre de usuario ya lo tiene alguien más');
  if (error?.code === '23514') return new Error('Ese nombre no se puede usar');
  return new Error(error?.message ?? 'Algo falló en la nube');
}

/* ---------- Archivos en R2 ---------- */

const CUBETA = 'muzzy'; // el almacén de Supabase
const EXTENSION_DE = {
  'audio/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/ogg': 'ogg',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
};

/** Sube un archivo (si no estaba ya) y devuelve su dirección pública. */
async function subirArchivo(clase, datos, tipo, huellaConocida) {
  const cuerpo = datos instanceof Blob ? datos : new Blob([datos], { type: tipo });
  const firma = huellaConocida ?? await huella(await cuerpo.arrayBuffer());
  if (ALMACEN === 'supabase') return subirASupabase(clase, cuerpo, tipo, firma);
  const { data, error } = await db().functions.invoke('firmar', {
    body: { clase, huella: firma, tipo, bytes: cuerpo.size },
  });
  if (error) throw new Error(`No se pudo pedir permiso para subir: ${error.message}`);
  if (!data.ya) {
    const respuesta = await fetch(data.subir, { method: 'PUT', headers: { 'Content-Type': tipo }, body: cuerpo });
    if (!respuesta.ok) throw new Error(`No se pudo subir el archivo (${respuesta.status})`);
  }
  return data.publica;
}

/** Al almacén de Supabase: audios/<huella>.webm, portadas/<huella>.jpg, fotos/<tú>-….jpg */
async function subirASupabase(clase, cuerpo, tipo, firma) {
  const extension = EXTENSION_DE[tipo] ?? 'bin';
  const nombre = clase === 'foto' ? `fotos/${yo}-${firma.slice(0, 16)}.${extension}` : `${clase}s/${firma}.${extension}`;
  const almacen = db().storage.from(CUBETA);
  const { error } = await almacen.upload(nombre, cuerpo, { contentType: tipo, upsert: false, cacheControl: '31536000' });
  // Si ya estaba (el mismo archivo lo subió alguien), no se sube otra vez.
  if (error && !/exists|duplicate/i.test(error.message) && String(error.statusCode) !== '409') {
    throw new Error(`No se pudo subir el archivo: ${error.message}`);
  }
  return almacen.getPublicUrl(nombre).data.publicUrl;
}

async function bajarBytes(direccion) {
  const respuesta = await fetch(direccion);
  if (!respuesta.ok) throw new Error(`No se pudo bajar (${respuesta.status})`);
  return respuesta.arrayBuffer();
}

/* ---------- Subir una canción (como subir un video) ---------- */

const EXTENSIONES = { 'audio/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/ogg': 'ogg' };

/**
 * Sube una canción de este dispositivo. Si ya la subió alguien (mismo archivo),
 * no se sube otra vez: se agrega la de esa persona a tu biblioteca.
 */
// Menos que esto no es una canción (un archivo vacío o dañado): no se sube.
const MINIMO_BYTES = 20 * 1024;

async function subirCancion(cancion) {
  const original = await (await ganchos.audioDe(cancion)).arrayBuffer();
  if (original.byteLength < MINIMO_BYTES) throw new Error(`El audio de "${cancion.titulo}" está vacío`);
  const firma = await huella(original);

  const buscarIgual = async () => {
    const { data, error } = await db().from('audios').select('*').eq('huella', firma).gte('bytes', MINIMO_BYTES).limit(1);
    if (error) throw traducir(error); // sin esto, un error haría subirla otra vez (duplicada)
    return data?.[0] ?? null;
  };
  let fila = await buscarIgual();
  if (!fila) {
    const listo = await comprimir(original, cancion.tipo, cancion.duracion ?? null);
    if (listo.datos.byteLength > 50 * 1024 * 1024) {
      throw new Error(`"${cancion.titulo}" pesa ${Math.round(listo.datos.byteLength / 1048576)} MB y la nube acepta hasta 50 MB. Recórtalo en partes (Crear → Recortar).`);
    }
    const tipo = EXTENSIONES[listo.tipo] ? listo.tipo : 'audio/mpeg';
    const archivo = await subirArchivo('audio', listo.datos, tipo, firma);
    let portada = null;
    if (cancion.portada?.datos?.byteLength) {
      portada = await subirArchivo('portada', cancion.portada.datos, cancion.portada.tipo || 'image/jpeg').catch(() => null);
    }
    const { data, error } = await db().from('audios').insert({
      dueno: yo,
      titulo: (cancion.titulo || 'Sin título').slice(0, 200),
      artista: (cancion.artista || '').slice(0, 200),
      album: (cancion.album || '').slice(0, 200),
      archivo, portada, tipo, bytes: listo.datos.byteLength, duracion: listo.duracion ?? cancion.duracion ?? null, huella: firma,
    }).select().single();
    // Otro dispositivo subió el mismo archivo al mismo tiempo: se usa el suyo.
    if (error?.code === '23505') fila = await buscarIgual();
    else if (error) throw traducir(error);
    else fila = data;
    if (!fila) throw new Error('No se pudo registrar el audio');
  }
  // ¿Ya tienes aquí otra copia ligada a ese mismo audio? Entonces esta sobra.
  const otraCopia = (await listarCanciones()).find((c) => c.idNube === fila.id && c.id !== cancion.id);
  if (otraCopia) {
    await ganchos.borrarLocal?.(cancion);
    return fila;
  }
  const { error } = await db().from('guardados').upsert({ usuario: yo, audio: fila.id, orden: cancion.orden ?? null });
  if (error) throw traducir(error);
  // Si era de alguien más, se queda con los datos de su dueño (como en YouTube).
  const datosDueno = fila.dueno === yo ? {} : { titulo: fila.titulo, artista: fila.artista, album: fila.album };
  const sigue = await parchearCancion(cancion.id, {
    ...datosDueno,
    idNube: fila.id, dueno: fila.dueno, enNube: true, portadaNube: fila.portada, portadaBytes: cancion.portada?.datos?.byteLength ?? 0,
  });
  // La borraste mientras se subía: tampoco queda en tu cuenta.
  if (!sigue) await db().from('guardados').delete().eq('usuario', yo).eq('audio', fila.id);
  return fila;
}

/** Baja a este dispositivo una canción de tu biblioteca en la nube. */
async function bajarCancion(guardado, idLocalDe) {
  const audio = guardado.audio;
  const [bytes, portada] = await Promise.all([
    bajarBytes(audio.archivo),
    audio.portada ? bajarBytes(audio.portada).then((datos) => ({ datos, tipo: 'image/jpeg' })).catch(() => null) : null,
  ]);
  await guardarCancion({
    id: audio.id,
    idNube: audio.id,
    enNube: true,
    dueno: audio.dueno,
    duenoUsuario: audio.perfil?.usuario ?? null,
    titulo: audio.titulo,
    artista: audio.artista,
    album: audio.album,
    portada,
    portadaNube: audio.portada,
    portadaBytes: portada?.datos.byteLength ?? 0,
    tipo: audio.tipo,
    nombreArchivo: `${audio.titulo}.${EXTENSIONES[audio.tipo] ?? 'mp3'}`,
    agregada: Date.parse(guardado.agregado) || Date.now(),
    orden: guardado.orden ?? undefined,
    siguienteFija: guardado.siguiente ? idLocalDe(guardado.siguiente) : null,
  }, bytes, { desdeNube: true });
}

/* ---------- Sincronizar ---------- */

let temporizador = null;
let enCurso = null;
let otraVuelta = false;

export function programarVuelta(ms = 1500) {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => sincronizar().catch((error) => console.warn('Nube:', error.message)), ms);
}

/** Deja este dispositivo igual a tu cuenta (y sube lo nuevo de aquí). */
export function sincronizar() {
  if (!conectado()) return Promise.resolve();
  if (enCurso) { otraVuelta = true; return enCurso; }
  enCurso = (async () => {
    await ganchos.antesDeSincronizar?.();
    do {
      otraVuelta = false;
      await unaVuelta();
    } while (otraVuelta);
  })().finally(() => { enCurso = null; });
  return enCurso;
}

const mismoTexto = (a, b) => (a ?? '') === (b ?? '');
const fecha = (texto) => Date.parse(texto) || 0;

/** Tu biblioteca completa (Supabase da máximo 1000 filas por pedido: se pide por páginas). */
async function leerGuardados(cuenta) {
  const todos = [];
  const POR_PAGINA = 1000;
  for (let desde = 0; ; desde += POR_PAGINA) {
    const { data, error } = await db().from('guardados')
      .select('orden, agregado, siguiente, audio:audios!guardados_audio_fkey(*, perfil:perfiles!audios_dueno_fkey(usuario))')
      .eq('usuario', cuenta).order('audio').range(desde, desde + POR_PAGINA - 1);
    if (error) throw traducir(error);
    todos.push(...data);
    if (data.length < POR_PAGINA) return todos;
  }
}

async function unaVuelta() {
  const cuenta = yo; // si entras con otra cuenta a medio camino, esta vuelta se detiene
  const sigueLaMisma = () => yo === cuenta;
  const inicioVuelta = Date.now();
  const ultimaVuelta = leer(CLAVE_ULTIMA_VUELTA, 0);
  await quitarLasBorradasSinInternet();

  const [guardados, { data: remotas, error: e2 }] = await Promise.all([
    leerGuardados(cuenta),
    db().from('listas').select('*').eq('dueno', cuenta),
  ]);
  if (e2) throw traducir(e2);
  if (!sigueLaMisma()) return;

  const remotos = new Map(guardados.filter((g) => g.audio && g.audio.bytes >= MINIMO_BYTES).map((g) => [g.audio.id, g]));
  const rotos = new Set(guardados.filter((g) => g.audio && g.audio.bytes < MINIMO_BYTES).map((g) => g.audio.id));
  let locales = await listarCanciones();
  const porNube = new Map(locales.filter((c) => c.idNube).map((c) => [c.idNube, c]));
  const idLocalDe = (idNube) => porNube.get(idNube)?.id ?? idNube;
  const idNubeDe = (idLocal) => locales.find((c) => c.id === idLocal)?.idNube ?? null;
  let cambioAqui = false;

  // 1. Lo que ya tienes en los dos lados: datos del dueño, tu orden y tus vínculos.
  const porSubir = [];
  const enNubeAqui = locales.filter((c) => c.enNube).length;
  const desaparecidas = locales.filter((c) => c.idNube && c.enNube && !remotos.has(c.idNube) && !rotos.has(c.idNube)).length;
  const borradoSeguro = desaparecidas <= 3 || desaparecidas <= enNubeAqui * 0.3;
  if (!borradoSeguro) console.warn(`Nube: ${desaparecidas} canciones ya no están en tu cuenta; no se borran aquí por seguridad.`);
  for (const c of locales) {
    if (!sigueLaMisma()) return;
    if (!c.idNube) { porSubir.push(c); continue; }
    if (rotos.has(c.idNube)) continue; // ligada a un audio vacío: la arregla repararTitulos (app.js)
    const g = remotos.get(c.idNube);
    try {
      if (!g) {
        if (c.enNube) {
          if (borradoSeguro) { await ganchos.borrarLocal(c); cambioAqui = true; } // la quitaste en otro dispositivo
        } else {
          // De un audio que ya existe (bajado sin cuenta, o de tu cuenta anterior): a tu biblioteca.
          const { error } = await db().from('guardados').upsert({ usuario: yo, audio: c.idNube, orden: c.orden ?? null });
          if (!error) await parchearCancion(c.id, { enNube: true });
          else if (error.code === '23503') await parchearCancion(c.id, { idNube: null, enNube: false }); // ese audio ya no existe: se sube como nuevo
        }
        continue;
      }
      cambioAqui = (await igualarCancion(c, g, { ultimaVuelta, idLocalDe, idNubeDe })) || cambioAqui;
    } catch (error) {
      anotarFallo(c.id, c.titulo, error); // una canción con problemas no detiene a las demás
    }
  }

  // 2. Listas (antes de bajar, para que se vean ya; se repasan al terminar).
  const pendientes = new Set(porSubir.map((c) => c.id));
  cambioAqui = (await igualarListas(remotas, { idLocalDe, idNubeDe, porNube, pendientes })) || cambioAqui;
  if (cambioAqui) ganchos.alCambiarBiblioteca?.();

  // 3. Bajar las que tienes en tu cuenta y aquí no.
  let hechas = 0;
  const porBajar = [...remotos.values()].filter((g) => !porNube.has(g.audio.id) && !fallaHaceRato(g.audio.id));
  for (const [i, g] of porBajar.entries()) {
    if (!sigueLaMisma()) return;
    ganchos.avisar?.(`Descargando tu música: ${i + 1} de ${porBajar.length} · ${g.audio.titulo}`);
    try {
      await bajarCancion(g, idLocalDe);
      hechas++;
      if (i % 5 === 4) ganchos.alCambiarBiblioteca?.();
    } catch (error) {
      anotarFallo(g.audio.id, g.audio.titulo, error);
    }
  }

  // 4. Subir lo nuevo de este dispositivo.
  const subibles = porSubir.filter((c) => !fallaHaceRato(c.id));
  for (const [i, c] of subibles.entries()) {
    if (!sigueLaMisma()) return;
    ganchos.avisar?.(`Subiendo tus canciones: ${i + 1} de ${subibles.length} · ${c.titulo}`);
    try {
      await subirCancion(c);
      hechas++;
    } catch (error) {
      anotarFallo(c.id, c.titulo, error);
    }
  }

  if (hechas) {
    otraVuelta = true; // repasar listas con todo ya bajado/subido
    ganchos.alCambiarBiblioteca?.();
  }
  if (porBajar.length || subibles.length) {
    const fallaron = porBajar.length + subibles.length - hechas;
    ganchos.avisar?.(fallaron
      ? `${fallaron} ${fallaron === 1 ? 'canción no se pudo' : 'canciones no se pudieron'} subir o descargar; se intenta otra vez en unos minutos.`
      : 'Tu música está al día en todos tus dispositivos.', 4000);
    if (fallaron) programarVuelta(ESPERA_TRAS_FALLO_MS + 1000);
  }
  if (!sigueLaMisma()) return;
  guardar(CLAVE_ULTIMA_VUELTA, inicioVuelta);
  await refrescarMapa(); // que lo recién subido/bajado se pueda borrar también en la nube
}

// Lo que falló (sin internet, archivo dañado…) no se reintenta en cada vuelta.
const ESPERA_TRAS_FALLO_MS = 5 * 60 * 1000;
const fallos = new Map(); // id → cuándo falló

function anotarFallo(id, titulo, error) {
  fallos.set(id, Date.now());
  console.warn('Nube: no se pudo pasar', titulo, error.message);
}

const fallaHaceRato = (id) => Date.now() - (fallos.get(id) ?? 0) < ESPERA_TRAS_FALLO_MS;

/** Iguala una canción que está aquí y en tu cuenta. @returns true si cambió algo aquí */
async function igualarCancion(c, g, { ultimaVuelta, idLocalDe, idNubeDe }) {
  const a = g.audio;
  const cambiadaAqui = (c.cambiada ?? 0) > ultimaVuelta;
  let cambioAqui = false;

  // Título, artista, álbum y portada: los decide el dueño.
  const datosDistintos = !mismoTexto(c.titulo, a.titulo) || !mismoTexto(c.artista, a.artista) || !mismoTexto(c.album, a.album);
  const portadaCambiadaAqui = (c.portada?.datos?.byteLength ?? 0) !== (c.portadaBytes ?? 0);
  if (a.dueno === yo && cambiadaAqui && (c.cambiada ?? 0) > fecha(a.cambiado) && (datosDistintos || portadaCambiadaAqui)) {
    const cambios = { titulo: c.titulo.slice(0, 200), artista: (c.artista ?? '').slice(0, 200), album: (c.album ?? '').slice(0, 200) };
    if (portadaCambiadaAqui) {
      cambios.portada = c.portada?.datos?.byteLength
        ? await subirArchivo('portada', c.portada.datos, c.portada.tipo || 'image/jpeg').catch(() => a.portada)
        : null;
    }
    const { error } = await db().from('audios').update(cambios).eq('id', a.id);
    if (error) throw traducir(error);
    await parchearCancion(c.id, { portadaNube: cambios.portada ?? a.portada, portadaBytes: c.portada?.datos?.byteLength ?? 0 });
  } else {
    let campos = null;
    if (datosDistintos || c.duenoUsuario !== (a.perfil?.usuario ?? null) || c.dueno !== a.dueno) {
      campos = { titulo: a.titulo, artista: a.artista, album: a.album, dueno: a.dueno, duenoUsuario: a.perfil?.usuario ?? null };
    }
    if ((a.portada ?? null) !== (c.portadaNube ?? null)) {
      const portada = a.portada ? await bajarBytes(a.portada).then((datos) => ({ datos, tipo: 'image/jpeg' })).catch(() => c.portada) : null;
      campos = { ...campos, portada, portadaNube: a.portada, portadaBytes: portada?.datos?.byteLength ?? 0 };
    }
    if (campos) {
      await parchearCancion(c.id, campos);
      c = { ...c, ...campos };
      cambioAqui = true;
    }
  }

  // Tu orden y tus vínculos (cosas tuyas, no del dueño): gana lo último que hiciste.
  const siguienteNube = c.siguienteFija ? idNubeDe(c.siguienteFija) : null;
  const ordenDistinto = (c.orden ?? null) !== (g.orden ?? null);
  const vinculoDistinto = (siguienteNube ?? null) !== (g.siguiente ?? null);
  if (!ordenDistinto && !vinculoDistinto) return cambioAqui;
  if (cambiadaAqui) {
    await db().from('guardados').update({ orden: c.orden ?? null, siguiente: siguienteNube }).eq('usuario', yo).eq('audio', a.id);
    return cambioAqui;
  }
  await parchearCancion(c.id, { orden: g.orden ?? undefined, siguienteFija: g.siguiente ? idLocalDe(g.siguiente) : null });
  return true;
}

/** Iguala tus álbumes y playlists. @returns true si cambió algo aquí */
async function igualarListas(remotas, { idLocalDe, idNubeDe, porNube, pendientes = new Set() }) {
  let cambio = false;
  const locales = await listarListas();
  const porId = new Map(remotas.map((r) => [r.id, r]));

  // Lo que la lista tiene en la nube pero aquí todavía no se bajó: no se pierde al subirla.
  const comoRemota = (l, remota) => {
    const aqui = l.canciones.map(idNubeDe).filter(Boolean);
    const faltan = (remota?.canciones ?? []).filter((id) => !porNube.has(id) && !aqui.includes(id));
    const vinculos = {};
    for (const [a, b] of Object.entries(l.vinculos ?? {})) {
      const ida = idNubeDe(a);
      const idb = idNubeDe(b);
      if (ida && idb) vinculos[ida] = idb;
    }
    return { nombre: l.nombre.slice(0, 100), tipo: l.tipo === 'playlist' ? 'playlist' : 'album', publica: Boolean(l.publico), canciones: [...aqui, ...faltan], vinculos };
  };
  const comoLocal = (r, l = {}) => {
    const vinculos = {};
    for (const [a, b] of Object.entries(r.vinculos ?? {})) vinculos[idLocalDe(a)] = idLocalDe(b);
    return {
      ...l, id: l.id ?? r.id, idNube: r.id, enNube: true, nombre: r.nombre, tipo: r.tipo, publico: r.publica,
      canciones: r.canciones.filter((id) => porNube.has(id)).map(idLocalDe), vinculos,
      creada: l.creada ?? fecha(r.creada), cambiadaNube: r.cambiada,
    };
  };
  const firma = (x) => JSON.stringify([x.nombre, x.tipo ?? 'album', Boolean(x.publico ?? x.publica), x.canciones, x.vinculos ?? {}]);

  for (const l of locales) {
    if (l.nombre?.startsWith('Muz15 · ')) continue; // respaldos internos
    const r = l.idNube ? porId.get(l.idNube) : null;
    if (l.canciones.some((id) => pendientes.has(id))) { // espera a que sus canciones se suban
      if (r) porId.delete(r.id);
      continue;
    }
    if (!l.idNube || (!r && !l.enNube)) {
      const { data, error } = await db().from('listas').insert({ ...(l.idNube ? { id: l.idNube } : {}), dueno: yo, ...comoRemota(l, null) }).select().single();
      if (error) { console.warn('No se pudo subir la lista', l.nombre, error.message); continue; }
      const sigue = await parchearLista(l.id, { idNube: data.id, enNube: true, cambiadaNube: data.cambiada });
      if (!sigue) await db().from('listas').delete().eq('id', data.id).eq('dueno', yo); // la borraste mientras tanto
      continue;
    }
    if (!r) { // la borraste en otro dispositivo
      await borrarLista(l.id, { desdeNube: true });
      cambio = true;
      continue;
    }
    porId.delete(r.id);
    const cambiadaAqui = (l.cambiada ?? 0) > fecha(l.cambiadaNube ?? r.cambiada) && (l.cambiada ?? 0) > fecha(r.cambiada) - 1000;
    if (cambiadaAqui) {
      const subir = comoRemota(l, r);
      if (firma(subir) !== firma(r)) {
        const { data, error } = await db().from('listas').update(subir).eq('id', r.id).select().single();
        if (!error) await parchearLista(l.id, { cambiadaNube: data.cambiada });
      }
    } else {
      const bajar = comoLocal(r, l);
      if (firma(bajar) !== firma(l) || l.cambiadaNube !== r.cambiada) {
        const { id: _id, ...campos } = bajar;
        await parchearLista(l.id, campos);
        cambio = true;
      }
    }
  }
  // Listas nuevas de tu cuenta (creadas en otro dispositivo).
  for (const r of porId.values()) {
    await guardarLista(comoLocal(r), { desdeNube: true });
    cambio = true;
  }
  return cambio;
}

/* ---------- Lo que cambias aquí ---------- */

let mapaNube = new Map(); // id local → { idNube, tipo } (para saber qué borrar en la nube)

async function refrescarMapa() {
  const [canciones, listas] = await Promise.all([listarCanciones(), listarListas()]);
  mapaNube = new Map([
    ...canciones.filter((c) => c.idNube).map((c) => [`cancion:${c.id}`, c.idNube]),
    ...listas.filter((l) => l.idNube).map((l) => [`lista:${l.id}`, l.idNube]),
  ]);
}

async function alCambiarAlgoAqui(evento) {
  const { tipo, id, borrada, idNube: deAviso } = evento.detail ?? {};
  if (borrada) {
    const idNube = deAviso ?? mapaNube.get(`${tipo}:${id}`);
    if (idNube) {
      const borradas = leer(CLAVE_BORRADAS, {});
      borradas[`${tipo}:${idNube}`] = Date.now();
      guardar(CLAVE_BORRADAS, borradas);
      if (conectado()) quitarLasBorradasSinInternet().catch(() => {});
    }
  } else {
    refrescarMapa();
  }
  if (conectado()) programarVuelta();
}

async function quitarLasBorradasSinInternet() {
  for (const clave of Object.keys(leer(CLAVE_BORRADAS, {}))) {
    const [tipo, idNube] = clave.split(':');
    const { error } = tipo === 'cancion'
      ? await db().from('guardados').delete().eq('usuario', yo).eq('audio', idNube)
      : await db().from('listas').delete().eq('id', idNube).eq('dueno', yo);
    if (error) return; // sin internet: se intenta después
    const actuales = leer(CLAVE_BORRADAS, {});
    delete actuales[clave];
    guardar(CLAVE_BORRADAS, actuales);
  }
}

/* ---------- Tiempo real ---------- */

function suscribir() {
  desuscribir();
  refrescarMapa();
  canal = db().channel(`muz15-${yo}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'guardados', filter: `usuario=eq.${yo}` }, () => programarVuelta(400))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'listas', filter: `dueno=eq.${yo}` }, () => programarVuelta(400))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'audios' }, (cambio) => {
      if ([...mapaNube.values()].includes(cambio.new.id)) programarVuelta(400);
      ganchos.alAudioCambiado?.(cambio.new);
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audios' }, (cambio) => ganchos.alAudioNuevo?.(cambio.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'escuchando', filter: `usuario=eq.${yo}` }, (cambio) => ganchos.alEscuchando?.(cambio.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'siguiendo' }, () => ganchos.alCambiarSeguidores?.())
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'perfiles' }, () => ganchos.alCambiarSeguidores?.())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reacciones' }, (cambio) => ganchos.alCambiarAudioSocial?.(cambio.new?.audio ?? cambio.old?.audio ?? null))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comentarios' }, (cambio) => ganchos.alCambiarAudioSocial?.(cambio.new?.audio ?? cambio.old?.audio ?? null))
    .subscribe();
  // Al volver a la app (o recuperar internet), ponerse al día.
  document.addEventListener('visibilitychange', alVolver);
  window.addEventListener('online', alVolver);
  leerEscuchando().then((fila) => fila && ganchos.alEscuchando?.(fila)).catch(() => {});
}

function alVolver() {
  if (document.visibilityState === 'visible' && conectado()) programarVuelta(300);
}

function desuscribir() {
  if (canal) db()?.removeChannel(canal);
  canal = null;
  document.removeEventListener('visibilitychange', alVolver);
  window.removeEventListener('online', alVolver);
}

/* ---------- "Estás escuchando…" ---------- */

let ultimoAnuncio = { clave: '', cuando: 0 };

/** Cuenta a tus otros dispositivos qué suena aquí (al cambiar, y cada 30 s mientras suena). */
export async function anunciar({ cancion, sonando, posicion }) {
  if (!conectado()) return;
  const clave = `${cancion?.id ?? ''}|${sonando}`;
  if (clave === ultimoAnuncio.clave && Date.now() - ultimoAnuncio.cuando < 30000) return;
  ultimoAnuncio = { clave, cuando: Date.now() };
  const { id, nombre } = dispositivo();
  await db().from('escuchando').upsert({
    usuario: yo,
    dispositivo: nombre,
    dispositivo_id: id,
    audio: cancion?.idNube ?? (cancion?.id && /^[0-9a-f-]{36}$/.test(cancion.id) ? cancion.id : null),
    titulo: cancion?.titulo ?? '',
    artista: cancion?.artista ?? '',
    sonando: Boolean(sonando && cancion),
    posicion: Number(posicion) || 0,
    cuando: new Date().toISOString(),
  }).then(({ error }) => { if (error) console.warn('Nube (escuchando):', error.message); });
}

export async function leerEscuchando() {
  if (!conectado()) return null;
  const { data } = await db().from('escuchando').select('*').eq('usuario', yo).maybeSingle();
  return data;
}

/* ---------- Explorar (lo de todos) ---------- */

const POR_PAGINA = 50;

/** Audios de todos, del más nuevo al más viejo. Con búsqueda y/o de un solo dueño. */
export async function explorar({ busqueda = '', dueno = null, pagina = 0 } = {}) {
  let consulta = db().from('audios').select(CON_DUENO)
    .gte('bytes', MINIMO_BYTES)
    .order('creado', { ascending: false })
    .range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
  if (dueno) consulta = consulta.eq('dueno', dueno);
  const texto = busqueda.replace(/[%,()*\\]/g, ' ').trim();
  if (texto) consulta = consulta.or(`titulo.ilike.%${texto}%,artista.ilike.%${texto}%,album.ilike.%${texto}%`);
  const { data, error } = await consulta;
  if (error) throw traducir(error);
  return data;
}

export async function perfilPorUsuario(usuario) {
  const { data, error } = await db().from('perfiles').select('*').eq('usuario', usuario).maybeSingle();
  if (error) throw traducir(error);
  return data;
}

/* ---------- Seguidores (como en Instagram) ---------- */

/**
 * Quién sigue a quién, y todos los perfiles. Para un grupo de amigos alcanza con
 * traer todo de una vez (así se cuentan seguidores y "en común" sin más consultas).
 * @returns {Promise<{perfiles: Map<string, object>, siguiendo: {seguidor: string, seguido: string}[]}>}
 */
export async function red() {
  const [{ data: perfiles, error: e1 }, { data: siguiendo, error: e2 }] = await Promise.all([
    db().from('perfiles').select('*').limit(2000),
    db().from('siguiendo').select('seguidor, seguido').limit(20000),
  ]);
  if (e1 || e2) throw traducir(e1 ?? e2);
  return { perfiles: new Map(perfiles.map((p) => [p.id, p])), siguiendo };
}

/** Cuántos audios ha subido alguien. */
export async function cuantasSubidas(dueno) {
  const { count, error } = await db().from('audios').select('id', { count: 'exact', head: true }).eq('dueno', dueno).gte('bytes', MINIMO_BYTES);
  if (error) throw traducir(error);
  return count ?? 0;
}

export async function seguir(id) {
  const { error } = await db().from('siguiendo').upsert({ seguidor: yo, seguido: id });
  if (error) throw traducir(error);
}

export async function dejarDeSeguir(id) {
  const { error } = await db().from('siguiendo').delete().eq('seguidor', yo).eq('seguido', id);
  if (error) throw traducir(error);
}

/* ---------- Me gusta y comentarios (como en YouTube) ---------- */

/** @returns {Promise<{likes: number, dislikes: number, mia: 1|-1|0}>} */
export async function reaccionesDe(audio) {
  const contar = (valor) => db().from('reacciones').select('audio', { count: 'exact', head: true }).eq('audio', audio).eq('valor', valor);
  const [likes, dislikes, mia] = await Promise.all([
    contar(1), contar(-1),
    yo ? db().from('reacciones').select('valor').eq('audio', audio).eq('usuario', yo).maybeSingle() : { data: null }, // sin cuenta: no hay "tuya"
  ]);
  const error = likes.error ?? dislikes.error ?? mia.error;
  if (error) throw traducir(error);
  return { likes: likes.count ?? 0, dislikes: dislikes.count ?? 0, mia: mia.data?.valor ?? 0 };
}

/** valor: 1 = me gusta, -1 = no me gusta, 0 = quitar. */
export async function reaccionar(audio, valor) {
  const { error } = valor
    ? await db().from('reacciones').upsert({ usuario: yo, audio, valor })
    : await db().from('reacciones').delete().eq('usuario', yo).eq('audio', audio);
  if (error) throw traducir(error);
}

export async function comentariosDe(audio) {
  const { data, error } = await db().from('comentarios').select('*, perfil:perfiles!comentarios_usuario_fkey(id, usuario, nombre, foto)')
    .eq('audio', audio).order('creado', { ascending: false }).limit(100);
  if (error) throw traducir(error);
  return data;
}

export async function comentar(audio, texto) {
  const { error } = await db().from('comentarios').insert({ audio, usuario: yo, texto: texto.trim().slice(0, 500) });
  if (error) throw traducir(error);
}

export async function borrarComentario(id) {
  const { error } = await db().from('comentarios').delete().eq('id', id);
  if (error) throw traducir(error);
}

/* ---------- Top (los más escuchados) ---------- */

export const PERIODOS_TOP = {
  hoy: { nombre: 'Hoy', limite: 10 },
  semana: { nombre: 'Semana', limite: 10 },
  mes: { nombre: 'Mes', limite: 10 },
  anio: { nombre: 'Año', limite: 100 },
  siempre: { nombre: 'Siempre', limite: 100 },
};

function desdeCuando(periodo) {
  const ahora = new Date();
  if (periodo === 'hoy') return new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()); // desde las 00:00
  const dias = { semana: 7, mes: 30, anio: 365 }[periodo];
  return new Date(ahora.getTime() - dias * 24 * 60 * 60 * 1000);
}

/** Los audios más escuchados del periodo, en orden, con "vecesPeriodo". (También sin cuenta.) */
export async function top(periodo) {
  const { limite } = PERIODOS_TOP[periodo];
  const { data: filas, error } = periodo === 'siempre'
    ? await db().from('reproducciones').select('audio, veces').gt('veces', 0).order('veces', { ascending: false }).limit(limite)
    : await db().rpc('top_audios', { p_desde: desdeCuando(periodo).toISOString(), p_limite: limite });
  if (error) throw traducir(error);
  const audios = new Map((await audiosPorIds(filas.map((f) => f.audio))).map((a) => [a.id, a]));
  return filas
    .map((f) => audios.get(f.audio) && { ...audios.get(f.audio), vecesPeriodo: Number(f.veces) })
    .filter((a) => a && a.bytes >= MINIMO_BYTES);
}

/** Suma una reproducción (alguien la escuchó al menos 30 s). */
export async function contarReproduccion(audio) {
  // También sin cuenta: la base de datos solo cuenta una vez cada 30 min por dispositivo.
  if (!db() || !audio) return;
  const { error } = await db().rpc('sumar_reproduccion', { p_audio: audio, p_dispositivo: dispositivo().id });
  if (error) console.warn('Nube (reproducción):', error.message);
}

/** Un audio con su dueño (para la pantalla del reproductor). */
export async function audioPorId(id) {
  const { data, error } = await db().from('audios').select(CON_DUENO).eq('id', id).maybeSingle();
  if (error) throw traducir(error);
  return data;
}

/**
 * Explorar: audios elegidos para ti por el algoritmo (función "recomendaciones" en
 * nube/esquema.sql). Usa lo que escuchas en este dispositivo y, con cuenta, también
 * tus me gusta, lo que guardas y a quién sigues. @returns audios con "razon"
 */
export async function recomendaciones(limite = 20) {
  const { data: filas, error } = await db().rpc('recomendaciones', { p_dispositivo: dispositivo().id, p_limite: limite });
  if (error) throw traducir(error);
  const audios = new Map((await audiosPorIds(filas.map((f) => f.audio))).map((a) => [a.id, a]));
  return filas.map((f) => audios.get(f.audio) && { ...audios.get(f.audio), razon: f.razon }).filter(Boolean);
}

/** Todas las canciones de un artista (por su nombre, sin importar mayúsculas). */
export async function audiosDeArtista(nombre) {
  const exacto = nombre.replace(/[%_\\]/g, (c) => `\\${c}`); // que "%" o "_" no sean comodines
  const { data, error } = await db().from('audios').select(CON_DUENO)
    .ilike('artista', exacto).gte('bytes', MINIMO_BYTES).limit(300);
  if (error) throw traducir(error);
  return data;
}

/** Los álbumes de alguien (los tuyos todos; de otros, solo los públicos). */
export async function albumesDe(dueno) {
  const { data, error } = await db().from('listas').select('*')
    .eq('dueno', dueno).eq('tipo', 'album').order('cambiada', { ascending: false });
  if (error) throw traducir(error);
  return data;
}

/**
 * Álbumes públicos de todos (lo más nuevo primero), con sus audios.
 * @returns {Promise<{albumes: object[], audios: Map<string, object>}>}
 */
export async function explorarAlbumes(limite = 20) {
  const { data, error } = await db().from('listas')
    .select('*, perfil:perfiles!listas_dueno_fkey(id, usuario, nombre, foto)')
    .eq('tipo', 'album').eq('publica', true)
    .order('cambiada', { ascending: false }).limit(limite * 2);
  if (error) throw traducir(error);
  const conVarias = data.filter((a) => a.canciones.length >= 2 && a.perfil);
  const audios = new Map((await audiosPorIds([...new Set(conVarias.flatMap((a) => a.canciones))]))
    .filter((a) => a.bytes >= MINIMO_BYTES).map((a) => [a.id, a]));
  const albumes = conVarias.filter((a) => a.canciones.some((id) => audios.has(id))).slice(0, limite);
  return { albumes, audios };
}

/** Audios por id (para las portadas y canciones de un álbum). */
export async function audiosPorIds(ids) {
  if (!ids.length) return [];
  const { data, error } = await db().from('audios').select(CON_DUENO).in('id', ids);
  if (error) throw traducir(error);
  return data;
}

/** Map id de audio → cuántas personas lo tienen guardado. */
export async function vecesGuardado(ids) {
  if (!ids.length) return new Map();
  const { data, error } = await db().rpc('veces_guardado', { ids });
  if (error) throw traducir(error);
  return new Map(data.map((fila) => [fila.audio, Number(fila.veces)]));
}

export async function perfilPorId(id) {
  const { data, error } = await db().from('perfiles').select('*').eq('id', id).maybeSingle();
  if (error) throw traducir(error);
  return data;
}

/** Agrega un audio (tuyo o de un amigo) a tu biblioteca: se baja en todos tus dispositivos. */
export async function guardarEnBiblioteca(audio) {
  const { error } = await db().from('guardados').upsert({ usuario: yo, audio: audio.id });
  if (error) throw traducir(error);
  programarVuelta(0);
}

/** Solo el dueño: borra el audio de Muz15 para todos. */
export async function borrarParaTodos(idNube) {
  const { error } = await db().from('audios').delete().eq('id', idNube).eq('dueno', yo);
  if (error) throw traducir(error);
}
