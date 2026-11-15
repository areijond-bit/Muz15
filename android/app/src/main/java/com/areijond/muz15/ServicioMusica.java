package com.areijond.muz15;

import android.app.PendingIntent;
import android.content.Intent;
import android.media.audiofx.DynamicsProcessing;
import android.os.Build;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
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

        // Tocar la notificación abre Muz15.
        Intent abrirApp = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent alTocar = PendingIntent.getActivity(this, 0, abrirApp, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        sesion = new MediaSession.Builder(this, reproductor).setSessionActivity(alTocar).build();

        aplicarEfectos();
        instancia = this;
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
        lados = nuevos.clone();
        aplicarEfectos();
    }

    /**
     * Cuánto se baja una banda en un oído según hacia dónde la mandaste.
     * En el centro, nada; al mandarla a un lado, el otro oído se va apagando.
     */
    private static float atenuacionDb(float lado, boolean oidoIzquierdo) {
        float hacia = oidoIzquierdo ? -lado : lado; // > 0 = se aleja de este oído
        if (hacia <= 0f) return 0f;
        float queda = Math.max(1f - hacia, 0.001f); // 0.001 ≈ -60 dB (casi silencio)
        return (float) (20 * Math.log10(queda));
    }

    /** @param umbralDb dónde empieza a frenar (dB respecto al máximo, ≤ 0); null = sin tope */
    void ponerTope(@Nullable Float umbralDb) {
        topeActivo = umbralDb != null;
        umbralTopeDb = umbralDb != null ? Math.min(0f, umbralDb) : 0f;
        aplicarEfectos();
    }

    private void aplicarEfectos() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return; // DynamicsProcessing es de Android 9+
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
                efectos = new DynamicsProcessing(0, sesionAudio, config);
            }
            // Canal 0 = oído izquierdo, canal 1 = oído derecho.
            for (int canal = 0; canal < 2; canal++) {
                for (int i = 0; i < CORTES_HZ.length; i++) {
                    float ganancia = ganancias[i] + atenuacionDb(lados[i], canal == 0);
                    efectos.setPreEqBandByChannelIndex(canal, i, new DynamicsProcessing.EqBand(true, CORTES_HZ[i], ganancia));
                }
            }
            // Limitador: frena rápido (1 ms), suelta en 60 ms, y casi no deja pasar nada (10:1).
            efectos.setLimiterAllChannelsTo(new DynamicsProcessing.Limiter(true, topeActivo, 0, 1f, 60f, 10f, umbralTopeDb, 0f));
            efectos.setEnabled(true);
        } catch (Exception error) {
            Log.w(TAG, "No se pudieron aplicar los efectos", error);
        }
    }
}
