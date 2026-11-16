// cortar.js — Corta un MP3 o un MP4/M4A SIN volver a comprimirlo (calidad original).
//
// Un MP3 son "cuadros" de ~26 ms pegados uno tras otro, y un M4A son pedazos AAC con
// su índice. Cortar es tomar los cuadros de un tramo y guardarlos tal cual: el sonido
// queda idéntico al original (no se decodifica ni se vuelve a codificar).
//
// Solo si una parte pasa del límite de la nube (50 MB) se vuelve a codificar, en Opus
// estéreo con la mayor calidad que quepa.

import { Muxer as MuxerMp4, ArrayBufferTarget as DestinoMp4 } from './vendor/mp4-muxer.mjs';
import { Muxer as MuxerWebm, ArrayBufferTarget as DestinoWebm } from './vendor/webm-muxer.mjs';

/* ---------- Índice de un MP3 ---------- */

const KBPS_MPEG1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const KBPS_MPEG2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const TASAS = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Lee la cabecera de un cuadro MP3 (capa III) en p: { largo, muestras, tasa } o null. */
function cuadroEn(b, p) {
  if (p + 4 > b.length || b[p] !== 0xff || (b[p + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[p + 1] >> 3) & 3;
  const capa = (b[p + 1] >> 1) & 3;
  const indiceKbps = b[p + 2] >> 4;
  const indiceTasa = (b[p + 2] >> 2) & 3;
  if (version === 1 || capa !== 1 || indiceKbps === 0 || indiceKbps === 15 || indiceTasa === 3) return null;
  const kbps = (version === 3 ? KBPS_MPEG1 : KBPS_MPEG2)[indiceKbps];
  const tasa = TASAS[version][indiceTasa];
  const relleno = (b[p + 2] >> 1) & 1;
  const largo = Math.floor(((version === 3 ? 144 : 72) * kbps * 1000) / tasa) + relleno;
  return { largo, muestras: version === 3 ? 1152 : 576, tasa };
}

/**
 * Lista los cuadros de un MP3: dónde empieza cada uno y en qué segundo.
 * @returns {Promise<{tipo: 'mp3', inicios: Float64Array, tamanos: Uint32Array, segundos: Float64Array, tasa: number}>}
 */
export async function leerMp3(blob) {
  const b = new Uint8Array(await blob.arrayBuffer());
  let p = 0;
  const inicios = [];
  const tamanos = [];
  const segundos = [];
  let t = 0;
  let tasa = 0;
  while (p + 4 <= b.length) {
    // Etiquetas ID3 (al inicio, o en medio si el archivo son varios pegados).
    if (b[p] === 0x49 && b[p + 1] === 0x44 && b[p + 2] === 0x33 && p + 10 <= b.length) {
      const tam = ((b[p + 6] & 0x7f) << 21) | ((b[p + 7] & 0x7f) << 14) | ((b[p + 8] & 0x7f) << 7) | (b[p + 9] & 0x7f);
      p += 10 + tam + ((b[p + 5] & 0x10) ? 10 : 0);
      continue;
    }
    const cuadro = cuadroEn(b, p);
    // Un cuadro válido va seguido de otro (así no se confunde con bytes sueltos).
    if (!cuadro || (p + cuadro.largo + 4 <= b.length && !cuadroEn(b, p + cuadro.largo) && b[p + cuadro.largo] !== 0x49)) {
      p++;
      continue;
    }
    // El primer cuadro "Xing"/"Info" solo dice la duración del archivo entero: no se copia.
    if (!inicios.length && /Xing|Info/.test(String.fromCharCode(...b.subarray(p + 4, Math.min(p + 40, b.length))))) {
      p += cuadro.largo;
      continue;
    }
    inicios.push(p);
    tamanos.push(cuadro.largo);
    segundos.push(t);
    tasa ||= cuadro.tasa;
    t += cuadro.muestras / cuadro.tasa;
    p += cuadro.largo;
  }
  if (inicios.length < 10) throw new Error('no es un MP3');
  return { tipo: 'mp3', inicios: Float64Array.from(inicios), tamanos: Uint32Array.from(tamanos), segundos: Float64Array.from(segundos), tasa };
}

/**
 * Un cuadro "Xing" al inicio dice cuántos cuadros y bytes tiene el MP3: sin él, en los
 * MP3 de calidad variable la duración se calcula mal y adelantar cae en otro lugar.
 */
function cuadroXing(mp3, cuadros) {
  const cabeza = mp3.slice(0, 4);
  cabeza[2] &= ~0x02; // sin relleno
  const { largo } = cuadroEn(cabeza, 0) ?? cuadroEn(mp3, 0);
  const xing = new Uint8Array(largo);
  xing.set(cabeza);
  const mpeg1 = ((cabeza[1] >> 3) & 3) === 3;
  const mono = cabeza[3] >> 6 === 3;
  const p = 4 + (mpeg1 ? (mono ? 17 : 32) : (mono ? 9 : 17));
  const v = new DataView(xing.buffer);
  xing.set([0x58, 0x69, 0x6e, 0x67], p); // "Xing"
  v.setUint32(p + 4, 3); // trae: cuadros y bytes
  v.setUint32(p + 8, cuadros);
  v.setUint32(p + 12, mp3.length + largo);
  return xing;
}

/* ---------- Tramos ---------- */

/** Índices [primero, fin) de los cuadros entre desde y hasta (segundos). */
function tramo(indice, desde, hasta) {
  const s = indice.segundos;
  let primero = 0;
  while (primero < s.length && s[primero] < desde - 1e-6) primero++;
  let fin = primero;
  while (fin < s.length && s[fin] < hasta - 1e-6) fin++;
  return [primero, fin];
}

/** Cuánto pesa la parte si se copia tal cual. */
export function pesoSinPerdida(indice, desde, hasta) {
  const [primero, fin] = tramo(indice, desde, hasta);
  let total = 0;
  for (let i = primero; i < fin; i++) total += indice.tamanos[i];
  return total;
}

/** Lee los cuadros [primero, fin) de a pocos MB y se los da a "usar" uno por uno. */
async function recorrer(blob, indice, primero, fin, usar, alAvanzar) {
  const { inicios, tamanos } = indice;
  for (let i = primero; i < fin;) {
    const desde = inicios[i];
    let j = i;
    while (j < fin && inicios[j] >= desde && inicios[j] + tamanos[j] - desde <= 8 * 1024 * 1024) j++;
    if (j === i) j = i + 1;
    const hasta = Math.max(...Array.from({ length: j - i }, (_, k) => inicios[i + k] + tamanos[i + k]));
    const bytes = new Uint8Array(await blob.slice(desde, hasta).arrayBuffer());
    for (let k = i; k < j; k++) await usar(k, bytes.subarray(inicios[k] - desde, inicios[k] - desde + tamanos[k]));
    i = j;
    alAvanzar?.((i - primero) / Math.max(1, fin - primero));
  }
}

/**
 * La parte con la calidad original, sin volver a codificar.
 * @param indice  de leerMp3 o de leerMp4 (mp4.js)
 * @returns {Promise<{datos: ArrayBuffer, tipo: string}>}
 */
export async function cortarSinPerdida(blob, indice, desde, hasta, alAvanzar) {
  const [primero, fin] = tramo(indice, desde, hasta);
  if (fin <= primero) throw new Error('Esa parte está vacía');

  if (indice.tipo === 'mp3') {
    const salida = new Uint8Array(pesoSinPerdida(indice, desde, hasta));
    let lugar = 0;
    await recorrer(blob, indice, primero, fin, (_, datos) => { salida.set(datos, lugar); lugar += datos.length; }, alAvanzar);
    const xing = cuadroXing(salida, fin - primero);
    const conDuracion = new Uint8Array(xing.length + salida.length);
    conDuracion.set(xing);
    conDuracion.set(salida, xing.length);
    return { datos: conDuracion.buffer, tipo: 'audio/mpeg' };
  }

  // MP4 / M4A: los mismos pedazos AAC en un M4A nuevo.
  const { config, escala, tiempos } = indice;
  const destino = new DestinoMp4();
  const muxer = new MuxerMp4({
    target: destino,
    audio: { codec: 'aac', numberOfChannels: config.numberOfChannels, sampleRate: config.sampleRate },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  const microsegundos = (t) => Math.round((t / escala) * 1e6);
  await recorrer(blob, indice, primero, fin, (k, datos) => {
    const siguiente = k + 1 < tiempos.length ? tiempos[k + 1] : tiempos[k] + 1024;
    muxer.addAudioChunkRaw(datos.slice(), 'key', microsegundos(tiempos[k]), microsegundos(siguiente - tiempos[k]),
      k === primero ? { decoderConfig: config } : undefined);
  }, alAvanzar);
  muxer.finalize();
  return { datos: destino.buffer, tipo: 'audio/mp4' };
}

/* ---------- Si no cabe en la nube: volver a codificar, en estéreo ---------- */

/**
 * Decodifica el tramo poco a poco y lo codifica en Opus estéreo (sin guardar todo el
 * audio en memoria). Para partes que copiadas tal cual pesarían más de 50 MB.
 * @returns {Promise<{datos: ArrayBuffer, tipo: string}>}
 */
export async function recodificar(blob, indice, desde, hasta, kbps, alAvanzar) {
  const [primero, fin] = tramo(indice, desde, hasta);
  let tasa = indice.tipo === 'mp3' ? 48000 : indice.config.sampleRate;
  let canales = 2;
  const destino = new DestinoWebm();
  let muxer = null;
  let codificador = null;
  let fallo = null;
  let enviados = 0;

  const preparar = (tasaEntrada) => {
    tasa = tasaEntrada;
    muxer = new MuxerWebm({ target: destino, audio: { codec: 'A_OPUS', sampleRate: tasa, numberOfChannels: canales }, firstTimestampBehavior: 'offset' });
    codificador = new AudioEncoder({ output: (p, meta) => muxer.addAudioChunk(p, meta), error: (e) => { fallo ??= e; } });
    codificador.configure({ codec: 'opus', sampleRate: tasa, numberOfChannels: canales, bitrate: kbps * 1000 });
  };
  // Le da al codificador un pedazo de sonido (planar, estéreo).
  const dar = async (planos, tasaEntrada) => {
    if (!codificador) preparar(tasaEntrada);
    const cuadros = planos[0].length;
    const datos = new Float32Array(cuadros * canales);
    for (let c = 0; c < canales; c++) datos.set(planos[Math.min(c, planos.length - 1)], c * cuadros);
    const audio = new AudioData({ format: 'f32-planar', sampleRate: tasa, numberOfFrames: cuadros, numberOfChannels: canales, timestamp: Math.round((enviados / tasa) * 1e6), data: datos });
    enviados += cuadros;
    codificador.encode(audio);
    audio.close();
    while (codificador.encodeQueueSize > 20) await new Promise((r) => setTimeout(r, 5));
  };

  if (indice.tipo === 'mp3') {
    // Pedazos de ~1 minuto, cortados en cuadros: el navegador los abre ya a 48 kHz.
    const PEDAZO = 2400;
    for (let i = primero; i < fin && !fallo; i += PEDAZO) {
      const j = Math.min(fin, i + PEDAZO);
      const bytes = await blob.slice(indice.inicios[i], indice.inicios[j - 1] + indice.tamanos[j - 1]).arrayBuffer();
      const sonido = await new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: 48000 }).decodeAudioData(bytes);
      await dar(Array.from({ length: sonido.numberOfChannels }, (_, c) => sonido.getChannelData(c)), 48000);
      alAvanzar?.((j - primero) / (fin - primero));
    }
  } else {
    const pendientes = [];
    const decodificador = new AudioDecoder({
      output: (audio) => {
        const planos = Array.from({ length: audio.numberOfChannels }, (_, c) => {
          const plano = new Float32Array(audio.numberOfFrames);
          audio.copyTo(plano, { planeIndex: c, format: 'f32-planar' });
          return plano;
        });
        pendientes.push({ planos, tasa: audio.sampleRate });
        audio.close();
      },
      error: (e) => { fallo ??= e; },
    });
    decodificador.configure(indice.config);
    const vaciar = async () => { while (pendientes.length) { const p = pendientes.shift(); await dar(p.planos, p.tasa); } };
    await recorrer(blob, indice, primero, fin, async (k, datos) => {
      if (fallo) throw fallo;
      decodificador.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round((indice.tiempos[k] / indice.escala) * 1e6), data: datos }));
      while (decodificador.decodeQueueSize > 30) await new Promise((r) => setTimeout(r, 5));
      await vaciar();
    }, alAvanzar);
    await decodificador.flush();
    decodificador.close();
    await vaciar();
  }
  if (fallo) throw fallo;
  await codificador.flush();
  codificador.close();
  if (fallo) throw fallo;
  muxer.finalize();
  return { datos: destino.buffer, tipo: 'audio/webm' };
}
