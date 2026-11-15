// reproductor.js — Controla el <audio> y la pantalla de bloqueo / Bluetooth (MediaSession).
//
// MediaSession es lo que hace que el título y la portada salgan en la pantalla
// bloqueada, en el Control Center y en la pantalla del carro, y que los botones
// del volante (siguiente / anterior) lleguen a la app.
//
// Registramos play, pause, previoustrack, nexttrack y seekto (la barra de tiempo
// que se puede arrastrar). NO registramos seekforward / seekbackward: en iOS, si
// existen, los botones del carro pueden convertirse en "±10 segundos" en vez de
// "canción siguiente / anterior".

const PORTADA_POR_DEFECTO = new URL('../icons/portada.png', import.meta.url).href;

// Si la canción lleva más de esto, "anterior" vuelve al inicio en vez de cambiar.
const SEGUNDOS_PARA_REINICIAR = 3;

/**
 * @param {HTMLAudioElement} audio
 * @param {object} opciones
 * @param {(cancion) => Promise<{audio: string, portada: string | null}>} opciones.obtenerFuente
 *        devuelve las direcciones del audio y la portada: blob: si está en el teléfono,
 *        https: si suena desde el servidor
 * @param {(estado) => void} opciones.alCambiar  se llama cada vez que algo cambia, para pintar la UI
 * @param {(mensaje: string) => void} opciones.alFallar  cuando una canción no se puede cargar
 */
export function crearReproductor(audio, { obtenerFuente, alCambiar, alFallar }) {
  let lista = [];
  let indice = -1;
  let urlAudio = null;   // dirección del audio actual
  let urlPortada = null; // dirección de la portada actual

  // Orden en que suenan las canciones: [0, 1, 2...] en modo continuo,
  // revuelto en modo aleatorio. "posicion" es dónde vamos dentro de ese orden.
  let aleatorio = false;
  let orden = [];
  let posicion = -1;

  const estado = () => ({
    cancion: lista[indice] ?? null,
    indice,
    sonando: !audio.paused,
    aleatorio,
    urlPortada: urlPortada ?? PORTADA_POR_DEFECTO,
  });
  const avisar = () => alCambiar(estado());

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

  /* ---------- Cambiar de canción ---------- */

  async function reproducir(nuevoIndice) {
    if (!lista.length) return;
    // Damos la vuelta: después de la última viene la primera, y al revés.
    indice = (nuevoIndice + lista.length) % lista.length;
    if (orden.length !== lista.length) armarOrden();
    posicion = orden.indexOf(indice);
    const cancion = lista[indice];

    liberarURLs();
    try {
      ({ audio: urlAudio, portada: urlPortada } = await obtenerFuente(cancion));
    } catch (error) {
      console.error(error);
      alFallar?.(error.message);
      return;
    }

    audio.src = urlAudio;
    actualizarMediaSession(cancion);
    avisar();

    try {
      await audio.play();
    } catch (error) {
      // iOS bloquea play() si no viene de un toque del usuario. No es grave:
      // la canción queda cargada y el siguiente toque en ▶ la arranca.
      console.warn('No se pudo reproducir automáticamente:', error.message);
    }
  }

  // Las direcciones blob: ocupan memoria hasta que se liberan; las https: no.
  function liberarURLs() {
    for (const url of [urlAudio, urlPortada]) {
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
    }
    urlAudio = urlPortada = null;
  }

  /* ---------- Controles ---------- */

  function alternar() {
    if (indice === -1) return reproducir(0);
    return audio.paused ? audio.play() : audio.pause();
  }

  function siguiente() {
    if (!lista.length) return;
    let nueva = posicion + 1;
    if (nueva >= orden.length) {
      // Se acabó la lista: vuelve a empezar (en aleatorio, con otro orden).
      nueva = 0;
      if (aleatorio) armarOrden(-1);
    }
    return reproducir(orden[nueva]);
  }

  function anterior() {
    if (audio.currentTime > SEGUNDOS_PARA_REINICIAR) {
      audio.currentTime = 0;
      return;
    }
    if (!lista.length) return;
    return reproducir(orden[(posicion - 1 + orden.length) % orden.length]);
  }

  function irA(segundos) {
    audio.currentTime = Math.min(Math.max(segundos, 0), audio.duration || 0);
  }

  /* ---------- MediaSession ---------- */

  function actualizarMediaSession(cancion) {
    if (!('mediaSession' in navigator)) return;
    const portada = urlPortada ?? PORTADA_POR_DEFECTO;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: cancion.titulo,
      artist: cancion.artista,
      album: cancion.album || 'Muz15',
      artwork: [
        { src: portada, sizes: '512x512' },
        { src: portada, sizes: '256x256' },
      ],
    });
  }

  function registrarControles() {
    if (!('mediaSession' in navigator)) return;
    const acciones = {
      play: () => audio.play(),
      pause: () => audio.pause(),
      previoustrack: anterior,
      nexttrack: siguiente,
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
    if (!navigator.mediaSession?.setPositionState) return;
    const duracion = audio.duration;
    if (!Number.isFinite(duracion) || duracion <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: duracion,
        playbackRate: audio.playbackRate || 1,
        position: Math.min(audio.currentTime, duracion),
      });
    } catch (error) {
      console.warn('No se pudo actualizar la barra de tiempo:', error.message);
    }
  }

  /* ---------- Eventos del <audio> ---------- */

  audio.addEventListener('play', () => {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    actualizarPosicion();
    avisar();
  });
  audio.addEventListener('pause', () => {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    actualizarPosicion();
    avisar();
  });
  audio.addEventListener('loadedmetadata', actualizarPosicion);
  audio.addEventListener('seeked', actualizarPosicion);
  audio.addEventListener('ratechange', actualizarPosicion);
  audio.addEventListener('ended', siguiente);
  audio.addEventListener('error', () => {
    if (!audio.getAttribute('src')) return; // la quitamos a propósito
    console.error('Error del <audio>:', audio.error);
    const delServidor = urlAudio?.startsWith('http');
    alFallar?.(delServidor
      ? 'No se pudo escuchar desde el servidor. ¿Está prendida la PC y Tailscale activado?'
      : 'No se pudo reproducir este archivo.');
    avisar();
  });

  registrarControles();

  return {
    /** Pone una lista (la del teléfono o la del servidor) y empieza en esa canción. */
    reproducirLista(nuevaLista, desde) {
      lista = nuevaLista;
      indice = desde;
      armarOrden();
      return reproducir(desde);
    },
    /**
     * Pone la versión nueva de las canciones (después de editar títulos o
     * vínculos) sin cortar la que suena.
     */
    refrescar(canciones) {
      const actual = lista[indice];
      const mismas = canciones.length === lista.length && lista.every((c) => canciones.some((n) => n.id === c.id));
      if (mismas) {
        // Es la misma lista que suena (quizá reacomodada): tomamos su nuevo orden.
        lista = canciones;
        indice = actual ? lista.findIndex((c) => c.id === actual.id) : -1;
      } else {
        const nuevas = new Map(canciones.map((c) => [c.id, c]));
        lista = lista.map((c) => nuevas.get(c.id) ?? c);
      }
      armarOrden();
      if (lista[indice]) actualizarMediaSession(lista[indice]);
      avisar();
    },
    /** Activa o quita el modo aleatorio sin cortar la canción actual. */
    cambiarAleatorio(activar) {
      aleatorio = activar;
      armarOrden();
      avisar();
    },
    /** Saca una canción borrada de la lista; si era la que sonaba, la detiene. */
    quitar(id) {
      const posicion = lista.findIndex((c) => c.id === id);
      if (posicion === -1) return;
      if (posicion === indice) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        liberarURLs();
        indice = -1;
      } else if (posicion < indice) {
        indice--;
      }
      lista = lista.filter((c) => c.id !== id);
      armarOrden();
      avisar();
    },
    alternar,
    siguiente,
    anterior,
    estado,
  };
}
