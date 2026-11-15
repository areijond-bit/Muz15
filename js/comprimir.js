// comprimir.js — Hace las canciones más ligeras antes de subirlas a la nube.
//
// Las pasa a Opus (el formato de audio de YouTube y WhatsApp) a 96 kbps: suena casi
// igual que un MP3 normal pero pesa unas 3 veces menos, así caben muchas más
// canciones gratis. Lo hace el propio teléfono o PC (WebCodecs), sin servidor.
// Si el aparato no sabe hacerlo, se sube el archivo tal cual.

import { Muxer, ArrayBufferTarget } from './vendor/webm-muxer.mjs';

const TASA = 48000;                 // Opus siempre trabaja a 48 kHz
const KBPS = 96;
const MAXIMO_PARA_COMPRIMIR = 60 * 1024 * 1024; // más grande que esto: tal cual (no ahogar la memoria)

/** ¿Este aparato puede comprimir? */
export async function sePuedeComprimir(canales = 2, tasa = TASA) {
  if (typeof AudioEncoder === 'undefined' || typeof OfflineAudioContext === 'undefined') return false;
  try {
    const { supported } = await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: tasa, numberOfChannels: canales, bitrate: KBPS * 1000 });
    return Boolean(supported);
  } catch {
    return false;
  }
}

/**
 * @param {ArrayBuffer} original  MP3, M4A, MP4 (su audio), WAV…
 * @returns {Promise<{datos: ArrayBuffer, tipo: string, duracion: number|null, comprimida: boolean}>}
 */
export async function comprimir(original, tipoOriginal) {
  const tal = { datos: original, tipo: tipoOriginal, duracion: null, comprimida: false };
  // Ya viene en Opus (por ejemplo, un pedazo hecho con "Recortar"): no se vuelve a comprimir.
  if (tipoOriginal === 'audio/webm') return tal;
  if (original.byteLength > MAXIMO_PARA_COMPRIMIR || !(await sePuedeComprimir())) return tal;

  let sonido;
  try {
    const contexto = new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: TASA });
    sonido = await contexto.decodeAudioData(original.slice(0)); // slice: decodeAudioData se queda con el buffer
  } catch {
    return tal; // formato que este aparato no sabe leer
  }

  const comprimido = await codificar(sonido, 0, sonido.duration).catch(() => null);
  // Si falló o no ganamos nada (ej. ya venía muy comprimida), mejor la original.
  if (!comprimido || comprimido.byteLength >= original.byteLength) return { ...tal, duracion: sonido.duration };
  return { datos: comprimido, tipo: 'audio/webm', duracion: sonido.duration, comprimida: true };
}

/**
 * Codifica en Opus (WebM) un pedazo de un audio ya decodificado.
 * @param {AudioBuffer} sonido
 * @param {number} desde  segundos
 * @param {number} hasta  segundos
 * @param {{canales?: number, kbps?: number, alAvanzar?: (fraccion: number) => void}} [opciones]
 *        canales: 1 = mezcla a mono (los audios largos, para que pesen menos)
 * @returns {Promise<ArrayBuffer>}
 */
export async function codificar(sonido, desde, hasta, { canales, kbps = KBPS, alAvanzar } = {}) {
  const tasa = sonido.sampleRate;
  const deEntrada = Math.min(sonido.numberOfChannels, 2);
  const salida = Math.min(canales ?? deEntrada, deEntrada);
  const primero = Math.max(0, Math.floor(desde * tasa));
  const ultimo = Math.min(sonido.length, Math.ceil(hasta * tasa));

  const objetivo = new ArrayBufferTarget();
  const muxer = new Muxer({
    target: objetivo,
    audio: { codec: 'A_OPUS', sampleRate: tasa, numberOfChannels: salida },
    firstTimestampBehavior: 'offset',
  });
  let fallo = null;
  const codificador = new AudioEncoder({
    output: (pedazo, meta) => muxer.addAudioChunk(pedazo, meta),
    error: (error) => { fallo = error; },
  });
  codificador.configure({ codec: 'opus', sampleRate: tasa, numberOfChannels: salida, bitrate: kbps * 1000 });

  // Se le va dando de a un segundo, en formato "planar" (un canal tras otro).
  const datosCanales = Array.from({ length: deEntrada }, (_, c) => sonido.getChannelData(c));
  for (let inicio = primero; inicio < ultimo && !fallo; inicio += tasa) {
    const cuadros = Math.min(tasa, ultimo - inicio);
    const plano = new Float32Array(cuadros * salida);
    if (salida === deEntrada) {
      for (let c = 0; c < salida; c++) plano.set(datosCanales[c].subarray(inicio, inicio + cuadros), c * cuadros);
    } else { // estéreo → mono
      const [izquierda, derecha] = datosCanales;
      for (let i = 0; i < cuadros; i++) plano[i] = (izquierda[inicio + i] + derecha[inicio + i]) / 2;
    }
    const pedazo = new AudioData({
      format: 'f32-planar', sampleRate: tasa, numberOfFrames: cuadros, numberOfChannels: salida,
      timestamp: Math.round(((inicio - primero) / tasa) * 1e6), data: plano,
    });
    codificador.encode(pedazo);
    pedazo.close();
    alAvanzar?.((inicio - primero) / Math.max(1, ultimo - primero));
    // No llenar la cola de golpe (en el cel se trabaría).
    while (codificador.encodeQueueSize > 20) await new Promise((r) => setTimeout(r, 5));
  }
  await codificador.flush();
  codificador.close();
  if (fallo) throw fallo;
  muxer.finalize();
  alAvanzar?.(1);
  return objetivo.buffer;
}

/** Huella SHA-256 (en hex) de unos bytes: la misma canción da la misma huella. */
export async function huella(datos) {
  const resumen = await crypto.subtle.digest('SHA-256', datos);
  return [...new Uint8Array(resumen)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
