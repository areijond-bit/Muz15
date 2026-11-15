// ecualizador.js — Ecualizador de 8 bandas (graves, medios, agudos) con Web Audio.
//
// El sonido de los dos <audio> pasa por 8 filtros en fila antes de salir:
//   <audio> ─┐
//            ├─► 100 Hz ► 200 ► 400 ► 800 ► 1.6k ► 3.2k ► 6.4k ► 12.8k ─► bocinas
//   <audio> ─┘
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

/** @param {HTMLAudioElement[]} audios  los <audio> del reproductor */
export function crearEcualizador(audios) {
  let contexto = null;
  let filtros = [];
  let ganancias = BANDAS.map(() => 0);

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
    filtros.reduce((anterior, siguiente) => { anterior.connect(siguiente); return siguiente; });
    filtros.at(-1).connect(contexto.destination);
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
  };
}
