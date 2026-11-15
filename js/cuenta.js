// cuenta.js — Tu cuenta de Muz15 (entrar con Google, en Supabase).
//
//  - En la PC (navegador): te manda a la página de Google y regresas ya adentro.
//  - En la APK: Google no deja entrar desde una página dentro de una app, así que
//    la ventanita de cuentas la abre Android (complemento nativo "Cuenta") y
//    Supabase recibe el token de identidad.
// La sesión se queda guardada y se renueva sola: entras una vez por dispositivo.

import { Capacitor, registerPlugin } from './vendor/capacitor-core.js';
import { esApk } from './nativo.js';
import { SUPABASE_URL, SUPABASE_LLAVE_PUBLICA, GOOGLE_CLIENTE_WEB, nubeConfigurada } from './config.js';

const CuentaNativa = esApk ? registerPlugin('Cuenta') : null;

let cliente = null;

/** El cliente de Supabase (o null si falta configurar). js/vendor/supabase.js lo trae. */
export function supabase() {
  if (!cliente && nubeConfigurada() && window.supabase) {
    cliente = window.supabase.createClient(SUPABASE_URL, SUPABASE_LLAVE_PUBLICA, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    });
  }
  return cliente;
}

/** ¿Este Muz15 puede entrar? Si no, el motivo para mostrarlo. */
export function puedeEntrar() {
  if (!nubeConfigurada()) return { si: false, motivo: 'Muzzy todavía no está conectado a su nube.' };
  if (esApk && !Capacitor.isPluginAvailable('Cuenta')) {
    return { si: false, motivo: 'Necesitas la APK nueva para entrar con Google. Ve a Configuración → Buscar actualizaciones.' };
  }
  return { si: true };
}

/** El usuario con sesión iniciada (o null). */
export async function usuarioActual() {
  const db = supabase();
  if (!db) return null;
  const { data } = await db.auth.getSession();
  return data.session?.user ?? null;
}

/** Avisa cada vez que entras o sales (también desde otra pestaña). */
export function alCambiarSesion(funcion) {
  supabase()?.auth.onAuthStateChange((evento, sesion) => {
    if (['SIGNED_IN', 'SIGNED_OUT', 'INITIAL_SESSION'].includes(evento)) funcion(sesion?.user ?? null);
  });
}

/** Entrar con Google. En el navegador la página se va a Google y regresa sola. */
export async function entrar() {
  const db = supabase();
  if (esApk) {
    const { token } = await CuentaNativa.entrar({ clienteWeb: GOOGLE_CLIENTE_WEB });
    const { data, error } = await db.auth.signInWithIdToken({ provider: 'google', token });
    if (error) throw error;
    return data.user;
  }
  const regreso = location.origin + location.pathname;
  const { error } = await db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: regreso } });
  if (error) throw error;
  return null; // la página se va a Google
}

/** Salir en este dispositivo (tus canciones descargadas se quedan). */
export async function salir() {
  await supabase()?.auth.signOut({ scope: 'local' });
}
