// tema.js — Los colores de Muzzy: principal (fondo), secundario (letras e íconos)
// y terciario (acentos: botones, las "zz"). Se cargan ANTES que la página para que
// no se vea un parpadeo con los colores de siempre.
//
// Es un script normal (no módulo) y deja window.muzzyTema para app.js.

(() => {
  const CLAVE = 'muz15-tema';

  const TEMAS = [
    { nombre: 'Muzzy', fondo: '#000000', texto: '#ffffff', acento: '#a8ff1a' },
    { nombre: 'Claro', fondo: '#ffffff', texto: '#111111', acento: '#16a34a' },
    { nombre: 'Noche azul', fondo: '#0b1020', texto: '#e8ecff', acento: '#5b8cff' },
    { nombre: 'Atardecer', fondo: '#1a0f0a', texto: '#fff1e6', acento: '#ff7a3d' },
    { nombre: 'Rosa', fondo: '#140a12', texto: '#ffe9f5', acento: '#ff4fa3' },
    { nombre: 'Morado', fondo: '#0f0a1a', texto: '#efe8ff', acento: '#a77bff' },
  ];

  /** Qué tan claro es un color (0 = negro, 1 = blanco). */
  function luz(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function aplicar(tema) {
    const raiz = document.documentElement.style;
    raiz.setProperty('--color-fondo', tema.fondo);
    raiz.setProperty('--color-texto', tema.texto);
    raiz.setProperty('--color-acento', tema.acento);
    // Sobre el acento: letras negras o blancas, la que se lea mejor.
    raiz.setProperty('--color-texto-sobre-acento', luz(tema.acento) > 0.35 ? '#000000' : '#ffffff');
    document.documentElement.dataset.temaClaro = String(luz(tema.fondo) > 0.5);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tema.fondo);
  }

  function guardado() {
    try {
      const tema = JSON.parse(localStorage.getItem(CLAVE));
      if (tema && [tema.fondo, tema.texto, tema.acento].every((c) => /^#[0-9a-f]{6}$/i.test(c))) return tema;
    } catch { /* nada */ }
    return TEMAS[0];
  }

  function guardar(tema) {
    try { localStorage.setItem(CLAVE, JSON.stringify(tema)); } catch { /* nada */ }
    aplicar(tema);
  }

  aplicar(guardado());
  window.muzzyTema = { TEMAS, guardado, guardar, aplicar };
})();
