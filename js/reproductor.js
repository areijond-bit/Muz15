// reproductor.js — Controla el audio y la pantalla de bloqueo / Bluetooth (MediaSession).
//
// Sin cortes entre canciones: usamos DOS <audio>, como las dos bandejas de un DJ.
// Mientras una suena, la otra ya tiene cargada la siguiente canción. Al terminar
// se cambia de bandeja al instante (o con fundido, si está activado), en vez de
// esperar a leer el archivo del teléfono.
//
// MediaSession hace que el título y la portada salgan en la pantalla bloqueada,
// en la notificación y en la pantalla del carro, y que los botones del volante
// (siguiente / anterior) lleguen a la app. NO registramos seekforward /
// seekbackward: si existen, los botones del carro pueden convertirse en
// "±10 segundos" en vez de "canción siguiente / anterior".

import { SesionNativa, aDataURL } from './nativo.js';

// En la APK, los controles los pone Android (SesionNativa). En el navegador, Chrome
// los arma con navigator.mediaSession. Llamamos a los dos: el que no aplica no hace nada.

const PORTADA_POR_DEFECTO = new URL('../icons/portada.png', import.meta.url).href;

// Si la canción lleva más de esto, "anterior" vuelve al inicio en vez de cambiar.
const SEGUNDOS_PARA_REINICIAR = 3;

// Cada cuánto se ajusta el volumen durante un fundido.
const PASO_FUNDIDO_MS = 50;

/**
 * @param {[HTMLAudioElement, HTMLAudioElement]} bandejas  dos <audio> vacíos
 * @param {object} opciones
 * @param {(cancion) => Promise<{audio: string, portada: string | null}>} opciones.obtenerFuente
 *        devuelve las direcciones del audio y la portada: blob: si está en el teléfono,
 *        https: si suena desde el servidor
 * @param {(estado) => void} opciones.alCambiar  se llama cada vez que algo cambia, para pintar la UI
 * @param {(tiempo: {actual: number, duracion: number}) => void} opciones.alProgreso  mientras suena
 * @param {(mensaje: string) => void} opciones.alFallar  cuando una canción no se puede cargar
 */
export function crearReproductor(bandejas, { obtenerFuente, alCambiar, alProgreso, alFallar }) {
  let lista = [];
  let indice = -1;

  // La bandeja que suena ("activa") y la que espera con la siguiente ("libre").
  let activa = bandejas[0];
  let libre = bandejas[1];
  // Qué canción y qué direcciones tiene cargada cada bandeja.
  const cargada = new Map(bandejas.map((b) => [b, { indice: -1, id: null, audio: null, portada: null }]));

  // Segundos de fundido entre canciones (0 = cambio instantáneo).
  let fundido = 0;
  let fundiendo = null; // { anterior: bandeja que se apaga, temporizador }

  // Orden en que suenan las canciones: [0, 1, 2...] en modo continuo,
  // revuelto en modo aleatorio. "posicion" es dónde vamos dentro de ese orden.
  let aleatorio = false;
  let orden = [];
  let posicion = -1;

  // Para descartar cargas viejas si cambias de canción muy rápido.
  let turno = 0;

  const portadaActual = () => cargada.get(activa).portada ?? PORTADA_POR_DEFECTO;
  const estado = () => ({
    cancion: lista[indice] ?? null,
    indice,
    sonando: !activa.paused,
    aleatorio,
    fundido,
    urlPortada: portadaActual(),
  });
  const avisar = () => alCambiar(estado());
  const avisarProgreso = () => alProgreso?.({ actual: activa.currentTime, duracion: activa.duration || 0 });

  /* ---------- Orden (continuo o aleatorio) ---------- */

  // Revuelve un arreglo (algoritmo de Fisher-Yates).
  function mezclar(arreglo) {
    for (let i = arreglo.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arreglo[i], arreglo[j]] = [arreglo[j], arreglo[i]];
    }
    return arreglo;
  }

  // Arma el orden de reproducción:
  //  1. Las canciones "pegadas" (vinculadas: cancion.siguienteFija) se apartan.
  //  2. El resto va en orden o revuelto. En aleatorio, "primera" va al inicio
  //     para que la canción actual no se repita enseguida.
  //  3. Detrás de cada canción se mete su cadena de vinculadas: A → B → C.
  function armarOrden(primera = indice) {
    const porId = new Map(lista.map((c, i) => [c.id, i]));
    const siguienteDe = (i) => porId.get(lista[i].siguienteFija);

    const pegadas = new Set();
    lista.forEach((_, i) => {
      const s = siguienteDe(i);
      if (s !== undefined && s !== i) pegadas.add(s);
    });

    const base = lista.map((_, i) => i).filter((i) => !pegadas.has(i) || i === primera);
    if (aleatorio) {
      mezclar(base);
      if (primera >= 0 && base.includes(primera)) base.unshift(...base.splice(base.indexOf(primera), 1));
    }

    const colocadas = new Set();
    orden = [];
    for (const i of base) {
      for (let x = i; x !== undefined && !colocadas.has(x); x = siguienteDe(x)) {
        orden.push(x);
        colocadas.add(x);
      }
    }
    // Por si quedó alguna fuera (no debería): al final.
    lista.forEach((_, i) => { if (!colocadas.has(i)) orden.push(i); });
    posicion = orden.indexOf(indice);
  }

  /** Qué canción toca después (sin moverse), o -1 si no se sabe todavía. */
  function proximoIndice() {
    if (!lista.length || posicion < 0) return -1;
    if (posicion + 1 < orden.length) return orden[posicion + 1];
    return aleatorio ? -1 : orden[0]; // en aleatorio se revuelve de nuevo al dar la vuelta
  }

  /* ---------- Bandejas ---------- */

  // Vacía una bandeja y libera la memoria de sus direcciones blob:.
  function vaciar(bandeja) {
    const datos = cargada.get(bandeja);
    bandeja.pause();
    bandeja.removeAttribute('src');
    bandeja.load();
    for (const url of [datos.audio, datos.portada]) {
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
    }
    cargada.set(bandeja, { indice: -1, id: null, audio: null, portada: null });
  }

  async function cargar(bandeja, i) {
    const cancion = lista[i];
    const fuente = await obtenerFuente(cancion);
    vaciar(bandeja);
    cargada.set(bandeja, { indice: i, id: cancion.id, ...fuente });
    bandeja.volume = 1;
    bandeja.preload = 'auto';
    bandeja.src = fuente.audio;
    bandeja.load();
  }

  /** Deja la siguiente canción cargada en la bandeja libre. */
  async function prepararSiguiente() {
    if (fundiendo) return; // la libre todavía se está apagando
    const i = proximoIndice();
    const enLibre = cargada.get(libre);
    if (i < 0 || (enLibre.indice === i && enLibre.id === lista[i]?.id)) return;
    const miTurno = turno;
    try {
      await cargar(libre, i);
    } catch (error) {
      console.warn('No se pudo precargar la siguiente:', error.message);
      return;
    }
    if (miTurno !== turno) vaciar(libre); // mientras tanto cambiaste de canción
  }

  /* ---------- Cambiar de canción ---------- */

  /**
   * @param {number} nuevoIndice
   * @param {object} [como]
   * @param {boolean} [como.conFundido]  true si viene del final natural de la canción
   */
  async function reproducir(nuevoIndice, { conFundido = false } = {}) {
    if (!lista.length) return;
    // Damos la vuelta: después de la última viene la primera, y al revés.
    nuevoIndice = (nuevoIndice + lista.length) % lista.length;
    const miTurno = ++turno;
    terminarFundido();

    const anterior = activa;
    const enLibre = cargada.get(libre);
    const yaCargada = enLibre.indice === nuevoIndice && enLibre.id === lista[nuevoIndice].id;

    if (yaCargada) {
      // Cambio de bandeja: la siguiente ya estaba lista, así que suena al instante.
      [activa, libre] = [libre, activa];
    } else {
      try {
        await cargar(libre, nuevoIndice);
      } catch (error) {
        console.error(error);
        alFallar?.(error.message);
        return;
      }
      if (miTurno !== turno) return; // otra canción se pidió mientras cargaba
      [activa, libre] = [libre, activa];
    }

    indice = nuevoIndice;
    if (orden.length !== lista.length) armarOrden();
    posicion = orden.indexOf(indice);

    activa.currentTime = 0;
    const vincularSinFundido = lista[cargada.get(anterior).indice]?.siguienteFija === lista[indice].id;
    const conFundidoAhora = conFundido && fundido > 0 && !anterior.paused && !vincularSinFundido;

    actualizarMediaSession(lista[indice]);
    avisar();
    avisarProgreso();

    // Primero arranca la nueva y DESPUÉS se apaga la anterior. Si por un instante
    // no sonara nada, Android puede quitar la notificación de "multimedia" y,
    // con la pantalla bloqueada, ya no dejar que arranque la siguiente.
    if (conFundidoAhora) empezarFundido(anterior);
    try {
      await activa.play();
    } catch (error) {
      // El navegador bloquea play() si no viene de un toque del usuario. No es
      // grave: la canción queda cargada y el siguiente toque en ▶ la arranca.
      console.warn('No se pudo reproducir automáticamente:', error.message);
    }
    if (!conFundidoAhora) vaciar(anterior);
    if (!fundiendo) prepararSiguiente();
  }

  /* ---------- Fundido (crossfade) ---------- */

  // Sube el volumen de la nueva mientras baja el de la anterior.
  function empezarFundido(anterior) {
    const inicio = performance.now();
    const duracionMs = fundido * 1000;
    activa.volume = 0;
    fundiendo = {
      anterior,
      temporizador: setInterval(() => {
        // Usamos el tiempo real transcurrido: si el teléfono retrasa el
        // temporizador (pantalla apagada), el fundido igual termina a tiempo.
        const avance = Math.min((performance.now() - inicio) / duracionMs, 1);
        activa.volume = avance;
        anterior.volume = 1 - avance;
        if (avance >= 1) terminarFundido();
      }, PASO_FUNDIDO_MS),
    };
  }

  function terminarFundido() {
    if (!fundiendo) return;
    clearInterval(fundiendo.temporizador);
    vaciar(fundiendo.anterior);
    activa.volume = 1;
    fundiendo = null;
    prepararSiguiente();
  }

  /* ---------- Controles ---------- */

  function alternar() {
    if (indice === -1) return reproducir(0);
    if (activa.paused) return activa.play();
    terminarFundido();
    activa.pause();
  }

  function siguiente({ conFundido = false } = {}) {
    if (!lista.length) return;
    let nueva = posicion + 1;
    if (nueva >= orden.length) {
      // Se acabó la lista: vuelve a empezar (en aleatorio, con otro orden).
      nueva = 0;
      if (aleatorio) armarOrden(-1);
    }
    return reproducir(orden[nueva], { conFundido });
  }

  function anterior() {
    if (activa.currentTime > SEGUNDOS_PARA_REINICIAR) {
      activa.currentTime = 0;
      return;
    }
    if (!lista.length) return;
    return reproducir(orden[(posicion - 1 + orden.length) % orden.length]);
  }

  function irA(segundos) {
    activa.currentTime = Math.min(Math.max(segundos, 0), activa.duration || 0);
  }

  // Con fundido, la siguiente arranca X segundos antes de que acabe la actual.
  function vigilarFinal(evento) {
    if (evento.target !== activa || fundido <= 0 || fundiendo || activa.paused) return;
    const restante = activa.duration - activa.currentTime;
    const proxima = lista[proximoIndice()];
    const vinculada = proxima && lista[indice]?.siguienteFija === proxima.id;
    // Las vinculadas no se funden: van pegadas tal cual, como una transición.
    if (!vinculada && Number.isFinite(restante) && activa.duration > fundido * 2 && restante <= fundido) {
      siguiente({ conFundido: true });
    }
  }

  /* ---------- MediaSession ---------- */

  function actualizarMediaSession(cancion) {
    const portada = portadaActual();
    const datos = { title: cancion.titulo, artist: cancion.artista, album: cancion.album || 'Muz15' };

    if (SesionNativa) {
      // Primero sin portada (para que el título salga ya) y luego con ella.
      SesionNativa.setMetadata({ ...datos, artwork: [] }).catch(() => {});
      aDataURL(portada)
        .then((src) => {
          if (lista[indice]?.id !== cancion.id) return; // ya cambió de canción
          return SesionNativa.setMetadata({ ...datos, artwork: [{ src, sizes: '512x512' }] });
        })
        .catch((error) => console.warn('Portada para Android:', error.message));
    }

    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      ...datos,
      artwork: [
        { src: portada, sizes: '512x512' },
        { src: portada, sizes: '256x256' },
      ],
    });
  }

  function cambiarEstadoSesion(estadoSesion) {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = estadoSesion;
    SesionNativa?.setPlaybackState({ playbackState: estadoSesion }).catch(() => {});
  }

  function registrarControles() {
    if (SesionNativa) {
      const nativos = {
        play: () => activa.play(),
        pause: () => alternar(),
        stop: () => alternar(),
        previoustrack: anterior,
        nexttrack: () => siguiente(),
        seekto: (detalles) => irA(detalles.seekTime ?? 0),
      };
      for (const [action, manejador] of Object.entries(nativos)) {
        SesionNativa.setActionHandler({ action }, manejador).catch(() => {});
      }
    }

    if (!('mediaSession' in navigator)) return;
    const acciones = {
      play: () => activa.play(),
      pause: () => alternar(),
      previoustrack: anterior,
      nexttrack: () => siguiente(),
      // Arrastrar la barra de tiempo en la pantalla bloqueada o la notificación.
      seekto: (detalles) => irA(detalles.seekTime),
      // Quitamos explícitamente estos para que el carro muestre siguiente / anterior.
      seekforward: null,
      seekbackward: null,
    };
    for (const [accion, manejador] of Object.entries(acciones)) {
      try {
        navigator.mediaSession.setActionHandler(accion, manejador);
      } catch {
        // Algún navegador no conoce esa acción: la ignoramos.
      }
    }
  }

  // Le dice al sistema cuánto dura la canción y en qué segundo va, para que
  // la pantalla bloqueada muestre "1:23 / 3:45" con la barra. No hace falta
  // llamarlo cada segundo: el sistema avanza la barra solo mientras suena.
  function actualizarPosicion() {
    const duracion = activa.duration;
    if (!Number.isFinite(duracion) || duracion <= 0) return;
    const posicionActual = {
      duration: duracion,
      playbackRate: activa.playbackRate || 1,
      position: Math.min(activa.currentTime, duracion),
    };
    SesionNativa?.setPositionState(posicionActual).catch(() => {});
    if (!navigator.mediaSession?.setPositionState) return;
    try {
      navigator.mediaSession.setPositionState(posicionActual);
    } catch (error) {
      console.warn('No se pudo actualizar la barra de tiempo:', error.message);
    }
  }

  /* ---------- Eventos de las dos bandejas ---------- */
  // Solo cuentan los de la bandeja activa; la libre está cargando en silencio.

  const soloActiva = (fn) => (evento) => { if (evento.target === activa) fn(evento); };

  for (const bandeja of bandejas) {
    bandeja.addEventListener('play', soloActiva(() => {
      cambiarEstadoSesion('playing');
      actualizarPosicion();
      avisar();
    }));
    bandeja.addEventListener('pause', soloActiva(() => {
      // Al terminar una canción también llega "pause"; si va a seguir otra, no avisamos
      // "pausado" a Android, para que no quite los controles en ese instante.
      if (!activa.ended) cambiarEstadoSesion('paused');
      actualizarPosicion();
      avisar();
    }));
    bandeja.addEventListener('loadedmetadata', soloActiva(() => { actualizarPosicion(); avisarProgreso(); }));
    bandeja.addEventListener('seeked', soloActiva(actualizarPosicion));
    bandeja.addEventListener('ratechange', soloActiva(actualizarPosicion));
    bandeja.addEventListener('timeupdate', soloActiva((evento) => { avisarProgreso(); vigilarFinal(evento); }));
    bandeja.addEventListener('ended', soloActiva(() => siguiente()));
    bandeja.addEventListener('error', (evento) => {
      if (!bandeja.getAttribute('src')) return; // la vaciamos a propósito
      if (evento.target !== activa) {
        // Falló la precarga: se intentará de nuevo al llegar a esa canción.
        cargada.set(bandeja, { indice: -1, id: null, audio: null, portada: null });
        return;
      }
      console.error('Error del <audio>:', bandeja.error);
      const delServidor = cargada.get(activa).audio?.startsWith('http');
      alFallar?.(delServidor
        ? 'No se pudo escuchar desde el servidor. ¿Está prendida la PC y Tailscale activado?'
        : 'No se pudo reproducir este archivo.');
      avisar();
    });
  }

  registrarControles();

  return {
    /** Pone una lista (la del teléfono o la del servidor) y empieza en esa canción. */
    reproducirLista(nuevaLista, desde) {
      lista = nuevaLista;
      indice = desde;
      armarOrden();
      vaciar(libre); // lo precargado era de la lista anterior
      return reproducir(desde);
    },
    /**
     * Pone la versión nueva de las canciones (después de editar títulos,
     * vínculos u orden) sin cortar la que suena.
     */
    refrescar(canciones) {
      const actual = lista[indice];
      const mismas = canciones.length === lista.length && lista.every((c) => canciones.some((n) => n.id === c.id));
      if (mismas) {
        // Es la misma lista que suena (quizá reacomodada): tomamos su nuevo orden.
        lista = canciones;
        indice = actual ? lista.findIndex((c) => c.id === actual.id) : -1;
        const enActiva = cargada.get(activa);
        if (enActiva.id) cargada.set(activa, { ...enActiva, indice });
      } else {
        const nuevas = new Map(canciones.map((c) => [c.id, c]));
        lista = lista.map((c) => nuevas.get(c.id) ?? c);
      }
      armarOrden();
      if (lista[indice]) actualizarMediaSession(lista[indice]);
      avisar();
      prepararSiguiente();
    },
    /** Activa o quita el modo aleatorio sin cortar la canción actual. */
    cambiarAleatorio(activar) {
      aleatorio = activar;
      armarOrden();
      avisar();
      prepararSiguiente();
    },
    /** Segundos de fundido entre canciones (0 = sin pausa, cambio instantáneo). */
    cambiarFundido(segundos) {
      fundido = segundos;
      avisar();
    },
    /** Saca una canción borrada de la lista; si era la que sonaba, la detiene. */
    quitar(id) {
      const lugar = lista.findIndex((c) => c.id === id);
      if (lugar === -1) return;
      terminarFundido();
      if (lugar === indice) {
        vaciar(activa);
        cambiarEstadoSesion('none');
        indice = -1;
      } else if (lugar < indice) {
        indice--;
      }
      vaciar(libre);
      lista = lista.filter((c) => c.id !== id);
      const enActiva = cargada.get(activa);
      if (enActiva.id) cargada.set(activa, { ...enActiva, indice });
      armarOrden();
      avisar();
      prepararSiguiente();
    },
    alternar,
    siguiente: () => siguiente(),
    anterior,
    irA,
    estado,
  };
}
