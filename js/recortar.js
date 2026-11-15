// recortar.js — Recortar un audio antes de subirlo, como un editor de video sencillo.
//
//   ┌ onda del audio ─────────────────────────────┐
//   │▁▃▅▇▅▃▁│▂▄▆█▆▄▂│▁▃▅▇▅▃▁   ← tocas para moverte  │
//   └────────────────┴─────── cortes ──────────────┘
//   Parte 1  0:00 – 12:30   [Subir]  nombre…
//   Parte 2 12:30 – 14:00   [Borrar]
//
// Pones cortes donde quieras y a cada parte le dices Subir o Borrar. Cada parte que
// se sube queda como su propio audio (así un audio de 1 h se vuelve 5, o le quitas un
// pedazo del inicio). Todo pasa en el teléfono/PC; nada se sube hasta que guardas.

import { icono } from './iconos.js';
import { codificar, sePuedeComprimir } from './comprimir.js';

// Cuánta memoria puede ocupar el audio abierto (se guarda completo para poder cortarlo).
const PRESUPUESTO_BYTES = 480 * 1024 * 1024;
// De mejor a peor: la primera que quepa. En los largos baja la calidad para no trabarse.
const CALIDADES = [
  { tasa: 48000, canales: 2, kbps: 96, nombre: 'completa' },
  { tasa: 24000, canales: 1, kbps: 48, nombre: 'buena (audio largo)' },
  { tasa: 16000, canales: 1, kbps: 32, nombre: 'media (audio muy largo)' },
  { tasa: 12000, canales: 1, kbps: 24, nombre: 'básica (audio muy largo)' },
];
const PARTE_MINIMA_S = 3;

const mmss = (s) => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const seg = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${seg}` : `${m}:${seg}`;
};

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
      <p class="recortador__ayuda">Pon cortes donde quieras. Cada parte en <strong>Subir</strong> se vuelve su propio audio; las de <strong>Borrar</strong> se quitan.</p>
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
    document.body.classList.remove('con-pantalla');
  };
  $('[data-cerrar]').addEventListener('click', cerrar);

  // ---- Abrir el audio (con la mejor calidad que quepa en memoria) ----
  let sonido;
  let calidad;
  let duracion;
  try {
    duracion = await duracionDe(url);
    for (const c of CALIDADES) {
      const bytes = c.tasa * 2 * 4 * duracion; // al decodificar quedan los canales originales (2)
      if (bytes <= PRESUPUESTO_BYTES && await sePuedeComprimir(c.canales, c.tasa)) { calidad = c; break; }
    }
    if (!calidad) throw new Error(`Es muy largo para recortarlo aquí (${mmss(duracion)}). Máximo unos 80 minutos.`);
    const contexto = new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: calidad.tasa });
    sonido = await contexto.decodeAudioData(await blob.arrayBuffer());
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
          <button class="recortador__opcion" data-alternar></button>
        </div>
        <input class="campo__entrada" maxlength="200" placeholder="Nombre de este audio">
        <button class="recortador__unir" data-unir>${icono('cerrar', 16)} Quitar el corte de arriba</button>`;
      li.querySelector('strong').textContent = `Parte ${i + 1}`;
      li.querySelector('.recortador__dato span').textContent = `${mmss(parte.inicio)} – ${mmss(parte.fin)} · ${mmss(parte.fin - parte.inicio)}`;
      const opcion = li.querySelector('[data-alternar]');
      opcion.textContent = parte.subir ? 'Subir' : 'Borrar';
      opcion.classList.toggle('recortador__opcion--subir', parte.subir);
      opcion.addEventListener('click', () => { parte.subir = !parte.subir; pintarTodo(); });
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
    $('[data-guardar]').textContent = quedan > 1 ? `Guardar ${quedan} audios` : 'Guardar';
  }

  function pintarTodo() {
    dibujar();
    pintarPartes();
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
    if (!elegidas.length) return avisar('Todas las partes están en Borrar: no queda nada que subir.', 3000);
    reproductor.pause();
    const guardar = $('[data-guardar]');
    guardar.disabled = true;
    guardar.classList.add('cargando');
    const resultado = [];
    try {
      for (const [n, parte] of elegidas.entries()) {
        const datos = await codificar(sonido, parte.inicio, parte.fin, {
          canales: calidad.canales,
          kbps: calidad.kbps,
          alAvanzar: (f) => { guardar.textContent = `Guardando ${n + 1} de ${elegidas.length} · ${Math.round(f * 100)}%`; },
        });
        resultado.push({ titulo: parte.titulo, datos, tipo: 'audio/webm', duracion: parte.fin - parte.inicio });
      }
      await alGuardar(resultado);
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
