// reproductor-nativo.js — El reproductor para la APK: quien suena es el servicio
// nativo de Android (ServicioMusica), que sigue aunque cierres la app.
//
// Tiene las mismas funciones que reproductor.js (reproducirLista, alternar,
// siguiente…), así el resto de la app no cambia. Aquí se calcula el orden
// (aleatorio y vínculos ⛓) y se le manda al servicio la cola ya ordenada:
// así, aunque la app esté cerrada, Android sabe qué sigue.

import { Reproductor } from './archivos.js';

const CLAVE_COLA = 'muz15-cola-nativa'; // para reconocer la cola al volver a abrir la app
const CADA_CUANTO_PROGRESO_MS = 500;

/**
 * @param {object} opciones
 * @param {(cancion) => Promise<{url: string, portada: string, portadaPantalla: string}>} opciones.fuente
 *        url = archivo o servidor para Android; portadaPantalla = para mostrar en la app
 * @param {(estado) => void} opciones.alCambiar
 * @param {(tiempo: {actual: number, duracion: number}) => void} opciones.alProgreso
 * @param {(mensaje: string) => void} opciones.alFallar
 */
export function crearReproductorNativo({ fuente, alCambiar, alProgreso, alFallar }) {
  let lista = [];
  let orden = [];    // posición en la cola nativa → índice en "lista"
  let indice = -1;   // índice en "lista" de la que suena
  let sonando = false;
  let aleatorio = false;
  let fundido = 0;   // (el reproductor nativo cambia sin pausa; el fundido no aplica)
  let urlPortada = null;
  let ultimoSegundo = 0;

  const estado = () => ({
    cancion: lista[indice] ?? null,
    indice,
    sonando,
    aleatorio,
    fundido,
    urlPortada,
  });
  const avisar = () => alCambiar(estado());

  /* ---------- Orden (igual que reproductor.js) ---------- */

  function mezclar(arreglo) {
    for (let i = arreglo.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arreglo[i], arreglo[j]] = [arreglo[j], arreglo[i]];
    }
    return arreglo;
  }

  // Las vinculadas van pegadas detrás de su canción; en aleatorio, "primera" va al inicio.
  function calcularOrden(primera) {
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
    const resultado = [];
    for (const i of base) {
      for (let x = i; x !== undefined && !colocadas.has(x); x = siguienteDe(x)) {
        resultado.push(x);
        colocadas.add(x);
      }
    }
    lista.forEach((_, i) => { if (!colocadas.has(i)) resultado.push(i); });
    return resultado;
  }

  /* ---------- Cola en el servicio ---------- */

  async function cargar(desde, { reproducir = true, segundo = 0 } = {}) {
    if (!lista.length) return;
    orden = calcularOrden(desde);
    try {
      const canciones = await Promise.all(orden.map(async (i) => {
        const c = lista[i];
        const { url, portada } = await fuente(c);
        return { id: c.id, url, titulo: c.titulo, artista: c.artista, album: c.album || 'Muzzy', portada };
      }));
      indice = desde;
      urlPortada = (await fuente(lista[desde])).portadaPantalla;
      sonando = reproducir;
      avisar();
      await Reproductor.cargarCola({ canciones, indice: orden.indexOf(desde), segundo, reproducir });
      guardarCola();
    } catch (error) {
      console.error(error);
      alFallar?.(error.message);
    }
  }

  function guardarCola() {
    try {
      localStorage.setItem(CLAVE_COLA, JSON.stringify(orden.map((i) => lista[i].id)));
    } catch { /* nada */ }
  }

  /** Recarga la cola con el orden nuevo sin cortar: misma canción, mismo segundo. */
  async function reacomodar() {
    if (indice < 0) return;
    const { segundo = ultimoSegundo } = await Reproductor.estado().catch(() => ({}));
    await cargar(indice, { reproducir: sonando, segundo });
  }

  /* ---------- Avisos del servicio ---------- */

  async function alCambiarNativo(e) {
    if (!e || e.id == null) return;
    const i = lista.findIndex((c) => c.id === e.id);
    const cambioCancion = i !== -1 && i !== indice;
    if (i !== -1) indice = i;
    sonando = Boolean(e.sonando);
    if (cambioCancion) urlPortada = (await fuente(lista[indice]).catch(() => ({}))).portadaPantalla ?? null;
    if (typeof e.segundo === 'number') {
      ultimoSegundo = e.segundo;
      alProgreso?.({ actual: e.segundo, duracion: e.duracion || 0 });
    }
    avisar();
  }

  Reproductor.addListener('cambio', alCambiarNativo);

  // La barra de progreso: preguntamos al servicio mientras la app está a la vista.
  setInterval(async () => {
    if (document.visibilityState !== 'visible' || !sonando) return;
    const e = await Reproductor.estado().catch(() => null);
    if (e?.id != null) {
      ultimoSegundo = e.segundo;
      alProgreso?.({ actual: e.segundo, duracion: e.duracion || 0 });
      if (Boolean(e.sonando) !== sonando) alCambiarNativo(e);
    }
  }, CADA_CUANTO_PROGRESO_MS);

  /* ---------- Lo que usa la app (igual que reproductor.js) ---------- */

  return {
    reproducirLista(nueva, desde) {
      lista = nueva;
      return cargar(desde, { reproducir: true });
    },
    prepararLista(nueva, desde, segundo) {
      lista = nueva;
      return cargar(desde, { reproducir: false, segundo });
    },
    /**
     * Al abrir la app: si el servicio ya estaba sonando (la cerraste con música),
     * reconoce esa cola para mostrarla. @returns {Promise<boolean>} true si había algo
     */
    async adoptarColaExistente(buscarCancion) {
      const e = await Reproductor.estado().catch(() => null);
      if (!e?.total || e.id == null) return false;
      let ids = [];
      try { ids = JSON.parse(localStorage.getItem(CLAVE_COLA)) ?? []; } catch { ids = []; }
      const canciones = ids.map(buscarCancion).filter(Boolean);
      if (!canciones.length) return false;
      lista = canciones;
      orden = lista.map((_, i) => i);
      indice = Math.max(0, lista.findIndex((c) => c.id === e.id));
      sonando = Boolean(e.sonando);
      urlPortada = (await fuente(lista[indice]).catch(() => ({}))).portadaPantalla ?? null;
      avisar();
      alProgreso?.({ actual: e.segundo || 0, duracion: e.duracion || 0 });
      return true;
    },
    refrescar(canciones) {
      if (!lista.length) return;
      const nuevas = new Map(canciones.map((c) => [c.id, c]));
      const mismas = canciones.length === lista.length && lista.every((c) => nuevas.has(c.id));
      const actual = lista[indice];
      const antes = orden.map((i) => lista[i]?.id).join();
      lista = mismas ? canciones : lista.map((c) => nuevas.get(c.id) ?? c);
      indice = actual ? lista.findIndex((c) => c.id === actual.id) : -1;
      // Si cambió el orden (arrastraste, vínculos nuevos…), se le avisa al servicio.
      if (orden.length && calcularOrden(indice).map((i) => lista[i].id).join() !== antes && !aleatorio) reacomodar();
      avisar();
    },
    cambiarAleatorio(activar) {
      aleatorio = activar;
      reacomodar();
      avisar();
    },
    cambiarFundido(segundos) {
      fundido = segundos;
      avisar();
    },
    async quitar(id) {
      const lugar = lista.findIndex((c) => c.id === id);
      if (lugar === -1) return;
      const eraLaActual = lugar === indice;
      const actual = lista[indice];
      lista = lista.filter((c) => c.id !== id);
      if (eraLaActual || !lista.length) {
        await Reproductor.pausar().catch(() => {});
        indice = -1;
        sonando = false;
        avisar();
        return;
      }
      indice = lista.findIndex((c) => c.id === actual.id);
      reacomodar();
    },
    async alternar() {
      if (indice === -1) return lista.length ? cargar(0) : undefined;
      sonando = !sonando;
      avisar();
      await (sonando ? Reproductor.reproducir() : Reproductor.pausar());
    },
    /** Lo que sigue (hasta 30), en el orden en que va a sonar. */
    cola() {
      const p = orden.indexOf(indice);
      if (p === -1) return [];
      return Array.from({ length: Math.min(30, orden.length - 1) }, (_, k) => lista[orden[(p + 1 + k) % orden.length]]).filter(Boolean);
    },
    /** Salta a una canción de la cola (sin recargarla). */
    saltarA(id) {
      const p = orden.indexOf(lista.findIndex((c) => c.id === id));
      if (p !== -1) return Reproductor.irACancion({ indice: p });
    },
    siguiente: () => Reproductor.siguiente(),
    anterior: () => Reproductor.anterior(),
    irA: (segundo) => Reproductor.irA({ segundo }),
    estado,
  };
}
