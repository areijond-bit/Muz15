// config.js — Datos para conectar Muz15 con tu nube. No son secretos: van en la
// página (la seguridad la ponen las reglas de la base de datos, nube/esquema.sql).
//
// Dónde sale cada uno: ver docs/nube.md.

/** Supabase → Project Settings → API → Project URL */
export const SUPABASE_URL = '';

/** Supabase → Project Settings → API → anon / public key */
export const SUPABASE_LLAVE_PUBLICA = '';

/** Google Cloud → Credenciales → ID de cliente de tipo "Aplicación web" */
export const GOOGLE_CLIENTE_WEB = '';

/** ¿Ya está todo puesto? */
export const nubeConfigurada = () => Boolean(SUPABASE_URL && SUPABASE_LLAVE_PUBLICA && GOOGLE_CLIENTE_WEB);
