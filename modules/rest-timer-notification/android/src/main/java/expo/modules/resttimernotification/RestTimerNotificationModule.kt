package expo.modules.resttimernotification

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class RestTimerNotificationModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("RestTimerNotification")

    /**
     * Show a live countdown ending at `endTimeMillis` (epoch ms) and schedule
     * the completion alert that replaces it.
     */
    Function("start") {
      endTimeMillis: Double,
      title: String,
      completeTitle: String,
      completeBody: String ->
      RestTimerNotifier.start(
        context,
        endTimeMillis.toLong(),
        title,
        completeTitle,
        completeBody
      )
    }

    /** Cancel the countdown and its pending completion alert. */
    Function("stop") {
      RestTimerNotifier.stop(context)
    }
  }
}
