# G3 Connect · native Android beta 16

One installed app connects to the MAX G3 over Bluetooth, pairs through the physical Power button, reads Google Maps navigation notifications locally and forwards guidance directly to the scooter's TFT. Start navigation in the normal Google Maps Android app; G3 Connect starts/stops the display automatically while connected. No API key, Chrome, web view, loopback server or second bridge app is needed. This evolves the previous companion with the same package/signing identity; it can update G3 Maps Bridge in place.

## Setup

1. Install `g3-connect.apk` on Android 8 or newer and open G3 Connect.
2. Grant Notification access and Bluetooth permission. Android 8–11 also requires location permission and the system Location switch for BLE discovery. Android 12+ uses Nearby devices. Android 13+ optionally shows the ongoing connection notification after notification permission is granted; the connection service is still listed in Android's active apps when notifications are denied.
3. Search for the scooter, select it and briefly press Power when requested. The full advertised name is used privately to derive the initial handshake key. New keys are only stored after physical confirmation **and** successful authentication. Keys are private app preferences, excluded from backup and logs. A rejected remembered key gets one new GATT connection/challenge before Power pairing. Use “Neu koppeln” to force a fresh key.
4. Leave Maps automation enabled, then start a route in the existing Google Maps app. Connect and wait for the first TFT arrow before riding. The app needs a live Bluetooth connection for the ride; it does not reconnect after a killed process/reboot. Start it and connect again if Android has stopped it.
5. Stopping Maps navigation removes its ongoing guidance notification and stops TFT navigation after a short removal/repost debounce. Turning off automation also stops it. The connection notification includes a Disconnect action.

For sideloaded apps, Android 13+ may require **App info → Allow restricted settings** before allowing notification access. Menu names depend on the phone. If the manufacturer kills the service, allow background operation / remove battery restrictions in system settings. This app starts its connected-device foreground service while the activity is visible, keeps it running while Maps is in front and holds a timed partial wake lock while transmitting. It does not silently launch a new connection from a background notification. A connection must be established before the ride.

“Displaytest” sends a synthetic left arrow / 100 m once per second for 15 seconds, then stops; do it while stationary. “Navigation stoppen / Automatik aus” cancels the test or live navigation. Acceleration levels 1–3 and range display preference use the same read/write/ACK/readback behavior as the existing website, with a stationary check.

## Verification and limits

**Native Bluetooth authentication and notification capture are now confirmed by the user’s Android 16 logs.** The new Beta 15 departure/parser and image-processing fixes pass host tests; their actual TFT display result still needs verification on the user’s phone/scooter. No local Android device or emulator is available here. The user confirmed the website's SimpleNavi start/stop and display packets on their actual G3. That confirms the wire format, not this app's Android behavior or Google Maps recognition. Real GATT callbacks, notification formats, model predictions, background execution and screen locking still need testing on the user's phone.

Only Google Maps (`com.google.android.apps.maps`) is inspected; every other package returns before extras are read. Android's Notification access permission nevertheless technically covers all apps. Route text stays in memory and is shown only in the app; no notification contents or street names enter the connection log. The manifest requests **no Internet permission**, and there is no local server. Uninstalling or clearing app data deletes saved scooter keys.

The parser accepts combined instructions such as `350 m · Turn right onto Aggerstraße`, as well as a distance title with a separate instruction text. It checks title, big title, text, big text and text lines. Explicit supported English/German turn commands provide the direction directly; a street name alone never does. Otherwise the existing local icon classifier with score >= 0.90 is used. A model score is not a guarantee of the correct arrow. Subtitle, summary and info text are checked independently for remaining route distance and relative duration; an ETA-only subtitle no longer hides a usable route summary in another field. When no relative duration is supplied, an explicitly labeled arrival clock such as `Arrive 21:34` is converted to an approximate remaining duration by subtracting the phone’s current time in its local time zone. An arrival clock is never treated as an arrived maneuver and supplies no distance. Unsupported formats remain unknown. Unknown/invalid guidance, missing notification, disabled listener or observations older than 6 seconds stop TFT streaming. The listener rechecks current active notifications every second, so a valid persistent notification with unchanged text is usable without inventing freshness or requiring Maps to repost continuously. Once guidance returns the app can restart the informational TFT navigation without requiring the scooter to stop. An incomplete instruction does not reuse the previous turn. Some Maps versions or languages may not provide enough fields and will need parser adjustments using a concrete observed example. Distances with an ambiguous three-digit fraction are rejected.

Live navigation start and repeated guidance only write informational TFT commands and work while moving. The synthetic display test and motor/range settings still require a stationary speed-register check. Bluetooth loss stops transmission; a TFT stop cannot be confirmed after the radio link is already gone. Reconnect and restart explicitly. Only Encryption2 / Nordic UART (the transport shown in this G3's logs) is supported in this beta. A negotiated MTU >= 34 is required; packets are not arbitrarily fragmented.

### Beta 12–13: the supplied Maps notification

The user's screenshot shows `350 m · Turn right onto Aggerstraße` and `Arrive 21:34`. The pure parser's regression fixture recognizes right / 350 m / Aggerstraße from that text, including line breaks. The image is not bundled and is not used as proof of actual Android extras or of the icon model's behavior.

**Beta 14 uses the user-requested fixed 1337 km placeholder when route distance is absent.** The received route distance stays unknown in diagnostics, while the generated TFT sample uses exactly 1,337,000 meters for remaining and total route distance. This allows the supplied real notification (right / 350 m / arrival-derived duration) to start streaming. UI and diagnostics identify the placeholder. Real route distance supplied by Maps takes precedence. Turn distance and direction stay real; the 1337 km value is not a route estimate or a TFT hide-value sentinel.

Use **Maps-Diagnose kopieren** while the Maps notification is active to inspect what Android actually exposes. The local report contains only selected Google Maps text fields, capture time, presence of large icon/custom layout, classifier result, parsed fields and display eligibility. It intentionally includes navigation text and street names, so the app tells the user before they share it. The report is memory-only, copied only on button press, not uploaded or added to the connection log. No other apps, PendingIntents, arbitrary Bundle values, device identifiers or scooter keys are included. An ongoing Maps notification with no recognized instruction can still produce a diagnostic report without triggering navigation.

### Arrival-time estimate in Beta 13

An explicit relative duration always takes priority. Otherwise the parser recognizes labeled English/German ETA clocks in 24-hour or AM/PM format and subtracts the current phone time using the phone’s local time zone. It reevaluates the ETA during every notification poll, so the estimate counts down even without a notification repost. UI labels it `ca.`; the diagnostic reports `remainingSecondsSource: arrivalClockEstimate` and the phone time-zone ID.

The supplied real diagnostic epoch `1792092992422` is 2026-10-15 21:36:32.422 in Europe/Berlin; `Arrive 21:44` gives 448 estimated remaining seconds, approximately eight minutes. The minute-resolution arrival display limits precision. A clock in the current minute is approximately zero; a plausible arrival after midnight uses the next local calendar day. Estimates over 12 hours are rejected because no date is supplied: this prevents a one-minute-expired ETA from becoming a 23-hour-59-minute journey. Invalid or nonexistent local times remain unknown. Neither zero estimated minutes nor an ETA causes an arrived maneuver by itself. No route distance is inferred from travel time.

### Fixed route-distance placeholder in Beta 14

The user explicitly requested 1337 km in place of absent route distance. Both the 4-byte total-distance command and the 18-byte guidance remaining-distance field carry 1,337,000 meters. Parsed `remainingMeters` stays null; diagnostics additionally report `displayRemainingMeters` and `displayRemainingSource` (`fixed1337kmPlaceholder` or `maps`). The UI says `1337 km (Platzhalter)`. A later real Maps distance replaces the placeholder without inheriting a 1337 km route total. Real route progress survives a temporary return to the placeholder.

Missing time, unknown direction, unrecognizable instruction, stale samples, lost notification access and Bluetooth failures still stop/deny streaming. Beta 15 additionally recognizes explicit immediate instructions without a meter prefix, as described below. No speed-based distance estimate is introduced. Host tests cover the supplied real notification through encrypted simulated TFT writes, correct kilometer-to-meter conversion, preserved right / 350 m fields, placeholder-to-real transitions and remaining guards. The scooter's display formatting of the large placeholder still needs a hardware check; the test verifies transmitted bytes, not the real display's visual result.

### Departure and dark icons in Beta 15

The supplied real Android 16 diagnostic is `Head towards Alfred-Delp-Straße` with `Arrive 21:55`, no distance, and a rejected image-model score of 0.04029575. The parser now recognizes this as a **departure instruction**: Ninebot forward/start icon 9, target street, step distance 0 meaning “now”, ETA-derived duration and the requested 1337 km route placeholder. It does not require image inference to recognize this text. German departures, cardinal headings, continuing onto a named road and explicit turns without a meter prefix are also supported. A later numeric turn replaces zero with the actual distance. A street name alone still cannot create a direction. Diagnostics label `stepSource: immediateInstruction` and `directionSource: departureInstruction` where applicable; zero is not claimed to be a measured distance.

The prior icon renderer composited black glyphs on black, which can erase them. The model’s documented training preprocessing uses a white alpha mask on black. The new code draws onto a transparent bitmap first and normalizes black/white transparent glyphs through alpha, or opaque light/dark backgrounds through foreground contrast, before producing RGB input. Blank/near-solid inputs are rejected before inference; the confidence threshold stays 0.90. Diagnostics expose only normalization mode and foreground pixel count, not the image. Pure tests verify equivalent model input for black/white transparent glyphs and opaque light/dark variants. Real-phone classification accuracy is not established by these synthetic tests.

Live TFT start no longer performs a stationary check, so a resumed instruction does not drop the connection merely because the scooter is moving. It writes TFT commands only. Manual synthetic tests and settings retain their stationary checks. Regression tests run the actual departure diagnostic through encryption against a moving simulated scooter, then a right turn at 350 m, and finally notification removal/confirmed stop.

### Manual sender in Beta 16

Use **Manuell senden / Dauersenden …** after connecting to the scooter. This mode works without Google Maps or Notification access. The form lets the user choose forward, left/right, slight/sharp turns, U-turn, roundabouts or arrival, plus street, meters to the turn, remaining minutes and route kilometers. A separate send duration is in seconds; `0` means until Stop. Decimal comma/dot input is supported for route kilometers and remaining minutes. Values are validated before the current display mode is changed.

**Dauersenden** repeats the complete selected TFT dataset at most once per second. **Einmal** starts navigation and sends one dataset; it does not repeat. In both cases the chosen send duration optionally stops TFT navigation automatically. Without a send-duration limit a one-shot leaves the display session open until stopped; the TFT firmware may impose its own inactivity behavior. The entered remaining time stays fixed by default; **Restfahrzeit herunterzählen** optionally counts it down without going negative. Turn distance, route distance and street stay fixed as configured. For manual display data the chosen street is supplied as both current and next road; Maps retains its existing unknown-current-road behavior. The dialog remembers last valid form inputs in private app preferences; it never restarts transmission on app launch.

**Manuelles Senden stoppen** cancels manual sending and sends the confirmed TFT stop. The existing global navigation Stop and Bluetooth Disconnect also terminate it. Starting manual mode pauses Maps automation; Maps notifications cannot overwrite the selected manual dataset. To return to Maps, enable its checkbox: the manual session stops before Maps takes over. Starting the stationary display test replaces manual mode after its stationary check.

Runtime uses Android’s monotonic elapsed clock, independent of local time changes. The existing connected-device foreground service and wake lock keep repeating while the UI is in the background. No background auto-reconnect/restart is added. When the timer ends or the user stops, the manual configuration is cleared and later ticks produce no more manual writes. A lost BLE link stops the service; a stop ACK cannot be obtained after radio loss. Mode changes and all GATT operations use the same serialized worker.

Tests verify unit conversion and validation, continuous/one-shot behavior, fixed versus countdown time, explicit/timed stop, no duplicate before one second, indefinite mode, phone wall-clock changes, switching back to Maps, and the exact configured street/numeric fields through encrypted simulated scooter writes. Real Android dialog interaction and the new mode’s visual TFT result still need testing on the user’s device.

## Build and tests

Requires Python 3.11+, Java 21 runtime and keytool. SDK/ECJ/TensorFlow downloads are pinned by SHA-256 in `dependencies.json`.

```sh
python3 android-bridge/bootstrap.py /tmp/g3-android-tools
python3 android-bridge/build.py /tmp/g3-android-tools
python3 android-bridge/test.py /tmp/g3-android-tools
npm test
```

Run from the full G3 Connect repository. Output: `dist/g3-connect.apk`. Target SDK 35, minimum 26. No Gradle/javac is required: ECJ compiles Java 8 and D8 desugars it. Build artifacts and the beta signing key live in the external tools directory, not the source ZIP. The key is reused for subsequent builds; a local rebuild with a different key needs the earlier app uninstalled first. The APK's cryptographic signature is verified by the build script; this beta is not a Play Store release.

Host tests execute the same pure Java classes shipped in the APK. They verify independent Python Encryption2 vectors, MAC/replay rejection, counter sharing, buffering, an encrypted simulated scooter, physical Power confirmation, key reuse, stationary settings guards, readback, exact one-byte navigation start/stop, the 18-byte information payload, UTF-8 truncation and Maps lifecycle behavior including missing/uncertain guidance and failed start ACK. Android platform callbacks and the image model itself are not mocked as proof of real phone behavior.

## Protocol and model provenance

- The existing G3 Connect protocol implementation and independent Python golden vectors were ported to native Java; no manufacturer app code is bundled. The source repository's `tests/vectors.json` is required for host tests; use the full source download to run them.
- Official G3 config and offline APK analysis established **board 0x23 / command 0x71 / index 0 / payload `[1]` start and `[0]` stop** (one byte each). The user confirmed visible navigation with these packets. Other fields: index 1 unsigned 32-bit total meters, index 0x10 current road (unknown → empty), index 0x24 instruction road, index 3 18-byte little-endian guidance. Navigation does not write motor/firmware settings.
- [NinebotEnhance](https://github.com/Margele/NinebotEnhance): independent navigation packet reference. [Android Bluetooth background guidance](https://developer.android.com/develop/connectivity/bluetooth/ble/background) documents the connected-device foreground service approach.
- [OpenDash / KTM-Nav-GEN3](https://github.com/Pavanayi1/KTM-Nav-GEN3), MIT: bundled classifier, labels, training/preprocessing reference. No KTM Bluetooth protocol is used. Model class labels are translated by meaning into Ninebot icons, never passed through as IDs.
- Model SHA-256: `381ee97edf5e7fb537ece6e34361114cdf6cac405c3025f655e9b98751fd507b`; float32 input `[1,96,96,3]`, output `[1,30]`. Re-training requires the upstream dataset and ML dependencies, not the Android build.
- TensorFlow Lite / Lite API 2.14.0, Apache 2.0. License texts are in `licenses/` and embedded in the APK. JSON-java is used only by host tests; it is not packaged as a runtime dependency.

## Beta 17: neue Oberfläche

Die Android-App ist neu gestaltet; Bluetooth-, Kopplungs- und Navigationslogik sind unverändert.

- Kopfzeile mit Verbindungsstatus (Offline, Verbindet, Koppeln, Verbunden, Navigation, Fehler). Während der Kopplung erscheint „Jetzt Power-Taste kurz drücken“ deutlich hervorgehoben.
- Ein Hauptknopf je nach Zustand: Roller suchen, Mit letztem Roller verbinden, Abbrechen oder Verbindung trennen. Gefundene Roller erscheinen als Liste mit Signalstärke.
- Einrichtungs-Checkliste: Bluetooth-Berechtigung, Benachrichtigungszugriff und (empfohlen) Akkuoptimierung, jeweils mit Haken oder direktem Knopf zur Einstellung.
- Navigationskarte mit gezeichnetem Abbiegepfeil, Entfernung bis zum Abbiegen, Straße, Reststrecke und Restzeit des aktuellen Maps-Hinweises.
- Beschleunigung (Stufe 1–3) und Reichweitenanzeige (Ein/Aus) als Auswahlknöpfe. Nach dem Verbinden liest die App beide Werte einmal aus und markiert den bestätigten Wert; Fehler erscheinen direkt unter den Knöpfen.
- Kompaktes Protokoll (letzte Einträge, auf Wunsch alles), Hell-/Dunkelmodus nach Systemeinstellung, eigenes App-Symbol (adaptiv, auch als Themen-Symbol).

`build.py` kompiliert dafür zusätzlich den Ordner `res/` mit `aapt2 compile`. Version: `0.8-beta17` (versionCode 8).
