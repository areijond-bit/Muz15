// md5.js — Calcula el MD5 de un texto.
//
// Lo pide el protocolo de Navidrome (Subsonic) para iniciar sesión sin mandar
// la contraseña: se envía md5(contraseña + sal) y la sal. El navegador no trae
// MD5 (crypto.subtle no lo tiene), por eso va aquí.

const DESPLAZAMIENTOS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const CONSTANTES = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

/** @returns {string} el MD5 en hexadecimal (32 caracteres) */
export function md5(texto) {
  const bytes = new TextEncoder().encode(texto);

  // Relleno: un bit 1, ceros, y el largo original en bits (64 bits, little-endian).
  const largoConRelleno = (((bytes.length + 8) >> 6) + 1) * 64;
  const datos = new Uint8Array(largoConRelleno);
  datos.set(bytes);
  datos[bytes.length] = 0x80;
  const vista = new DataView(datos.buffer);
  vista.setUint32(largoConRelleno - 8, (bytes.length * 8) >>> 0, true);
  vista.setUint32(largoConRelleno - 4, Math.floor(bytes.length / 2 ** 29), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let bloque = 0; bloque < largoConRelleno; bloque += 64) {
    const m = (i) => vista.getUint32(bloque + i * 4, true);
    let a = a0, b = b0, c = c0, d = d0;

    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }

      const suma = (a + f + CONSTANTES[i] + m(g)) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((suma << DESPLAZAMIENTOS[i]) | (suma >>> (32 - DESPLAZAMIENTOS[i])))) >>> 0;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  // El resultado se escribe en little-endian.
  const salida = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((valor, i) => salida.setUint32(i * 4, valor, true));
  return [...new Uint8Array(salida.buffer)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
