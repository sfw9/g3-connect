// Picks the BLE transport for the current runtime. In a browser this is the native Web
// Bluetooth object; under Capacitor (the Android wrapper) it is a Web-Bluetooth-shaped shim
// over the native plugin. Nothing above this line (ninebot.js, crypto.js, profiles.js, the UI)
// knows which one it got — they only ever see the Web Bluetooth GATT API.
import {capacitorBluetooth} from './ble-capacitor.js?v=3';

export function isCapacitor(){return !!globalThis.Capacitor?.isNativePlatform?.();}

// Web Bluetooth in a browser, the Capacitor shim in the native app. May be undefined on a
// browser without Web Bluetooth; callers already treat that as "not supported".
export function runtimeBluetooth(){return isCapacitor()?capacitorBluetooth:globalThis.navigator?.bluetooth;}
