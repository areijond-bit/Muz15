-- ---------- Explorar: recomendaciones (el "algoritmo") ----------
-- Las escuchas también recuerdan quién (si tenía cuenta), para juntar tus dispositivos.
alter table public.escuchas add column if not exists usuario uuid;
create index if not exists escuchas_usuario on public.escuchas (usuario, cuando desc);

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
  insert into public.escuchas (audio, dispositivo, origen, usuario) values (p_audio, p_dispositivo, v_origen, auth.uid());
  return true;
end $$;
revoke all on function public.sumar_reproduccion(uuid, text) from public;
grant execute on function public.sumar_reproduccion(uuid, text) to anon, authenticated;

-- Puntos de cada audio para ti:
--   tu gusto por su artista (escuchas, me gusta, guardados; no me gusta resta)
-- + tu gusto por quien lo subió (y si lo sigues)
-- + lo que escucha gente que escucha lo mismo que tú (filtrado colaborativo)
-- + qué tan popular es este mes + qué tan nuevo es
-- - lo que ya escuchaste mucho;   + un poco de azar para descubrir cosas.
-- Fuera: lo tuyo, lo que ya guardaste, lo que marcaste con no me gusta.
-- Variedad: máximo 3 por artista.
create or replace function public.recomendaciones(p_dispositivo text, p_limite int default 20)
returns table (audio uuid, puntos double precision, razon text)
language sql security definer set search_path = public as $$
with
yo as (select auth.uid() as id),
mis_escuchas as (
  select e.audio, count(*)::float8 as n
  from escuchas e, yo
  where (e.dispositivo = p_dispositivo or (yo.id is not null and e.usuario = yo.id))
    and e.cuando > now() - interval '180 days'
  group by e.audio
),
mis_reacciones as (select r.audio, r.valor from reacciones r, yo where r.usuario = yo.id),
mis_guardados as (select g.audio from guardados g, yo where g.usuario = yo.id),
mis_seguidos as (select s.seguido from siguiendo s, yo where s.seguidor = yo.id),
gusto as (
  select x.audio, sum(x.p)::float8 as p from (
    select audio, least(n, 10) as p from mis_escuchas
    union all select audio, case when valor > 0 then 5.0 else -8.0 end from mis_reacciones
    union all select audio, 3.0 from mis_guardados
  ) x group by x.audio
),
gusto_artista as (
  select lower(a.artista) as artista, sum(g.p)::float8 as p
  from gusto g join audios a on a.id = g.audio
  where a.artista <> '' group by 1
),
gusto_dueno as (
  select d.dueno, sum(d.p)::float8 as p from (
    select a.dueno, g.p * 0.5 as p from gusto g join audios a on a.id = g.audio
    union all select seguido, 6.0 from mis_seguidos
  ) d group by d.dueno
),
vecinos as (
  select coalesce(e.usuario::text, e.dispositivo) as quien, count(distinct e.audio)::float8 as comun
  from escuchas e join gusto g on g.audio = e.audio and g.p > 0, yo
  where e.dispositivo is distinct from p_dispositivo
    and (yo.id is null or e.usuario is distinct from yo.id)
    and e.cuando > now() - interval '180 days'
  group by 1
),
de_vecinos as (
  select e.audio, sum(ln(1 + v.comun))::float8 as p
  from escuchas e join vecinos v on v.quien = coalesce(e.usuario::text, e.dispositivo)
  where e.cuando > now() - interval '180 days'
  group by e.audio
),
popular as (
  select e.audio, count(*)::float8 as n from escuchas e
  where e.cuando > now() - interval '30 days' group by e.audio
),
candidatos as (
  select a.id, a.artista,
    coalesce(ga.p, 0) as p_artista,
    coalesce(gd.p, 0) as p_dueno,
    coalesce(dv.p, 0) as p_vecinos,
    ln(1 + coalesce(po.n, 0)) as p_popular,
    exp(-(extract(epoch from now() - a.creado) / 86400.0 / 14.0))::float8 as p_nuevo,
    coalesce(me.n, 0) as ya_escuchada
  from audios a
  left join gusto_artista ga on ga.artista = lower(a.artista)
  left join gusto_dueno gd on gd.dueno = a.dueno
  left join de_vecinos dv on dv.audio = a.id
  left join popular po on po.audio = a.id
  left join mis_escuchas me on me.audio = a.id
  where a.bytes >= 20480
    and a.dueno is distinct from (select id from yo)
    and not exists (select 1 from mis_guardados mg where mg.audio = a.id)
    and not exists (select 1 from mis_reacciones mr where mr.audio = a.id and mr.valor < 0)
),
puntuados as (
  select c.id, c.artista,
    ( ln(1 + greatest(c.p_artista, 0)) * 3.0
    + ln(1 + greatest(c.p_dueno, 0)) * 2.0
    + c.p_vecinos * 1.5
    + c.p_popular * 0.8
    + c.p_nuevo * 2.0
    - least(c.ya_escuchada, 10) * 0.6
    - case when c.p_artista < 0 then 3.0 else 0 end
    + random() * 0.8 ) as puntos,
    case
      when c.p_artista > 0 then 'artista'
      when c.p_dueno > 0 then 'dueno'
      when c.p_vecinos > 0 then 'vecinos'
      when c.p_nuevo > 0.5 then 'nuevo'
      else 'popular'
    end as razon
  from candidatos c
),
variados as (
  select p.*, row_number() over (partition by lower(p.artista) order by p.puntos desc) as n_artista
  from puntuados p
)
select v.id, v.puntos, v.razon from variados v
where v.n_artista <= 3
order by v.puntos desc
limit least(greatest(p_limite, 1), 50)
$$;
revoke all on function public.recomendaciones(text, int) from public;
grant execute on function public.recomendaciones(text, int) to anon, authenticated;
