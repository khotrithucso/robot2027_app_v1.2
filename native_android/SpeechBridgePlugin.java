package vn.io.khotrithucso.robot2027;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.WindowManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.Locale;

@CapacitorPlugin(
    name = "SpeechBridge",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class SpeechBridgePlugin extends Plugin {

    private TextToSpeech ttsEn;
    private TextToSpeech ttsVi;
    private boolean ttsEnReady = false;
    private boolean ttsViReady = false;

    private SpeechRecognizer speechRecognizer;
    private boolean isListening = false;
    private boolean continuousMode = false;

    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private boolean streamsMutedByUs = false;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable unmuteRunnable = this::restoreSystemStreams;
    private final Runnable restartRunnable = this::internalStartListening;

    @Override
    public void load() {
        Context ctx = getContext();
        audioManager = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        initDualTts(ctx);
    }

    // Khởi tạo song song 2 engine TTS (Anh & Việt) để chuyển giọng 0ms không khựng
    private void initDualTts(Context ctx) {
        ttsEn = new TextToSpeech(ctx, status -> {
            if (status == TextToSpeech.SUCCESS && ttsEn != null) {
                ttsEn.setLanguage(Locale.US);
                ttsEnReady = true;
            }
        }, "com.google.android.tts");

        ttsVi = new TextToSpeech(ctx, status -> {
            if (status == TextToSpeech.SUCCESS && ttsVi != null) {
                ttsVi.setLanguage(new Locale("vi", "VN"));
                ttsViReady = true;
            }
        }, "com.google.android.tts");

        UtteranceProgressListener listener = new UtteranceProgressListener() {
            @Override
            public void onStart(String utteranceId) {
                JSObject data = new JSObject();
                data.put("utteranceId", utteranceId);
                notifyListeners("ttsStart", data);
            }

            @Override
            public void onDone(String utteranceId) {
                JSObject data = new JSObject();
                data.put("utteranceId", utteranceId);
                notifyListeners("ttsDone", data);
            }

            @Override
            public void onError(String utteranceId) {
                JSObject data = new JSObject();
                data.put("utteranceId", utteranceId);
                data.put("error", true);
                notifyListeners("ttsDone", data);
            }
        };

        if (ttsEn != null) ttsEn.setOnUtteranceProgressListener(listener);
        if (ttsVi != null) ttsVi.setOnUtteranceProgressListener(listener);
    }

    @PluginMethod
    public void speakEn(PluginCall call) {
        String text = call.getString("text", "");
        float rate = call.getFloat("rate", 0.92f);
        if (text == null || text.trim().isEmpty()) {
            call.resolve();
            return;
        }
        mainHandler.post(() -> {
            stopAllTtsInternal();
            if (ttsEn != null && ttsEnReady) {
                ttsEn.setSpeechRate(rate);
                Bundle params = new Bundle();
                params.putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_MUSIC);
                ttsEn.speak(text, TextToSpeech.QUEUE_FLUSH, params, "en_" + System.currentTimeMillis());
            } else {
                JSObject data = new JSObject();
                data.put("fallback", true);
                notifyListeners("ttsDone", data);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void speakVi(PluginCall call) {
        String text = call.getString("text", "");
        float rate = call.getFloat("rate", 1.0f);
        if (text == null || text.trim().isEmpty()) {
            call.resolve();
            return;
        }
        mainHandler.post(() -> {
            stopAllTtsInternal();
            if (ttsVi != null && ttsViReady) {
                ttsVi.setSpeechRate(rate);
                Bundle params = new Bundle();
                params.putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_MUSIC);
                ttsVi.speak(text, TextToSpeech.QUEUE_FLUSH, params, "vi_" + System.currentTimeMillis());
            } else {
                JSObject data = new JSObject();
                data.put("fallback", true);
                notifyListeners("ttsDone", data);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        mainHandler.post(() -> {
            stopAllTtsInternal();
            call.resolve();
        });
    }

    private void stopAllTtsInternal() {
        try {
            if (ttsEn != null && ttsEn.isSpeaking()) ttsEn.stop();
            if (ttsVi != null && ttsVi.isSpeaking()) ttsVi.stop();
        } catch (Exception ignored) {
        }
    }

    @PluginMethod
    public void startListening(PluginCall call) {
        continuousMode = call.getBoolean("continuous", false);
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "micPermissionCallback");
            return;
        }
        mainHandler.post(() -> {
            internalStartListening();
            call.resolve();
        });
    }

    @PermissionCallback
    private void micPermissionCallback(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            mainHandler.post(() -> {
                internalStartListening();
                call.resolve();
            });
        } else {
            call.reject("Chưa cấp quyền Micro (RECORD_AUDIO).");
        }
    }

    @PluginMethod
    public void stopListening(PluginCall call) {
        continuousMode = false;
        mainHandler.post(() -> {
            mainHandler.removeCallbacks(restartRunnable);
            internalStopListening();
            call.resolve();
        });
    }

    // Hủy và tạo mới hoàn toàn SpeechRecognizer (sửa triệt để lỗi mất Mic khi đổi tab YouTube/Game)
    @PluginMethod
    public void resetMic(PluginCall call) {
        boolean resume = call.getBoolean("resume", true);
        continuousMode = call.getBoolean("continuous", continuousMode);
        mainHandler.post(() -> {
            mainHandler.removeCallbacks(restartRunnable);
            destroyRecognizer();
            requestMicAudioFocus();
            if (resume && getPermissionState("microphone") == PermissionState.GRANTED) {
                mainHandler.postDelayed(this::internalStartListening, 260);
            }
            call.resolve();
        });
    }

    private void requestMicAudioFocus() {
        if (audioManager == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                AudioAttributes attrs = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build();
                audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                        .setAudioAttributes(attrs)
                        .setAcceptsDelayedFocusGain(true)
                        .setOnAudioFocusChangeListener(focusChange -> {})
                        .build();
                audioManager.requestAudioFocus(audioFocusRequest);
            } else {
                audioManager.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
            }
        } catch (Exception ignored) {
        }
    }

    // Tắt tạm thời kênh Thông báo & Hệ thống 350ms để triệt tiêu tiếng kêu "tít tít" của Google Speech
    private void muteBeepStreamsBriefly() {
        if (audioManager == null) return;
        mainHandler.removeCallbacks(unmuteRunnable);
        try {
            if (!streamsMutedByUs) {
                audioManager.adjustStreamVolume(AudioManager.STREAM_NOTIFICATION, AudioManager.ADJUST_MUTE, 0);
                audioManager.adjustStreamVolume(AudioManager.STREAM_SYSTEM, AudioManager.ADJUST_MUTE, 0);
                audioManager.adjustStreamVolume(AudioManager.STREAM_RING, AudioManager.ADJUST_MUTE, 0);
                streamsMutedByUs = true;
            }
        } catch (Exception ignored) {
        }
        mainHandler.postDelayed(unmuteRunnable, 380);
    }

    private void restoreSystemStreams() {
        if (audioManager == null || !streamsMutedByUs) return;
        try {
            audioManager.adjustStreamVolume(AudioManager.STREAM_NOTIFICATION, AudioManager.ADJUST_UNMUTE, 0);
            audioManager.adjustStreamVolume(AudioManager.STREAM_SYSTEM, AudioManager.ADJUST_UNMUTE, 0);
            audioManager.adjustStreamVolume(AudioManager.STREAM_RING, AudioManager.ADJUST_UNMUTE, 0);
        } catch (Exception ignored) {
        }
        streamsMutedByUs = false;
    }

    private void ensureRecognizerCreated() {
        if (speechRecognizer != null) return;
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) return;

        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
        speechRecognizer.setRecognitionListener(new RecognitionListener() {
            @Override
            public void onReadyForSpeech(Bundle params) {
                isListening = true;
                JSObject st = new JSObject();
                st.put("state", "listening");
                notifyListeners("speechState", st);
            }

            @Override
            public void onBeginningOfSpeech() {}

            @Override
            public void onRmsChanged(float rmsdB) {
                JSObject rmsObj = new JSObject();
                rmsObj.put("rms", rmsdB);
                notifyListeners("speechRms", rmsObj);
            }

            @Override
            public void onBufferReceived(byte[] buffer) {}

            @Override
            public void onEndOfSpeech() {
                isListening = false;
            }

            @Override
            public void onError(int error) {
                isListening = false;
                JSObject st = new JSObject();
                st.put("state", "error");
                st.put("code", error);
                notifyListeners("speechState", st);

                // Nếu bộ thu bị treo hoặc bận (lỗi 5 hoặc 8), hủy và tạo mới lại ngay
                if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY
                        || error == SpeechRecognizer.ERROR_CLIENT) {
                    destroyRecognizer();
                }

                if (continuousMode) {
                    long delay = (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) ? 250 : 500;
                    mainHandler.removeCallbacks(restartRunnable);
                    mainHandler.postDelayed(restartRunnable, delay);
                }
            }

            @Override
            public void onResults(Bundle results) {
                isListening = false;
                ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (matches != null && !matches.isEmpty()) {
                    JSArray alts = new JSArray();
                    for (String m : matches) alts.put(m);

                    JSObject resObj = new JSObject();
                    resObj.put("text", matches.get(0));
                    resObj.put("alternatives", alts);
                    notifyListeners("speechResult", resObj);
                }

                JSObject st = new JSObject();
                st.put("state", "stopped");
                notifyListeners("speechState", st);

                if (continuousMode) {
                    mainHandler.removeCallbacks(restartRunnable);
                    mainHandler.postDelayed(restartRunnable, 300);
                }
            }

            @Override
            public void onPartialResults(Bundle partialResults) {
                ArrayList<String> partial = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (partial != null && !partial.isEmpty()) {
                    JSObject pObj = new JSObject();
                    pObj.put("text", partial.get(0));
                    notifyListeners("speechPartial", pObj);
                }
            }

            @Override
            public void onEvent(int eventType, Bundle params) {}
        });
    }

    private void internalStartListening() {
        if (getPermissionState("microphone") != PermissionState.GRANTED) return;
        stopAllTtsInternal();
        requestMicAudioFocus();
        ensureRecognizerCreated();
        if (speechRecognizer == null) return;

        try {
            if (isListening) {
                speechRecognizer.cancel();
                isListening = false;
            }
            muteBeepStreamsBriefly();

            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US");
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "en-US");
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
            intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1200L);
            intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1000L);

            speechRecognizer.startListening(intent);
        } catch (Exception e) {
            destroyRecognizer();
        }
    }

    private void internalStopListening() {
        isListening = false;
        if (speechRecognizer != null) {
            try {
                muteBeepStreamsBriefly();
                speechRecognizer.stopListening();
                speechRecognizer.cancel();
            } catch (Exception ignored) {
            }
        }
        JSObject st = new JSObject();
        st.put("state", "stopped");
        notifyListeners("speechState", st);
    }

    private void destroyRecognizer() {
        isListening = false;
        if (speechRecognizer != null) {
            try {
                speechRecognizer.stopListening();
                speechRecognizer.cancel();
                speechRecognizer.destroy();
            } catch (Exception ignored) {
            }
            speechRecognizer = null;
        }
    }

    @PluginMethod
    public void setKioskPinLock(PluginCall call) {
        boolean locked = call.getBoolean("locked", true);
        if (getActivity() instanceof MainActivity) {
            ((MainActivity) getActivity()).setKioskGuardEnabled(locked);
        }
        call.resolve();
    }

    @PluginMethod
    public void setScreenBrightness(PluginCall call) {
        float level = call.getFloat("level", -1.0f);
        mainHandler.post(() -> {
            if (getActivity() != null && getActivity().getWindow() != null) {
                WindowManager.LayoutParams lp = getActivity().getWindow().getAttributes();
                lp.screenBrightness = level;
                getActivity().getWindow().setAttributes(lp);
            }
            call.resolve();
        });
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        restoreSystemStreams();
    }

    @Override
    protected void handleOnDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        restoreSystemStreams();
        destroyRecognizer();
        if (ttsEn != null) {
            ttsEn.stop();
            ttsEn.shutdown();
        }
        if (ttsVi != null) {
            ttsVi.stop();
            ttsVi.shutdown();
        }
        super.handleOnDestroy();
    }
}
