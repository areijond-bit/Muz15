// mejorar.js — "Mejorar sonido": hace que un audio suene más claro y con más cuerpo,
// sin que se oiga raro.
//
// No inventa lo que el archivo no tiene (eso suena falso): lo "masteriza" con cuidado,
// como se hace en un estudio. Primero MIDE el audio y según eso decide:
//   - Volumen: lo deja al nivel de Spotify/YouTube (-14 dB). Si estaba bajito lo sube;
//     si estaba demasiado fuerte o saturado, lo BAJA (subirle a algo saturado lo empeora).
//   - Si está saturado: no le agrega graves ni compresión (lo ensuciarían más) y suaviza
//     los agudos ásperos que deja la saturación.
//   - Si no: un poco más de graves (cuerpo), menos "lodo", más presencia en las voces,
//     más brillo, estéreo un poco más abierto y un compresor suave.
//   - Siempre: quita el retumbe que no se oye (menos de 30 Hz) y nunca toca el tope.
// Antes de guardar puedes comparar Original / Mejorada al instante.

import { icono } from './iconos.js';
import { codificar, sePuedeComprimir } from './comprimir.js';

// Igual que en el recortador: lo que el aparato aguanta para abrir el audio entero.
const PRESUPUESTO_BYTES = Math.min(1200, (navigator.deviceMemory || 4) * 150) * 1024 * 1024;
const TASA = 48000;
const KBPS = 160; // Opus estéreo a 160 kbps: suena igual que lo que sale del ecualizador
const PICO_MAXIMO = 0.89; // -1 dB: deja espacio para que al guardarlo (Opus) nunca toque el tope
const VOLUMEN_OBJETIVO_DB = -14; // el nivel al que Spotify y YouTube dejan las canciones

const NIVELES = {
  suave: { nombre: 'Suave', fuerza: 0.6 },
  normal: { nombre: 'Normal', fuerza: 1 },
  fuerte: { nombre: 'Fuerte', fuerza: 1.5 },
};

const mmss = (s) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const enDb = (x) => 20 * Math.log10(Math.max(x, 1e-6));

/**
 * Mide el audio: volumen (RMS), pico y cuántas veces "pega en el techo" (saturación:
 * varias muestras seguidas al máximo, que es cuando el sonido se recorta y raspa).
 */
function medir(sonido) {
  let suma = 0;
  let cuenta = 0;
  let pico = 0;
  let recortes = 0;
  for (let c = 0; c < Math.min(2, sonido.numberOfChannels); c++) {
    const datos = sonido.getChannelData(c);
    let seguidas = 0;
    for (let i = 0; i < datos.length; i++) {
      const v = Math.abs(datos[i]);
      if (i % 8 === 0) { suma += v * v; cuenta++; }
      if (v > pico) pico = v;
      if (v >= 0.985) { if (++seguidas === 3) recortes++; } else seguidas = 0;
    }
  }
  const volumen = Math.sqrt(suma / Math.max(1, cuenta)) || 1e-6;
  const porMinuto = recortes / Math.max(1 / 60, sonido.duration / 60);
  return {
    volumen,
    pico,
    porMinuto,
    // Muy fuerte (más de -9 dB, "guerra del volumen") o que se recorta seguido.
    saturada: enDb(volumen) > -9 || porMinuto > 20,
  };
}

/**
 * Arma la cadena de efectos (la misma para escuchar en vivo y para guardar).
 * @param final  ganancia del final (deja el volumen en el nivel objetivo)
 * @returns {{entrada: AudioNode, salida: AudioNode}}
 */
function crearCadena(ctx, { fuerza }, medida, final = 1) {
  const nodos = [];
  const filtro = (tipo, frecuencia, ganancia = 0, q = 0.7) => {
    const f = ctx.createBiquadFilter();
    f.type = tipo;
    f.frequency.value = frecuencia;
    f.gain.value = ganancia;
    f.Q.value = q;
    nodos.push(f);
    return f;
  };

  // Siempre en estéreo (si el audio es mono, se copia a los dos lados). Entra a un nivel
  // parejo para que el compresor trabaje igual con cualquier canción.
  const entrada = ctx.createGain();
  entrada.channelCount = 2;
  entrada.channelCountMode = 'explicit';
  entrada.channelInterpretation = 'speakers';
  entrada.gain.value = Math.min(4, Math.max(0.25, 0.16 / medida.volumen));
  nodos.push(entrada);

  filtro('highpass', 30, 0, 0.7);
  if (medida.saturada) {
    // Saturada: nada de graves extra; se suaviza la aspereza (2.5–5 kHz) y un poquito de aire.
    filtro('peaking', 350, -1 * fuerza, 1);
    filtro('peaking', 3500, -1.5 * fuerza, 0.8);
    filtro('highshelf', 10000, 1 * fuerza);
  } else {
    filtro('lowshelf', 110, 2 * fuerza);
    filtro('peaking', 350, -1.5 * fuerza, 1);
    filtro('peaking', 3200, 2 * fuerza, 0.9);
    filtro('highshelf', 8000, 3.5 * fuerza);
  }

  // Estéreo más abierto: un poco más de lo que es distinto entre izquierda y derecha.
  const ancho = 1 + (medida.saturada ? 0.1 : 0.2) * fuerza;
  const separar = ctx.createChannelSplitter(2);
  const juntar = ctx.createChannelMerger(2);
  const mezcla = (de, a, cuanto) => {
    const g = ctx.createGain();
    g.gain.value = cuanto;
    separar.connect(g, de);
    g.connect(juntar, 0, a);
  };
  mezcla(0, 0, (1 + ancho) / 2);
  mezcla(1, 0, (1 - ancho) / 2);
  mezcla(1, 1, (1 + ancho) / 2);
  mezcla(0, 1, (1 - ancho) / 2);
  for (let i = 0; i < nodos.length - 1; i++) nodos[i].connect(nodos[i + 1]);
  nodos.at(-1).connect(separar);

  let ultimo = juntar;
  if (!medida.saturada) { // a lo saturado ya le sobra compresión
    const compresor = ctx.createDynamicsCompressor();
    compresor.threshold.value = -18;
    compresor.knee.value = 12;
    compresor.ratio.value = 1.3 + 0.4 * fuerza;
    compresor.attack.value = 0.03; // deja pasar el golpe de la batería (si no, suena aplastado)
    compresor.release.value = 0.2;
    ultimo.connect(compresor);
    ultimo = compresor;
  }
  const volumenFinal = ctx.createGain();
  volumenFinal.gain.value = final;
  ultimo.connect(volumenFinal);
  // Red de seguridad: en vivo nada pasa del tope (al guardar ya se ajustó antes).
  const limitador = ctx.createDynamicsCompressor();
  limitador.threshold.value = -1;
  limitador.knee.value = 0;
  limitador.ratio.value = 20;
  limitador.attack.value = 0.001;
  limitador.release.value = 0.08;
  volumenFinal.connect(limitador);
  return { entrada, salida: limitador };
}

/**
 * Procesa el audio entero con un nivel y lo deja en el volumen objetivo sin tocar el tope.
 * @returns {Promise<{buffer: AudioBuffer, final: number}>} final = ganancia que se aplicó al final
 */
async function procesar(sonido, nivel, medida) {
  const offline = new OfflineAudioContext({ numberOfChannels: 2, length: sonido.length, sampleRate: TASA });
  const origen = offline.createBufferSource();
  origen.buffer = sonido;
  const { entrada, salida } = crearCadena(offline, NIVELES[nivel], medida, 1);
  origen.connect(entrada);
  salida.connect(offline.destination);
  origen.start();
  const buffer = await offline.startRendering();
  const salidaMedida = medir(buffer);
  const objetivo = 10 ** (VOLUMEN_OBJETIVO_DB / 20);
  // Al volumen objetivo… pero sin que el punto más fuerte pase de -1 dB.
  const final = Math.min(objetivo / salidaMedida.volumen, PICO_MAXIMO / salidaMedida.pico);
  for (let c = 0; c < 2; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= final;
  }
  return { buffer, final, volumen: salidaMedida.volumen * final };
}

/** Duración sin abrir el audio entero (con un <audio>). */
function duracionDe(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(audio.duration); };
    audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Ese archivo no se puede abrir')); };
    audio.src = url;
  });
}

/**
 * Mejora un audio sin pantalla (al subir canciones): mide, mejora en nivel Normal y lo
 * guarda en Opus 160 kbps.
 * @returns {Promise<{datos: ArrayBuffer, tipo: string, duracion: number, cambioDb: number}>}
 */
export async function mejorarAudio(blob, nivel = 'normal') {
  const duracion = await duracionDe(blob);
  if (!Number.isFinite(duracion) || blob.size + 2 * TASA * 2 * 4 * duracion > PRESUPUESTO_BYTES) {
    throw new Error('es muy largo para mejorarlo en este aparato');
  }
  if (!await sePuedeComprimir(2, TASA)) throw new Error('este aparato no puede guardar el audio mejorado');
  const sonido = await new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: TASA }).decodeAudioData(await blob.arrayBuffer());
  const medida = medir(sonido);
  const { buffer, volumen } = await procesar(sonido, nivel, medida);
  const datos = await codificar(buffer, 0, buffer.duration, { kbps: KBPS });
  return { datos, tipo: 'audio/webm', duracion: buffer.duration, cambioDb: Math.round(enDb(volumen) - enDb(medida.volumen)) };
}

/**
 * @param {object} opciones
 * @param {Blob} opciones.blob
 * @param {string} opciones.titulo   nombre del audio que se guarda
 * @param {(texto: string, ms?: number) => void} opciones.avisar
 * @param {(partes: {titulo: string, datos: ArrayBuffer, tipo: string, duracion: number}[]) => Promise<void>} opciones.alGuardar
 */
export async function abrirMejorador({ blob, titulo, avisar, alGuardar }) {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.preload = 'auto';

  const caja = document.createElement('div');
  caja.className = 'recortador mejorador';
  caja.setAttribute('role', 'dialog');
  caja.setAttribute('aria-label', 'Mejorar sonido');
  caja.innerHTML = `
    <div class="recortador__barra">
      <button class="boton-icono" data-cerrar aria-label="Cerrar">${icono('cerrar')}</button>
      <div class="recortador__titulo"><strong>Mejorar sonido</strong><span></span></div>
      <button class="boton-perfil boton-perfil--acento" data-guardar disabled>Guardar</button>
    </div>
    <p class="recortador__estado">Analizando el audio…</p>
    <div class="mejorador__editor" hidden>
      <p class="mejorador__diagnostico" data-diagnostico></p>
      <div class="mejorador__reproductor">
        <button class="recortador__play" data-play aria-label="Reproducir">${icono('play', 28)}</button>
        <input class="mejorador__barra" type="range" min="0" step="0.1" value="0" aria-label="Posición">
        <span class="mejorador__tiempo" data-tiempo>0:00</span>
      </div>
      <p class="mejorador__etiqueta">Escuchar</p>
      <div class="recortador__elegir" role="group" aria-label="Qué escuchar">
        <button data-version="original">Original</button>
        <button data-version="mejorada">Mejorada</button>
      </div>
      <p class="mejorador__etiqueta">Cuánto mejorar</p>
      <div class="recortador__elegir" role="group" aria-label="Cuánto mejorar">
        ${Object.entries(NIVELES).map(([clave, n]) => `<button data-nivel="${clave}">${n.nombre}</button>`).join('')}
      </div>
      <p class="mejorador__etiqueta">Nombre del audio</p>
      <input class="campo__entrada" data-nombre maxlength="200">
    </div>`;
  document.body.append(caja);
  document.body.classList.add('con-pantalla');
  const $ = (s) => caja.querySelector(s);
  $('.recortador__titulo span').textContent = titulo;
  $('[data-nombre]').value = titulo;

  let ctx = null;
  let cerrado = false;
  const cerrar = () => {
    cerrado = true;
    audio.pause();
    ctx?.close().catch(() => {});
    URL.revokeObjectURL(url);
    caja.remove();
    if (document.querySelector('.pantalla')?.hidden !== false) document.body.classList.remove('con-pantalla');
  };
  $('[data-cerrar]').addEventListener('click', cerrar);

  // ---- Abrir y medir el audio ----
  let sonido;
  let medida;
  try {
    const duracion = await new Promise((resolve, reject) => {
      audio.onloadedmetadata = () => resolve(audio.duration);
      audio.onerror = () => reject(new Error('Ese archivo no se puede abrir'));
    });
    // Abierto + mejorado: dos copias en 48 kHz estéreo.
    if (blob.size + 2 * TASA * 2 * 4 * duracion > PRESUPUESTO_BYTES) {
      throw new Error(`Es muy largo para mejorarlo en este aparato (${mmss(duracion)}). Recórtalo en partes primero.`);
    }
    if (!await sePuedeComprimir(2, TASA)) throw new Error('Este aparato no puede guardar el audio mejorado.');
    sonido = await new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: TASA }).decodeAudioData(await blob.arrayBuffer());
    medida = medir(sonido);
  } catch (error) {
    if (!cerrado) {
      cerrar();
      avisar(`No se pudo abrir para mejorar: ${error.message}`, 5000);
    }
    return;
  }
  if (cerrado) return;

  // ---- Procesar (una vez por nivel) y decir qué se le hizo ----
  let nivel = 'normal';
  let version = 'mejorada';
  const hechas = new Map(); // nivel → resultado (solo se guarda el último, para no llenar la memoria)
  const resultado = async (n) => {
    if (!hechas.has(n)) {
      hechas.clear();
      hechas.set(n, procesar(sonido, n, medida));
    }
    return hechas.get(n);
  };
  const diagnosticar = ({ volumen }) => {
    const cambio = Math.round(enDb(volumen) - enDb(medida.volumen));
    const estado = medida.saturada
      ? 'Este audio está muy fuerte o saturado: se le baja el volumen y se suaviza lo áspero, sin agregarle graves ni compresión.'
      : enDb(medida.volumen) < -20
        ? 'Este audio está bajito: se sube a un volumen normal, con más claridad y cuerpo.'
        : 'Se le da más claridad y cuerpo, con el volumen parejo.';
    const volumenTexto = Math.abs(cambio) < 1 ? 'El volumen queda casi igual.'
      : cambio > 0 ? `Volumen: +${cambio} dB.` : `Volumen: ${cambio} dB (más bajo, más limpio).`;
    $('[data-diagnostico]').textContent = `${estado} ${volumenTexto} Nunca satura.`;
  };

  try {
    diagnosticar(await resultado(nivel));
  } catch (error) {
    if (!cerrado) { cerrar(); avisar(`No se pudo mejorar: ${error.message}`, 5000); }
    return;
  }
  if (cerrado) return;
  $('.recortador__estado').hidden = true;
  $('.mejorador__editor').hidden = false;
  $('[data-guardar]').disabled = false;

  // ---- Escuchar en vivo (Original / Mejorada) ----
  let fuente = null;
  let cadena = null;
  const conectar = async () => {
    if (!ctx) {
      ctx = new AudioContext();
      fuente = ctx.createMediaElementSource(audio);
    }
    const { final } = await resultado(nivel);
    fuente.disconnect();
    cadena?.salida.disconnect();
    cadena = null;
    if (version === 'mejorada') {
      cadena = crearCadena(ctx, NIVELES[nivel], medida, final);
      fuente.connect(cadena.entrada);
      cadena.salida.connect(ctx.destination);
    } else {
      fuente.connect(ctx.destination);
    }
  };
  const pintarBotones = () => {
    for (const b of caja.querySelectorAll('[data-version]')) b.setAttribute('aria-pressed', String(b.dataset.version === version));
    for (const b of caja.querySelectorAll('[data-nivel]')) b.setAttribute('aria-pressed', String(b.dataset.nivel === nivel));
  };
  pintarBotones();
  for (const b of caja.querySelectorAll('[data-version]')) {
    b.addEventListener('click', () => { version = b.dataset.version; pintarBotones(); if (ctx) conectar(); });
  }
  for (const b of caja.querySelectorAll('[data-nivel]')) {
    b.addEventListener('click', async () => {
      nivel = b.dataset.nivel;
      version = 'mejorada';
      pintarBotones();
      $('[data-diagnostico]').textContent = 'Preparando…';
      diagnosticar(await resultado(nivel));
      if (ctx) conectar();
    });
  }

  const barra = $('.mejorador__barra');
  barra.max = String(sonido.duration);
  const play = $('[data-play]');
  play.addEventListener('click', async () => {
    if (!ctx) await conectar();
    await ctx.resume();
    if (audio.paused) audio.play(); else audio.pause();
  });
  audio.addEventListener('play', () => { play.innerHTML = icono('pausa', 28); play.setAttribute('aria-label', 'Pausar'); });
  audio.addEventListener('pause', () => { play.innerHTML = icono('play', 28); play.setAttribute('aria-label', 'Reproducir'); });
  audio.addEventListener('timeupdate', () => {
    barra.value = String(audio.currentTime);
    $('[data-tiempo]').textContent = `${mmss(audio.currentTime)} / ${mmss(sonido.duration)}`;
  });
  barra.addEventListener('input', () => { audio.currentTime = Number(barra.value); });

  // ---- Guardar ----
  const guardar = $('[data-guardar]');
  guardar.addEventListener('click', async () => {
    audio.pause();
    guardar.disabled = true;
    guardar.classList.add('cargando');
    guardar.textContent = 'Mejorando…';
    try {
      const { buffer } = await resultado(nivel);
      const datos = await codificar(buffer, 0, buffer.duration, {
        kbps: KBPS,
        alAvanzar: (f) => { guardar.textContent = `Guardando · ${Math.round(f * 100)}%`; },
      });
      const nombre = $('[data-nombre]').value.trim() || titulo;
      await alGuardar([{ titulo: nombre, datos, tipo: 'audio/webm', duracion: buffer.duration }]);
      cerrar();
    } catch (error) {
      avisar(`No se pudo guardar: ${error.message}`, 5000);
      guardar.disabled = false;
      guardar.classList.remove('cargando');
      guardar.textContent = 'Guardar';
    }
  });
}
