-- 2026-11-15: un mismo archivo (bien subido) solo existe una vez.
-- Si falla por duplicados, primero hay que juntar los repetidos.
create unique index if not exists audios_huella_unica on public.audios (huella) where bytes >= 20480;
