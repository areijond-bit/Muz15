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
| `js/reproductor.js` | Controla el `<audio>` y MediaSession, que se encarga de la pantalla bloqueada, el Bluetooth y los botones del volante. |
| `manifest.webmanifest` | Nombre, colores e íconos para instalarla como app. |
| `sw.js` | Service worker: guarda la app en el teléfono para que abra en modo avión. |
| `icons/` | Íconos placeholder. Reemplázalos por los tuyos con el mismo nombre y tamaño. |
| `tools/` | Ayudantes para la computadora: servidor local y generador de íconos. |

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
