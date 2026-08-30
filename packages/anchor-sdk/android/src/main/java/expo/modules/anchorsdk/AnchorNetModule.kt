package expo.modules.anchorsdk

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.NetworkInterface

/**
 * AnchorNet — real network-integrity signals for the demo cross-checks.
 *
 * isVpnActive(): true when a VPN tunnel is up on this device. Two independent
 * probes, either is sufficient:
 *  1. A tun/tap network interface exists (kernel-level VPN tunnel).
 *  2. The active network reports TRANSPORT_VPN (ConnectivityManager).
 *
 * This is the same signal family commercial anti-fraud SDKs use; it is read
 * from the OS, never synthesized.
 */
class AnchorNetModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("AnchorNet")

        Function("isVpnActive") {
            val context = appContext.reactContext

            // Probe 1: kernel tunnel interfaces (tunN/tapN — any VPN implementation).
            // Numbered match only: the kernel's always-present IPIP device
            // "tunl0" shares the prefix but is not a user VPN.
            try {
                val tunRegex = Regex("^tun[0-9]+$")
                val tapRegex = Regex("^tap[0-9]+$")
                val interfaces = NetworkInterface.getNetworkInterfaces()
                while (interfaces.hasMoreElements()) {
                    val name = interfaces.nextElement().name.lowercase()
                    if (tunRegex.containsMatchIn(name) || tapRegex.containsMatchIn(name)) {
                        return@Function true
                    }
                }
            } catch (_: Exception) {
                // Interface enumeration denied — fall through to transport probe.
            }

            if (context != null) {
                try {
                    val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                    if (cm != null) {
                        // Any network carrying TRANSPORT_VPN counts — not just the
                        // default: split-tunnel VPNs leave the default network
                        // un-capped while the VPN network exists.
                        for (network in cm.allNetworks) {
                            val caps = cm.getNetworkCapabilities(network)
                            if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) {
                                return@Function true
                            }
                        }
                    }
                } catch (_: Exception) {
                    // Connectivity service unavailable.
                }
            }

            false
        }
    }
}
