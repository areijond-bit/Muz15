-- esquema.sql — La base de datos de Muz15 en Supabase.
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
--
-- Seguridad (RLS): cualquiera con cuenta puede VER perfiles y audios; solo el dueño
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
create policy "perfiles: todos los ven" on public.perfiles for select to authenticated using (true);
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
create policy "audios: todos los ven" on public.audios for select to authenticated using (true);
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
create policy "listas: las tuyas y las públicas" on public.listas for select to authenticated using (dueno = auth.uid() or publica);
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
create policy "siguiendo: todos lo ven" on public.siguiendo for select to authenticated using (true);
drop policy if exists "siguiendo: sigues tú" on public.siguiendo;
create policy "siguiendo: sigues tú" on public.siguiendo for insert to authenticated with check (seguidor = auth.uid());
drop policy if exists "siguiendo: dejas de seguir tú" on public.siguiendo;
create policy "siguiendo: dejas de seguir tú" on public.siguiendo for delete to authenticated using (seguidor = auth.uid());

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

-- ---------- Tiempo real: avisar al momento de los cambios ----------
do $$
declare tabla text;
begin
  foreach tabla in array array['audios', 'guardados', 'listas', 'escuchando', 'perfiles', 'siguiendo'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = tabla) then
      execute format('alter publication supabase_realtime add table public.%I', tabla);
    end if;
  end loop;
end $$;
-- Para que al borrar llegue el registro completo (y saber de quién era).
alter table public.guardados replica identity full;
alter table public.listas replica identity full;
alter table public.siguiendo replica identity full;
