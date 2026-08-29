import { registerWebModule, NativeModule } from 'expo';

// AnchorSdkModule is not available on the web platform.
class AnchorSdkModule extends NativeModule<{}> {}

export default registerWebModule(AnchorSdkModule, 'AnchorSdkModule');
