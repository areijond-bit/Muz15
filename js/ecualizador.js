// ecualizador.js — Ecualizador de 8 bandas (graves, medios, agudos) con Web Audio.
//
// El sonido de los dos <audio> pasa por 8 filtros en fila antes de salir:
//   <audio> ─┐
//            ├─► 100 Hz ► 200 ► 400 ► 800 ► 1.6k ► 3.2k ► 6.4k ► 12.8k ─► bocinas
//   <audio> ─┘
// (después de los 8 filtros va el "tope" del volumen seguro, ver más abajo)
// Cada filtro sube o baja el volumen de su zona: 100-200 Hz son los bajos (bombo,
// bajo), 400-800 los medios (cuerpo de la guitarra, voz), 1.6k-3.2k la presencia
// (ataque de la guitarra, claridad de la voz) y 6.4k-12.8k los agudos (platillos, brillo).
//
// Ojo: una vez que el audio pasa por aquí ya no se puede desconectar hasta cerrar la
// app (así funciona el navegador). Por eso solo se conecta la primera vez que activas
// el ecualizador; apagarlo deja todas las bandas en 0 dB.

export const BANDAS = [100, 200, 400, 800, 1600, 3200, 6400, 12800];
export const MAXIMO_DB = 12;

// Perfiles listos (dB por banda, de 100 Hz a 12.8 kHz).
export const PERFILES = {
  plano: { nombre: 'Plano', ganancias: [0, 0, 0, 0, 0, 0, 0, 0] },
  bajos: { nombre: 'Más bajos', ganancias: [7, 5, 2, 0, 0, 0, 0, 0] },
  guitarra: { nombre: 'Guitarra / rock', ganancias: [4, 2, -1, 0, 3, 5, 4, 2] },
  voces: { nombre: 'Voces', ganancias: [-2, -1, 1, 3, 4, 3, 1, 0] },
  agudos: { nombre: 'Más brillo', ganancias: [0, 0, 0, 0, 1, 3, 5, 6] },
  carro: { nombre: 'Para el carro', ganancias: [4, 3, 0, -1, 1, 3, 3, 2] },
};

/* Volumen seguro: después de los filtros hay un LIMITADOR.
 *
 * Mientras el audio esté por debajo del tope, pasa exactamente igual (no se
 * baja nada). Solo cuando una parte intenta sonar más fuerte que el tope, se
 * frena ahí. Como va al final, también frena lo que suba el ecualizador.
 *
 * El teléfono no puede medir los dB que llegan a tu oído (dependen de los
 * audífonos o bocinas). Tomamos como referencia 100 dB = volumen máximo del
 * teléfono con audífonos comunes: el tope de 85 dB frena todo lo que pase de
 * 15 dB por debajo del máximo, el de 70 dB lo que pase de 30 dB por debajo, etc. */
export const REFERENCIA_DB = 100;
export const OPCIONES_TOPE_DB = [70, 75, 80, 85, 90, 95, 100];

// Qué tan duro frena: por cada 20 dB que algo intente pasarse, solo se pasa 1 dB.
const PROPORCION_LIMITADOR = 20;

/** @param {HTMLAudioElement[]} audios  los <audio> del reproductor */
export function crearEcualizador(audios) {
  let contexto = null;
  let filtros = [];
  let limitador = null;   // DynamicsCompressor usado como limitador
  let compensacion = null; // anula la "subida automática" que el navegador le mete al limitador
  let ganancias = BANDAS.map(() => 0);
  let topeDb = null;  // null = sin volumen seguro
  let referenciaDb = REFERENCIA_DB; // se ajusta al calibrar con tus audífonos

  // El compresor del navegador sube solo todo el audio para "compensar" lo que
  // frena (makeup gain = (1 / ganancia a todo volumen) ^ 0.6). Nosotros no queremos
  // que suba nada, así que lo anulamos con una ganancia contraria.
  function gananciaQueAnula(umbralDb, proporcion) {
    const salidaATodoVolumenDb = umbralDb * (1 - 1 / proporcion); // entrada de 0 dB
    return 10 ** ((0.6 * salidaATodoVolumenDb) / 20);
  }

  function aplicarTope() {
    if (!limitador) return;
    const ahora = contexto.currentTime;
    // Sin volumen seguro: umbral en 0 dB y proporción 1 = no toca nada.
    // (nunca por encima de 0 dB: más arriba no hay nada que frenar)
    const umbral = topeDb === null ? 0 : Math.min(0, topeDb - referenciaDb);
    const proporcion = topeDb === null ? 1 : PROPORCION_LIMITADOR;
    limitador.threshold.setValueAtTime(umbral, ahora);
    limitador.ratio.setValueAtTime(proporcion, ahora);
    compensacion.gain.setValueAtTime(gananciaQueAnula(umbral, proporcion), ahora);
  }

  // Arma la cadena de filtros. Debe llamarse desde un toque del usuario
  // (el navegador no deja crear audio sin uno).
  function conectar() {
    if (contexto) return;
    contexto = new AudioContext();
    filtros = BANDAS.map((frecuencia, i) => {
      const filtro = contexto.createBiquadFilter();
      // La primera y la última son "repisas": suben todo lo que está por debajo / encima.
      filtro.type = i === 0 ? 'lowshelf' : i === BANDAS.length - 1 ? 'highshelf' : 'peaking';
      filtro.frequency.value = frecuencia;
      filtro.Q.value = 1.1;
      filtro.gain.value = ganancias[i];
      return filtro;
    });
    limitador = contexto.createDynamicsCompressor();
    limitador.knee.value = 0;         // frena de golpe al llegar al tope, no antes
    limitador.attack.value = 0.002;   // reacciona en 2 ms
    limitador.release.value = 0.15;   // y suelta en 150 ms
    compensacion = contexto.createGain();
    aplicarTope();
    filtros.reduce((anterior, siguiente) => { anterior.connect(siguiente); return siguiente; });
    filtros.at(-1).connect(limitador);
    limitador.connect(compensacion);
    compensacion.connect(contexto.destination);
    for (const audio of audios) contexto.createMediaElementSource(audio).connect(filtros[0]);

    // El navegador pausa el procesador si se queda sin uso; lo reactivamos al reproducir.
    for (const audio of audios) audio.addEventListener('play', () => contexto.resume());
  }

  return {
    get conectado() { return Boolean(contexto); },
    conectar,
    /** Cambia las 8 bandas (dB). Si todavía no está conectado, se guardan para después. */
    aplicar(nuevas) {
      ganancias = nuevas.map((g) => Math.max(-MAXIMO_DB, Math.min(MAXIMO_DB, g)));
      if (!contexto) return;
      const ahora = contexto.currentTime;
      // Cambio suave (50 ms) para que no truene al mover una barra.
      filtros.forEach((filtro, i) => filtro.gain.setTargetAtTime(ganancias[i], ahora, 0.05));
    },
    /**
     * Volumen seguro: dB máximos (70–100) o null para quitarlo.
     * @param {number} [referencia] dB que dan TUS audífonos al máximo (calibración)
     */
    ponerTope(db, referencia = REFERENCIA_DB) {
      topeDb = db;
      referenciaDb = referencia;
      if (contexto) aplicarTope();
    },
    /** El modo eco solo existe en la APK con reproductor nativo. */
    ponerEco() {},
  };
}
