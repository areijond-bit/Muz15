// mejorar.js — "Mejorar sonido": hace que un audio suene más claro y con más cuerpo,
// sin que se oiga raro.
//
// No inventa lo que el archivo no tiene (eso suena falso): lo "masteriza" con cuidado,
// como se hace en un estudio, con pasos suaves:
//   1. Quita el retumbe que no se oye (menos de 30 Hz) y que solo ensucia.
//   2. Ecualizador: un poco más de graves (cuerpo), menos "lodo" en los medios-bajos,
//      más presencia en las voces y más brillo arriba.
//   3. Estéreo un poco más abierto.
//   4. Volumen parejo: un compresor suave y un limitador para que nunca se sature.
// Antes de guardar puedes comparar Original / Mejorada al instante.

import { icono } from './iconos.js';
import { codificar, sePuedeComprimir } from './comprimir.js';

// Igual que en el recortador: lo que el aparato aguanta para abrir el audio entero.
const PRESUPUESTO_BYTES = Math.min(1200, (navigator.deviceMemory || 4) * 150) * 1024 * 1024;
const TASA = 48000;
const KBPS = 160; // Opus estéreo a 160 kbps: suena igual que lo que sale del ecualizador
const PICO_MAXIMO = 0.89; // -1 dB: deja espacio para que al guardarlo (Opus) nunca toque el tope

const NIVELES = {
  suave: { nombre: 'Suave', fuerza: 0.6 },
  normal: { nombre: 'Normal', fuerza: 1 },
  fuerte: { nombre: 'Fuerte', fuerza: 1.5 },
};

const mmss = (s) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/** Qué tan fuerte suena (promedio RMS de una muestra del audio). */
function volumenDe(sonido) {
  let suma = 0;
  let cuenta = 0;
  for (let c = 0; c < Math.min(2, sonido.numberOfChannels); c++) {
    const datos = sonido.getChannelData(c);
    for (let i = 0; i < datos.length; i += 16) { suma += datos[i] * datos[i]; cuenta++; }
  }
  return Math.sqrt(suma / Math.max(1, cuenta)) || 0.0001;
}

/**
 * Arma la cadena de efectos (igual para escuchar en vivo y para guardar).
 * @returns {{entrada: AudioNode, salida: AudioNode}}
 */
function crearCadena(ctx, { fuerza }, volumen) {
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

  // Siempre en estéreo (si el audio es mono, se copia a los dos lados).
  const entrada = ctx.createGain();
  entrada.channelCount = 2;
  entrada.channelCountMode = 'explicit';
  entrada.channelInterpretation = 'speakers';
  // Volumen parejo: los audios bajitos suben, los muy fuertes bajan un poco.
  entrada.gain.value = Math.min(2.5, Math.max(0.6, 0.16 / volumen));
  nodos.push(entrada);

  filtro('highpass', 30, 0, 0.7);
  filtro('lowshelf', 110, 2 * fuerza);
  filtro('peaking', 350, -1.5 * fuerza, 1);
  filtro('peaking', 3200, 2 * fuerza, 0.9);
  filtro('highshelf', 8000, 3.5 * fuerza);

  // Estéreo más abierto: un poco más de lo que es distinto entre izquierda y derecha.
  const ancho = 1 + 0.2 * fuerza;
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

  const compresor = ctx.createDynamicsCompressor();
  compresor.threshold.value = -18;
  compresor.knee.value = 12;
  compresor.ratio.value = 1.3 + 0.4 * fuerza;
  compresor.attack.value = 0.03; // deja pasar el golpe de la batería (si no, suena aplastado)
  compresor.release.value = 0.2;

  const limitador = ctx.createDynamicsCompressor();
  limitador.threshold.value = -1.5;
  limitador.knee.value = 0;
  limitador.ratio.value = 20;
  limitador.attack.value = 0.001;
  limitador.release.value = 0.08;

  for (let i = 0; i < nodos.length - 1; i++) nodos[i].connect(nodos[i + 1]);
  nodos.at(-1).connect(separar);
  juntar.connect(compresor);
  compresor.connect(limitador);
  return { entrada, salida: limitador };
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
      <p class="mejorador__ayuda">Más claro, con más cuerpo y el volumen parejo, sin saturar. Escúchalo y compara con el original antes de guardar.</p>
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
  let volumen;
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
    volumen = volumenDe(sonido);
  } catch (error) {
    if (!cerrado) {
      cerrar();
      avisar(`No se pudo abrir para mejorar: ${error.message}`, 5000);
    }
    return;
  }
  if (cerrado) return;
  $('.recortador__estado').hidden = true;
  $('.mejorador__editor').hidden = false;
  $('[data-guardar]').disabled = false;

  // ---- Escuchar en vivo (Original / Mejorada) ----
  let nivel = 'normal';
  let version = 'mejorada';
  let fuente = null;
  let cadena = null;
  const conectar = () => {
    if (!ctx) {
      ctx = new AudioContext();
      fuente = ctx.createMediaElementSource(audio);
    }
    fuente.disconnect();
    cadena?.salida.disconnect();
    cadena = null;
    if (version === 'mejorada') {
      cadena = crearCadena(ctx, NIVELES[nivel], volumen);
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
    b.addEventListener('click', () => { nivel = b.dataset.nivel; version = 'mejorada'; pintarBotones(); if (ctx) conectar(); });
  }

  const barra = $('.mejorador__barra');
  barra.max = String(sonido.duration);
  const play = $('[data-play]');
  play.addEventListener('click', async () => {
    if (!ctx) conectar();
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
      const offline = new OfflineAudioContext({ numberOfChannels: 2, length: sonido.length, sampleRate: TASA });
      const origen = offline.createBufferSource();
      origen.buffer = sonido;
      const { entrada, salida } = crearCadena(offline, NIVELES[nivel], volumen);
      origen.connect(entrada);
      salida.connect(offline.destination);
      origen.start();
      const mejorada = await offline.startRendering();
      // Que el punto más fuerte quede justo debajo del tope (nunca satura).
      let pico = 0;
      for (let c = 0; c < 2; c++) for (const v of mejorada.getChannelData(c)) pico = Math.max(pico, Math.abs(v));
      if (pico > PICO_MAXIMO) {
        const factor = PICO_MAXIMO / pico;
        for (let c = 0; c < 2; c++) { const d = mejorada.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= factor; }
      }
      const datos = await codificar(mejorada, 0, mejorada.duration, {
        kbps: KBPS,
        alAvanzar: (f) => { guardar.textContent = `Guardando · ${Math.round(f * 100)}%`; },
      });
      const nombre = $('[data-nombre]').value.trim() || titulo;
      await alGuardar([{ titulo: nombre, datos, tipo: 'audio/webm', duracion: mejorada.duration }]);
      cerrar();
    } catch (error) {
      avisar(`No se pudo guardar: ${error.message}`, 5000);
      guardar.disabled = false;
      guardar.classList.remove('cargando');
      guardar.textContent = 'Guardar';
    }
  });
}
