// arrastrar.js — Reordenar una lista arrastrando cada fila desde su agarradera (⋮⋮).
//
// Funciona con dedo y con mouse (Pointer Events). Mientras arrastras, la fila
// se mueve entre las demás; al soltar se llama alSoltar con los ids en el nuevo orden.

const MARGEN_AUTOSCROLL = 80; // px cerca del borde de la pantalla para empezar a desplazar
const VELOCIDAD_AUTOSCROLL = 12;

/**
 * @param {HTMLUListElement} lista  sus <li> deben tener data-id y una .cancion__arrastre
 * @param {(ids: string[]) => void} alSoltar
 */
export function activarArrastre(lista, alSoltar) {
  lista.addEventListener('pointerdown', (evento) => {
    const agarradera = evento.target.closest('.cancion__arrastre');
    if (!agarradera || !lista.contains(agarradera)) return;
    evento.preventDefault();

    const fila = agarradera.closest('li');
    const ordenInicial = idsDe(lista);
    let ultimaY = evento.clientY;
    let autoscroll = null;

    fila.classList.add('cancion--arrastrando');
    agarradera.setPointerCapture(evento.pointerId);

    // Mueve la fila por encima o por debajo de sus vecinas según dónde está el dedo.
    // Repite hasta quedar en su lugar, por si el dedo se movió varias filas de golpe.
    // Se mueven las VECINAS, nunca la fila arrastrada: si la sacáramos del DOM,
    // el navegador soltaría el dedo a medio arrastre.
    const acomodar = () => {
      for (;;) {
        const anterior = fila.previousElementSibling;
        const siguiente = fila.nextElementSibling;
        if (anterior && ultimaY < mitad(anterior)) lista.insertBefore(anterior, siguiente);
        else if (siguiente && ultimaY > mitad(siguiente)) lista.insertBefore(siguiente, fila);
        else break;
      }
    };

    // Cerca de los bordes, la página se desplaza sola para llegar más lejos.
    const desplazar = () => {
      const alto = window.innerHeight;
      let paso = 0;
      if (ultimaY < MARGEN_AUTOSCROLL) paso = -VELOCIDAD_AUTOSCROLL;
      else if (ultimaY > alto - MARGEN_AUTOSCROLL - 100) paso = VELOCIDAD_AUTOSCROLL; // 100: el reproductor de abajo
      if (paso) {
        window.scrollBy(0, paso);
        acomodar();
      }
      autoscroll = requestAnimationFrame(desplazar);
    };
    autoscroll = requestAnimationFrame(desplazar);

    const alMover = (e) => {
      ultimaY = e.clientY;
      acomodar();
    };

    // Escuchamos en toda la ventana: así seguimos el dedo aunque salga de la agarradera.
    const alTerminar = () => {
      cancelAnimationFrame(autoscroll);
      fila.classList.remove('cancion--arrastrando');
      window.removeEventListener('pointermove', alMover);
      window.removeEventListener('pointerup', alTerminar);
      window.removeEventListener('pointercancel', alTerminar);
      const ordenFinal = idsDe(lista);
      if (ordenFinal.join() !== ordenInicial.join()) alSoltar(ordenFinal);
    };

    window.addEventListener('pointermove', alMover);
    window.addEventListener('pointerup', alTerminar);
    window.addEventListener('pointercancel', alTerminar);
  });

  // Que tocar la agarradera no reproduzca la canción.
  lista.addEventListener('click', (evento) => {
    if (evento.target.closest('.cancion__arrastre')) evento.stopPropagation();
  }, true);
}

function idsDe(lista) {
  return [...lista.children].map((li) => li.dataset.id);
}

function mitad(elemento) {
  const caja = elemento.getBoundingClientRect();
  return caja.top + caja.height / 2;
}
