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
      // 'implicit': Google regresa con la sesión en la dirección. (Con 'pkce', si se tocaba "Entrar"
      // dos veces o había dos pestañas, la segunda llave pisaba a la primera y fallaba.)
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
    });
  }
  return cliente;
}

/** ¿Este Muzzy puede entrar (con correo)? Si no, el motivo para mostrarlo. */
export function puedeEntrar() {
  if (!nubeConfigurada()) return { si: false, motivo: 'Muzzy todavía no está conectado a su nube.' };
  return { si: true };
}

/** Con Google hace falta, en la APK, la parte nativa (APK 1.10 o más nueva). */
export const puedeEntrarConGoogle = () => puedeEntrar().si && (!esApk || Capacitor.isPluginAvailable('Cuenta'));

/** El usuario con sesión iniciada (o null). */
export async function usuarioActual() {
  const db = supabase();
  if (!db) return null;
  const { data } = await db.auth.getSession();
  return data.session?.user ?? null;
}

/**
 * Avisa cada vez que entras o sales (también desde otra pestaña).
 * alRecuperar: abriste el enlace de "olvidé mi contraseña" (hay que poner una nueva).
 */
export function alCambiarSesion(funcion, { alRecuperar } = {}) {
  supabase()?.auth.onAuthStateChange((evento, sesion) => {
    if (['SIGNED_IN', 'SIGNED_OUT', 'INITIAL_SESSION'].includes(evento)) funcion(sesion?.user ?? null);
    if (evento === 'PASSWORD_RECOVERY') setTimeout(() => alRecuperar?.());
  });
}

/* ---------- Con correo y contraseña ---------- */

// Los errores de Supabase vienen en inglés: los de siempre, en español.
function enEspanol(error) {
  const texto = error?.message ?? '';
  if (/invalid login credentials/i.test(texto)) return new Error('Correo o contraseña incorrectos.');
  if (/already registered|already exists/i.test(texto)) return new Error('Ese correo ya tiene cuenta. Entra con él.');
  if (/password.*(at least|characters|short)/i.test(texto)) return new Error('La contraseña debe tener al menos 6 caracteres.');
  if (/invalid.*email|email.*invalid|valid email/i.test(texto)) return new Error('Ese correo no es válido.');
  if (/email not confirmed/i.test(texto)) return new Error('Falta confirmar tu correo.');
  if (/rate limit|too many/i.test(texto)) return new Error('Demasiados intentos. Espera unos minutos.');
  return new Error(texto || 'Algo falló.');
}

export async function entrarConCorreo(correo, contrasena) {
  const { data, error } = await supabase().auth.signInWithPassword({ email: correo.trim(), password: contrasena });
  if (error) throw enEspanol(error);
  return data.user;
}

/** Crea la cuenta y entra de una vez (el nombre de usuario se elige después). */
export async function crearCuenta(correo, contrasena) {
  const { data, error } = await supabase().auth.signUp({
    email: correo.trim(),
    password: contrasena,
    options: { emailRedirectTo: location.origin + location.pathname },
  });
  if (error) throw enEspanol(error);
  // Si Supabase pidiera confirmar el correo, no habría sesión todavía.
  return { usuario: data.user, falta: data.session ? null : 'confirmar' };
}

/** Manda el correo para poner una contraseña nueva. */
export async function recuperarContrasena(correo) {
  const { error } = await supabase().auth.resetPasswordForEmail(correo.trim(), { redirectTo: location.origin + location.pathname });
  if (error) throw enEspanol(error);
}

export async function cambiarContrasena(nueva) {
  const { error } = await supabase().auth.updateUser({ password: nueva });
  if (error) throw enEspanol(error);
}

/* ---------- Con Google ---------- */

/** Entrar con Google. En el navegador la página se va a Google y regresa sola. */
export async function entrar() {
  const db = supabase();
  if (esApk) {
    const { token } = await CuentaNativa.entrar({ clienteWeb: GOOGLE_CLIENTE_WEB });
    const { data, error } = await db.auth.signInWithIdToken({ provider: 'google', token });
    if (error) throw enEspanol(error);
    return data.user;
  }
  const regreso = location.origin + location.pathname;
  const { error } = await db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: regreso } });
  if (error) throw error;
  return null; // la página se va a Google
}

/**
 * Si al regresar de Google algo falló, Supabase lo deja en la dirección
 * (#error_description=… o ?error_description=…). Devuelve el mensaje y limpia la dirección.
 */
export function errorAlRegresar() {
  const datos = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
  const error = datos.get('error_description') || datos.get('error');
  if (!error) return null;
  history.replaceState(null, '', location.pathname);
  return error.replace(/\+/g, ' ');
}

/** Salir en este dispositivo (tus canciones descargadas se quedan). */
export async function salir() {
  await supabase()?.auth.signOut({ scope: 'local' });
}
