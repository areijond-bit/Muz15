// hoja.js — Menú que sube desde abajo (como en Spotify) para elegir una acción,
// confirmar algo o escribir un nombre.
//
// Usamos esto en vez de confirm() / prompt() del navegador porque en las apps
// instaladas de Android esas ventanitas a veces no aparecen.

import { icono } from './iconos.js';

/**
 * @param {object} opciones
 * @param {string} opciones.titulo
 * @param {string} [opciones.subtitulo]
 * @param {{texto: string, icono?: string, peligro?: boolean, alElegir: () => void}[]} [opciones.acciones]
 * @param {{placeholder: string, valor?: string, numero?: boolean, textoBoton: string, alAceptar: (texto: string) => void}} [opciones.entrada]
 * @param {HTMLElement} [opciones.contenido]  cualquier otro contenido (ej. un formulario)
 * @param {() => void} [opciones.alCerrar]  si se cierra sin elegir nada (Cancelar, tocar fuera, Esc)
 * @returns {() => void} función para cerrar la hoja
 */
export function abrirHoja({ titulo, subtitulo, acciones = [], entrada, contenido, alCerrar }) {
  let elegida = false;
  const fondo = document.createElement('div');
  fondo.className = 'hoja-fondo';

  const hoja = document.createElement('div');
  hoja.className = 'hoja';
  hoja.setAttribute('role', 'dialog');
  hoja.setAttribute('aria-modal', 'true');

  const encabezado = document.createElement('p');
  encabezado.className = 'hoja__titulo';
  encabezado.textContent = titulo;
  hoja.append(encabezado);

  if (subtitulo) {
    const sub = document.createElement('p');
    sub.className = 'hoja__subtitulo';
    sub.textContent = subtitulo;
    hoja.append(sub);
  }

  let cerrada = false;
  const cerrar = () => {
    if (cerrada) return;
    cerrada = true;
    fondo.remove();
    document.removeEventListener('keydown', alTeclear);
    if (!elegida) alCerrar?.();
  };
  const alTeclear = (evento) => { if (evento.key === 'Escape') cerrar(); };
  document.addEventListener('keydown', alTeclear);

  // Tocar fuera de la hoja la cierra.
  fondo.addEventListener('click', (evento) => { if (evento.target === fondo) cerrar(); });

  if (entrada) {
    const formulario = document.createElement('form');
    formulario.className = 'hoja__formulario';
    const campo = document.createElement('input');
    campo.className = 'campo__entrada';
    campo.placeholder = entrada.placeholder;
    campo.value = entrada.valor ?? '';
    campo.maxLength = 60;
    if (entrada.numero) { // teclado de números en el cel
      campo.inputMode = 'numeric';
      campo.pattern = '[0-9]*';
    }
    campo.required = true;
    const boton = document.createElement('button');
    boton.className = 'boton boton--primario boton--ancho';
    boton.type = 'submit';
    boton.textContent = entrada.textoBoton;
    formulario.append(campo, boton);
    formulario.addEventListener('submit', (evento) => {
      evento.preventDefault();
      const texto = campo.value.trim();
      if (!texto) return;
      cerrar();
      entrada.alAceptar(texto);
    });
    hoja.append(formulario);
    setTimeout(() => campo.focus(), 50);
  }

  if (contenido) hoja.append(contenido);

  for (const accion of [...acciones, { texto: 'Cancelar', alElegir: () => {} }]) {
    const boton = document.createElement('button');
    boton.className = 'hoja__accion';
    if (accion.peligro) boton.classList.add('hoja__accion--peligro');
    // Ícono dibujado a la izquierda (ver js/iconos.js), si la acción trae uno.
    if (accion.icono) boton.insertAdjacentHTML('beforeend', icono(accion.icono));
    boton.append(accion.texto);
    boton.addEventListener('click', () => {
      if (accion.texto !== 'Cancelar' || accion.icono) elegida = true;
      cerrar();
      accion.alElegir();
    });
    hoja.append(boton);
  }

  fondo.append(hoja);
  document.body.append(fondo);
  return cerrar;
}

/** Pregunta "¿Seguro?" con un botón rojo. */
export function confirmar({ titulo, subtitulo, textoBoton, alConfirmar }) {
  abrirHoja({ titulo, subtitulo, acciones: [{ texto: textoBoton, peligro: true, alElegir: alConfirmar }] });
}
