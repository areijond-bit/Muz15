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
export async function sePuedeComprimir(canales = 2) {
  if (typeof AudioEncoder === 'undefined' || typeof OfflineAudioContext === 'undefined') return false;
  try {
    const { supported } = await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: TASA, numberOfChannels: canales, bitrate: KBPS * 1000 });
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
  if (original.byteLength > MAXIMO_PARA_COMPRIMIR || !(await sePuedeComprimir())) return tal;

  let sonido;
  try {
    const contexto = new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: TASA });
    sonido = await contexto.decodeAudioData(original.slice(0)); // slice: decodeAudioData se queda con el buffer
  } catch {
    return tal; // formato que este aparato no sabe leer
  }

  const canales = Math.min(sonido.numberOfChannels, 2);
  const objetivo = new ArrayBufferTarget();
  const muxer = new Muxer({
    target: objetivo,
    audio: { codec: 'A_OPUS', sampleRate: TASA, numberOfChannels: canales },
    firstTimestampBehavior: 'offset',
  });

  let fallo = null;
  const codificador = new AudioEncoder({
    output: (pedazo, meta) => muxer.addAudioChunk(pedazo, meta),
    error: (error) => { fallo = error; },
  });
  codificador.configure({ codec: 'opus', sampleRate: TASA, numberOfChannels: canales, bitrate: KBPS * 1000 });

  // Se le va dando de a un segundo, en formato "planar" (un canal tras otro).
  const datosCanales = Array.from({ length: canales }, (_, c) => sonido.getChannelData(c));
  for (let inicio = 0; inicio < sonido.length && !fallo; inicio += TASA) {
    const cuadros = Math.min(TASA, sonido.length - inicio);
    const plano = new Float32Array(cuadros * canales);
    for (let c = 0; c < canales; c++) plano.set(datosCanales[c].subarray(inicio, inicio + cuadros), c * cuadros);
    const pedazo = new AudioData({
      format: 'f32-planar', sampleRate: TASA, numberOfFrames: cuadros, numberOfChannels: canales,
      timestamp: Math.round((inicio / TASA) * 1e6), data: plano,
    });
    codificador.encode(pedazo);
    pedazo.close();
    // No llenar la cola de golpe (en el cel se trabaría).
    while (codificador.encodeQueueSize > 20) await new Promise((r) => setTimeout(r, 5));
  }
  await codificador.flush();
  codificador.close();
  if (fallo) return tal;
  muxer.finalize();

  const comprimido = objetivo.buffer;
  // Si por alguna razón no ganamos nada (ej. ya venía muy comprimida), mejor la original.
  if (comprimido.byteLength >= original.byteLength) return { ...tal, duracion: sonido.duration };
  return { datos: comprimido, tipo: 'audio/webm', duracion: sonido.duration, comprimida: true };
}

/** Huella SHA-256 (en hex) de unos bytes: la misma canción da la misma huella. */
export async function huella(datos) {
  const resumen = await crypto.subtle.digest('SHA-256', datos);
  return [...new Uint8Array(resumen)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
