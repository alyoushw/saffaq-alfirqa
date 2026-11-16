package com.taqweemalzahra.saffaq;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaToolsPlugin.class);
        super.onCreate(savedInstanceState);
        // لا نستخدم الذاكرة المؤقتة: كل تحديث يشتغل بملفاته الجديدة
        try {
            WebView wv = getBridge().getWebView();
            wv.clearCache(true);
            wv.getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
            wv.getSettings().setMediaPlaybackRequiresUserGesture(false);
        } catch (Exception ignored) { }
    }
}
