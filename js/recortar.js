// recortar.js — Recortar un audio antes de subirlo, como un editor de video sencillo.
//
//   ┌ onda del audio ─────────────────────────────┐
//   │▁▃▅▇▅▃▁│▂▄▆█▆▄▂│▁▃▅▇▅▃▁   ← tocas para moverte  │
//   └────────────────┴─────── cortes ──────────────┘
//   Parte 1  0:00 – 12:30   [✓ Guardar | Quitar]  nombre…
//   Parte 2 12:30 – 14:00   [Guardar | ✕ Quitar]
//
// Pones cortes donde quieras y a cada parte le dices Subir o Borrar. Cada parte que
// se sube queda como su propio audio (así un audio de 1 h se vuelve 5, o le quitas un
// pedazo del inicio). Todo pasa en el teléfono/PC; nada se sube hasta que guardas.

import { icono } from './iconos.js';
import { codificar, sePuedeComprimir } from './comprimir.js';
import { leerMp4, sePuedeAbrirMp4, abrirMp4 } from './mp4.js';

// Cuánta memoria puede usar abrir el audio (se guarda completo para poder cortarlo).
// deviceMemory = GB del aparato (aprox., máx. 8): un teléfono de 4 GB → 600 MB. Si se pasa,
// el navegador cierra la página, así que mejor avisar antes.
const PRESUPUESTO_BYTES = Math.min(1200, (navigator.deviceMemory || 4) * 150) * 1024 * 1024;
// Al abrir un archivo entero, el navegador primero lo pasa a 48 kHz estéreo (≈ 23 MB por minuto).
const ABIERTO_POR_SEGUNDO = 48000 * 2 * 4;
// Los MP3, MP4 y M4A largos se abren por pedazos (así un audio de horas no necesita toda esa memoria a la vez).
const PEDAZO_MP3_BYTES = 4 * 1024 * 1024;
// De mejor a peor: la primera que quepa. En los largos baja la calidad para no trabarse.
const CALIDADES = [
  { tasa: 48000, canales: 2, kbps: 96, nombre: 'completa' },
  { tasa: 24000, canales: 1, kbps: 48, nombre: 'buena (audio largo)' },
  { tasa: 16000, canales: 1, kbps: 32, nombre: 'media (audio muy largo)' },
  { tasa: 12000, canales: 1, kbps: 24, nombre: 'básica (audio muy largo)' },
];
const PARTE_MINIMA_S = 3;
// La nube acepta archivos de hasta 50 MB: las partes muy largas se guardan un poco más ligeras.
const MAXIMO_PARTE_KB = 45 * 1024;
// Tus cortes se recuerdan por archivo: si se cierra o algo falla, al abrirlo otra vez siguen ahí.
const claveCortes = (blob) => `muz15-cortes:${blob.name ?? ''}:${blob.size}`;

const mmss = (s) => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const seg = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${seg}` : `${m}:${seg}`;
};

const esMp3 = (blob) => /mpeg|mp3/.test(blob.type) || /\.mp3$/i.test(blob.name ?? '');

/**
 * Abre un MP3 por pedazos y lo deja ya en la calidad elegida. Devuelve algo que se usa
 * igual que un AudioBuffer (sampleRate, numberOfChannels, length, duration, getChannelData).
 */
async function abrirPorPedazos(blob, { tasa, canales }, duracion, { alAvanzar, sigue }) {
  const total = Math.ceil((duracion * 1.02 + 5) * tasa); // la duración de algunos MP3 es aproximada
  const datos = Array.from({ length: canales }, () => new Float32Array(total));
  let escrito = 0;
  for (let desde = 0; desde < blob.size && escrito < total; desde += PEDAZO_MP3_BYTES) {
    if (!sigue()) throw new Error('cerrado');
    let parte;
    try {
      const bytes = await blob.slice(desde, desde + PEDAZO_MP3_BYTES).arrayBuffer();
      parte = await new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: tasa }).decodeAudioData(bytes);
    } catch {
      continue; // un pedazo sin audio (por ejemplo, solo la portada)
    }
    const n = Math.min(parte.length, total - escrito);
    const entrada = Array.from({ length: parte.numberOfChannels }, (_, c) => parte.getChannelData(c));
    if (canales === 1 && entrada.length > 1) {
      const [izq, der] = entrada;
      for (let i = 0; i < n; i++) datos[0][escrito + i] = (izq[i] + der[i]) / 2;
    } else {
      for (let c = 0; c < canales; c++) datos[c].set(entrada[Math.min(c, entrada.length - 1)].subarray(0, n), escrito);
    }
    escrito += n;
    alAvanzar(Math.min(1, (desde + PEDAZO_MP3_BYTES) / blob.size));
  }
  if (!escrito) throw new Error('Ese archivo no se puede abrir');
  return {
    sampleRate: tasa,
    numberOfChannels: canales,
    length: escrito,
    duration: escrito / tasa,
    getChannelData: (c) => datos[c].subarray(0, escrito),
  };
}

/** Duración sin decodificar (con un <audio>). */
function duracionDe(url) {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onerror = () => reject(new Error('Ese archivo no se puede abrir'));
    audio.onloadedmetadata = () => {
      if (Number.isFinite(audio.duration)) return resolve(audio.duration);
      // Algunos WebM no dicen su duración hasta ir al final.
      audio.currentTime = 1e9;
      audio.ontimeupdate = () => { audio.ontimeupdate = null; resolve(audio.duration); };
    };
    audio.src = url;
  });
}

/**
 * @param {object} opciones
 * @param {Blob} opciones.blob           el audio (o video)
 * @param {string} opciones.titulo       para nombrar las partes
 * @param {(texto: string, ms?: number) => void} opciones.avisar
 * @param {(partes: {titulo: string, datos: ArrayBuffer, tipo: string, duracion: number}[]) => Promise<void>} opciones.alGuardar
 */
export async function abrirRecortador({ blob, titulo, avisar, alGuardar }) {
  const url = URL.createObjectURL(blob);
  const reproductor = new Audio(url);
  reproductor.preload = 'auto';

  const caja = document.createElement('div');
  caja.className = 'recortador';
  caja.setAttribute('role', 'dialog');
  caja.setAttribute('aria-label', 'Recortar audio');
  caja.innerHTML = `
    <div class="recortador__barra">
      <button class="boton-icono" data-cerrar aria-label="Cerrar">${icono('cerrar')}</button>
      <div class="recortador__titulo"><strong>Recortar</strong><span></span></div>
      <button class="boton-perfil boton-perfil--acento" data-guardar disabled>Guardar</button>
    </div>
    <p class="recortador__estado">Preparando el audio…</p>
    <div class="recortador__editor" hidden>
      <canvas class="recortador__onda" height="140" aria-label="Onda del audio: toca para moverte"></canvas>
      <div class="recortador__tiempos"><span data-actual>0:00</span><span data-total>0:00</span></div>
      <div class="recortador__controles">
        <button class="boton-perfil" data-mover="-10">−10 s</button>
        <button class="boton-perfil" data-mover="-1">−1 s</button>
        <button class="recortador__play" data-play aria-label="Reproducir">${icono('play', 28)}</button>
        <button class="boton-perfil" data-mover="1">+1 s</button>
        <button class="boton-perfil" data-mover="10">+10 s</button>
      </div>
      <button class="boton boton--primario boton--ancho recortador__cortar" data-cortar>${icono('regla', 20)} Cortar aquí</button>
      <p class="recortador__ayuda">Pon cortes donde quieras. En cada parte elige <strong>Guardar</strong> (se vuelve su propio audio) o <strong>Quitar</strong> (se tira).</p>
      <ol class="recortador__partes"></ol>
    </div>`;
  document.body.append(caja);
  document.body.classList.add('con-pantalla');
  const $ = (s) => caja.querySelector(s);
  $('.recortador__titulo span').textContent = titulo;

  let cerrado = false;
  const cerrar = () => {
    cerrado = true;
    reproductor.pause();
    URL.revokeObjectURL(url);
    caja.remove();
    window.removeEventListener('resize', dibujar);
    // Si el reproductor grande sigue abierto, la página sigue sin desplazarse.
    if (document.querySelector('.pantalla')?.hidden !== false) document.body.classList.remove('con-pantalla');
  };
  $('[data-cerrar]').addEventListener('click', cerrar);

  // ---- Abrir el audio (con la mejor calidad que quepa en memoria) ----
  let sonido;
  let calidad;
  let duracion;
  try {
    duracion = await duracionDe(url);
    // La mejor calidad que quepa en la memoria de este aparato: entero, o (MP3) por pedazos.
    let porPedazos = false;
    // MP4 / M4A (también videos): se lee su índice para abrir solo el audio, por pedazos.
    const mp4 = esMp3(blob) ? null : await leerMp4(blob).catch(() => null);
    const sePuedePorPedazos = esMp3(blob) || await sePuedeAbrirMp4(mp4);
    const pedazoAbierto = mp4 ? 16 * 1024 * 1024 : ABIERTO_POR_SEGUNDO * duracion * Math.min(1, PEDAZO_MP3_BYTES / blob.size);
    for (const c of CALIDADES) {
      if (!await sePuedeComprimir(c.canales, c.tasa)) continue;
      const entero = blob.size + ABIERTO_POR_SEGUNDO * duracion + c.tasa * 2 * 4 * duracion; // quedan los 2 canales
      const pedazos = PEDAZO_MP3_BYTES + pedazoAbierto + c.tasa * c.canales * 4 * duracion;
      if (entero <= PRESUPUESTO_BYTES) { calidad = c; break; }
      if (sePuedePorPedazos && pedazos <= PRESUPUESTO_BYTES) { calidad = c; porPedazos = true; break; }
    }
    if (!calidad) {
      throw new Error(sePuedePorPedazos
        ? `Es muy largo para recortarlo en este aparato (${mmss(duracion)}).`
        : `Es muy pesado para abrirlo en este aparato (${mmss(duracion)}, ${Math.round(blob.size / 1048576)} MB). Pásalo a MP3 o M4A y se puede recortar aunque dure horas.`);
    }
    if (porPedazos) {
      const opciones = {
        sigue: () => !cerrado,
        alAvanzar: (f) => { $('.recortador__estado').textContent = `Preparando el audio… ${Math.round(f * 100)}%`; },
      };
      sonido = mp4
        ? await abrirMp4(blob, mp4, calidad, duracion, opciones)
        : await abrirPorPedazos(blob, calidad, duracion, opciones);
    } else {
      const contexto = new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: calidad.tasa });
      sonido = await contexto.decodeAudioData(await blob.arrayBuffer());
    }
    duracion = sonido.duration;
  } catch (error) {
    if (!cerrado) {
      cerrar();
      avisar(`No se pudo abrir para recortar: ${error.message}`, 5000);
    }
    return;
  }
  if (cerrado) return;
  $('.recortador__estado').textContent = calidad.tasa < 48000 ? `Audio largo: se guarda en calidad ${calidad.nombre}.` : '';
  $('.recortador__estado').hidden = calidad.tasa === 48000;
  $('.recortador__editor').hidden = false;
  $('[data-total]').textContent = mmss(duracion);
  $('[data-guardar]').disabled = false;

  // ---- La onda (picos) ----
  const lienzo = $('.recortador__onda');
  const PICOS = 1200;
  const picos = new Float32Array(PICOS);
  {
    const canalesOnda = Array.from({ length: Math.min(2, sonido.numberOfChannels) }, (_, c) => sonido.getChannelData(c));
    const porPico = Math.max(1, Math.floor(sonido.length / PICOS));
    const paso = Math.max(1, Math.floor(porPico / 64)); // no hace falta mirar cada muestra
    let maximo = 0;
    for (let p = 0; p < PICOS; p++) {
      let pico = 0;
      for (let i = p * porPico; i < (p + 1) * porPico && i < sonido.length; i += paso) {
        for (const datos of canalesOnda) pico = Math.max(pico, Math.abs(datos[i]));
      }
      picos[p] = pico;
      maximo = Math.max(maximo, pico);
    }
    if (maximo > 0) for (let p = 0; p < PICOS; p++) picos[p] /= maximo;
  }

  // ---- Las partes ----
  let partes = [{ inicio: 0, fin: duracion, subir: true, nombre: null }];
  try {
    const guardadas = JSON.parse(localStorage.getItem(claveCortes(blob)));
    if (Array.isArray(guardadas) && guardadas.length > 1 && Math.abs(guardadas.at(-1).fin - duracion) < 2) {
      partes = guardadas;
      avisar('Se recuperaron los cortes que habías hecho en este archivo.', 4000);
    }
  } catch { /* nada */ }
  const recordarCortes = () => {
    try { localStorage.setItem(claveCortes(blob), JSON.stringify(partes)); } catch { /* nada */ }
  };
  const nombreDe = (parte, i) => parte.nombre ?? (partes.filter((p) => p.subir).length > 1 || partes.length > 1 ? `${titulo} (parte ${i + 1})` : titulo);
  const estilo = getComputedStyle(document.documentElement);
  const color = (nombre, respaldo) => estilo.getPropertyValue(nombre).trim() || respaldo;

  function dibujar() {
    const ancho = lienzo.clientWidth || 600;
    const escala = window.devicePixelRatio || 1;
    if (lienzo.width !== Math.round(ancho * escala)) lienzo.width = Math.round(ancho * escala);
    const alto = lienzo.height;
    const ctx = lienzo.getContext('2d');
    ctx.setTransform(escala, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ancho, alto);
    const acento = color('--color-acento', '#a8ff1a');
    const suave = color('--color-texto-suave', '#888');
    // Fondo de cada parte: verde = se sube, oscuro = se borra
    for (const parte of partes) {
      const x0 = (parte.inicio / duracion) * ancho;
      const x1 = (parte.fin / duracion) * ancho;
      ctx.fillStyle = parte.subir ? 'rgba(168,255,26,0.08)' : 'rgba(255,77,109,0.10)';
      ctx.fillRect(x0, 0, x1 - x0, alto);
    }
    const barras = Math.min(PICOS, Math.floor(ancho / 2));
    for (let b = 0; b < barras; b++) {
      const segundo = ((b + 0.5) / barras) * duracion;
      const parte = partes.find((p) => segundo >= p.inicio && segundo < p.fin) ?? partes.at(-1);
      const valor = picos[Math.floor((b / barras) * PICOS)];
      const h = Math.max(2, valor * (alto - 12));
      ctx.fillStyle = parte.subir ? acento : suave;
      ctx.globalAlpha = parte.subir ? 0.9 : 0.35;
      ctx.fillRect((b / barras) * ancho, (alto - h) / 2, Math.max(1, ancho / barras - 1), h);
    }
    ctx.globalAlpha = 1;
    // Cortes
    ctx.fillStyle = '#ffffff';
    for (const parte of partes.slice(1)) ctx.fillRect((parte.inicio / duracion) * ancho - 1, 0, 2, alto);
    // Dónde vas
    const x = (reproductor.currentTime / duracion) * ancho;
    ctx.fillStyle = '#ff4d6d';
    ctx.fillRect(x - 1, 0, 2, alto);
  }

  function pintarPartes() {
    const lista = $('.recortador__partes');
    lista.replaceChildren(...partes.map((parte, i) => {
      const li = document.createElement('li');
      li.className = `recortador__parte${parte.subir ? '' : ' recortador__parte--borrar'}`;
      li.innerHTML = `
        <div class="recortador__fila">
          <button class="boton-icono" data-oir aria-label="Escuchar esta parte">${icono('play', 20)}</button>
          <div class="recortador__dato"><strong></strong><span></span></div>
        </div>
        <div class="recortador__elegir" role="group" aria-label="¿Qué hacer con esta parte?">
          <button data-elegir="si">${icono('descargado', 18)} Guardar</button>
          <button data-elegir="no">${icono('cerrar', 18)} Quitar</button>
        </div>
        <input class="campo__entrada" maxlength="200" placeholder="Nombre de este audio">
        <button class="recortador__unir" data-unir>${icono('cerrar', 16)} Quitar el corte de arriba</button>`;
      li.querySelector('strong').textContent = `Parte ${i + 1}`;
      li.querySelector('.recortador__dato span').textContent = `${mmss(parte.inicio)} – ${mmss(parte.fin)} · ${mmss(parte.fin - parte.inicio)}`;
      for (const boton of li.querySelectorAll('[data-elegir]')) {
        const guardar = boton.dataset.elegir === 'si';
        boton.setAttribute('aria-pressed', String(parte.subir === guardar));
        boton.addEventListener('click', () => { parte.subir = guardar; pintarTodo(); });
      }
      const nombre = li.querySelector('input');
      nombre.hidden = !parte.subir;
      nombre.value = nombreDe(parte, i);
      nombre.addEventListener('input', () => { parte.nombre = nombre.value; });
      li.querySelector('[data-oir]').addEventListener('click', () => { reproductor.currentTime = parte.inicio; reproductor.play(); });
      const unir = li.querySelector('[data-unir]');
      unir.hidden = i === 0;
      unir.addEventListener('click', () => {
        partes[i - 1].fin = parte.fin;
        partes.splice(i, 1);
        pintarTodo();
      });
      return li;
    }));
    const quedan = partes.filter((p) => p.subir).length;
    $('[data-guardar]').textContent = quedan === 1 ? 'Guardar 1 audio' : `Guardar ${quedan} audios`;
  }

  function pintarTodo() {
    dibujar();
    pintarPartes();
    recordarCortes();
  }

  function cortar() {
    const t = reproductor.currentTime;
    const i = partes.findIndex((p) => t > p.inicio && t < p.fin);
    const parte = partes[i];
    if (!parte || t - parte.inicio < PARTE_MINIMA_S || parte.fin - t < PARTE_MINIMA_S) {
      avisar(`Muy cerca de otro corte: cada parte debe durar al menos ${PARTE_MINIMA_S} segundos.`, 3000);
      return;
    }
    partes.splice(i, 1, { ...parte, fin: t }, { inicio: t, fin: parte.fin, subir: parte.subir, nombre: null });
    pintarTodo();
  }

  // ---- Controles ----
  const irA = (segundo) => {
    reproductor.currentTime = Math.min(Math.max(0, segundo), duracion);
    $('[data-actual]').textContent = mmss(reproductor.currentTime);
    dibujar();
  };
  const tocarOnda = (evento) => {
    const caja = lienzo.getBoundingClientRect();
    irA(((evento.clientX - caja.left) / caja.width) * duracion);
  };
  let arrastrando = false;
  lienzo.addEventListener('pointerdown', (e) => { arrastrando = true; lienzo.setPointerCapture(e.pointerId); tocarOnda(e); });
  lienzo.addEventListener('pointermove', (e) => { if (arrastrando) tocarOnda(e); });
  lienzo.addEventListener('pointerup', () => { arrastrando = false; });
  for (const boton of caja.querySelectorAll('[data-mover]')) {
    boton.addEventListener('click', () => irA(reproductor.currentTime + Number(boton.dataset.mover)));
  }
  const play = $('[data-play]');
  play.addEventListener('click', () => (reproductor.paused ? reproductor.play() : reproductor.pause()));
  reproductor.addEventListener('play', () => { play.innerHTML = icono('pausa', 28); });
  reproductor.addEventListener('pause', () => { play.innerHTML = icono('play', 28); });
  reproductor.addEventListener('timeupdate', () => {
    $('[data-actual]').textContent = mmss(reproductor.currentTime);
    dibujar();
  });
  $('[data-cortar]').addEventListener('click', cortar);
  window.addEventListener('resize', dibujar);

  // ---- Guardar: cada parte en "Subir" se vuelve un audio ----
  $('[data-guardar]').addEventListener('click', async () => {
    const elegidas = partes.map((p, i) => ({ ...p, titulo: (nombreDe(p, i) || titulo).trim() })).filter((p) => p.subir);
    if (!elegidas.length) return avisar('Todas las partes están en Quitar: elige Guardar en las que quieres.', 4000);
    const quitadas = partes.length - elegidas.length;
    if (quitadas && !confirm(`Se guardan ${elegidas.length} ${elegidas.length === 1 ? 'audio' : 'audios'}:\n${elegidas.map((p) => `• ${p.titulo} (${mmss(p.fin - p.inicio)})`).join('\n')}\n\nY se ${quitadas === 1 ? 'quita 1 parte' : `quitan ${quitadas} partes`}. ¿Está bien?`)) return;
    reproductor.pause();
    const guardar = $('[data-guardar]');
    guardar.disabled = true;
    guardar.classList.add('cargando');
    const resultado = [];
    try {
      for (const [n, parte] of elegidas.entries()) {
        const datos = await codificar(sonido, parte.inicio, parte.fin, {
          canales: calidad.canales,
          kbps: Math.max(16, Math.min(calidad.kbps, Math.floor((MAXIMO_PARTE_KB * 8) / (parte.fin - parte.inicio)))),
          alAvanzar: (f) => { guardar.textContent = `Guardando ${n + 1} de ${elegidas.length} · ${Math.round(f * 100)}%`; },
        });
        resultado.push({ titulo: parte.titulo, datos, tipo: 'audio/webm', duracion: parte.fin - parte.inicio });
      }
      await alGuardar(resultado);
      try { localStorage.removeItem(claveCortes(blob)); } catch { /* nada */ }
      cerrar();
    } catch (error) {
      avisar(`No se pudo guardar: ${error.message}`, 5000);
      guardar.disabled = false;
      guardar.classList.remove('cargando');
      pintarPartes();
    }
  });

  pintarTodo();
}
