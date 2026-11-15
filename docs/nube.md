# Conectar Muz15 a su nube (cuentas, perfiles y audios compartidos)

Muz15 usa dos servicios gratis:

- **Supabase**: cuentas (entrar con Google), perfiles, datos de cada audio, tu biblioteca, tus listas, "estás escuchando…" y los avisos al instante.
- **Cloudflare R2**: los archivos (audios comprimidos, portadas y fotos de perfil). Da 10 GB gratis y no cobra cuando tus amigos escuchan.

Son cinco pasos y se hacen una sola vez. Al final me pasas **3 datos**, y ninguno es secreto (están en el paso 6).

> Nunca me pases contraseñas, el "Client secret" de Google ni las llaves de R2. Esos van directo en las páginas de Supabase o Cloudflare.

---

## 1. Supabase: crear el proyecto y la base de datos

1. Entra a <https://supabase.com> → **Start your project**. Inicia sesión con tu cuenta de GitHub (`areijond-bit`).
2. **New project**:
   - Name: `muz15`.
   - Database Password: inventa una y guárdala tú.
   - Region: la más cercana (por ejemplo, *East US*).
   - Crea el proyecto y espera 1 o 2 minutos.
3. Menú izquierdo → **SQL Editor** → **New query**. Pega TODO el contenido del archivo `nube/esquema.sql` de este repositorio → **Run**. Debe decir *Success*.
4. Menú → **Project Settings** → **API**. Anota estos dos datos para el paso 6:
   - **Project URL**: se ve como `https://abcdefgh.supabase.co`.
   - **anon public key**: un texto largo que empieza con `eyJ…` o `sb_publishable_…`.

## 2. Google: permiso para "Entrar con Google"

1. Entra a <https://console.cloud.google.com> con tu cuenta de Google → arriba, **Seleccionar proyecto** → **Proyecto nuevo** → nombre `Muz15` → Crear.
2. Menú → **APIs y servicios** → **Pantalla de consentimiento de OAuth** (o **Google Auth Platform**) → **Comenzar**:
   - Nombre de la app: `Muz15`. Correo de asistencia: el tuyo.
   - Público: **Externo**.
   - Datos de contacto: tu correo → Aceptar → Crear.
3. En **Público** (Audience), toca **Publicar app**. Así tus amigos pueden entrar sin que los agregues uno por uno. Muz15 solo pide tu nombre, correo y foto, así que Google no pide revisión.
4. **Clientes** → **Crear cliente** → tipo **Aplicación web**:
   - Nombre: `Muz15 web`.
   - **Orígenes autorizados de JavaScript**:
     - `https://areijond-bit.github.io`
     - `http://localhost:5150`
   - **URI de redireccionamiento autorizados**: `https://TU-PROYECTO.supabase.co/auth/v1/callback` (cambia `TU-PROYECTO` por el de tu *Project URL* del paso 1).
   - Crear. Anota el **ID de cliente** (termina en `.apps.googleusercontent.com`). Copia también el **Secreto del cliente**, pero ese solo va en Supabase (paso 3), no a mí.
5. **Crear cliente** otra vez → tipo **Android**:
   - Nombre: `Muz15 APK`.
   - Nombre del paquete: `com.areijond.muz15`.
   - Huella digital SHA-1: `D5:56:21:AE:68:EA:F6:1A:70:09:86:08:6B:B8:58:88:58:76:AA:3D`
   - Crear. De este no hay que copiar nada.

## 3. Supabase: activar Google

1. Supabase → **Authentication** → **Sign In / Providers** → **Google** → actívalo:
   - **Client IDs**: el ID de cliente web del paso 2.
   - **Client Secret**: el secreto del paso 2.
   - Activa **Skip nonce checks**. Hace falta para que funcione dentro de la APK.
   - Save.
2. **Authentication** → **URL Configuration**:
   - Site URL: `https://areijond-bit.github.io/Muz15/`
   - Redirect URLs → Add URL: `https://areijond-bit.github.io/Muz15/` y `http://localhost:5150/`

## 4. Cloudflare R2: donde viven los audios

1. Entra a <https://dash.cloudflare.com> y crea tu cuenta.
2. Menú → **R2 Object Storage**. Te pide agregar una tarjeta: no cobra nada mientras no pases de 10 GB.
3. **Create bucket** → nombre `muz15` → Create.
4. Dentro del bucket → **Settings**:
   - **Public access** → **R2.dev subdomain** → **Allow**. Anota la dirección pública; se ve como `https://pub-xxxxxxxx.r2.dev`.
   - **CORS Policy** → **Add CORS policy** → pega el contenido de `nube/r2-cors.json` → Save.
5. Regresa a **R2 Object Storage** → **Manage R2 API Tokens** (o **API** → *Manage API tokens*) → **Create API token**:
   - Permisos: **Object Read & Write**. Solo para el bucket `muz15`.
   - Crear. Copia el **Access Key ID**, el **Secret Access Key** y tu **Account ID**. Esos tres van en el paso 5, no a mí.

## 5. Supabase: la función que da permiso para subir

1. Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Nombre: `firmar`. Borra el ejemplo y pega TODO `nube/funciones/firmar/index.ts` → **Deploy**.
3. **Edge Functions** → **Secrets** → agrega estos 5:

   | Nombre             | Valor                                        |
   |--------------------|----------------------------------------------|
   | `R2_CUENTA`        | tu Account ID de Cloudflare                  |
   | `R2_LLAVE_ID`      | el Access Key ID                             |
   | `R2_LLAVE_SECRETA` | el Secret Access Key                         |
   | `R2_CUBETA`        | `muz15`                                      |
   | `R2_PUBLICA`       | la dirección pública `https://pub-….r2.dev`  |

## 6. Pásame estos 3 datos

1. **Project URL** de Supabase (paso 1).
2. **anon public key** de Supabase (paso 1).
3. **ID de cliente web** de Google (paso 2).

Con eso conecto Muz15 (archivo `js/config.js`) y ya puedes entrar con Google en el cel y en la PC.

---

### Cuánto cabe

Cada canción se comprime a Opus (unos 96 kbps), así que pesa unos 2.5 MB. Con los 10 GB gratis de R2 caben unas **4,000 canciones** entre todos. Pasando de eso, cada GB extra cuesta unos $0.015 dólares al mes. Si tú y un amigo suben la misma canción, se guarda una sola vez.

### Si Supabase se pausa

Si en 7 días nadie usa Muz15, Supabase pausa el proyecto gratis. No se borra nada: entra a supabase.com → tu proyecto → **Restore**.
