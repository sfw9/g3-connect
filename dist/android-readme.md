# G3 Connect for Android

Native app for the Ninebot MAX G3. It connects over Bluetooth, shows Google Maps navigation on the scooter's display and uploads custom sounds. No Google API key, no Chrome, no internet permission.

Version 1.1 · Android 8 or newer · APK: [`dist/g3-connect.apk`](../dist/g3-connect.apk)

## Features

- **Navigation:** reads the Google Maps notification on the phone and sends arrow, distance, street and remaining time to the display. Starts and stops automatically.
- **Manual sending:** send your own direction, street and distance to the display, once or every second, also without Maps.
- **Settings:** acceleration in sport mode (level 1–3) and range display. Every value is read back.
- **Custom sounds:**
  - upload an audio file (MP3, M4A, OGG, WAV …) or a test tone for the custom button (slot 71), alarm (72), power on (73) or a slot of your choice
  - switch each event between custom sound and built-in tone
  - assign one of the eight actions to the custom button; an upload for the button sets it to "play custom sound" automatically
  - play all sound numbers one after another
- **Pairing key:** "Pairing-Schlüssel anzeigen" shows the key the app created when pairing, to copy it into the web app or keep a backup.
- **Log** to copy, and a **Maps diagnostic** for missing arrows.

## Setup

1. Install the APK. Coming from G3 Connect Beta or G3 Maps Bridge, **uninstall it first**: since 1.0 the app has a new signature. 1.0 updates to 1.1 normally.
2. Open the app, allow the Bluetooth permission and notification access. On Android 13+ you may first need "Allow restricted settings" in the app info.
3. Search for the scooter, connect and briefly press the **Power button** when asked. The pairing is saved.
4. For navigation, leave Maps automation on ("Google Maps automatisch am G3 starten / beenden") and start a route in Google Maps. Wait for the first arrow before riding.

Tip: exclude G3 Connect from battery optimisation so Android does not end the connection while riding.

## Good to know

- Settings and sounds can only be changed while standing still and only on the MAX G3. Other models (e.g. F3) are read-only.
- If Maps gives no total remaining distance, the display shows 1337 km as a placeholder.
- Unrecognised Maps instructions stop the transmission instead of showing a wrong arrow.
- After a connection loss the app does not reconnect by itself.
- Pairing keys stay in private app storage and are not backed up. Anyone with the key can connect to your scooter, so keep a copied key private.
- How the sound upload works: [sound-upload-analysis-en.md](../dist/sound-upload-analysis-en.md).

## Build and test

Requires Python 3.11+, Java 21 and keytool:

```sh
python3 android-bridge/bootstrap.py /path/to/android-tools
python3 android-bridge/build.py /path/to/android-tools
python3 android-bridge/test.py /path/to/android-tools
```

`bootstrap.py` downloads Android SDK 35, ECJ and TensorFlow Lite and checks their SHA-256 hashes (`dependencies.json`). No Gradle needed. The first build creates the signing key in the tools folder (`g3-signing.jks`). Keep it: later updates must be signed with the same key, or users have to uninstall first.

The host tests check encryption, pairing, settings, Maps handling and the sound upload against a simulated scooter.

## Licences

Arrow recognition: OpenDash / KTM-Nav-GEN3 (MIT). TensorFlow Lite (Apache 2.0). Full texts in `licenses/` and inside the APK.
