// generar-iconos.mjs — Crea los íconos placeholder de Muz15 sin instalar nada.
// Uso:  node tools/generar-iconos.mjs
// Cuando tengas tus íconos diseñados, reemplaza los PNG de /icons y borra este archivo.

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const FONDO = [0x00, 0x00, 0x00];
const ACENTO = [0xa8, 0xff, 0x1a];
const BLANCO = [0xf4, 0xf4, 0xf6];
const MUESTREO = 4; // dibujamos 4 veces más grande y reducimos: bordes suaves

// Dígitos en una cuadrícula de 5x7 (1 = relleno).
const DIGITOS = {
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
};

function lienzo(tamano) {
  const t = tamano * MUESTREO;
  const pixeles = new Array(t * t);
  return {
    t,
    pintar(fn) {
      for (let y = 0; y < t; y++) {
        for (let x = 0; x < t; x++) {
          const color = fn(x / t, y / t);
          if (color) pixeles[y * t + x] = color;
        }
      }
    },
    // Reduce al tamaño final promediando cada bloque de MUESTREO x MUESTREO.
    reducir() {
      const salida = Buffer.alloc(tamano * tamano * 3);
      for (let y = 0; y < tamano; y++) {
        for (let x = 0; x < tamano; x++) {
          const suma = [0, 0, 0];
          for (let dy = 0; dy < MUESTREO; dy++) {
            for (let dx = 0; dx < MUESTREO; dx++) {
              const p = pixeles[(y * MUESTREO + dy) * t + x * MUESTREO + dx];
              for (let c = 0; c < 3; c++) suma[c] += p[c];
            }
          }
          for (let c = 0; c < 3; c++) salida[(y * tamano + x) * 3 + c] = Math.round(suma[c] / MUESTREO ** 2);
        }
      }
      return salida;
    },
  };
}

function png(tamano, rgb) {
  const filas = Buffer.alloc((tamano * 3 + 1) * tamano);
  for (let y = 0; y < tamano; y++) rgb.copy(filas, y * (tamano * 3 + 1) + 1, y * tamano * 3, (y + 1) * tamano * 3);
  const trozo = (tipo, datos) => {
    const largo = Buffer.alloc(4); largo.writeUInt32BE(datos.length);
    const cuerpo = Buffer.concat([Buffer.from(tipo), datos]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(cuerpo));
    return Buffer.concat([largo, cuerpo, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(tamano, 0); ihdr.writeUInt32BE(tamano, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bits, RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr),
    trozo('IDAT', deflateSync(filas)),
    trozo('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

// Ícono de la app: "15" en el color de acento sobre fondo oscuro.
// "celda" = tamaño de cada cuadrito del dígito (más chico = "15" más chico).
function icono(tamano, celda = 0.058) {
  const l = lienzo(tamano);
  l.pintar(() => FONDO);
  const anchoTexto = celda * 11;       // 5 + 1 de separación + 5
  const x0 = (1 - anchoTexto) / 2;
  const y0 = (1 - celda * 7) / 2;
  l.pintar((x, y) => {
    const fila = Math.floor((y - y0) / celda);
    const col = Math.floor((x - x0) / celda);
    if (fila < 0 || fila > 6 || col < 0 || col > 10 || col === 5) return null;
    const digito = col < 5 ? DIGITOS[1] : DIGITOS[5];
    return digito[fila][col < 5 ? col : col - 6] === '1' ? ACENTO : null;
  });
  return png(tamano, l.reducir());
}

// Portada por defecto: una nota musical.
function portada(tamano) {
  const l = lienzo(tamano);
  l.pintar((x, y) => FONDO.map((c, i) => Math.round(c + (ACENTO[i] - c) * 0.18 * (1 - y))));
  l.pintar((x, y) => {
    const cabeza = (x - 0.42) ** 2 / 0.11 ** 2 + (y - 0.66) ** 2 / 0.085 ** 2 <= 1;
    const palo = x >= 0.49 && x <= 0.53 && y >= 0.26 && y <= 0.66;
    const bandera = x >= 0.49 && x <= 0.66 && y >= 0.26 && y <= 0.33;
    return cabeza || palo || bandera ? BLANCO : null;
  });
  return png(tamano, l.reducir());
}

mkdirSync('icons', { recursive: true });
for (const t of [180, 192, 512]) writeFileSync(`icons/icono-${t}.png`, icono(t));
writeFileSync('icons/portada.png', portada(512));
console.log('Íconos creados en /icons');

// APK de Android: un ícono por densidad de pantalla. El "foreground" es la capa
// del ícono adaptable; Android le recorta los bordes, así que el "15" va más chico.
const RES = 'android/app/src/main/res';
const DENSIDADES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [densidad, escala] of Object.entries(DENSIDADES)) {
  const carpeta = `${RES}/mipmap-${densidad}`;
  mkdirSync(carpeta, { recursive: true });
  writeFileSync(`${carpeta}/ic_launcher.png`, icono(48 * escala));
  writeFileSync(`${carpeta}/ic_launcher_round.png`, icono(48 * escala));
  writeFileSync(`${carpeta}/ic_launcher_foreground.png`, icono(108 * escala, 0.04));
}
// Pantalla de carga: negra con el "15".
for (const carpeta of ['drawable', ...Object.keys(DENSIDADES).flatMap((d) => [`drawable-port-${d}`, `drawable-land-${d}`])]) {
  writeFileSync(`${RES}/${carpeta}/splash.png`, icono(480, 0.025));
}
console.log('Íconos de Android creados');
