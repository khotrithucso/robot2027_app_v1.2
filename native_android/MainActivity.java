package vn.io.khotrithucso.robot2027;

import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {

    private final Handler uiHandler = new Handler(Looper.getMainLooper());
    private boolean kioskGuardEnabled = true;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Đăng ký Plugin giọng nói & Kiosk trước super.onCreate theo chuẩn Capacitor 6
        registerPlugin(SpeechBridgePlugin.class);
        super.onCreate(savedInstanceState);

        // 1. Khóa cứng màn hình ngang & giữ màn hình luôn sáng
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }

        // 2. Chặn nút Back cứng/vuốt quay lại
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                // Vô hiệu hóa nút Back để tránh thoát nhầm khỏi Robot
            }
        });

        // 3. Ẩn toàn bộ thanh điều hướng & thanh trạng thái, tự ẩn lại tức thì nếu vuốt mép
        applyFullImmersiveKiosk();
        setupInsetsGuard();

        // 4. Cấu hình WebView tối ưu cho Iframe YouTube/Game & chặn văng ra trình duyệt ngoài
        configureWebViewSecurity();

        // 5. Kích hoạt Ghim màn hình (Lock Task Mode) chống vuốt 3 nút điều hướng
        uiHandler.postDelayed(() -> {
            if (kioskGuardEnabled) {
                try {
                    startLockTask();
                } catch (Exception ignored) {
                }
            }
        }, 600);
    }

    private void applyFullImmersiveKiosk() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        View decorView = getWindow().getDecorView();
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), decorView);
        if (controller != null) {
            controller.hide(WindowInsetsCompat.Type.systemBars());
            controller.setSystemBarsBehavior(
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            );
        }

        // Hỗ trợ thêm cờ tương thích cho các dòng Android đời cũ
        int flags = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN;
        decorView.setSystemUiVisibility(flags);
    }

    private void setupInsetsGuard() {
        View decorView = getWindow().getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(decorView, (v, insets) -> {
            boolean statusVisible = insets.isVisible(WindowInsetsCompat.Type.statusBars());
            boolean navVisible = insets.isVisible(WindowInsetsCompat.Type.navigationBars());
            if (kioskGuardEnabled && (statusVisible || navVisible)) {
                uiHandler.postDelayed(this::applyFullImmersiveKiosk, 40);
            }
            return WindowInsetsCompat.CONSUMED;
        });
    }

    private void configureWebViewSecurity() {
        if (bridge == null || bridge.getWebView() == null) return;
        WebView webView = bridge.getWebView();
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setSupportMultipleWindows(false);

        // Chặn mọi link mở trình duyệt ngoài hoặc app YouTube gốc từ bên trong iframe
        webView.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri == null) return true;
                String scheme = uri.getScheme() != null ? uri.getScheme().toLowerCase() : "";
                String host = uri.getHost() != null ? uri.getHost().toLowerCase() : "";

                // Chặn intent://, market://, vnd.youtube://
                if (!scheme.equals("http") && !scheme.equals("https")) {
                    return true;
                }

                // Cho phép nội bộ localhost, máy chủ trithuc/khotrithucso và trình phát nhúng YouTube
                if (host.equals("localhost")
                        || host.endsWith("trithuc.io.vn")
                        || host.endsWith("khotrithucso.io.vn")
                        || host.endsWith("youtube.com")
                        || host.endsWith("youtube-nocookie.com")
                        || host.endsWith("ytimg.com")
                        || host.endsWith("googlevideo.com")
                        || host.endsWith("google.com")) {
                    return super.shouldOverrideUrlLoading(view, request);
                }

                // Chặn toàn bộ trang web lạ bên ngoài để giữ trẻ trong App Robot
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final android.webkit.PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }
        });
    }

    public void setKioskGuardEnabled(boolean enabled) {
        this.kioskGuardEnabled = enabled;
        runOnUiThread(() -> {
            if (enabled) {
                applyFullImmersiveKiosk();
                try {
                    startLockTask();
                } catch (Exception ignored) {
                }
            } else {
                try {
                    stopLockTask();
                } catch (Exception ignored) {
                }
            }
        });
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && kioskGuardEnabled) {
            applyFullImmersiveKiosk();
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (kioskGuardEnabled && (keyCode == KeyEvent.KEYCODE_BACK
                || keyCode == KeyEvent.KEYCODE_APP_SWITCH
                || keyCode == KeyEvent.KEYCODE_MENU)) {
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
}
