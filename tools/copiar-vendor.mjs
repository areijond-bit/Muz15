// copiar-vendor.mjs — Copia a js/vendor/ las librerías que la página usa tal cual
// (la app no tiene paso de compilación). Correr después de actualizar alguna:
//   npm run vendor
import { copyFileSync } from 'node:fs';

const copias = {
  'node_modules/@supabase/supabase-js/dist/umd/supabase.js': 'js/vendor/supabase.js',
  'node_modules/webm-muxer/build/webm-muxer.mjs': 'js/vendor/webm-muxer.mjs',
  'node_modules/mp4-muxer/build/mp4-muxer.mjs': 'js/vendor/mp4-muxer.mjs',
};
for (const [desde, hacia] of Object.entries(copias)) {
  copyFileSync(desde, hacia);
  console.log(`${desde} → ${hacia}`);
}
