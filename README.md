# Muz15

Mi app de música personal. Funciona sin internet, se instala en iPhone y Android y no cuesta nada.

**Estado:** Fase 0, la prueba de viabilidad en el iPhone. Ver [docs/prueba-iphone.md](docs/prueba-iphone.md).

## Archivos

| Archivo | Qué hace |
|---|---|
| `index.html` | La pantalla: botón de importar, lista y reproductor. Si la URL lleva `?debug`, carga Eruda (una consola dentro del teléfono). |
| `styles.css` | Todo el diseño. Las variables del inicio (colores, tamaños, radios y fuentes) son lo único que hace falta tocar para rediseñar. |
| `js/app.js` | Une todo: importa archivos, pinta la lista y conecta los botones. |
| `js/db.js` | Guarda las canciones en IndexedDB para que sigan ahí sin internet. |
| `js/metadatos.js` | Lee título, artista y portada del propio MP3 o M4A. Si no traen etiquetas, usa el nombre "Artista - Título". |
| `js/servidor.js` | Se conecta a tu Navidrome: lista toda tu música, la reproduce en vivo y la descarga al teléfono. |
| `js/hoja.js` | El menú que sube desde abajo (⋯): opciones, confirmar y escribir nombres. |
| `js/md5.js` | Calcula la llave para iniciar sesión en Navidrome sin guardar tu contraseña. |
| `js/reproductor.js` | Controla el `<audio>` y MediaSession, que se encarga de la pantalla bloqueada, el Bluetooth y los botones del volante. |
| `manifest.webmanifest` | Nombre, colores e íconos para instalarla como app. |
| `sw.js` | Service worker: guarda la app en el teléfono para que abra en modo avión. |
| `icons/` | Íconos placeholder. Reemplázalos por los tuyos con el mismo nombre y tamaño. |
| `tools/` | Ayudantes para la computadora: servidor local y generador de íconos. |

## APK de Android

La APK (carpeta `android/`, hecha con Capacitor) es un "cascarón": carga la app desde GitHub Pages y le agrega los controles nativos de la pantalla de bloqueo, la notificación y el carro.

- **Descarga:** https://github.com/areijond-bit/Muz15/releases/latest/download/Muz15.apk
- **Cambios en HTML, CSS o JS:** no hace falta APK nueva. Basta con cerrar y abrir Muz15.
- **Cambios en `android/`, `capacitor.config.json` o `package.json`:** GitHub Actions compila una APK nueva (`.github/workflows/apk.yml`) y la publica en Releases. La app avisa sola y se instala encima.
- La firma usa los secretos `MUZ15_KEYSTORE_BASE64` y `MUZ15_KEYSTORE_PASSWORD`. Hay una copia de la llave en `Documentos\Muz15 - llave de firma (NO BORRAR)`.

## Videos a MP3 (en la PC)

Si pones un video (`.mp4`, `.mov`, `.mkv`, `.webm`) en `C:\Music`, en un minuto se convierte solo en `.mp3`. La portada sale de un cuadro del video, y el original se mueve a `Videos\Muz15-originales`.

- Para activarlo (una sola vez):
  ```bash
  powershell -ExecutionPolicy Bypass -File tools/instalar-conversion.ps1
  ```
- Para ver qué se convirtió, abre `Videos\Muz15-originales\conversiones.log`.
- Para desactivarlo, abre el Programador de tareas de Windows y borra la tarea **Muz15 - convertir videos**.

## Probar en la computadora

```bash
node tools/servidor.mjs
```

Después abre http://localhost:5150 en Chrome o Edge.

## Publicar gratis con HTTPS

El iPhone solo instala PWAs y hace funcionar el service worker con HTTPS. Hay dos opciones gratis:

### Opción A: GitHub Pages (recomendada, porque cada `git push` actualiza la app)

1. Crea una cuenta en https://github.com si no tienes.
2. Arriba a la derecha, pulsa **+** → **New repository**. Nómbralo `Muz15`, márcalo **Public** y no agregues README.
   (Pages gratis exige un repositorio público. Solo se ve el código, nunca tu música, que vive en tu teléfono.)
3. En esta carpeta, conecta el repositorio y súbelo (cambia `TU_USUARIO`):
   ```bash
   git remote add origin https://github.com/TU_USUARIO/Muz15.git
   ```
   ```bash
   git push -u origin main
   ```
4. En GitHub, dentro del repositorio: **Settings** → **Pages** → en *Source* elige **Deploy from a branch**, rama **main** y carpeta **/ (root)** → **Save**.
5. Espera 1 o 2 minutos. La app queda en `https://TU_USUARIO.github.io/Muz15/`.

### Opción B: Cloudflare Pages (el código queda privado)

1. Crea una cuenta en https://dash.cloudflare.com.
2. Ve a **Workers & Pages** → **Create** → **Pages** → **Upload assets**.
3. Ponle de nombre `muz15` y arrastra la carpeta completa (sin `.git`).
4. Queda en `https://muz15.pages.dev`. Para actualizar, vuelve a subir la carpeta.

### Instalar en el iPhone

1. Abre la URL en **Safari** (no sirve otro navegador).
2. Pulsa **Compartir** (el cuadro con la flecha) → **Añadir a pantalla de inicio** → **Añadir**.
3. Abre Muz15 desde el ícono. Es importante abrirla desde ahí y no desde Safari.

En Android basta con abrir la URL en Chrome y pulsar **Instalar app** en el menú ⋮.

### Cuando publiques cambios

Sube el número en `sw.js` (`muz15-v1` → `muz15-v2`). Si no lo haces, el teléfono sigue usando la versión guardada. En iPhone, el cambio aparece al cerrar la app por completo y volver a abrirla.
