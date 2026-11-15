// firmar — Función de Supabase (Edge Function) que da permiso para subir UN archivo
// a Cloudflare R2. La app nunca ve las llaves de R2: le pide a esta función una
// dirección firmada que sirve 10 minutos solo para ese archivo.
//
// Pide: { clase: 'audio' | 'portada' | 'foto', huella: sha256 en hex, tipo, bytes }
// Responde: { ya: true, publica } si ese archivo ya estaba (no se sube dos veces),
//           o { subir: <url para PUT>, publica } si hay que subirlo.
//
// Secretos (Supabase → Edge Functions → Secrets):
//   R2_CUENTA, R2_LLAVE_ID, R2_LLAVE_SECRETA, R2_CUBETA, R2_PUBLICA

import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CLASES: Record<string, { carpeta: string; extension: Record<string, string>; maximo: number }> = {
  audio: { carpeta: 'audios', extension: { 'audio/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/ogg': 'ogg' }, maximo: 80 * 1024 * 1024 },
  portada: { carpeta: 'portadas', extension: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }, maximo: 2 * 1024 * 1024 },
  foto: { carpeta: 'fotos', extension: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }, maximo: 2 * 1024 * 1024 },
};

const r2 = new AwsClient({
  accessKeyId: Deno.env.get('R2_LLAVE_ID')!,
  secretAccessKey: Deno.env.get('R2_LLAVE_SECRETA')!,
  service: 's3',
  region: 'auto',
});
const BASE = `https://${Deno.env.get('R2_CUENTA')}.r2.cloudflarestorage.com/${Deno.env.get('R2_CUBETA')}`;
const PUBLICA = Deno.env.get('R2_PUBLICA')!.replace(/\/+$/, '');

const responder = (codigo: number, datos: unknown) =>
  new Response(JSON.stringify(datos), { status: codigo, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (pedido) => {
  if (pedido.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (pedido.method !== 'POST') return responder(405, { error: 'Solo POST' });

  // ¿Quién eres? (la llave de tu sesión de Muzzy). Se usa la llave pública que manda
  // la app ("apikey"), no la vieja SUPABASE_ANON_KEY que Supabase retira en 2027.
  const llavePublica = pedido.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, llavePublica, {
    global: { headers: { Authorization: pedido.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return responder(401, { error: 'Necesitas entrar a Muzzy' });

  let datos: { clase?: string; huella?: string; tipo?: string; bytes?: number };
  try { datos = await pedido.json(); } catch { return responder(400, { error: 'Pedido inválido' }); }
  const clase = CLASES[datos.clase ?? ''];
  const extension = clase?.extension[datos.tipo ?? ''];
  if (!clase || !extension) return responder(400, { error: 'Tipo de archivo no permitido' });
  if (!/^[a-f0-9]{64}$/.test(datos.huella ?? '')) return responder(400, { error: 'Huella inválida' });
  if (!(Number(datos.bytes) > 0 && Number(datos.bytes) <= clase.maximo)) return responder(413, { error: 'Archivo demasiado grande' });

  // Las fotos de perfil son de cada quien; audios y portadas se comparten si son idénticos.
  const nombre = datos.clase === 'foto'
    ? `${clase.carpeta}/${user.id}-${datos.huella!.slice(0, 16)}.${extension}`
    : `${clase.carpeta}/${datos.huella}.${extension}`;
  const publica = `${PUBLICA}/${nombre}`;

  const yaEsta = await r2.fetch(`${BASE}/${nombre}`, { method: 'HEAD' });
  if (yaEsta.ok) return responder(200, { ya: true, publica, nombre });

  const firmado = await r2.sign(new Request(`${BASE}/${nombre}?X-Amz-Expires=600`, {
    method: 'PUT',
    headers: { 'Content-Type': datos.tipo! },
  }), { aws: { signQuery: true } });
  return responder(200, { subir: firmado.url, publica, nombre });
});
