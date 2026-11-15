package com.areijond.muz15;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // El reproductor nativo de Muz15 (debe registrarse antes de super.onCreate).
        registerPlugin(ReproductorPlugin.class);
        super.onCreate(savedInstanceState);
        // Permite que la siguiente canción arranque sola (al terminar la actual o
        // desde los botones de la pantalla de bloqueo) sin que haya que tocar la pantalla.
        getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
    }

    @Override
    public void onPause() {
        super.onPause();
        // Android pausa el WebView al salir de la app; lo reanudamos para que la
        // música y el paso a la siguiente canción sigan con la pantalla bloqueada.
        getBridge().getWebView().onResume();
        getBridge().getWebView().resumeTimers();
    }
}
