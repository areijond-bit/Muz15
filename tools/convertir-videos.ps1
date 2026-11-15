# convertir-videos.ps1 — Convierte a MP3 los videos que pongas en tu carpeta de música.
#
# Busca videos (.mp4, .mov, .mkv, .webm) dentro de C:\Music y sus subcarpetas, y para cada uno:
#   1. Crea un .mp3 con el mismo nombre, en la misma carpeta.
#   2. Usa un cuadro del video (recortado en cuadrado) como portada.
#   3. Mueve el video original a Videos\Muz15-originales (no lo borra).
# Navidrome ve el .mp3 nuevo en uno o dos minutos.
#
# Usa el ffmpeg que viene con Navidrome. Una tarea programada lo corre cada minuto;
# instálala con:  powershell -File tools\instalar-conversion.ps1

param(
  [string]$Musica = 'C:\Music',
  [string]$Originales = (Join-Path ([Environment]::GetFolderPath('MyVideos')) 'Muz15-originales'),
  [string]$FFmpeg = 'C:\Program Files\Navidrome\ffmpeg.exe'
)

$ErrorActionPreference = 'Stop'
$extensiones = '.mp4', '.mov', '.mkv', '.webm'
$registro = Join-Path $Originales 'conversiones.log'

function Escribir-Registro([string]$texto) {
  New-Item -ItemType Directory -Force $Originales | Out-Null
  Add-Content -Path $registro -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $texto" -Encoding utf8
}

# Un archivo que todavía se está copiando no se puede abrir en exclusiva.
function Esta-Listo([IO.FileInfo]$archivo) {
  if ($archivo.LastWriteTime -gt (Get-Date).AddSeconds(-10)) { return $false }
  try {
    $flujo = $archivo.Open('Open', 'Read', 'None')
    $flujo.Close()
    return $true
  } catch {
    return $false
  }
}

if (-not (Test-Path $FFmpeg)) { Escribir-Registro "No se encontró ffmpeg en $FFmpeg"; exit 1 }
if (-not (Test-Path $Musica)) { exit 0 }

$videos = Get-ChildItem -Path $Musica -Recurse -File | Where-Object { $extensiones -contains $_.Extension.ToLower() }

foreach ($video in $videos) {
  if (-not (Esta-Listo $video)) { continue }

  $mp3 = [IO.Path]::ChangeExtension($video.FullName, '.mp3')
  if (Test-Path $mp3) { $mp3 = $mp3 -replace '\.mp3$', " ($(Get-Date -Format 'HHmmss')).mp3" }
  $temporal = "$mp3.parcial"

  # -map 0:a:0     el audio del video
  # -map 1:v:0?    un cuadro del segundo 3 como portada (el ? lo hace opcional)
  # -q:a 2         MP3 de buena calidad (~190 kbps)
  $argumentos = @(
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', $video.FullName,
    '-ss', '3', '-i', $video.FullName,
    '-map', '0:a:0', '-map', '1:v:0?',
    '-c:a', 'libmp3lame', '-q:a', '2',
    '-c:v', 'mjpeg', '-frames:v', '1', '-vf', "crop='min(iw,ih)':'min(iw,ih)',scale=600:600",
    '-disposition:v', 'attached_pic',
    '-map_metadata', '0', '-id3v2_version', '3',
    '-f', 'mp3', $temporal
  )

  $salida = & $FFmpeg @argumentos 2>&1
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $temporal)) {
    Remove-Item $temporal -ErrorAction SilentlyContinue
    Escribir-Registro "ERROR con $($video.Name): $salida"
    continue
  }

  Move-Item $temporal $mp3
  New-Item -ItemType Directory -Force $Originales | Out-Null
  $destino = Join-Path $Originales $video.Name
  if (Test-Path $destino) { $destino = Join-Path $Originales "$($video.BaseName) ($(Get-Date -Format 'yyyyMMdd-HHmmss'))$($video.Extension)" }
  Move-Item $video.FullName $destino
  Escribir-Registro "OK  $($video.Name)  ->  $(Split-Path $mp3 -Leaf)"
}
