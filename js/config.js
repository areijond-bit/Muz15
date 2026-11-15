// config.js — Datos para conectar Muz15 con tu nube. No son secretos: van en la
// página (la seguridad la ponen las reglas de la base de datos, nube/esquema.sql).
//
// Dónde sale cada uno: ver docs/nube.md.

/** Supabase → Project Settings → API → Project URL */
export const SUPABASE_URL = 'https://sslzsoeyghcptpkemvef.supabase.co';

/** Supabase → Project Settings → API Keys → Publishable key */
export const SUPABASE_LLAVE_PUBLICA = 'sb_publishable_0Q5BCi9VZ29gziOnd5VBsA_NYrfbdbo';

/** Google Cloud → Credenciales → ID de cliente de tipo "Aplicación web" */
export const GOOGLE_CLIENTE_WEB = '';

/** ¿Ya está todo puesto? */
export const nubeConfigurada = () => Boolean(SUPABASE_URL && SUPABASE_LLAVE_PUBLICA && GOOGLE_CLIENTE_WEB);
