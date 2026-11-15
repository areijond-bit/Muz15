-- esquema.sql — La base de datos de Muzzy en Supabase.
-- Se pega completo en Supabase → SQL Editor → New query → Run. Se puede volver a
-- correr sin romper nada (solo crea lo que falte).
--
-- Tablas:
--   perfiles    tu usuario, nombre y foto (uno por cuenta de Google)
--   audios      cada canción subida, como un video de YouTube: tiene dueño, título, artista…
--   guardados   las canciones que tienes en TU biblioteca (tuyas o de tus amigos)
--   listas      tus álbumes y playlists
--   escuchando  qué estás escuchando ahora y en qué dispositivo
--   siguiendo   quién sigue a quién (seguidores / seguidos, como en Instagram)
--   reacciones  me gusta / no me gusta de cada audio (como en YouTube)
--   comentarios lo que escriben en cada audio
--   reproducciones cuántas veces se ha escuchado cada audio
--
-- Seguridad (RLS): cualquiera (aun sin cuenta) puede VER perfiles y audios; solo el dueño
-- puede cambiar o borrar lo suyo. Tu biblioteca y lo que escuchas solo los ves tú.

create extension if not exists pgcrypto;

-- ---------- Perfiles ----------
create table if not exists public.perfiles (
  id        uuid primary key references auth.users (id) on delete cascade,
  usuario   text not null unique check (usuario ~ '^[a-z0-9_.]{3,20}$'),
  nombre    text not null default '' check (char_length(nombre) <= 50),
  foto      text,                         -- dirección de la foto (o null: se usa la inicial)
  creado    timestamptz not null default now()
);
alter table public.perfiles enable row level security;
drop policy if exists "perfiles: todos los ven" on public.perfiles;
create policy "perfiles: todos los ven" on public.perfiles for select to anon, authenticated using (true);
drop policy if exists "perfiles: el tuyo lo creas tú" on public.perfiles;
create policy "perfiles: el tuyo lo creas tú" on public.perfiles for insert to authenticated with check (id = auth.uid());
drop policy if exists "perfiles: el tuyo lo cambias tú" on public.perfiles;
create policy "perfiles: el tuyo lo cambias tú" on public.perfiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ---------- Audios ----------
create table if not exists public.audios (
  id         uuid primary key default gen_random_uuid(),
  dueno      uuid not null references public.perfiles (id) on delete cascade,
  titulo     text not null check (char_length(titulo) between 1 and 200),
  artista    text not null default '' check (char_length(artista) <= 200),
  album      text not null default '' check (char_length(album) <= 200),
  archivo    text not null,               -- dirección del audio en Cloudflare R2
  portada    text,                        -- dirección de la portada en R2 (o null)
  tipo       text not null default 'audio/webm',
  bytes      bigint not null default 0,
  duracion   real,                        -- segundos
  huella     text not null,               -- SHA-256 del archivo original (para no repetir)
  creado     timestamptz not null default now(),
  cambiado   timestamptz not null default now()
);
create index if not exists audios_dueno on public.audios (dueno);
create index if not exists audios_creado on public.audios (creado desc);
create index if not exists audios_huella on public.audios (huella);
alter table public.audios enable row level security;
drop policy if exists "audios: todos los ven" on public.audios;
create policy "audios: todos los ven" on public.audios for select to anon, authenticated using (true);
drop policy if exists "audios: subes a tu nombre" on public.audios;
create policy "audios: subes a tu nombre" on public.audios for insert to authenticated with check (dueno = auth.uid());
drop policy if exists "audios: solo el dueño cambia" on public.audios;
create policy "audios: solo el dueño cambia" on public.audios for update to authenticated using (dueno = auth.uid()) with check (dueno = auth.uid());
drop policy if exists "audios: solo el dueño borra" on public.audios;
create policy "audios: solo el dueño borra" on public.audios for delete to authenticated using (dueno = auth.uid());

create or replace function public.marcar_cambiado() returns trigger language plpgsql as $$
begin new.cambiado := now(); return new; end $$;
drop trigger if exists audios_cambiado on public.audios;
create trigger audios_cambiado before update on public.audios for each row execute function public.marcar_cambiado();

-- ---------- Tu biblioteca ----------
create table if not exists public.guardados (
  usuario   uuid not null references public.perfiles (id) on delete cascade,
  audio     uuid not null references public.audios (id) on delete cascade,
  orden     double precision,
  siguiente uuid,                          -- vínculo: después de esta, siempre suena esa
  agregado  timestamptz not null default now(),
  primary key (usuario, audio)
);
alter table public.guardados enable row level security;
drop policy if exists "guardados: solo los tuyos" on public.guardados;
create policy "guardados: solo los tuyos" on public.guardados for all to authenticated using (usuario = auth.uid()) with check (usuario = auth.uid());

-- ---------- Álbumes y playlists ----------
create table if not exists public.listas (
  id         uuid primary key default gen_random_uuid(),
  dueno      uuid not null references public.perfiles (id) on delete cascade,
  nombre     text not null check (char_length(nombre) between 1 and 100),
  tipo       text not null default 'album' check (tipo in ('album', 'playlist')),
  publica    boolean not null default false,
  canciones  uuid[] not null default '{}',   -- ids de audios, en orden
  vinculos   jsonb not null default '{}',    -- { a: b }: después de a siempre suena b
  creada     timestamptz not null default now(),
  cambiada   timestamptz not null default now()
);
create index if not exists listas_dueno on public.listas (dueno);
alter table public.listas enable row level security;
drop policy if exists "listas: las tuyas y las públicas" on public.listas;
create policy "listas: las tuyas y las públicas" on public.listas for select to anon, authenticated using (dueno = auth.uid() or publica);
drop policy if exists "listas: solo el dueño escribe" on public.listas;
create policy "listas: solo el dueño escribe" on public.listas for all to authenticated using (dueno = auth.uid()) with check (dueno = auth.uid());
drop trigger if exists listas_cambiada on public.listas;
create or replace function public.marcar_cambiada() returns trigger language plpgsql as $$
begin new.cambiada := now(); return new; end $$;
create trigger listas_cambiada before update on public.listas for each row execute function public.marcar_cambiada();

-- ---------- Seguidores ----------
create table if not exists public.siguiendo (
  seguidor  uuid not null references public.perfiles (id) on delete cascade,
  seguido   uuid not null references public.perfiles (id) on delete cascade,
  creado    timestamptz not null default now(),
  primary key (seguidor, seguido),
  check (seguidor <> seguido)
);
create index if not exists siguiendo_seguido on public.siguiendo (seguido);
alter table public.siguiendo enable row level security;
drop policy if exists "siguiendo: todos lo ven" on public.siguiendo;
create policy "siguiendo: todos lo ven" on public.siguiendo for select to anon, authenticated using (true);
drop policy if exists "siguiendo: sigues tú" on public.siguiendo;
create policy "siguiendo: sigues tú" on public.siguiendo for insert to authenticated with check (seguidor = auth.uid());
-- (seguir dos veces a la misma persona no falla: la app usa upsert)
drop policy if exists "siguiendo: lo tuyo lo cambias tú" on public.siguiendo;
create policy "siguiendo: lo tuyo lo cambias tú" on public.siguiendo for update to authenticated using (seguidor = auth.uid()) with check (seguidor = auth.uid());
drop policy if exists "siguiendo: dejas de seguir tú" on public.siguiendo;
create policy "siguiendo: dejas de seguir tú" on public.siguiendo for delete to authenticated using (seguidor = auth.uid());

-- ---------- Me gusta / No me gusta ----------
create table if not exists public.reacciones (
  usuario  uuid not null references public.perfiles (id) on delete cascade,
  audio    uuid not null references public.audios (id) on delete cascade,
  valor    smallint not null check (valor in (1, -1)),   -- 1 = me gusta, -1 = no me gusta
  creado   timestamptz not null default now(),
  primary key (usuario, audio)
);
create index if not exists reacciones_audio on public.reacciones (audio);
alter table public.reacciones enable row level security;
drop policy if exists "reacciones: todos las ven" on public.reacciones;
create policy "reacciones: todos las ven" on public.reacciones for select to anon, authenticated using (true);
drop policy if exists "reacciones: la tuya la pones tú" on public.reacciones;
create policy "reacciones: la tuya la pones tú" on public.reacciones for all to authenticated using (usuario = auth.uid()) with check (usuario = auth.uid());

-- ---------- Comentarios ----------
create table if not exists public.comentarios (
  id       uuid primary key default gen_random_uuid(),
  audio    uuid not null references public.audios (id) on delete cascade,
  usuario  uuid not null references public.perfiles (id) on delete cascade,
  texto    text not null check (char_length(texto) between 1 and 500),
  creado   timestamptz not null default now()
);
create index if not exists comentarios_audio on public.comentarios (audio, creado desc);
alter table public.comentarios enable row level security;
drop policy if exists "comentarios: todos los ven" on public.comentarios;
create policy "comentarios: todos los ven" on public.comentarios for select to anon, authenticated using (true);
drop policy if exists "comentarios: comentas a tu nombre" on public.comentarios;
create policy "comentarios: comentas a tu nombre" on public.comentarios for insert to authenticated with check (usuario = auth.uid());
-- Borra el que lo escribió o el dueño del audio.
drop policy if exists "comentarios: borra el autor o el dueño" on public.comentarios;
create policy "comentarios: borra el autor o el dueño" on public.comentarios for delete to authenticated
  using (usuario = auth.uid() or exists (select 1 from public.audios a where a.id = comentarios.audio and a.dueno = auth.uid()));

-- ---------- Reproducciones ----------
-- Se cuenta una cuando alguien escucha 30 s (o la mitad, si es más corta). Solo se
-- puede sumar con la función (nadie escribe el número a mano).
create table if not exists public.reproducciones (
  audio  uuid primary key references public.audios (id) on delete cascade,
  veces  bigint not null default 0
);
alter table public.reproducciones enable row level security;
drop policy if exists "reproducciones: todos las ven" on public.reproducciones;
create policy "reproducciones: todos las ven" on public.reproducciones for select to anon, authenticated using (true);

-- ---------- Top: cuándo se escuchó cada audio ----------
-- Cada reproducción deja una "escucha" con su fecha; así se arman los Top de hoy,
-- la semana, el mes, el año y de siempre. Nadie la lee ni escribe directo: solo las funciones.
create table if not exists public.escuchas (
  id      bigint generated always as identity primary key,
  audio   uuid not null references public.audios (id) on delete cascade,
  cuando  timestamptz not null default now()
);
create index if not exists escuchas_cuando on public.escuchas (cuando);
alter table public.escuchas enable row level security;

-- Cuentan también sin cuenta, con protección contra números inflados:
--  - la misma canción en el mismo dispositivo: una vez cada 30 minutos;
--  - desde la misma conexión: máximo 120 por hora.
-- De la conexión solo se guarda una huella (md5), no la dirección.
alter table public.escuchas add column if not exists dispositivo text;
alter table public.escuchas add column if not exists origen text;
create index if not exists escuchas_audio_dispositivo on public.escuchas (audio, dispositivo, cuando desc);
create index if not exists escuchas_origen on public.escuchas (origen, cuando desc);

drop function if exists public.sumar_reproduccion(uuid);
create or replace function public.sumar_reproduccion(p_audio uuid, p_dispositivo text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_ip text := split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1);
  v_origen text := md5(v_ip || ':muzzy');
begin
  if p_dispositivo is null or char_length(p_dispositivo) not between 8 and 64 then return false; end if;
  if exists (
    select 1 from public.escuchas
    where audio = p_audio and dispositivo = p_dispositivo and cuando > now() - interval '30 minutes'
  ) then return false; end if;
  if (select count(*) from public.escuchas where origen = v_origen and cuando > now() - interval '1 hour') >= 120 then
    return false;
  end if;
  insert into public.reproducciones (audio, veces) values (p_audio, 1)
  on conflict (audio) do update set veces = public.reproducciones.veces + 1;
  insert into public.escuchas (audio, dispositivo, origen) values (p_audio, p_dispositivo, v_origen);
  return true;
end $$;
revoke all on function public.sumar_reproduccion(uuid, text) from public;
grant execute on function public.sumar_reproduccion(uuid, text) to anon, authenticated;

-- Los más escuchados desde una fecha (máximo 100).
create or replace function public.top_audios(p_desde timestamptz, p_limite int default 10)
returns table (audio uuid, veces bigint)
language sql stable security definer set search_path = public as $$
  select e.audio, count(*) as veces
  from public.escuchas e join public.audios a on a.id = e.audio
  where e.cuando >= p_desde and a.bytes >= 20480
  group by e.audio
  order by veces desc, max(e.cuando) desc
  limit least(greatest(p_limite, 1), 100)
$$;
grant execute on function public.top_audios(timestamptz, int) to anon, authenticated;

-- ---------- "N veces guardada" ----------
-- Cuántas personas (sin contar al dueño) tienen cada audio en su biblioteca.
-- La biblioteca de cada quien es privada; esto solo da el número.
create or replace function public.veces_guardado(ids uuid[])
returns table (audio uuid, veces bigint)
language sql stable security definer set search_path = public as $$
  select g.audio, count(*)
  from public.guardados g join public.audios a on a.id = g.audio
  where g.audio = any (ids) and g.usuario <> a.dueno
  group by g.audio
$$;
revoke all on function public.veces_guardado(uuid[]) from public;
grant execute on function public.veces_guardado(uuid[]) to authenticated;
grant execute on function public.veces_guardado(uuid[]) to anon;  -- solo da números: también sin cuenta

-- ---------- Lo que estás escuchando ----------
create table if not exists public.escuchando (
  usuario        uuid primary key references public.perfiles (id) on delete cascade,
  dispositivo    text not null,          -- "Galaxy S24", "PC"…
  dispositivo_id text not null,
  audio          uuid,
  titulo         text not null default '',
  artista        text not null default '',
  sonando        boolean not null default false,
  posicion       real not null default 0,
  cuando         timestamptz not null default now()
);
alter table public.escuchando enable row level security;
drop policy if exists "escuchando: solo tú" on public.escuchando;
create policy "escuchando: solo tú" on public.escuchando for all to authenticated using (usuario = auth.uid()) with check (usuario = auth.uid());

-- ---------- Almacén de archivos en Supabase (audios, portadas, fotos) ----------
-- 1 GB gratis. Cualquiera puede escuchar/ver (público); solo quien entró puede subir,
-- y solo a estas carpetas. Los archivos no se pisan (el mismo audio = el mismo nombre).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('muzzy', 'muzzy', true, 52428800, array[
  'audio/webm', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/ogg',
  'image/jpeg', 'image/png', 'image/webp'
])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "muzzy: subir quien entró" on storage.objects;
create policy "muzzy: subir quien entró" on storage.objects for insert to authenticated
  with check (bucket_id = 'muzzy' and (storage.foldername(name))[1] in ('audios', 'portadas', 'fotos'));

-- ---------- Tiempo real: avisar al momento de los cambios ----------
do $$
declare tabla text;
begin
  foreach tabla in array array['audios', 'guardados', 'listas', 'escuchando', 'perfiles', 'siguiendo', 'reacciones', 'comentarios'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = tabla) then
      execute format('alter publication supabase_realtime add table public.%I', tabla);
    end if;
  end loop;
end $$;
-- Para que al borrar llegue el registro completo (y saber de quién era).
alter table public.guardados replica identity full;
alter table public.listas replica identity full;
alter table public.siguiendo replica identity full;
alter table public.reacciones replica identity full;
alter table public.comentarios replica identity full;
