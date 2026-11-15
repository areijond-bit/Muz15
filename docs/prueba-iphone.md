# Fase 0: prueba en el iPhone

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

## Si algo falla

Abre la URL en Safari con `?debug` al final (ej. `https://TU_USUARIO.github.io/Muz15/?debug`). Aparece un botón de engranaje con la consola: toma captura de los errores rojos y pásamela.
