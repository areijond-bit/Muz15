# instalar-conversion.ps1 — Crea una tarea de Windows que corre convertir-videos.ps1 cada minuto.
# Uso:        powershell -ExecutionPolicy Bypass -File tools\instalar-conversion.ps1
# Para quitarla:  Unregister-ScheduledTask -TaskName 'Muz15 - convertir videos' -Confirm:$false
#
# La tarea apunta a este repositorio: si mueves la carpeta Muz15, vuelve a correr este instalador.

$nombre = 'Muz15 - convertir videos'
$script = Join-Path $PSScriptRoot 'convertir-videos.ps1'

# conhost --headless evita que aparezca una ventana negra cada minuto.
$accion = New-ScheduledTaskAction -Execute 'conhost.exe' `
  -Argument "--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$script`""

$cadaMinuto = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1)

$ajustes = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask -TaskName $nombre -Action $accion -Trigger $cadaMinuto -Settings $ajustes `
  -Description 'Convierte a MP3 los videos que pongas en C:\Music (Muz15).' -Force | Out-Null

Write-Host "Listo: la tarea '$nombre' revisa C:\Music cada minuto."
