package expo.modules.resttimernotification

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Fired by the exact alarm at the rest timer's end time. Runs even when the app
 * process is gone, which is the whole point — the alert must not depend on the
 * JS runtime still being alive.
 */
class RestTimerAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val title = intent.getStringExtra(RestTimerNotifier.EXTRA_TITLE) ?: "Rest complete"
    val body = intent.getStringExtra(RestTimerNotifier.EXTRA_BODY) ?: "Ready for the next set."
    RestTimerNotifier.showComplete(context, title, body)
  }
}
