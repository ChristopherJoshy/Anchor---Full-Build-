import { NativeModule, requireNativeModule } from 'expo';

/**
 * JS contract for the AnchorNet native module (android/.../AnchorNetModule.kt).
 * Exposes real OS-level network-integrity signals — no synthesized values.
 */
declare class AnchorNetNativeModule extends NativeModule<Record<string, never>> {
  /**
   * True when a VPN tunnel is up on this device: a tun/tap network interface
   * exists, or the active network reports the TRANSPORT_VPN capability.
   */
  isVpnActive(): boolean;
}

/**
 * Network-integrity signals. Android-only (see expo-module.config.json);
 * on other platforms requireNativeModule throws because the module is absent.
 */
export default requireNativeModule<AnchorNetNativeModule>('AnchorNet');
