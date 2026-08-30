import { TextDecoder, TextEncoder } from 'node:util';

// expo's winter runtime (pulled in by expo-router's useRouter) installs a URL
// implementation that needs WHATWG encoding globals, absent in jsdom.
if (typeof globalThis.TextEncoder === 'undefined') {
  Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder });
}
if (typeof globalThis.TextDecoder === 'undefined') {
  Object.defineProperty(globalThis, 'TextDecoder', { value: TextDecoder });
}

 import './src/__tests__/__testboundaries__/nativeBoundaries';
