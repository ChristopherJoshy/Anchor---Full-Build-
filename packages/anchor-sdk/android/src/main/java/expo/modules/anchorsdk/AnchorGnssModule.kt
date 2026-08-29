package expo.modules.anchorsdk

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.GnssMeasurementsEvent
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executor
import java.util.concurrent.Executors

private const val TAG = "AnchorGnss"

/**
 * Maps [android.location.GnssMeasurement] CONSTELLATION_* integer codes to the
 * constellation vocabulary shared with the JS contract:
 * "gps" | "glonass" | "beidou" | "galileo" | "qzss" | "irnss" | "unknown".
 * SBAS and anything unrecognized degrade to "unknown".
 */
internal fun constellationName(constellationType: Int): String = when (constellationType) {
    android.location.GnssMeasurement.CONSTELLATION_GPS -> "gps"
    android.location.GnssMeasurement.CONSTELLATION_GLONASS -> "glonass"
    android.location.GnssMeasurement.CONSTELLATION_BEIDOU -> "beidou"
    android.location.GnssMeasurement.CONSTELLATION_GALILEO -> "galileo"
    android.location.GnssMeasurement.CONSTELLATION_QZSS -> "qzss"
    android.location.GnssMeasurement.CONSTELLATION_IRNSS -> "irnss"
    else -> "unknown"
}

/**
 * AnchorGnss — raw GNSS C/N0 measurement streaming for the Anchor integrity pipeline.
 *
 * Requires ACCESS_FINE_LOCATION to have been granted by the embedding app BEFORE
 * `start()` is called; this module never requests permissions itself.
 *
 * Events:
 *  - "onMeasurement": { satellites: [{ svid, constellation, cn0DbHz }], timestamp (epoch ms),
 *    elapsedRealtimeNanos (only reported on API 29+, where GnssClock carries it) }
 *  - "onError": { code, message }
 *  - "onStatus": { status: "ready" | "stopped" | "notSupported" | "locationDisabled" | "notAllowed" }
 *
 * Status note: on API 31+ the framework calls onStatusChanged exactly once with
 * STATUS_READY regardless of actual conditions, so `start()` performs explicit
 * permission / location-enabled checks upfront instead of relying on it. On API
 * 24-30 onStatusChanged carries the real subsystem status and is forwarded as-is.
 */
class AnchorGnssModule : Module() {
    private var measurementCallback: GnssMeasurementsEvent.Callback? = null

    private val deliveryExecutor: Executor by lazy {
        Executors.newSingleThreadExecutor { runnable -> Thread(runnable, "AnchorGnss") }
    }

    private val mainHandler: Handler by lazy { Handler(Looper.getMainLooper()) }

    override fun definition() = ModuleDefinition {
        Name("AnchorGnss")

        Events("onMeasurement", "onError", "onStatus")

        AsyncFunction("start") { promise: Promise ->
            startStreaming(promise)
        }

        AsyncFunction("stop") { promise: Promise ->
            stopStreaming()
            promise.resolve(null)
        }

        Function("isSupported") {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && gnssLocationManager() != null
        }
    }

    private fun gnssLocationManager(): LocationManager? {
        val context = appContext.reactContext ?: return null
        return context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
    }

    private fun hasFineLocationPermission(): Boolean {
        val context = appContext.reactContext ?: return false
        return try {
            context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) ==
                PackageManager.PERMISSION_GRANTED
        } catch (e: Exception) {
            Log.w(TAG, "Permission check failed", e)
            false
        }
    }

    private fun emitError(code: String, message: String) {
        sendEvent("onError", mapOf("code" to code, "message" to message))
    }

    private fun emitStatus(status: String) {
        sendEvent("onStatus", mapOf("status" to status))
    }

    private fun startStreaming(promise: Promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            val message = "AnchorGnss requires Android 7.0 (API 24) or newer for GnssMeasurements; this device is API ${Build.VERSION.SDK_INT}."
            emitError("E_UNSUPPORTED", message)
            promise.reject("E_UNSUPPORTED", message, null)
            return
        }

        val locationManager = gnssLocationManager()
        if (locationManager == null) {
            val message = "LocationManager is unavailable on this device; raw GNSS measurements cannot be collected."
            emitError("E_UNSUPPORTED", message)
            promise.reject("E_UNSUPPORTED", message, null)
            return
        }

        if (measurementCallback != null) {
            // Already streaming: start() is idempotent.
            promise.resolve(null)
            return
        }

        if (!hasFineLocationPermission()) {
            val message = "ACCESS_FINE_LOCATION has not been granted. Request location permission in the app before calling AnchorGnss.start()."
            emitError("E_PERMISSION", message)
            emitStatus("notAllowed")
            promise.reject("E_PERMISSION", message, null)
            return
        }

        if (!locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
            val message = "The GPS provider is disabled. Enable device location before starting GNSS measurements."
            emitError("E_LOCATION_DISABLED", message)
            emitStatus("locationDisabled")
            promise.reject("E_LOCATION_DISABLED", message, null)
            return
        }

        val callback = object : GnssMeasurementsEvent.Callback() {
            override fun onGnssMeasurementsReceived(event: GnssMeasurementsEvent) {
                sendEvent("onMeasurement", buildMeasurementPayload(event))
            }

            @Deprecated("Deprecated in Java")
            override fun onStatusChanged(status: Int) {
                val statusName = when (status) {
                    GnssMeasurementsEvent.Callback.STATUS_READY -> "ready"
                    GnssMeasurementsEvent.Callback.STATUS_LOCATION_DISABLED -> "locationDisabled"
                    GnssMeasurementsEvent.Callback.STATUS_NOT_SUPPORTED -> "notSupported"
                    GnssMeasurementsEvent.Callback.STATUS_NOT_ALLOWED -> "notAllowed"
                    else -> "unknown"
                }
                emitStatus(statusName)
                if (status != GnssMeasurementsEvent.Callback.STATUS_READY) {
                    emitError("E_GNSS_STATUS", "GNSS measurements status changed to $statusName.")
                }
            }
        }
        measurementCallback = callback

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                // Executor overload (API 31+): callbacks are delivered off the main thread.
                locationManager.registerGnssMeasurementsCallback(deliveryExecutor, callback)
            } else {
                // Plain overload (API 24-30) delivers on the Looper of the registering
                // thread, so registration must happen on the main looper.
                mainHandler.post {
                    try {
                        locationManager.registerGnssMeasurementsCallback(callback)
                    } catch (e: Exception) {
                        measurementCallback = null
                        Log.e(TAG, "registerGnssMeasurementsCallback failed", e)
                        emitError("E_REGISTRATION_FAILED", "Failed to register GNSS measurement callback: ${e.message}")
                        promise.reject("E_REGISTRATION_FAILED", "Failed to register GNSS measurement callback: ${e.message}", e)
                    }
                }
            }
            emitStatus("ready")
            promise.resolve(null)
        } catch (e: SecurityException) {
            measurementCallback = null
            val message = "ACCESS_FINE_LOCATION is required for raw GNSS measurements and was not granted (SecurityException). Request location permission in the app before calling AnchorGnss.start()."
            Log.e(TAG, message, e)
            emitError("E_PERMISSION", message)
            emitStatus("notAllowed")
            promise.reject("E_PERMISSION", message, e)
        } catch (e: Exception) {
            measurementCallback = null
            val message = "Failed to register GNSS measurement callback: ${e.message}"
            Log.e(TAG, message, e)
            emitError("E_REGISTRATION_FAILED", message)
            promise.reject("E_REGISTRATION_FAILED", message, e)
        }
    }

    private fun stopStreaming() {
        val callback = measurementCallback ?: return
        measurementCallback = null
        val locationManager = gnssLocationManager()
        try {
            if (locationManager != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    locationManager.unregisterGnssMeasurementsCallback(callback)
                } else {
                    mainHandler.post {
                        try {
                            locationManager.unregisterGnssMeasurementsCallback(callback)
                        } catch (e: Exception) {
                            Log.w(TAG, "unregisterGnssMeasurementsCallback failed", e)
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "unregisterGnssMeasurementsCallback failed", e)
        }
        emitStatus("stopped")
    }

    /**
     * Converts one GnssMeasurementsEvent into the JS payload:
     * every measurement with a positive C/N0 becomes
     * { svid, constellation, cn0DbHz }. Timestamp is epoch milliseconds computed
     * from the event's elapsedRealtimeNanos clock; the raw monotonic nanos are
     * forwarded when the platform exposes them (API 29+).
     */
    private fun buildMeasurementPayload(event: GnssMeasurementsEvent): Map<String, Any?> {
        val satellites = event.measurements
            .filter { it.cn0DbHz > 0.0 }
            .map { measurement ->
                mapOf<String, Any>(
                    "svid" to measurement.svid,
                    "constellation" to constellationName(measurement.constellationType),
                    "cn0DbHz" to measurement.cn0DbHz,
                )
            }

        val payload = HashMap<String, Any?>()
        payload["satellites"] = satellites
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val elapsedRealtimeNanos = event.clock.elapsedRealtimeNanos
            payload["elapsedRealtimeNanos"] = elapsedRealtimeNanos
            // Boot-clock to epoch offset sampled at send time; drift within one
            // event is nanoseconds and irrelevant at millisecond resolution.
            payload["timestamp"] =
                System.currentTimeMillis() - SystemClock.elapsedRealtime() + elapsedRealtimeNanos / 1_000_000L
        } else {
            payload["timestamp"] = System.currentTimeMillis()
        }
        return payload
    }
}
