package com.class4.signboard;

import android.app.Application;

/**
 * 全局初始化（Crosswalk 版，方案 B）：
 * 引擎完全自包含，无需任何初始化；只装崩溃看门狗。
 */
public class MainApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        Watchdog.install(this);
    }
}
