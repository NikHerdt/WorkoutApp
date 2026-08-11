package expo.modules.resttimernotification

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Rest timer tray notification.
 *
 * The countdown is rendered by the system via a chronometer: we post once with
 * the end time and Android ticks it down. That avoids re-posting every second,
 * which gets an app rate-limited and was what made the previous notifications
 * arrive late.
 *
 * The completion alert reuses the same notification id, so it *replaces* the
 * countdown rather than stacking a second notification. It is delivered by an
 * exact alarm owned by this module, so it fires even with the app killed.
 */
object RestTimerNotifier {
  /** Shared id: posting the completion alert under it replaces the countdown. */
  private const val NOTIFICATION_ID = 8801
  private const val NOTIFICATION_TAG = "rest-timer"

  private const val CHANNEL_ONGOING = "rest-timer-live"
  private const val CHANNEL_COMPLETE = "rest-timer-complete"

  private const val ALARM_REQUEST_CODE = 8801

  const val EXTRA_TITLE = "completeTitle"
  const val EXTRA_BODY = "completeBody"

  private fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    // Low importance: the countdown should sit quietly in the shade.
    manager.createNotificationChannel(
      NotificationChannel(
        CHANNEL_ONGOING,
        "Rest timer",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "Live countdown while you rest between sets"
        setShowBadge(false)
        enableVibration(false)
        setSound(null, null)
      }
    )

    // High importance: the completion alert should break through.
    manager.createNotificationChannel(
      NotificationChannel(
        CHANNEL_COMPLETE,
        "Rest complete",
        NotificationManager.IMPORTANCE_HIGH
      ).apply {
        description = "Fires when your rest period ends"
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 250, 120, 250)
      }
    )
  }

  private fun smallIcon(context: Context): Int {
    // Prefer an app-provided notification icon; fall back to the system alarm
    // glyph so a missing drawable can never crash the post.
    val res = context.resources
    val id = res.getIdentifier("ic_notification", "drawable", context.packageName)
    return if (id != 0) id else android.R.drawable.ic_lock_idle_alarm
  }

  private fun contentIntent(context: Context): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: return null
    launch.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
    return PendingIntent.getActivity(
      context,
      0,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun alarmIntent(context: Context, title: String, body: String): PendingIntent {
    val intent = Intent(context, RestTimerAlarmReceiver::class.java).apply {
      putExtra(EXTRA_TITLE, title)
      putExtra(EXTRA_BODY, body)
    }
    return PendingIntent.getBroadcast(
      context,
      ALARM_REQUEST_CODE,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  /**
   * Show the live countdown and schedule the completion alert.
   * Calling again replaces both, so restarting a timer never leaves the
   * previous one pending.
   */
  fun start(
    context: Context,
    endTimeMillis: Long,
    title: String,
    completeTitle: String,
    completeBody: String
  ) {
    ensureChannels(context)

    val notification = NotificationCompat.Builder(context, CHANNEL_ONGOING)
      .setSmallIcon(smallIcon(context))
      .setContentTitle(title)
      // The system renders and ticks this down to `when`; no app updates needed.
      .setWhen(endTimeMillis)
      .setShowWhen(true)
      .setUsesChronometer(true)
      .setChronometerCountDown(true)
      .setOngoing(true)
      .setSilent(true)
      .setOnlyAlertOnce(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setContentIntent(contentIntent(context))
      .build()

    try {
      NotificationManagerCompat.from(context).notify(NOTIFICATION_TAG, NOTIFICATION_ID, notification)
    } catch (_: SecurityException) {
      // POST_NOTIFICATIONS not granted — the in-app timer still runs.
    }

    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pending = alarmIntent(context, completeTitle, completeBody)
    val canBeExact =
      Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()
    if (canBeExact) {
      alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endTimeMillis, pending)
    } else {
      // Without the exact-alarm permission Android may defer this; still better
      // than nothing, and the app declares USE_EXACT_ALARM so it rarely applies.
      alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endTimeMillis, pending)
    }
  }

  /** Replace the countdown with the completion alert. Called from the alarm. */
  fun showComplete(context: Context, title: String, body: String) {
    ensureChannels(context)

    val notification = NotificationCompat.Builder(context, CHANNEL_COMPLETE)
      .setSmallIcon(smallIcon(context))
      .setContentTitle(title)
      .setContentText(body)
      .setAutoCancel(true)
      .setOngoing(false)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setDefaults(NotificationCompat.DEFAULT_ALL)
      .setContentIntent(contentIntent(context))
      .build()

    try {
      // Same tag + id as the countdown, so this replaces it in place.
      NotificationManagerCompat.from(context).notify(NOTIFICATION_TAG, NOTIFICATION_ID, notification)
    } catch (_: SecurityException) {
      // Notifications not permitted.
    }
  }

  /** Cancel a running timer: drop the pending alarm and clear the notification. */
  fun stop(context: Context) {
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    alarmManager.cancel(alarmIntent(context, "", ""))
    NotificationManagerCompat.from(context).cancel(NOTIFICATION_TAG, NOTIFICATION_ID)
  }
}
