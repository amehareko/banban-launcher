package com.class4.signboard;

import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ValueCallback;

import org.xwalk.core.XWalkPreferences;
import org.xwalk.core.XWalkResourceClient;
import org.xwalk.core.XWalkSettings;
import org.xwalk.core.XWalkView;

/**
 * 班牌主界面（Crosswalk 版，方案 B）：
 * XWalkView 自带独立 Chromium 53 引擎，不依赖系统 WebView、不做任何 Hook，
 * Android 5.1 上的"原生"方案。页面按老内核标准编写，Chromium 53 完全兼容。
 * Kiosk 三件套：屏幕常亮 / 沉浸式全屏 / 返回键不退出。
 */
public class MainActivity extends Activity {
    private static final String PAGE_URL = "file:///android_asset/index.html";
    private static final String LAUNCH_SCHEME = "banbanx://launch?p=";

    private XWalkView xWalkView;
    private AppBridge appBridge;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        /* 屏幕常亮：班牌 7x24 展示，不依赖系统休眠设置 */
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        /* 引擎初始化前设置（REMOTE_DEBUGGING 需要时改为 true，可用 chrome://inspect 调试） */
        XWalkPreferences.setValue(XWalkPreferences.REMOTE_DEBUGGING, false);

        xWalkView = new XWalkView(this);
        XWalkSettings s = xWalkView.getSettings();
        s.setJavaScriptEnabled(true);
        /* 关键：页面的主题记忆/排行榜/倒数日/文字自定义全靠 localStorage */
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setSupportZoom(false);
        setContentView(xWalkView);
        hideSystemUi();

        /* 注入应用桥（必须在 load 之前注册）：页面右下角启动器经此列出/打开应用 */
        appBridge = new AppBridge(this);
        xWalkView.addJavascriptInterface(appBridge, "BanbanApp");

        /* 兜底通道：部分设备上 Crosswalk 23 的 addJavascriptInterface 注入异常
         *（桥对象在但方法不可见）。改用两条不依赖 JS 接口的路：
         * 1) onLoadFinished 后 evaluateJavascript 直接把应用 JSON 注入 window.__BANBAN_APPS；
         * 2) 页面启动应用走 banbanx://launch?p=<pkg>，在此拦截。 */
        xWalkView.setResourceClient(new XWalkResourceClient(xWalkView) {
            @Override
            public void onLoadFinished(XWalkView view, String url) {
                view.evaluateJavascript("window.__BANBAN_APPS=" + appBridge.getAppsJson() + ";",
                        new ValueCallback<String>() {
                            @Override
                            public void onReceiveValue(String value) { /* 忽略 */ }
                        });
            }

            @Override
            public boolean shouldOverrideUrlLoading(XWalkView view, String url) {
                if (url != null && url.startsWith(LAUNCH_SCHEME)) {
                    appBridge.launch(Uri.decode(url.substring(LAUNCH_SCHEME.length())));
                    return true; /* 拦截，不真导航 */
                }
                return super.shouldOverrideUrlLoading(view, url);
            }
        });

        xWalkView.load(PAGE_URL, null);
    }

    private void hideSystemUi() {
        View d = getWindow().getDecorView();
        d.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemUi(); /* 弹出软键盘等场景丢焦后恢复全屏 */
        }
    }

    @Override
    public void onBackPressed() {
        /* kiosk：返回键不做任何事，防止误触退出 */
    }

    @Override
    protected void onDestroy() {
        if (xWalkView != null) {
            xWalkView.onDestroy();
            xWalkView = null;
        }
        super.onDestroy();
    }
}
