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

$FFprobe = Join-Path (Split-Path $FFmpeg) 'ffprobe.exe'

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
  $portada = "$mp3.portada.jpg"

  # 1) Portada: un cuadro del segundo 3, recortado en cuadrado. Va en un paso
  #    aparte: si se hace junto con el audio, ffmpeg corta el MP3 al terminar ese cuadro.
  & $FFmpeg -hide_banner -loglevel error -y -ss 3 -i $video.FullName -frames:v 1 `
    -vf "crop='min(iw,ih)':'min(iw,ih)',scale=600:600" $portada 2>$null
  $hayPortada = Test-Path $portada

  # 2) Audio a MP3 de buena calidad (-q:a 2, ~190 kbps) con la portada adentro.
  $argumentos = @('-hide_banner', '-loglevel', 'error', '-y', '-i', $video.FullName)
  if ($hayPortada) { $argumentos += '-i', $portada }
  $argumentos += '-map', '0:a:0'
  if ($hayPortada) { $argumentos += '-map', '1:v:0', '-c:v', 'copy', '-disposition:v', 'attached_pic' }
  $argumentos += '-c:a', 'libmp3lame', '-q:a', '2', '-map_metadata', '0', '-id3v2_version', '3'

  # Si el video no trae título, lo sacamos del nombre: "Artista - Título (Official Video).mp4"
  $tituloEnVideo = & $FFprobe -v error -show_entries format_tags=title -of 'default=nw=1:nk=1' $video.FullName 2>$null
  if (-not $tituloEnVideo) {
    $limpio = $video.BaseName -replace '\s*[\(\[][^\)\]]*\b(official|oficial|video|lyrics?|letra|audio|visualizer|hd|hq|4k)\b[^\)\]]*[\)\]]', ''
    if ($limpio -match '^(.+?) - (.+)$') {
      $argumentos += '-metadata', "artist=$($Matches[1].Trim())", '-metadata', "title=$($Matches[2].Trim())"
    } else {
      $argumentos += '-metadata', "title=$($limpio.Trim())"
    }
  }

  $argumentos += '-f', 'mp3', $temporal

  $salida = & $FFmpeg @argumentos 2>&1
  Remove-Item $portada -ErrorAction SilentlyContinue
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $temporal)) {
    Remove-Item $temporal -ErrorAction SilentlyContinue
    Escribir-Registro "ERROR con $($video.Name): $salida"
    continue
  }

  # 3) Comprobación: el MP3 debe durar lo mismo que el video. Si no, no tocamos el original.
  $duracionVideo = [double](& $FFprobe -v error -show_entries format=duration -of 'default=nw=1:nk=1' $video.FullName)
  $duracionMp3 = [double](& $FFprobe -v error -show_entries format=duration -of 'default=nw=1:nk=1' $temporal)
  if ($duracionMp3 -lt $duracionVideo - 2) {
    Remove-Item $temporal -ErrorAction SilentlyContinue
    Escribir-Registro "ERROR con $($video.Name): el MP3 salió de $([int]$duracionMp3) s y el video dura $([int]$duracionVideo) s"
    continue
  }

  Move-Item $temporal $mp3
  New-Item -ItemType Directory -Force $Originales | Out-Null
  $destino = Join-Path $Originales $video.Name
  if (Test-Path $destino) { $destino = Join-Path $Originales "$($video.BaseName) ($(Get-Date -Format 'yyyyMMdd-HHmmss'))$($video.Extension)" }
  Move-Item $video.FullName $destino
  Escribir-Registro "OK  $($video.Name)  ->  $(Split-Path $mp3 -Leaf)"
}
