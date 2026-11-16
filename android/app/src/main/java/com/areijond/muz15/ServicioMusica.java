package com.areijond.muz15;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.audiofx.DynamicsProcessing;
import android.os.Build;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.Util;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

/**
 * El reproductor de Muz15 como servicio de Android (como Spotify).
 *
 * Vive aparte de la pantalla de la app: si la cierras desde "recientes", la
 * música sigue. Android pone solo los controles en la notificación, la pantalla
 * de bloqueo y el carro (MediaSession), y maneja los audífonos que se desconectan.
 *
 * Encima del sonido van los efectos de Muz15 (DynamicsProcessing de Android):
 *   - Ecualizador de 8 bandas (100 Hz … 12.8 kHz).
 *   - Modo eco: cada banda se puede llevar a la izquierda o a la derecha
 *     (se ecualiza cada oído por separado).
 *   - Limitador del "volumen seguro": lo que no llega al tope suena igual; lo
 *     que intenta pasarse se frena ahí.
 */
public class ServicioMusica extends MediaSessionService {

    private static final String TAG = "Muz15Musica";

    /** La instancia viva (el plugin la usa para darle órdenes). */
    @Nullable
    static ServicioMusica instancia;

    ExoPlayer reproductor;
    private MediaSession sesion;

    // Efectos
    private DynamicsProcessing efectos;
    private int sesionAudio = C.AUDIO_SESSION_ID_UNSET;
    // Bordes superiores de cada banda (entre las frecuencias centrales de Muz15).
    private static final float[] CORTES_HZ = { 141f, 283f, 566f, 1131f, 2263f, 4525f, 9051f, 20000f };
    private float[] ganancias = new float[8];
    private float[] lados = new float[8]; // modo eco: -1 = todo a la izquierda, 0 = centro, 1 = todo a la derecha
    private boolean topeActivo = false;
    private static final float UMBRAL_ANTI_SATURACION_DB = -1f;
    private float umbralTopeDb = 0f;

    @Override
    public void onCreate() {
        super.onCreate();
        sesionAudio = Util.generateAudioSessionIdV21(this);

        reproductor = new ExoPlayer.Builder(this)
            // Música: pide el "foco de audio" (se pausa con una llamada) y se pausa sola
            // si desconectas los audífonos.
            .setAudioAttributes(
                new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
                true
            )
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK) // que el teléfono no se duerma mientras suena
            .build();
        reproductor.setAudioSessionId(sesionAudio);
        reproductor.setRepeatMode(Player.REPEAT_MODE_ALL); // al terminar la lista, vuelve a empezar
        // Si una canción no se puede abrir (archivo que ya no está, sin internet…), pasa a
        // la siguiente en vez de quedarse callado. Si fallan todas, se detiene.
        reproductor.addListener(new Player.Listener() {
            private int fallosSeguidos = 0;

            @Override
            public void onPlayerError(PlaybackException error) {
                Log.w(TAG, "No se pudo reproducir: " + error.getMessage());
                fallosSeguidos++;
                if (fallosSeguidos < reproductor.getMediaItemCount() && reproductor.hasNextMediaItem()) {
                    reproductor.seekToNextMediaItem();
                    reproductor.prepare();
                } else {
                    fallosSeguidos = 0;
                    reproductor.setPlayWhenReady(false);
                }
            }

            @Override
            public void onIsPlayingChanged(boolean sonando) {
                if (sonando) fallosSeguidos = 0;
            }
        });

        // Tocar la notificación abre Muz15.
        Intent abrirApp = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent alTocar = PendingIntent.getActivity(this, 0, abrirApp, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        sesion = new MediaSession.Builder(this, reproductor).setSessionActivity(alTocar).build();
        // Registrar la sesión: así Android pone la notificación con controles, la
        // pantalla de bloqueo y el carro, y mantiene vivo el servicio mientras suena.
        // (Sin esto solo se registra si una pantalla se conecta como "controlador".)
        addSession(sesion);

        // Los efectos y el volumen seguro se recuerdan aquí mismo: si Android cierra el
        // servicio y lo vuelve a abrir (o la música arranca desde la notificación sin
        // abrir la app), el tope sigue puesto. Antes se perdía y sonaba sin límite.
        cargarEfectosGuardados();
        aplicarEfectos();
        instancia = this;
    }

    static final String PREFERENCIAS = "muz15-efectos";

    /** Guarda lo último que mandó la app (lo llama el plugin). */
    static void guardarEfectos(Context contexto, @Nullable float[] ganancias, @Nullable float[] lados, @Nullable Float umbralDb) {
        SharedPreferences.Editor e = contexto.getSharedPreferences(PREFERENCIAS, Context.MODE_PRIVATE).edit();
        if (ganancias != null) e.putString("ganancias", unir(ganancias));
        if (lados != null) e.putString("lados", unir(lados));
        e.putBoolean("tope", umbralDb != null);
        e.putFloat("umbral", umbralDb != null ? umbralDb : 0f);
        e.apply();
    }

    private void cargarEfectosGuardados() {
        SharedPreferences p = getSharedPreferences(PREFERENCIAS, MODE_PRIVATE);
        float[] g = separar(p.getString("ganancias", null));
        float[] l = separar(p.getString("lados", null));
        if (g != null) ganancias = g;
        if (l != null) { ladosFijos = l; lados = l.clone(); }
        topeActivo = p.getBoolean("tope", false);
        umbralTopeDb = topeActivo ? Math.min(UMBRAL_ANTI_SATURACION_DB, p.getFloat("umbral", 0f)) : 0f;
    }

    private static String unir(float[] valores) {
        StringBuilder texto = new StringBuilder();
        for (float v : valores) texto.append(texto.length() > 0 ? "," : "").append(v);
        return texto.toString();
    }

    @Nullable
    private static float[] separar(@Nullable String texto) {
        if (texto == null) return null;
        String[] partes = texto.split(",");
        if (partes.length != 8) return null;
        float[] valores = new float[8];
        try {
            for (int i = 0; i < 8; i++) valores[i] = Float.parseFloat(partes[i]);
        } catch (NumberFormatException error) {
            return null;
        }
        return valores;
    }

    /**
     * Plan B del volumen seguro: si los efectos no funcionan (Android viejo, o Dolby /
     * SoundAlive del teléfono se quedan con el control), se baja el volumen del
     * reproductor para que lo más fuerte nunca pase del tope.
     */
    private void respaldoDelTope(boolean efectosFuncionan) {
        if (reproductor == null) return;
        float volumen = topeActivo && !efectosFuncionan ? (float) Math.pow(10, umbralTopeDb / 20.0) : 1f;
        reproductor.setVolume(volumen);
    }

    @Nullable
    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controlador) {
        return sesion;
    }

    /** Cerraste la app desde "recientes": si está sonando, seguimos; si no, nos vamos. */
    @Override
    public void onTaskRemoved(@Nullable Intent intent) {
        if (reproductor == null || !reproductor.getPlayWhenReady() || reproductor.getMediaItemCount() == 0) {
            stopSelf();
        }
    }

    @Override
    public void onDestroy() {
        instancia = null;
        animando = false;
        manejador.removeCallbacks(pasoAnimacion);
        if (efectos != null) {
            efectos.release();
            efectos = null;
        }
        if (sesion != null) {
            sesion.release();
            sesion = null;
        }
        if (reproductor != null) {
            reproductor.release();
            reproductor = null;
        }
        super.onDestroy();
    }

    /* ---------- Efectos: ecualizador + limitador ---------- */

    /** @param nuevas 8 ganancias en dB (de 100 Hz a 12.8 kHz) */
    void ponerEcualizador(float[] nuevas) {
        ganancias = nuevas.clone();
        aplicarEfectos();
    }

    /** @param nuevos 8 valores de -1 (izquierda) a 1 (derecha) */
    void ponerEco(float[] nuevos) {
        ladosFijos = nuevos.clone();
        if (!animando) {
            lados = ladosFijos.clone();
            aplicarEfectos();
        }
    }

    // Cuánto sube el oído hacia el que mandas una banda, y lo mínimo que se oye el otro.
    private static final float REFUERZO_LADO_DB = 3f;
    private static final float MINIMO_OTRO_LADO = 0.03f; // ≈ -30 dB: se nota el lado sin desaparecer

    /**
     * Ganancia de una banda en un oído según hacia dónde la mandaste (-1 izquierda … 1 derecha).
     * El oído hacia el que va sube un poco (hasta +3 dB, para que se siga oyendo bien);
     * el otro baja (hasta unos -30 dB). En el centro, ninguno cambia.
     */
    private static float gananciaPorOidoDb(float lado, boolean oidoIzquierdo) {
        float haciaEste = oidoIzquierdo ? -lado : lado; // > 0 = la banda va hacia este oído
        if (haciaEste >= 0f) return REFUERZO_LADO_DB * haciaEste;
        float queda = Math.max(1f + haciaEste, MINIMO_OTRO_LADO);
        return (float) (20 * Math.log10(queda));
    }

    /* ---------- Animación del modo eco ---------- */
    // El sonido va y viene solo entre "desde" y "hasta" (-1 izq … 1 der), con un ciclo de
    // "segundos". En "ola", cada banda va un poco detrás de la anterior. Corre aquí en el
    // servicio, así sigue aunque cierres la app.

    private static final long PASO_ANIMACION_MS = 40;
    private float[] ladosFijos = new float[8]; // lo que pusiste a mano (vuelve al apagar la animación)
    private boolean animando = false;
    private float animDesde = -1f, animHasta = 1f;
    private long animCicloMs = 8000;
    private boolean animOla = false;
    private long animInicio = 0;
    private final android.os.Handler manejador = new android.os.Handler(android.os.Looper.getMainLooper());

    private final Runnable pasoAnimacion = new Runnable() {
        @Override
        public void run() {
            if (!animando) return;
            double t = (double) (System.currentTimeMillis() - animInicio) / animCicloMs;
            for (int i = 0; i < lados.length; i++) {
                double fase = animOla ? i / (double) lados.length : 0; // en ola, cada banda más atrasada
                // De "desde" a "hasta" y de regreso, suave (como un péndulo).
                double s = 0.5 - 0.5 * Math.cos(2 * Math.PI * (t - fase));
                lados[i] = (float) (animDesde + (animHasta - animDesde) * s);
            }
            aplicarEcualizadorPorOido();
            manejador.postDelayed(this, PASO_ANIMACION_MS);
        }
    };

    void animarEco(boolean activar, float desde, float hasta, double segundos, boolean ola) {
        animDesde = Math.max(-1f, Math.min(1f, desde));
        animHasta = Math.max(-1f, Math.min(1f, hasta));
        animCicloMs = (long) (Math.max(1, Math.min(120, segundos)) * 1000);
        animOla = ola;
        manejador.removeCallbacks(pasoAnimacion);
        if (activar) {
            if (!animando) animInicio = System.currentTimeMillis();
            animando = true;
            manejador.post(pasoAnimacion);
        } else {
            animando = false;
            lados = ladosFijos.clone();
            aplicarEcualizadorPorOido();
        }
    }

    /** @param umbralDb dónde empieza a frenar (dB respecto al máximo, ≤ 0); null = sin tope */
    void ponerTope(@Nullable Float umbralDb) {
        topeActivo = umbralDb != null;
        umbralTopeDb = umbralDb != null ? Math.min(UMBRAL_ANTI_SATURACION_DB, umbralDb) : 0f;
        aplicarEfectos();
    }

    // Para el diagnóstico (lo lee la app y lo anota en tu servidor).
    String ultimoErrorEfectos = null;
    int vecesAplicado = 0;

    boolean efectosCreados() { return efectos != null; }
    boolean efectosConControl() { return efectos != null && efectos.hasControl(); }
    boolean efectosEncendidos() { return efectos != null && efectos.getEnabled(); }
    int sesionDeAudio() { return sesionAudio; }

    private void aplicarEfectos() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) { // DynamicsProcessing es de Android 9+
            respaldoDelTope(false);
            return;
        }
        try {
            if (efectos == null) {
                DynamicsProcessing.Config config = new DynamicsProcessing.Config.Builder(
                    DynamicsProcessing.VARIANT_FAVOR_FREQUENCY_RESOLUTION,
                    2, // canales (estéreo)
                    true, CORTES_HZ.length, // ecualizador antes de todo
                    false, 0, // sin compresor multibanda
                    false, 0, // sin ecualizador al final
                    true // limitador
                ).build();
                // Prioridad máxima: en Samsung los efectos del propio teléfono (SoundAlive,
                // Dolby Atmos) se quedaban con el control y los de Muz15 no hacían nada.
                efectos = new DynamicsProcessing(Integer.MAX_VALUE, sesionAudio, config);
                // Si otro efecto nos quita el control y luego lo devuelve, volvemos a aplicar.
                efectos.setControlStatusListener((efecto, tieneControl) -> {
                    if (tieneControl) aplicarEfectos();
                    else respaldoDelTope(false); // otro efecto manda: que el tope no se pierda
                });
            }
            ponerBandas();
            // El limitador SIEMPRE está encendido:
            //  - con volumen seguro: frena en el tope elegido;
            //  - sin volumen seguro: frena justo antes del máximo (-1 dB), solo para que
            //    lo que suba el ecualizador no sature ("truene"). Si nada satura, no toca nada.
            // Frena en 1 ms (antes de que el golpe llegue al oído), suelta en 200 ms (sin
            // "bombeo") y es casi un muro: por cada 20 dB que algo intente pasarse, pasa 1.
            float umbral = topeActivo ? umbralTopeDb : UMBRAL_ANTI_SATURACION_DB;
            efectos.setLimiterAllChannelsTo(new DynamicsProcessing.Limiter(true, true, 0, 1f, 200f, 20f, umbral, 0f));
            efectos.setEnabled(true);
            respaldoDelTope(efectos.hasControl() && efectos.getEnabled());
            vecesAplicado++;
            ultimoErrorEfectos = null;
        } catch (Exception error) {
            Log.w(TAG, "No se pudieron aplicar los efectos", error);
            ultimoErrorEfectos = error.getClass().getSimpleName() + ": " + error.getMessage();
            respaldoDelTope(false);
            // Si el efecto quedó en mal estado, lo soltamos para crearlo de nuevo la próxima vez.
            if (efectos != null) {
                try { efectos.release(); } catch (Exception ignorar) { /* nada */ }
                efectos = null;
            }
        }
    }

    // Ecualizador + modo eco: canal 0 = oído izquierdo, canal 1 = oído derecho.
    private void ponerBandas() {
        for (int canal = 0; canal < 2; canal++) {
            for (int i = 0; i < CORTES_HZ.length; i++) {
                float ganancia = ganancias[i] + gananciaPorOidoDb(lados[i], canal == 0);
                efectos.setPreEqBandByChannelIndex(canal, i, new DynamicsProcessing.EqBand(true, CORTES_HZ[i], ganancia));
            }
        }
    }

    /** Solo las bandas (lo que cambia la animación muchas veces por segundo). */
    private void aplicarEcualizadorPorOido() {
        if (efectos == null) {
            aplicarEfectos();
            return;
        }
        try {
            ponerBandas();
        } catch (Exception error) {
            ultimoErrorEfectos = error.getClass().getSimpleName() + ": " + error.getMessage();
        }
    }
}
