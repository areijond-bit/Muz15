# Fase 0: prueba en el teléfono (iPhone y Android)

Haz todas las pruebas con Muz15 **instalada en la pantalla de inicio** y abierta desde su ícono.
Importa antes 3 o 4 canciones tuyas, de preferencia MP3 o M4A que tengan portada.

Anota tu modelo de iPhone y tu versión de iOS (Ajustes → General → Información): ________________

## Preparación

- [ ] Abre la URL en Safari, pulsa **Compartir** → **Añadir a pantalla de inicio** y abre Muz15 desde el ícono.
- [ ] Pulsa **+ Importar**, elige varias canciones desde Archivos y comprueba que salen con su título y artista.
- [ ] Toca una canción. ¿Suena? ¿Funcionan ▶/⏸, ⏮ y ⏭ en la app?

## Las 4 pruebas

### (a) Suena 10 minutos con la pantalla bloqueada
- [ ] Pon una canción y bloquea el teléfono. Si las canciones son cortas, mejor: así también se prueba que pase sola a la siguiente.
- [ ] Espera 10 minutos sin tocarlo.
- [ ] ¿Siguió sonando todo el tiempo? ¿Pasó sola de una canción a otra?
- [ ] En la pantalla bloqueada, ¿se ven el título, el artista y la portada? (Si la canción no trae portada, debería salir la nota musical.)

Resultado: ________________

### (b) Bluetooth del carro
- [ ] Conecta el iPhone al carro por Bluetooth y pon una canción en Muz15.
- [ ] ¿La pantalla del carro muestra el título y el artista?
- [ ] ¿El botón **siguiente** del volante pasa a la siguiente canción y no adelanta 10 segundos?
- [ ] ¿El botón **anterior** funciona? Al principio de una canción va a la anterior; pasados 3 segundos vuelve al inicio de la misma, igual que en Spotify.
- [ ] ¿Funciona pausa/play desde el carro?

Resultado: ________________

### (c) Pausado más de 5 segundos en segundo plano
Esta es la prueba más delicada: en iOS hay un fallo conocido de WebKit con esto.
- [ ] Pon una canción, bloquea el teléfono y **pausa desde la pantalla bloqueada**.
- [ ] Espera **30 segundos**.
- [ ] Pulsa play en la pantalla bloqueada. ¿Vuelve a sonar?
- [ ] Repite con **5 minutos** de pausa.
- [ ] Repite pausando desde el volante del carro y reanudando desde el volante.
- [ ] Repite saliendo de la app (pantalla de inicio, sin bloquear) en vez de bloquear.

Resultado: ________________

### (d) Modo avión
- [ ] Cierra Muz15 por completo (desliza hacia arriba en el selector de apps).
- [ ] Activa el **modo avión** y apaga también el Wi-Fi.
- [ ] Abre Muz15 desde el ícono. ¿Abre? ¿Siguen ahí las canciones?
- [ ] Toca una. ¿Suena?

Resultado: ________________

## Android

Son las mismas 4 pruebas, con estas diferencias:

- **Instalar:** abre la URL en **Chrome** → menú ⋮ → **Instalar app** (o **Añadir a pantalla de inicio**) y ábrela desde el ícono.
- **Importar:** al pulsar **+ Importar**, Android puede abrir "Audio" o "Archivos". Si no ves tus canciones, busca el menú ☰ del selector y elige la carpeta donde están (normalmente *Música* o *Descargas*).
- **(a) Pantalla bloqueada:** los controles salen en la notificación y en la pantalla de bloqueo. Si se corta al rato, la causa suele ser el ahorro de batería: Ajustes → Apps → Chrome → Batería → **Sin restricciones**, y vuelve a probar.
- **(c) Pausa larga:** en Android este fallo de iOS no debería pasar, pero pruébalo igual para comparar.
- **(d) Modo avión:** igual que en iPhone.

Anota tu modelo de Android y la versión (Ajustes → Acerca del teléfono): ________________

| Prueba | iPhone | Android |
|---|---|---|
| (a) 10 min bloqueado | | |
| (b) Carro: título y volante | | |
| (c) Reanudar tras pausa larga | | |
| (d) Modo avión | | |

## Si algo falla

En **Android** puedes usar lo mismo de abajo, o conectar el teléfono por USB a la PC y abrir `chrome://inspect` en Chrome de la computadora.


Abre la URL en Safari con `?debug` al final (ej. `https://TU_USUARIO.github.io/Muz15/?debug`). Aparece un botón de engranaje con la consola: toma captura de los errores rojos y pásamela.
