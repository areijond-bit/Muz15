// config.js — Datos para conectar Muzzy con tu nube. No son secretos: van en la
// página (la seguridad la ponen las reglas de la base de datos, nube/esquema.sql).
//
// Dónde sale cada uno: ver docs/nube.md.

/** Supabase → Project Settings → API → Project URL */
export const SUPABASE_URL = 'https://sslzsoeyghcptpkemvef.supabase.co';

/** Supabase → Project Settings → API Keys → Publishable key */
export const SUPABASE_LLAVE_PUBLICA = 'sb_publishable_0Q5BCi9VZ29gziOnd5VBsA_NYrfbdbo';

/** Google Cloud → Credenciales → ID de cliente de tipo "Aplicación web" */
export const GOOGLE_CLIENTE_WEB = '340319872333-9q4j9ivl6e7dmgin6g0bjs98pdpfle1d.apps.googleusercontent.com';

/**
 * Dónde se guardan los audios, portadas y fotos:
 *  - 'supabase': el almacén de Supabase (1 GB gratis, sin tarjeta). Ver nube/esquema.sql.
 *  - 'r2': Cloudflare R2 (10 GB gratis, pide tarjeta). Necesita la función "firmar".
 */
export const ALMACEN = 'supabase';

/** ¿Ya está todo puesto? */
export const nubeConfigurada = () => Boolean(SUPABASE_URL && SUPABASE_LLAVE_PUBLICA && GOOGLE_CLIENTE_WEB);
