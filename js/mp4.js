// mp4.js — Abre el audio de un MP4 / M4A largo poco a poco (para el recortador).
//
// El navegador sabe abrir un MP4 entero de golpe, pero un audio de 1 h se vuelve más
// de 1 GB en memoria y la página se cierra. Aquí se lee el índice del archivo (la caja
// "moov"), se toman los pedazos de audio AAC en orden, se decodifican con WebCodecs y
// se van guardando ya en la calidad final. Así solo hace falta la memoria del resultado.

/* ---------- Leer las cajas del MP4 ---------- */

const tipoDe = (v, p) => String.fromCharCode(v.getUint8(p), v.getUint8(p + 1), v.getUint8(p + 2), v.getUint8(p + 3));

/** Las cajas dentro de [desde, hasta): { tipo, ini (donde empieza su contenido), fin }. */
function* cajas(v, desde, hasta) {
  while (desde + 8 <= hasta) {
    let tam = v.getUint32(desde);
    const tipo = tipoDe(v, desde + 4);
    let cabecera = 8;
    if (tam === 1) { tam = Number(v.getBigUint64(desde + 8)); cabecera = 16; }
    else if (tam === 0) tam = hasta - desde;
    if (tam < cabecera) return;
    yield { tipo, ini: desde + cabecera, fin: Math.min(desde + tam, hasta) };
    desde += tam;
  }
}

const hijo = (v, caja, tipo) => caja && [...cajas(v, caja.ini, caja.fin)].find((c) => c.tipo === tipo);

/** Busca la caja "moov" (el índice) sin leer el archivo entero: puede estar al inicio o al final. */
async function leerMoov(blob) {
  let p = 0;
  while (p + 8 <= blob.size) {
    const v = new DataView(await blob.slice(p, p + 16).arrayBuffer());
    let tam = v.getUint32(0);
    const tipo = tipoDe(v, 4);
    if (tam === 1) tam = Number(v.getBigUint64(8));
    else if (tam === 0) tam = blob.size - p;
    if (tam < 8) break;
    if (tipo === 'moov') {
      if (tam > 64 * 1024 * 1024) break; // un índice así de grande no es normal
      return new DataView(await blob.slice(p, p + tam).arrayBuffer());
    }
    p += tam;
  }
  throw new Error('no es un MP4');
}

/** Lee el tamaño de un descriptor del "esds" (1 a 4 bytes). */
function descriptor(v, p) {
  const etiqueta = v.getUint8(p++);
  let largo = 0;
  for (let i = 0; i < 4; i++) {
    const b = v.getUint8(p++);
    largo = (largo << 7) | (b & 0x7f);
    if (!(b & 0x80)) break;
  }
  return { etiqueta, p, largo };
}

/** La configuración AAC (AudioSpecificConfig) de la entrada "mp4a". */
function configAac(v, entrada) {
  const version = v.getUint16(entrada.ini + 8);
  const inicioHijos = entrada.ini + 28 + (version === 1 ? 16 : version === 2 ? 36 : 0);
  const buscar = (desde, hasta) => {
    for (const c of cajas(v, desde, hasta)) {
      if (c.tipo === 'esds') return c;
      if (c.tipo === 'wave') { const dentro = buscar(c.ini, c.fin); if (dentro) return dentro; }
    }
    return null;
  };
  const esds = buscar(inicioHijos, entrada.fin);
  if (!esds) return null;
  let d = descriptor(v, esds.ini + 4);
  if (d.etiqueta !== 0x03) return null;
  let p = d.p + 2;
  const banderas = v.getUint8(p++);
  if (banderas & 0x80) p += 2;
  if (banderas & 0x40) p += v.getUint8(p) + 1;
  if (banderas & 0x20) p += 2;
  d = descriptor(v, p);
  if (d.etiqueta !== 0x04) return null;
  const tipoObjeto = v.getUint8(d.p);
  if (![0x40, 0x66, 0x67, 0x68].includes(tipoObjeto)) return null; // solo AAC
  d = descriptor(v, d.p + 13);
  if (d.etiqueta !== 0x05 || !d.largo) return null;
  return new Uint8Array(v.buffer, v.byteOffset + d.p, d.largo).slice();
}

/**
 * Lee el índice del audio de un MP4/M4A.
 * @returns {Promise<{config: AudioDecoderConfig, escala: number, inicios: Float64Array, tamanos: Uint32Array, tiempos: Float64Array}>}
 */
export async function leerMp4(blob) {
  const v = await leerMoov(blob);
  const moov = { ini: 8, fin: v.byteLength };
  for (const trak of cajas(v, moov.ini, moov.fin)) {
    if (trak.tipo !== 'trak') continue;
    const mdia = hijo(v, trak, 'mdia');
    const hdlr = hijo(v, mdia, 'hdlr');
    if (!hdlr || tipoDe(v, hdlr.ini + 8) !== 'soun') continue;
    const mdhd = hijo(v, mdia, 'mdhd');
    const escala = v.getUint8(mdhd.ini) === 1 ? v.getUint32(mdhd.ini + 20) : v.getUint32(mdhd.ini + 12);
    const stbl = hijo(v, hijo(v, mdia, 'minf'), 'stbl');
    const stsd = hijo(v, stbl, 'stsd');
    const entrada = [...cajas(v, stsd.ini + 8, stsd.fin)][0];
    if (entrada?.tipo !== 'mp4a') throw new Error('el audio no es AAC');
    const descripcion = configAac(v, entrada);
    if (!descripcion) throw new Error('el audio no es AAC');
    let tipoAudio = descripcion[0] >> 3;
    if (tipoAudio === 31) tipoAudio = 32 + (((descripcion[0] & 7) << 3) | (descripcion[1] >> 5));
    const config = {
      codec: `mp4a.40.${tipoAudio}`,
      sampleRate: (v.getUint32(entrada.ini + 24) >>> 16) || escala,
      numberOfChannels: v.getUint16(entrada.ini + 16) || 2,
      description: descripcion,
    };

    // Tamaños, ubicación y tiempo de cada pedazo de audio.
    const stsz = hijo(v, stbl, 'stsz');
    const tamanoFijo = v.getUint32(stsz.ini + 4);
    const cuantos = v.getUint32(stsz.ini + 8);
    const tamanos = new Uint32Array(cuantos);
    for (let i = 0; i < cuantos; i++) tamanos[i] = tamanoFijo || v.getUint32(stsz.ini + 12 + i * 4);

    const stco = hijo(v, stbl, 'stco');
    const co64 = hijo(v, stbl, 'co64');
    const bloques = stco ?? co64;
    const nBloques = v.getUint32(bloques.ini + 4);
    const inicioBloque = (i) => (stco ? v.getUint32(stco.ini + 8 + i * 4) : Number(v.getBigUint64(co64.ini + 8 + i * 8)));

    const stsc = hijo(v, stbl, 'stsc');
    const nStsc = v.getUint32(stsc.ini + 4);
    const reglas = Array.from({ length: nStsc }, (_, i) => ({
      primero: v.getUint32(stsc.ini + 8 + i * 12) - 1,
      porBloque: v.getUint32(stsc.ini + 12 + i * 12),
    }));
    const inicios = new Float64Array(cuantos);
    let muestra = 0;
    for (let b = 0, r = 0; b < nBloques && muestra < cuantos; b++) {
      while (r + 1 < reglas.length && reglas[r + 1].primero <= b) r++;
      let lugar = inicioBloque(b);
      for (let k = 0; k < reglas[r].porBloque && muestra < cuantos; k++) {
        inicios[muestra] = lugar;
        lugar += tamanos[muestra++];
      }
    }

    const stts = hijo(v, stbl, 'stts');
    const tiempos = new Float64Array(cuantos);
    let t = 0;
    muestra = 0;
    for (let i = 0, n = v.getUint32(stts.ini + 4); i < n; i++) {
      const veces = v.getUint32(stts.ini + 8 + i * 8);
      const delta = v.getUint32(stts.ini + 12 + i * 8);
      for (let k = 0; k < veces && muestra < cuantos; k++) { tiempos[muestra++] = t; t += delta; }
    }
    const segundos = tiempos.map((x) => x / escala);
    return { tipo: 'mp4', config, escala, inicios, tamanos, tiempos, segundos };
  }
  throw new Error('no tiene audio');
}

/** ¿Este aparato puede decodificar ese audio por pedazos? */
export async function sePuedeAbrirMp4(info) {
  if (typeof AudioDecoder === 'undefined' || !info) return false;
  try {
    return Boolean((await AudioDecoder.isConfigSupported(info.config)).supported);
  } catch {
    return false;
  }
}

/* ---------- Bajar la calidad mientras se decodifica ---------- */

/**
 * Pasa el audio a la tasa final por partes: promedia las muestras que caen en cada
 * muestra nueva (un filtro sencillo para que no suene metálico) o, si sube, interpola.
 */
function crearRemuestreo(tasaEntrada, tasaSalida, destino) {
  const paso = tasaEntrada / tasaSalida;
  const ancho = Math.max(1, paso);
  const canales = destino.length;
  let resto = destino.map(() => new Float32Array(0));
  let pos = 0;
  let escrito = 0;
  return {
    agregar(entrada) {
      const n = resto[0].length + entrada[0].length;
      const todo = resto.map((r, c) => {
        const t = new Float32Array(n);
        t.set(r);
        t.set(entrada[c], r.length);
        return t;
      });
      const total = destino[0].length;
      while (escrito < total && Math.ceil(pos + ancho / 2) + 1 < n) {
        for (let c = 0; c < canales; c++) {
          const s = todo[c];
          if (paso <= 1) {
            const i = Math.floor(pos);
            const f = pos - i;
            destino[c][escrito] = s[i] * (1 - f) + s[i + 1] * f;
          } else {
            let suma = 0;
            let cuenta = 0;
            for (let i = Math.max(0, Math.ceil(pos - ancho / 2)); i < pos + ancho / 2; i++) { suma += s[i]; cuenta++; }
            destino[c][escrito] = cuenta ? suma / cuenta : 0;
          }
        }
        escrito++;
        pos += paso;
      }
      const corte = Math.max(0, Math.floor(pos - ancho / 2) - 1);
      resto = todo.map((t) => t.slice(corte));
      pos -= corte;
    },
    get escrito() { return escrito; },
  };
}

/* ---------- Decodificar ---------- */

const MAXIMO_POR_LECTURA = 8 * 1024 * 1024;

/**
 * Decodifica todo el audio ya en la calidad elegida. Devuelve algo que se usa igual
 * que un AudioBuffer (sampleRate, numberOfChannels, length, duration, getChannelData).
 */
export async function abrirMp4(blob, info, { tasa, canales }, duracion, { alAvanzar, sigue }) {
  const total = Math.ceil((duracion * 1.02 + 5) * tasa);
  const datos = Array.from({ length: canales }, () => new Float32Array(total));
  let remuestreo = null;
  let fallo = null;

  const decodificador = new AudioDecoder({
    output: (audio) => {
      try {
        remuestreo ??= crearRemuestreo(audio.sampleRate, tasa, datos);
        const planos = Array.from({ length: audio.numberOfChannels }, (_, c) => {
          const plano = new Float32Array(audio.numberOfFrames);
          audio.copyTo(plano, { planeIndex: c, format: 'f32-planar' });
          return plano;
        });
        let entrada;
        if (canales === 1 && planos.length > 1) {
          const mezcla = new Float32Array(audio.numberOfFrames);
          for (let i = 0; i < mezcla.length; i++) mezcla[i] = (planos[0][i] + planos[1][i]) / 2;
          entrada = [mezcla];
        } else {
          entrada = Array.from({ length: canales }, (_, c) => planos[Math.min(c, planos.length - 1)]);
        }
        remuestreo.agregar(entrada);
      } catch (error) {
        fallo ??= error;
      } finally {
        audio.close();
      }
    },
    error: (error) => { fallo ??= error; },
  });
  decodificador.configure(info.config);

  const esperarCola = () => new Promise((listo) => {
    if (decodificador.decodeQueueSize <= 30) return listo();
    const revisar = () => (decodificador.decodeQueueSize <= 30 ? listo() : setTimeout(revisar, 5));
    setTimeout(revisar, 5);
  });

  const { inicios, tamanos, tiempos, escala } = info;
  try {
    for (let i = 0; i < tamanos.length;) {
      if (!sigue()) throw new Error('cerrado');
      if (fallo) throw fallo;
      // Un grupo de pedazos seguidos (sin leer más de 8 MB a la vez: en videos hay imagen en medio).
      const desde = inicios[i];
      let j = i;
      let hasta = desde;
      while (j < tamanos.length && inicios[j] >= desde && inicios[j] + tamanos[j] - desde <= MAXIMO_POR_LECTURA) {
        hasta = Math.max(hasta, inicios[j] + tamanos[j]);
        j++;
      }
      if (j === i) { hasta = inicios[i] + tamanos[i]; j = i + 1; }
      const bytes = new Uint8Array(await blob.slice(desde, hasta).arrayBuffer());
      for (let k = i; k < j; k++) {
        await esperarCola();
        decodificador.decode(new EncodedAudioChunk({
          type: 'key',
          timestamp: Math.round((tiempos[k] / escala) * 1e6),
          data: bytes.subarray(inicios[k] - desde, inicios[k] - desde + tamanos[k]),
        }));
      }
      i = j;
      alAvanzar(i / tamanos.length);
    }
    await decodificador.flush();
    if (fallo) throw fallo;
  } finally {
    if (decodificador.state !== 'closed') decodificador.close();
  }
  const escrito = remuestreo?.escrito ?? 0;
  if (!escrito) throw new Error('Ese archivo no se puede abrir');
  return {
    sampleRate: tasa,
    numberOfChannels: canales,
    length: escrito,
    duration: escrito / tasa,
    getChannelData: (c) => datos[c].subarray(0, escrito),
  };
}
