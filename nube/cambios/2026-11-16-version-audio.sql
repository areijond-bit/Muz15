-- 2026-11-16: versión del audio (para mejorar el sonido de lo ya subido sin perder el original).
alter table public.audios add column if not exists version_audio int not null default 1;
alter table public.audios add column if not exists archivo_original text;
