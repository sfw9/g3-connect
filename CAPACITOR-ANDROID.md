# Building the G3 Connect Android app (Capacitor)

The web app in `dist/` is the single source of truth. Capacitor wraps those exact files in a
native Android shell; on Android the BLE transport is a thin Web‑Bluetooth‑shaped shim
(`dist/ble-capacitor.js`) over `@capacitor-community/bluetooth-le`. Nothing above the transport
(`crypto.js`, `ninebot.js`, `profiles.js`, the UI) differs between web and Android.

> The existing native Java app (`android-bridge/`, appId `de.g3connect.maps`) is **not** replaced
> by this. It keeps the Google‑Maps turn‑by‑turn notification bridge. The Capacitor app uses a
> **different** appId (`de.g3connect.connect`) so both can be installed side by side.

> **Status: the debug APK now builds on this box.** The Android SDK is installed at
> `C:\Users\Admin\AppData\Local\Android\Sdk`, the vendor bundle and BLE permissions are wired in,
> and `app-debug.apk` is produced by `gradlew.bat :app:assembleDebug`. The steps below are the
> reproducible recipe; steps 1, 3, 4 and 5 are already done in-tree.

These steps run **on your machine**. This dev box has Node, Java 21 and the Android SDK.

## 0. Prerequisites

- **Node ≥ 20** and **npm** — already present.
- **JDK 21** — already present (Temurin 21).
- **Android SDK** — not present yet; installed in step 2.

## 1. Install the JS dependencies

```bash
npm install
```

This adds `@capacitor/core`, `@capacitor/cli`, `@capacitor/android` and
`@capacitor-community/bluetooth-le` (all declared in `package.json`).

> If `npm install` reports no matching version for any of these, align all four to the **same
> Capacitor major** (e.g. set them all to `^7.0.0`, or all to `^6.x`). The community BLE plugin
> tracks Capacitor's major version.

## 2. Android SDK (already installed)

The SDK is installed via Android Studio at `C:\Users\Admin\AppData\Local\Android\Sdk`. The build
finds it through `android/local.properties`:

```properties
sdk.dir=C:\\Users\\Admin\\AppData\\Local\\Android\\Sdk
```

Gradle also honours the `ANDROID_HOME` env var if you prefer:

```powershell
$env:ANDROID_HOME = "C:\Users\Admin\AppData\Local\Android\Sdk"
```

> **Platform note:** the only SDK platform installed here is a preview `android-37.0`, and there is
> no `cmdline-tools`/`sdkmanager`. That's fine — the project targets `compileSdk 34` and the Android
> Gradle Plugin **auto-downloads** the matching `platforms;android-34` + build-tools on first build
> (the SDK licence is already accepted). No manual `sdkmanager` step is needed.

## 3. Add the Android platform

```bash
npx cap add android      # or: npm run cap:add
```

This generates the `android/` Gradle project from `capacitor.config.json`.

## 4. Grant the BLE permissions

Edit `android/app/src/main/AndroidManifest.xml` and add, inside `<manifest>` (above
`<application>`):

```xml
<uses-permission android:name="android.permission.BLUETOOTH_SCAN"
    android:usesPermissionFlags="neverForLocation" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<!-- Only needed if you also target Android 11 or lower: -->
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"
    android:maxSdkVersion="30" />
<uses-feature android:name="android.hardware.bluetooth_le" android:required="true" />
```

`neverForLocation` matches the shim's `BleClient.initialize({ androidNeverForLocation: true })`,
so the app does not have to ask for location.

## 5. BLE plugin resolution (done — pre-bundled vendor file)

This app ships **plain ES modules with no bundler**, so the shim can't resolve a bare
`import('@capacitor-community/bluetooth-le')` in the WebView. The chosen fix (implemented in-tree):
pre-bundle **only** `BleClient` into a self-contained ESM, and have the shim import it by a
**relative** path.

- `build/vendor-entry.mjs` re-exports `BleClient` from the plugin.
- `npm run build:vendor` bundles it to `dist/vendor/bluetooth-le.js` (esbuild, ~51 KB, ESM).
  This step runs automatically as part of `npm run cap:sync` / `cap:copy`.
- `dist/ble-capacitor.js` loads it lazily via `import('./vendor/bluetooth-le.js?v=1')`.

> The web deployment stays bundler-free and never fetches the vendor file: in a browser
> `runtimeBluetooth()` returns native Web Bluetooth, so the dynamic import is never reached. The
> `_injectBleClient` seam still exists purely for the unit test (`tests/ble-capacitor.test.mjs`).

## 6. Sync and build

```bash
npm run cap:sync        # builds the vendor bundle, then copies dist/ + plugins into android/
cd android
# Windows:
gradlew.bat :app:assembleDebug
# macOS / Linux:
./gradlew :app:assembleDebug
```

> Use `npm run cap:sync` (not bare `npx cap sync`) so the vendor bundle is rebuilt first. If you
> edit anything under `dist/`, re-run `npm run cap:copy` before building.

The debug APK lands at `android/app/build/outputs/apk/debug/app-debug.apk` (~17 MB).

## 7. Install and run

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

On first connect, Android prompts for the Nearby devices (Bluetooth) permission. After granting,
the connect flow is byte‑for‑byte the same protocol as the web app.

---

### Safety note (unchanged by this work)

The Capacitor migration swaps **only** the BLE transport. It does **not** change the profile
write protocol in `dist/profiles.js` or touch any VCU firmware. Keep the existing rules: never
flash unverified firmware, always keep a stock recovery image, and follow the documented flash
order.
