// iconos.js — Los íconos de Muz15, dibujados (SVG) en vez de emojis.
// Los emojis se ven distinto en cada teléfono; estos se ven igual en todos y
// toman el color del texto (currentColor).
//
// Uso en HTML:  <span data-icono="play"></span>   (se llenan solos con ponerIconos())
// Uso en JS:    elemento.innerHTML = icono('play')

// Cada ícono en una cuadrícula de 24×24. "relleno" = figura sólida; si no, línea.
const TRAZOS = {
  play: { relleno: 'M8 5.5v13a.8.8 0 0 0 1.2.7l10.4-6.5a.8.8 0 0 0 0-1.4L9.2 4.8A.8.8 0 0 0 8 5.5z' },
  pausa: { relleno: 'M7 5h3.2v14H7zM13.8 5H17v14h-3.2z' },
  siguiente: { relleno: 'M5 5.6v12.8a.6.6 0 0 0 .9.5l9.1-6.4a.6.6 0 0 0 0-1L5.9 5.1a.6.6 0 0 0-.9.5zM17 5h2.2v14H17z' },
  anterior: { relleno: 'M19 5.6v12.8a.6.6 0 0 1-.9.5L9 12.5a.6.6 0 0 1 0-1l9.1-6.4a.6.6 0 0 1 .9.5zM4.8 5H7v14H4.8z' },
  aleatorio: { linea: 'M16 4h4v4M4 20L20 4M20 16v4h-4M14.5 14.5L20 20M4 4l5 5' },
  mas: { relleno: 'M12 6.5a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2zm0 7.1a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2zm0 7.1a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2z' },
  atras: { linea: 'M20 12H5M11 5l-7 7 7 7' },
  cerrar: { linea: 'M6 6l12 12M18 6L6 18' },
  agregar: { linea: 'M12 5v14M5 12h14' },
  descargar: { linea: 'M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14' },
  descargado: { relleno: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.2 13.6l-3.9-3.9 1.4-1.4 2.5 2.5 5.4-5.4 1.4 1.4z' },
  ajustes: { linea: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4' },
  buscar: { linea: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4' },
  telefono: { linea: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2' },
  album: { linea: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z' },
  playlist: { linea: 'M4 6h11M4 11h11M4 16h7M18 15V5l3 1.5M18 15a2 2 0 1 1-4 0 2 2 0 0 1 4 0z' },
  pc: { linea: 'M3 5h18v11H3zM8 20h8M12 16v4' },
  globo: { linea: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18' },
  candado: { linea: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3' },
  enlace: { linea: 'M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1' },
  editar: { linea: 'M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3zM13.5 8.5l2 2' },
  borrar: { linea: 'M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13' },
  ecualizador: { linea: 'M6 4v16M12 4v16M18 4v16M4 14h4M10 8h4M16 16h4' },
  audifonos: { linea: 'M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H5a1 1 0 0 1-1-1v-4zM20 15h-3v5h2a1 1 0 0 0 1-1v-4z' },
  escudo: { linea: 'M12 3l7.5 3v6c0 4.7-3.2 7.7-7.5 9-4.3-1.3-7.5-4.3-7.5-9V6z' },
  transicion: { linea: 'M4 8h14l-3.5-3.5M20 16H6l3.5 3.5' },
  repetidas: { linea: 'M8 8h12v12H8zM4 16V4h12' },
  actualizar: { linea: 'M20 12a8 8 0 1 1-2.4-5.7M20 4v4h-4' },
  subir: { linea: 'M12 20V9M7.5 13.5L12 9l4.5 4.5M5 4h14' },
  regla: { linea: 'M3.5 16.5L16.5 3.5l4 4-13 13zM7 13l2 2M10 10l1.5 1.5M13 7l2 2' },
  arrastrar: { relleno: 'M9 7a1.4 1.4 0 1 0 0-2.8A1.4 1.4 0 0 0 9 7zm6 0a1.4 1.4 0 1 0 0-2.8A1.4 1.4 0 0 0 15 7zm-6 6.4a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8zm6 0a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8zM9 19.8a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8zm6 0a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8z' },
  nota: { linea: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z' },
  reloj: { linea: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2' },
};

/** El SVG de un ícono como texto. */
export function icono(nombre, tamano = 24) {
  const trazo = TRAZOS[nombre];
  if (!trazo) return '';
  const forma = trazo.relleno
    ? `<path d="${trazo.relleno}" fill="currentColor"/>`
    : `<path d="${trazo.linea}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<svg class="icono" viewBox="0 0 24 24" width="${tamano}" height="${tamano}" aria-hidden="true">${forma}</svg>`;
}

/** Llena todos los <… data-icono="nombre"> que haya dentro de "raiz". */
export function ponerIconos(raiz = document) {
  for (const elemento of raiz.querySelectorAll('[data-icono]')) {
    elemento.innerHTML = icono(elemento.dataset.icono, Number(elemento.dataset.tamano) || 24);
  }
}
