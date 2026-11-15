package com.areijond.muz15;

import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * Puente entre la pantalla de Muz15 (JavaScript) y el reproductor nativo
 * (ServicioMusica). En JS se usa como registerPlugin('Reproductor').
 *
 * También guarda las canciones como archivos del teléfono, porque el reproductor
 * nativo no puede leer el almacenamiento de la página.
 */
@CapacitorPlugin(name = "Reproductor")
public class ReproductorPlugin extends Plugin {

    private final Handler principal = new Handler(Looper.getMainLooper());
    private final ExecutorService fondo = Executors.newSingleThreadExecutor();
    private Player reproductorEscuchado; // al que ya le pusimos el "oído" para avisar cambios

    /* ---------- Servicio ---------- */

    /** Arranca el servicio (si hace falta) y ejecuta la orden en el hilo principal. */
    private void conServicio(PluginCall llamada, AccionServicio accion) {
        principal.post(() -> {
            if (ServicioMusica.instancia == null) {
                getContext().startService(new Intent(getContext(), ServicioMusica.class));
            }
            esperarServicio(llamada, accion, 0);
        });
    }

    private void esperarServicio(PluginCall llamada, AccionServicio accion, int intentos) {
        ServicioMusica servicio = ServicioMusica.instancia;
        if (servicio != null && servicio.reproductor != null) {
            escucharCambios(servicio.reproductor);
            try {
                accion.ejecutar(servicio);
            } catch (Exception error) {
                llamada.reject(error.getMessage());
            }
            return;
        }
        if (intentos > 60) { // 3 segundos
            llamada.reject("El reproductor no arrancó");
            return;
        }
        principal.postDelayed(() -> esperarServicio(llamada, accion, intentos + 1), 50);
    }

    private interface AccionServicio {
        void ejecutar(ServicioMusica servicio) throws Exception;
    }

    /** Avisa a la pantalla cada vez que cambia la canción o se pausa/reproduce. */
    private void escucharCambios(Player reproductor) {
        if (reproductor == reproductorEscuchado) return;
        reproductorEscuchado = reproductor;
        reproductor.addListener(new Player.Listener() {
            @Override
            public void onEvents(Player jugador, Player.Events eventos) {
                notifyListeners("cambio", estadoDe(jugador));
            }
        });
    }

    private JSObject estadoDe(Player reproductor) {
        JSObject estado = new JSObject();
        MediaItem actual = reproductor.getCurrentMediaItem();
        estado.put("id", actual != null ? actual.mediaId : null);
        estado.put("indice", reproductor.getCurrentMediaItemIndex());
        estado.put("total", reproductor.getMediaItemCount());
        estado.put("sonando", reproductor.getPlayWhenReady());
        estado.put("cargando", reproductor.getPlaybackState() == Player.STATE_BUFFERING);
        estado.put("segundo", reproductor.getCurrentPosition() / 1000.0);
        long duracion = reproductor.getDuration();
        estado.put("duracion", duracion > 0 ? duracion / 1000.0 : 0);
        return estado;
    }

    /* ---------- Reproducción ---------- */

    /**
     * Pone una cola nueva, ya en el orden en que debe sonar (aleatorio y
     * vínculos los calcula la app). canciones: [{ id, url, titulo, artista, album, portada }]
     */
    @PluginMethod
    public void cargarCola(PluginCall llamada) {
        JSArray canciones = llamada.getArray("canciones");
        int indice = llamada.getInt("indice", 0);
        double segundo = llamada.getDouble("segundo", 0.0);
        boolean reproducir = llamada.getBoolean("reproducir", true);
        List<MediaItem> elementos = new ArrayList<>();
        try {
            for (int i = 0; i < canciones.length(); i++) {
                JSONObject c = canciones.getJSONObject(i);
                MediaMetadata.Builder datos = new MediaMetadata.Builder()
                    .setTitle(c.optString("titulo"))
                    .setArtist(c.optString("artista"))
                    .setAlbumTitle(c.optString("album"));
                String portada = c.optString("portada", "");
                if (!portada.isEmpty()) datos.setArtworkUri(Uri.parse(portada));
                elementos.add(
                    new MediaItem.Builder()
                        .setMediaId(c.getString("id"))
                        .setUri(Uri.parse(c.getString("url")))
                        .setMediaMetadata(datos.build())
                        .build()
                );
            }
        } catch (Exception error) {
            llamada.reject("Cola inválida: " + error.getMessage());
            return;
        }
        conServicio(llamada, (servicio) -> {
            Player r = servicio.reproductor;
            r.setMediaItems(elementos, Math.max(0, Math.min(indice, elementos.size() - 1)), (long) (segundo * 1000));
            r.prepare();
            r.setPlayWhenReady(reproducir);
            llamada.resolve(estadoDe(r));
        });
    }

    @PluginMethod
    public void reproducir(PluginCall llamada) {
        conServicio(llamada, (s) -> { s.reproductor.play(); llamada.resolve(estadoDe(s.reproductor)); });
    }

    @PluginMethod
    public void pausar(PluginCall llamada) {
        conServicio(llamada, (s) -> { s.reproductor.pause(); llamada.resolve(estadoDe(s.reproductor)); });
    }

    @PluginMethod
    public void siguiente(PluginCall llamada) {
        conServicio(llamada, (s) -> { s.reproductor.seekToNextMediaItem(); llamada.resolve(estadoDe(s.reproductor)); });
    }

    /** Si la canción lleva más de 3 s, vuelve al inicio; si no, a la anterior. */
    @PluginMethod
    public void anterior(PluginCall llamada) {
        conServicio(llamada, (s) -> { s.reproductor.seekToPrevious(); llamada.resolve(estadoDe(s.reproductor)); });
    }

    @PluginMethod
    public void irA(PluginCall llamada) {
        double segundo = llamada.getDouble("segundo", 0.0);
        conServicio(llamada, (s) -> { s.reproductor.seekTo((long) (segundo * 1000)); llamada.resolve(estadoDe(s.reproductor)); });
    }

    /** Salta a una canción de la cola (por su posición), sin volver a cargarla. */
    @PluginMethod
    public void irACancion(PluginCall llamada) {
        int indice = llamada.getInt("indice", 0);
        conServicio(llamada, (s) -> {
            s.reproductor.seekTo(indice, 0);
            s.reproductor.play();
            llamada.resolve(estadoDe(s.reproductor));
        });
    }

    @PluginMethod
    public void estado(PluginCall llamada) {
        // Solo consulta: si el servicio no existe, no lo arrancamos.
        principal.post(() -> {
            ServicioMusica servicio = ServicioMusica.instancia;
            if (servicio == null || servicio.reproductor == null) {
                JSObject vacio = new JSObject();
                vacio.put("id", null);
                vacio.put("total", 0);
                vacio.put("sonando", false);
                llamada.resolve(vacio);
                return;
            }
            escucharCambios(servicio.reproductor);
            llamada.resolve(estadoDe(servicio.reproductor));
        });
    }

    /* ---------- Efectos ---------- */

    /** { ganancias: [8 dB], lados: [8 de -1 a 1], umbralDb: número o null } */
    @PluginMethod
    public void efectos(PluginCall llamada) {
        float[] ganancias = aFlotantes(llamada.getArray("ganancias"));
        float[] lados = aFlotantes(llamada.getArray("lados"));
        Double umbral = llamada.getDouble("umbralDb");
        conServicio(llamada, (s) -> {
            if (ganancias != null) s.ponerEcualizador(ganancias);
            if (lados != null) s.ponerEco(lados);
            s.ponerTope(umbral != null ? umbral.floatValue() : null);
            llamada.resolve();
        });
    }

    /** Para el registro de diagnóstico: ¿los efectos están creados y con el control? */
    @PluginMethod
    public void diagnostico(PluginCall llamada) {
        principal.post(() -> {
            JSObject d = new JSObject();
            ServicioMusica s = ServicioMusica.instancia;
            d.put("android", android.os.Build.VERSION.SDK_INT);
            d.put("servicio", s != null);
            if (s != null) {
                d.put("efectosCreados", s.efectosCreados());
                d.put("efectosConControl", s.efectosConControl());
                d.put("efectosEncendidos", s.efectosEncendidos());
                d.put("vecesAplicado", s.vecesAplicado);
                d.put("errorEfectos", s.ultimoErrorEfectos);
                d.put("sesionAudio", s.sesionDeAudio());
                d.put("sesionesRegistradas", s.getSessions().size());
                d.put("sonando", s.reproductor != null && s.reproductor.isPlaying());
            }
            llamada.resolve(d);
        });
    }

    private static float[] aFlotantes(JSArray arreglo) {
        if (arreglo == null || arreglo.length() != 8) return null;
        float[] valores = new float[8];
        for (int i = 0; i < 8; i++) valores[i] = (float) arreglo.optDouble(i, 0);
        return valores;
    }

    /* ---------- Archivos (las canciones guardadas en el teléfono) ---------- */

    private File archivo(String ruta) throws Exception {
        if (ruta == null || ruta.contains("..")) throw new Exception("Ruta no válida");
        File base = new File(getContext().getFilesDir(), "muz15");
        File destino = new File(base, ruta);
        File carpeta = destino.getParentFile();
        if (carpeta != null && !carpeta.exists() && !carpeta.mkdirs()) throw new Exception("No se pudo crear la carpeta");
        return destino;
    }

    private static JSObject datosDe(File f) {
        JSObject r = new JSObject();
        r.put("existe", f.exists());
        r.put("url", Uri.fromFile(f).toString());
        r.put("bytes", f.exists() ? f.length() : 0);
        return r;
    }

    /** Escribe (o agrega al final, en pedazos) un archivo en base64. */
    @PluginMethod
    public void escribir(PluginCall llamada) {
        String ruta = llamada.getString("ruta");
        String base64 = llamada.getString("base64", "");
        boolean agregar = llamada.getBoolean("agregar", false);
        fondo.execute(() -> {
            try {
                File f = archivo(ruta);
                try (OutputStream salida = new FileOutputStream(f, agregar)) {
                    salida.write(Base64.decode(base64, Base64.DEFAULT));
                }
                llamada.resolve(datosDe(f));
            } catch (Exception error) {
                llamada.reject("No se pudo guardar: " + error.getMessage());
            }
        });
    }

    @PluginMethod
    public void existe(PluginCall llamada) {
        try {
            llamada.resolve(datosDe(archivo(llamada.getString("ruta"))));
        } catch (Exception error) {
            llamada.reject(error.getMessage());
        }
    }

    @PluginMethod
    public void borrar(PluginCall llamada) {
        try {
            File f = archivo(llamada.getString("ruta"));
            if (f.exists() && !f.delete()) throw new Exception("No se pudo borrar");
            llamada.resolve();
        } catch (Exception error) {
            llamada.reject(error.getMessage());
        }
    }

    /** Descarga directo a un archivo (sin pasar los MB por la pantalla). */
    @PluginMethod
    public void descargar(PluginCall llamada) {
        String direccion = llamada.getString("url");
        String ruta = llamada.getString("ruta");
        fondo.execute(() -> {
            HttpURLConnection conexion = null;
            try {
                File f = archivo(ruta);
                File parcial = new File(f.getPath() + ".parcial");
                conexion = (HttpURLConnection) new URL(direccion).openConnection();
                conexion.setConnectTimeout(15000);
                conexion.setReadTimeout(30000);
                if (conexion.getResponseCode() != 200) throw new Exception("El servidor respondió " + conexion.getResponseCode());
                try (InputStream entrada = conexion.getInputStream(); OutputStream salida = new FileOutputStream(parcial)) {
                    byte[] bufer = new byte[64 * 1024];
                    int leidos;
                    while ((leidos = entrada.read(bufer)) != -1) salida.write(bufer, 0, leidos);
                }
                if (f.exists()) f.delete();
                if (!parcial.renameTo(f)) throw new Exception("No se pudo guardar el archivo");
                llamada.resolve(datosDe(f));
            } catch (Exception error) {
                llamada.reject("No se pudo descargar: " + error.getMessage());
            } finally {
                if (conexion != null) conexion.disconnect();
            }
        });
    }
}
