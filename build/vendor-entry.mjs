// esbuild entry: bundle only what the Capacitor BLE shim needs from the community plugin
// into a single self-contained ESM (dist/vendor/bluetooth-le.js). See package.json
// "build:vendor". The web deployment never imports this (runtimeBluetooth() returns native
// Web Bluetooth in a browser); only the Android WebView loads it, via a relative dynamic
// import in dist/ble-capacitor.js.
export { BleClient } from '@capacitor-community/bluetooth-le';
