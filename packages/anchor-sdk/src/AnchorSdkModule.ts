import { NativeModule, requireNativeModule } from 'expo';

declare class AnchorSdkModule extends NativeModule<{}> {}

export default requireNativeModule<AnchorSdkModule>('AnchorSdk');
