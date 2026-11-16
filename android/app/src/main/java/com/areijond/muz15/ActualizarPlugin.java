package com.areijond.muz15;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Baja la APK nueva de Muzzy dentro de la app (con porcentaje) y abre el instalador
 * de Android. Antes se abría el enlace en el navegador, que bajaba en silencio y parecía
 * que no pasaba nada. En JS: registerPlugin('Actualizar').
 */
@CapacitorPlugin(name = "Actualizar")
public class ActualizarPlugin extends Plugin {

    private final ExecutorService fondo = Executors.newSingleThreadExecutor();
    private volatile boolean bajando = false;

    /** { url } → baja la APK y abre "Instalar". Rechaza con código PERMISO si falta el permiso. */
    @PluginMethod
    public void instalar(PluginCall llamada) {
        String direccion = llamada.getString("url");
        if (direccion == null) {
            llamada.reject("Falta la dirección");
            return;
        }
        // Android 8+: cada app necesita permiso para instalar otras ("Permitir de esta fuente").
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent permiso = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(permiso);
            llamada.reject("Falta el permiso para instalar", "PERMISO");
            return;
        }
        if (bajando) {
            llamada.reject("Ya se está bajando");
            return;
        }
        bajando = true;
        fondo.execute(() -> {
            HttpURLConnection conexion = null;
            try {
                File destino = new File(getContext().getCacheDir(), "Muzzy-nueva.apk");
                conexion = (HttpURLConnection) new URL(direccion).openConnection();
                conexion.setInstanceFollowRedirects(true); // GitHub manda a otro servidor
                conexion.setConnectTimeout(15000);
                conexion.setReadTimeout(30000);
                int codigo = conexion.getResponseCode();
                if (codigo != 200) throw new Exception("el servidor respondió " + codigo);
                long total = conexion.getContentLengthLong();
                long llevamos = 0;
                long ultimoAviso = 0;
                try (InputStream entrada = conexion.getInputStream(); OutputStream salida = new FileOutputStream(destino)) {
                    byte[] bufer = new byte[64 * 1024];
                    int leidos;
                    while ((leidos = entrada.read(bufer)) != -1) {
                        salida.write(bufer, 0, leidos);
                        llevamos += leidos;
                        long ahora = System.currentTimeMillis();
                        if (ahora - ultimoAviso > 300) {
                            ultimoAviso = ahora;
                            JSObject progreso = new JSObject();
                            progreso.put("fraccion", total > 0 ? (double) llevamos / total : 0);
                            progreso.put("bytes", llevamos);
                            notifyListeners("progreso", progreso);
                        }
                    }
                }
                if (total > 0 && llevamos < total) throw new Exception("la descarga se cortó");
                Uri apk = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", destino);
                Intent instalar = new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(apk, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(instalar);
                llamada.resolve();
            } catch (Exception error) {
                llamada.reject("No se pudo bajar: " + error.getMessage());
            } finally {
                if (conexion != null) conexion.disconnect();
                bajando = false;
            }
        });
    }
}
