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

/* Volumen seguro: después de los filtros hay un "tope" (un control de volumen fijo).
 *
 * El teléfono no puede medir los dB que llegan a tu oído (dependen de los
 * audífonos o bocinas). Tomamos como referencia 100 dB = volumen máximo del
 * teléfono con audífonos comunes, y cada opción baja ese máximo:
 *   85 dB → 15 dB menos que el máximo, 70 dB → 30 dB menos, etc.
 * Si el ecualizador sube alguna banda, el tope baja esa misma cantidad, así
 * que la suma nunca se pasa del límite elegido. */
export const REFERENCIA_DB = 100;
export const OPCIONES_TOPE_DB = [70, 75, 80, 85, 90, 95, 100];

/** @param {HTMLAudioElement[]} audios  los <audio> del reproductor */
export function crearEcualizador(audios) {
  let contexto = null;
  let filtros = [];
  let salida = null;  // el "tope" del volumen seguro
  let ganancias = BANDAS.map(() => 0);
  let topeDb = null;  // null = sin volumen seguro

  // Cuánto multiplica el tope: 1 = nada; 0.18 = 15 dB menos; etc.
  function factorTope() {
    if (topeDb === null) return 1;
    const subidaMaxima = Math.max(0, ...ganancias); // lo que el ecualizador podría subir
    return 10 ** ((topeDb - REFERENCIA_DB - subidaMaxima) / 20);
  }

  function aplicarTope() {
    if (salida) salida.gain.setTargetAtTime(factorTope(), contexto.currentTime, 0.05);
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
    salida = contexto.createGain();
    salida.gain.value = factorTope();
    filtros.reduce((anterior, siguiente) => { anterior.connect(siguiente); return siguiente; });
    filtros.at(-1).connect(salida);
    salida.connect(contexto.destination);
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
      aplicarTope(); // si subiste una banda, el tope se ajusta para no pasarse
    },
    /** Volumen seguro: dB máximos (70–100) o null para quitarlo. */
    ponerTope(db) {
      topeDb = db;
      if (contexto) aplicarTope();
    },
    /** Para revisar: el factor que se está aplicando ahora. */
    get factorTope() { return factorTope(); },
  };
}
