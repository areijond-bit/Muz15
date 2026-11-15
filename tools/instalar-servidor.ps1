# instalar-servidor.ps1 — Hace que el servidor de Muz15 de la PC (tools/servidor.mjs)
# arranque solo cada vez que inicias sesión en Windows.
#
# Ese servidor es el que recibe las canciones de "Enviar a mi PC" y de los álbumes,
# y las deja listas en C:\Music para tus otros dispositivos.
#
# Uso:            powershell -ExecutionPolicy Bypass -File tools\instalar-servidor.ps1
# Para quitarlo:  Unregister-ScheduledTask -TaskName 'Muz15 - servidor de la PC' -Confirm:$false

$nombre = 'Muz15 - servidor de la PC'
$script = Join-Path $PSScriptRoot 'servidor.mjs'
$node = (Get-Command node -ErrorAction Stop).Source

# conhost --headless: corre sin ventana.
$accion = New-ScheduledTaskAction -Execute 'conhost.exe' `
  -Argument "--headless `"$node`" `"$script`"" `
  -WorkingDirectory (Split-Path $PSScriptRoot)

$alIniciarSesion = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Sin límite de tiempo y, si se cae, que vuelva a arrancar.
$ajustes = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $nombre -Action $accion -Trigger $alIniciarSesion -Settings $ajustes `
  -Description 'Recibe las canciones de Muz15 y las deja listas en C:\Music.' -Force | Out-Null

Start-ScheduledTask -TaskName $nombre
Write-Host "Listo: '$nombre' arranca solo al iniciar sesión (y ya está corriendo)."
