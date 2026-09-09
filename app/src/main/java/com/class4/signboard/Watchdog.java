package com.class4.signboard;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.util.Log;

/**
 * 崩溃看门狗：任何未捕获异常导致进程崩溃时，1.5 秒后自动重启主界面。
 * 班牌无人值守，弹"应用已停止"挂在那是不可接受的。
 */
public class Watchdog implements Thread.UncaughtExceptionHandler {
    private static final String TAG = "Signboard";
    private final Context ctx;
    private final Thread.UncaughtExceptionHandler prev;

    private Watchdog(Context ctx, Thread.UncaughtExceptionHandler prev) {
        this.ctx = ctx;
        this.prev = prev;
    }

    public static void install(Context ctx) {
        Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler(new Watchdog(ctx.getApplicationContext(), prev));
    }

    @Override
    public void uncaughtException(Thread t, Throwable e) {
        Log.e(TAG, "uncaught crash, scheduled restart in 1.5s", e);
        try {
            Intent i = new Intent(ctx, MainActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            PendingIntent pi = PendingIntent.getActivity(ctx, 1001, i,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am != null) {
                am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP,
                        SystemClock.elapsedRealtime() + 1500, pi);
            }
        } catch (Throwable ignored) {
            /* 保底：闹钟注册失败也要走默认处理结束进程 */
        }
        if (prev != null) {
            prev.uncaughtException(t, e); /* 系统默认处理器会结束进程，闹钟随后拉起 */
        } else {
            android.os.Process.killProcess(android.os.Process.myPid());
            System.exit(10);
        }
    }
}
