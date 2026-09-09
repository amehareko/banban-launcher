package com.class4.signboard;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.text.TextUtils;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.text.Collator;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/**
 * 注入页面的应用桥（window.BanbanApp）：
 * - getApps()：返回可启动应用 JSON 数组 [{name, pkg, icon(dataURL)}]，按名称拼音序
 * - launch(pkg)：启动指定应用
 * 方法由 XWalkView 的 JavaBridge 线程调用，不在 UI 线程；图标绘制/启动 Activity 均可安全执行。
 * 图标一次性生成 64px PNG 并常驻内存缓存，避免反复传输。
 */
public class AppBridge {

    private static final int ICON_SIZE = 64;
    private static final String EMPTY_JSON = "[]";

    private final Activity activity;
    private volatile String cachedApps = null;

    public AppBridge(Activity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public String getApps() {
        String cached = cachedApps;
        if (cached != null) {
            return cached;
        }
        cachedApps = buildAppsJson();
        return cachedApps;
    }

    /** 供原生 XWalkResourceClient.onLoadFinished 直接取 JSON（evaluateJavascript 兜底注入用） */
    public String getAppsJson() {
        return getApps();
    }

    @JavascriptInterface
    public String launch(String pkg) {
        try {
            if (TextUtils.isEmpty(pkg)) {
                return "err:empty";
            }
            PackageManager pm = activity.getPackageManager();
            Intent i = pm.getLaunchIntentForPackage(pkg);
            if (i == null) {
                return "err:nointent";
            }
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(i);
            return "ok";
        } catch (Throwable t) {
            return "err:" + t.getClass().getSimpleName();
        }
    }

    private String buildAppsJson() {
        try {
            PackageManager pm = activity.getPackageManager();
            String self = activity.getPackageName();

            /* 只收"桌面有入口"的应用，排除自己（班牌本体） */
            List<ResolveInfo> launcher = pm.queryIntentActivities(
                    new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0);
            ArrayList<AppEntry> list = new ArrayList<AppEntry>();
            for (int i = 0; i < launcher.size(); i++) {
                ResolveInfo ri = launcher.get(i);
                String pkg = ri.activityInfo.packageName;
                if (pkg == null || pkg.equals(self)) {
                    continue;
                }
                CharSequence label = ri.loadLabel(pm);
                if (label == null || label.length() == 0) {
                    continue;
                }
                list.add(new AppEntry(label.toString(), pkg));
            }

            /* 中文按拼音排序 */
            final Collator col = Collator.getInstance(Locale.CHINA);
            Collections.sort(list, new Comparator<AppEntry>() {
                @Override
                public int compare(AppEntry a, AppEntry b) {
                    return col.compare(a.name, b.name);
                }
            });

            JSONArray arr = new JSONArray();
            for (int i = 0; i < list.size(); i++) {
                AppEntry e = list.get(i);
                JSONObject o = new JSONObject();
                o.put("name", e.name);
                o.put("pkg", e.pkg);
                o.put("icon", iconDataUrl(pm, e.pkg));
                arr.put(o);
            }
            return arr.toString();
        } catch (Throwable t) {
            return EMPTY_JSON;
        }
    }

    private String iconDataUrl(PackageManager pm, String pkg) {
        try {
            Drawable d = pm.getApplicationIcon(pkg);
            Bitmap bmp = Bitmap.createBitmap(ICON_SIZE, ICON_SIZE, Bitmap.Config.ARGB_8888);
            Canvas c = new Canvas(bmp);
            d.setBounds(0, 0, ICON_SIZE, ICON_SIZE);
            d.draw(c);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.PNG, 100, out);
            bmp.recycle();
            return "data:image/png;base64,"
                    + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (Throwable t) {
            return ""; /* 页面对空 icon 渲染占位 */
        }
    }

    private static class AppEntry {
        final String name;
        final String pkg;
        AppEntry(String name, String pkg) {
            this.name = name;
            this.pkg = pkg;
        }
    }
}
