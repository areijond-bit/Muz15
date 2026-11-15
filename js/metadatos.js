// metadatos.js — Lee título, artista, álbum y portada desde el propio archivo.
//
// Soporta:
//   - MP3 con etiquetas ID3v2 (versiones 2.2, 2.3 y 2.4)
//   - M4A / AAC con etiquetas de iTunes (átomos ©nam, ©ART, ©alb, covr)
// Si el archivo no trae etiquetas, se usa el nombre del archivo:
//   "Artista - Título.mp3"  →  artista "Artista", título "Título"

/**
 * @param {ArrayBuffer} buffer  contenido completo del archivo
 * @param {string} nombreArchivo
 * @returns {{titulo: string, artista: string, album: string, portada: {datos: ArrayBuffer, tipo: string} | null}}
 */
export function leerMetadatos(buffer, nombreArchivo) {
  const resultado = { ...desdeNombre(nombreArchivo), album: '', portada: null };
  const bytes = new Uint8Array(buffer);

  try {
    let etiquetas = null;
    if (texto(bytes, 0, 3) === 'ID3') etiquetas = leerID3(bytes);
    else if (texto(bytes, 4, 8) === 'ftyp') etiquetas = leerMP4(bytes);

    // Solo reemplazamos lo que sí venga en las etiquetas.
    if (etiquetas) {
      for (const [clave, valor] of Object.entries(etiquetas)) {
        if (valor) resultado[clave] = valor;
      }
    }
  } catch (error) {
    console.warn('No se pudieron leer las etiquetas de', nombreArchivo, error);
  }

  return resultado;
}

/* ---------- Nombre del archivo ---------- */

// Quita del nombre cosas como "(Official Video)", "[Video Oficial]" o "(Lyrics)".
const ETIQUETAS_DE_VIDEO = /\s*[([][^)\]]*\b(official|oficial|video|lyrics?|letra|audio|visualizer|hd|4k)\b[^)\]]*[)\]]/gi;

function desdeNombre(nombreArchivo) {
  const sinExtension = nombreArchivo.replace(/\.[^.]+$/, '').replace(ETIQUETAS_DE_VIDEO, '').trim();
  const partes = sinExtension.split(' - ');
  if (partes.length >= 2) {
    return { artista: partes[0].trim(), titulo: partes.slice(1).join(' - ').trim() };
  }
  return { artista: 'Artista desconocido', titulo: sinExtension || 'Sin título' };
}

/* ---------- Utilidades de bytes ---------- */

function texto(bytes, inicio, fin) {
  return String.fromCharCode(...bytes.subarray(inicio, fin));
}

function entero32(bytes, i) {
  return ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
}

// En ID3 algunos tamaños usan solo 7 bits por byte ("syncsafe").
function enteroSyncsafe(bytes, i) {
  return (bytes[i] << 21) | (bytes[i + 1] << 14) | (bytes[i + 2] << 7) | bytes[i + 3];
}

function copiar(bytes, inicio, fin) {
  return bytes.slice(inicio, fin).buffer;
}

/* ---------- MP3: ID3v2 ---------- */

// Nombres de los campos en ID3v2.2 (3 letras) y v2.3/2.4 (4 letras).
const CAMPOS_ID3 = {
  TIT2: 'titulo', TT2: 'titulo',
  TPE1: 'artista', TP1: 'artista',
  TALB: 'album', TAL: 'album',
};

function leerID3(bytes) {
  const version = bytes[3]; // 2, 3 o 4
  const banderas = bytes[5];
  const tamano = enteroSyncsafe(bytes, 6);
  const fin = Math.min(10 + tamano, bytes.length);
  let i = 10;

  // Cabecera extendida opcional: la saltamos.
  if (banderas & 0x40) {
    i += version === 4 ? enteroSyncsafe(bytes, i) : entero32(bytes, i) + 4;
  }

  const largoId = version === 2 ? 3 : 4;
  const largoCabecera = version === 2 ? 6 : 10;
  const etiquetas = {};

  while (i + largoCabecera <= fin) {
    const id = texto(bytes, i, i + largoId);
    if (!/^[A-Z0-9]+$/.test(id)) break; // llegamos al relleno final

    let largo;
    if (version === 2) largo = (bytes[i + 3] << 16) | (bytes[i + 4] << 8) | bytes[i + 5];
    else if (version === 4) largo = enteroSyncsafe(bytes, i + 4);
    else largo = entero32(bytes, i + 4);

    const inicioDatos = i + largoCabecera;
    const finDatos = Math.min(inicioDatos + largo, fin);
    const datos = bytes.subarray(inicioDatos, finDatos);

    if (CAMPOS_ID3[id]) {
      etiquetas[CAMPOS_ID3[id]] = textoID3(datos);
    } else if ((id === 'APIC' || id === 'PIC') && !etiquetas.portada) {
      etiquetas.portada = portadaID3(datos, version);
    }

    i = finDatos;
  }

  return etiquetas;
}

// El primer byte dice cómo está escrito el texto.
function decodificar(datos, codificacion) {
  const nombres = ['iso-8859-1', 'utf-16', 'utf-16be', 'utf-8'];
  return new TextDecoder(nombres[codificacion] || 'utf-8').decode(datos);
}

function textoID3(datos) {
  if (!datos.length) return '';
  return decodificar(datos.subarray(1), datos[0]).replace(/\0/g, ' ').trim();
}

// Busca el final de un texto terminado en cero (1 byte o 2 bytes en UTF-16).
function finDeTexto(datos, desde, codificacion) {
  const doble = codificacion === 1 || codificacion === 2;
  for (let i = desde; i < datos.length; i += doble ? 2 : 1) {
    if (datos[i] === 0 && (!doble || datos[i + 1] === 0)) return i + (doble ? 2 : 1);
  }
  return datos.length;
}

function portadaID3(datos, version) {
  const codificacion = datos[0];
  let i = 1;
  let tipo;

  if (version === 2) {
    // v2.2: formato de 3 letras, ej. "JPG"
    tipo = texto(datos, 1, 4).toUpperCase() === 'PNG' ? 'image/png' : 'image/jpeg';
    i = 4;
  } else {
    const finTipo = finDeTexto(datos, 1, 0);
    tipo = texto(datos, 1, finTipo - 1) || 'image/jpeg';
    if (!tipo.includes('/')) tipo = `image/${tipo.toLowerCase()}`;
    i = finTipo;
  }

  i += 1; // tipo de imagen (portada, contraportada...)
  i = finDeTexto(datos, i, codificacion); // descripción
  return { datos: copiar(datos, i, datos.length), tipo };
}

/* ---------- M4A: átomos MP4 ---------- */

// Recorre los "átomos" (cajas) que hay entre inicio y fin.
function* atomos(bytes, inicio, fin) {
  let i = inicio;
  while (i + 8 <= fin) {
    let largo = entero32(bytes, i);
    const tipo = texto(bytes, i + 4, i + 8);
    let cabecera = 8;
    if (largo === 1) { // tamaño de 64 bits (no debería pasar en canciones normales)
      largo = entero32(bytes, i + 8) * 2 ** 32 + entero32(bytes, i + 12);
      cabecera = 16;
    } else if (largo === 0) {
      largo = fin - i;
    }
    if (largo < cabecera) return;
    yield { tipo, inicio: i + cabecera, fin: Math.min(i + largo, fin) };
    i += largo;
  }
}

function buscarAtomo(bytes, inicio, fin, tipo) {
  for (const atomo of atomos(bytes, inicio, fin)) {
    if (atomo.tipo === tipo) return atomo;
  }
  return null;
}

const CAMPOS_MP4 = {
  '©nam': 'titulo',
  '©ART': 'artista',
  '©alb': 'album',
};

function leerMP4(bytes) {
  // Ruta: moov > udta > meta > ilst
  const moov = buscarAtomo(bytes, 0, bytes.length, 'moov');
  const udta = moov && buscarAtomo(bytes, moov.inicio, moov.fin, 'udta');
  const meta = udta && buscarAtomo(bytes, udta.inicio, udta.fin, 'meta');
  // "meta" tiene 4 bytes (versión y banderas) antes de sus hijos.
  const ilst = meta && buscarAtomo(bytes, meta.inicio + 4, meta.fin, 'ilst');
  if (!ilst) return null;

  const etiquetas = {};
  for (const item of atomos(bytes, ilst.inicio, ilst.fin)) {
    const dato = buscarAtomo(bytes, item.inicio, item.fin, 'data');
    if (!dato) continue;
    const tipoDato = entero32(bytes, dato.inicio); // 1 = texto, 13 = JPEG, 14 = PNG
    const contenido = bytes.subarray(dato.inicio + 8, dato.fin);

    if (CAMPOS_MP4[item.tipo]) {
      etiquetas[CAMPOS_MP4[item.tipo]] = new TextDecoder('utf-8').decode(contenido).trim();
    } else if (item.tipo === 'covr' && !etiquetas.portada) {
      etiquetas.portada = {
        datos: copiar(contenido, 0, contenido.length),
        tipo: tipoDato === 14 ? 'image/png' : 'image/jpeg',
      };
    }
  }
  return etiquetas;
}
