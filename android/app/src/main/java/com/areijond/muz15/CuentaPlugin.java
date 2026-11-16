package com.areijond.muz15;

import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.NoCredentialException;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.libraries.identity.googleid.GetGoogleIdOption;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import java.util.concurrent.Executors;

/**
 * Entrar con Google dentro de la APK. Google no deja iniciar sesión desde una
 * página dentro de una app, así que lo hace Android con su ventanita de cuentas
 * y le pasa a la página un "token de identidad"; con él la página entra a Supabase.
 *
 * En JS: registerPlugin('Cuenta').entrar({ clienteWeb }) → { token, email, nombre, foto }
 * (clienteWeb = el ID de cliente "Aplicación web" del proyecto de Google).
 */
@CapacitorPlugin(name = "Cuenta")
public class CuentaPlugin extends Plugin {

    @PluginMethod
    public void entrar(PluginCall call) {
        String clienteWeb = call.getString("clienteWeb");
        if (clienteWeb == null || clienteWeb.isEmpty()) {
            call.reject("Falta el ID de cliente de Google", "SIN_CONFIGURAR");
            return;
        }
        // Primero, la ventanita rápida con tus cuentas del teléfono.
        GetGoogleIdOption rapida = new GetGoogleIdOption.Builder()
            .setServerClientId(clienteWeb)
            .setFilterByAuthorizedAccounts(false)
            .setAutoSelectEnabled(false) // que siempre pregunte con qué cuenta (para poder cambiar)
            .build();
        pedir(call, new GetCredentialRequest.Builder().addCredentialOption(rapida).build(), clienteWeb, true);
    }

    private void pedir(PluginCall call, GetCredentialRequest pedido, String clienteWeb, boolean puedeReintentar) {
        CredentialManager.create(getContext()).getCredentialAsync(
            getActivity(), pedido, null, Executors.newSingleThreadExecutor(),
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse respuesta) {
                    responder(call, respuesta.getCredential());
                }

                @Override
                public void onError(GetCredentialException error) {
                    if (error instanceof GetCredentialCancellationException) {
                        call.reject("Cancelaste el inicio de sesión", "CANCELADO");
                    } else if (error instanceof NoCredentialException && puedeReintentar) {
                        // Sin cuentas listas: la ventana completa de "Acceder con Google".
                        GetSignInWithGoogleOption completa = new GetSignInWithGoogleOption.Builder(clienteWeb).build();
                        pedir(call, new GetCredentialRequest.Builder().addCredentialOption(completa).build(), clienteWeb, false);
                    } else {
                        call.reject("No se pudo entrar: " + error.getMessage(), "ERROR");
                    }
                }
            });
    }

    private void responder(PluginCall call, Credential credencial) {
        if (!(credencial instanceof CustomCredential)
            || !GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credencial.getType())) {
            call.reject("Google no dio una cuenta válida", "ERROR");
            return;
        }
        try {
            GoogleIdTokenCredential google = GoogleIdTokenCredential.createFrom(credencial.getData());
            JSObject datos = new JSObject();
            datos.put("token", google.getIdToken());
            datos.put("email", google.getId());
            datos.put("nombre", google.getDisplayName());
            datos.put("foto", google.getProfilePictureUri() != null ? google.getProfilePictureUri().toString() : null);
            call.resolve(datos);
        } catch (Exception error) {
            call.reject("No se pudo leer tu cuenta: " + error.getMessage(), "ERROR");
        }
    }
}
