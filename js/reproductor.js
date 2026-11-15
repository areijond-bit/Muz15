// reproductor.js — Controla el <audio> y la pantalla de bloqueo / Bluetooth (MediaSession).
//
// MediaSession es lo que hace que el título y la portada salgan en la pantalla
// bloqueada, en el Control Center y en la pantalla del carro, y que los botones
// del volante (siguiente / anterior) lleguen a la app.
//
// Solo registramos play, pause, previoustrack y nexttrack. NO registramos
// seekforward / seekbackward: en iOS, si existen, los botones del carro pueden
// convertirse en "±10 segundos" en vez de "canción siguiente / anterior".

const PORTADA_POR_DEFECTO = new URL('../icons/portada.png', import.meta.url).href;

// Si la canción lleva más de esto, "anterior" vuelve al inicio en vez de cambiar.
const SEGUNDOS_PARA_REINICIAR = 3;

/**
 * @param {HTMLAudioElement} audio
 * @param {object} opciones
 * @param {(cancion) => Promise<Blob>} opciones.obtenerAudio  carga el audio de una canción
 * @param {(estado) => void} opciones.alCambiar  se llama cada vez que algo cambia, para pintar la UI
 */
export function crearReproductor(audio, { obtenerAudio, alCambiar }) {
  let lista = [];
  let indice = -1;
  let urlAudio = null;   // URL temporal del audio actual (hay que liberarla al cambiar)
  let urlPortada = null; // igual para la portada

  const estado = () => ({
    cancion: lista[indice] ?? null,
    indice,
    sonando: !audio.paused,
    urlPortada: urlPortada ?? PORTADA_POR_DEFECTO,
  });
  const avisar = () => alCambiar(estado());

  /* ---------- Cambiar de canción ---------- */

  async function reproducir(nuevoIndice) {
    if (!lista.length) return;
    // Damos la vuelta: después de la última viene la primera, y al revés.
    indice = (nuevoIndice + lista.length) % lista.length;
    const cancion = lista[indice];

    liberarURLs();
    urlAudio = URL.createObjectURL(await obtenerAudio(cancion));
    if (cancion.portada) {
      urlPortada = URL.createObjectURL(new Blob([cancion.portada.datos], { type: cancion.portada.tipo }));
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

  function liberarURLs() {
    if (urlAudio) URL.revokeObjectURL(urlAudio);
    if (urlPortada) URL.revokeObjectURL(urlPortada);
    urlAudio = urlPortada = null;
  }

  /* ---------- Controles ---------- */

  function alternar() {
    if (indice === -1) return reproducir(0);
    return audio.paused ? audio.play() : audio.pause();
  }

  function siguiente() {
    return reproducir(indice + 1);
  }

  function anterior() {
    if (audio.currentTime > SEGUNDOS_PARA_REINICIAR) {
      audio.currentTime = 0;
      return;
    }
    return reproducir(indice - 1);
  }

  /* ---------- MediaSession ---------- */

  function actualizarMediaSession(cancion) {
    if (!('mediaSession' in navigator)) return;
    const portada = urlPortada ?? PORTADA_POR_DEFECTO;
    const tipo = cancion.portada?.tipo ?? 'image/png';
    navigator.mediaSession.metadata = new MediaMetadata({
      title: cancion.titulo,
      artist: cancion.artista,
      album: cancion.album || 'Muz15',
      artwork: [
        { src: portada, sizes: '512x512', type: tipo },
        { src: portada, sizes: '256x256', type: tipo },
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

  /* ---------- Eventos del <audio> ---------- */

  audio.addEventListener('play', () => {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    avisar();
  });
  audio.addEventListener('pause', () => {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    avisar();
  });
  audio.addEventListener('ended', siguiente);
  audio.addEventListener('error', () => console.error('Error del <audio>:', audio.error));

  registrarControles();

  return {
    /** Cambia la lista de canciones sin cortar la que está sonando. */
    cargarLista(nuevaLista) {
      const actual = lista[indice];
      lista = nuevaLista;
      indice = actual ? lista.findIndex((c) => c.id === actual.id) : -1;
      if (actual && indice === -1) { // borraron la canción que sonaba
        audio.pause();
        audio.removeAttribute('src');
        liberarURLs();
      }
      avisar();
    },
    reproducir,
    alternar,
    siguiente,
    anterior,
    estado,
  };
}
