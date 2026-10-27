# G3 Connect

Control your Ninebot MAX G3 over Bluetooth, without the Segway app or account. It has two parts:

- **Web app** (`dist/`): runs in Chrome or Edge, no install needed.
- **Android app** (`android-bridge/`): native app that also shows Google Maps navigation on the scooter display.

The app UI is in German. Also finds the F3 Pro D / F3 D (same display), where settings are read-only.

## Features

| | Web | Android |
| --- | :---: | :---: |
| Pair with the Power button, encrypted connection (Encryption2) | ✓ | ✓ |
| Sport acceleration level 1–3, range display on/off | ✓ | ✓ |
| Navigation arrows on the display | own route search | from Google Maps |
| Send test values / manual navigation to the display | ✓ | ✓ |
| Custom sounds: upload, custom/built-in toggle, button action, play all | ✓ | ✓ |
| Record all sounds with the microphone (dumper) | ✓ | |
| Read and configure AA03 CFW profiles and unlock sequence | ✓ | |
| Logger and diagnostics export | ✓ | ✓ |

## Quick start

**Web app.** Open the deployed site in Chrome or Edge (Android, Windows, macOS, Linux). Web Bluetooth needs HTTPS; Safari/iOS and Firefox do not support it. To run it locally:

```sh
python3 -m http.server 8080 --directory dist
```

Then open `http://localhost:8080` on the same computer.

1. Switch the scooter on and close the Segway app completely.
2. Click "Verbinden" and pick your scooter.
3. When asked, briefly press the scooter's **Power button**. The app creates a new pairing key and can remember it in this browser.

**Android app.** Download the APK from the web app's "Android" tab or use [`dist/g3-connect.apk`](g3-connect.apk). Setup and details: [android-bridge/README.md](android-readme.md).

## Custom sounds

Upload any audio file (cut to 4 s, converted to 8 kHz mono WAV) to these slots:

| Event | Slot | Bit in register `0x1F` |
| --- | --- | --- |
| Custom button | 71 | `0x1000` |
| Abnormality alarm | 72 | `0x2000` |
| Power on | 73 | `0x4000` |

The custom button only plays its sound when its action is set to 8 ("play custom sound"). An upload for the button sets this automatically. How it works: [sound-upload-analysis-en.md](sound-upload-analysis-en.md) (German original: [sound-upload-analysis.md](sound-upload-analysis.md)).

## CFW profiles

The web app's **Profile** tab supports the reconstructed AA03 interface in the separate Compat 1.6.2/lizenzcode port. Connect normally, read both blocks first, edit the normal/tuning Sport limits (the G3 has no Race mode, so the Race byte is read-only and written back unchanged; Sport has a 15 km/h floor), underglow, front light bar, cruise control, panic button, beep, and physical unlock sequence, then use **Schreiben + prüfen** while stationary. Re-read after a normal restart to confirm persistence. Exact fields, event IDs, frames, and test boundaries: [profiles-protocol.md](profiles-protocol.md).

## Safety and limits

- Settings and sounds are only written while the scooter stands still, only on the MAX G3, and every write is checked by reading it back.
- No firmware updates, region changes, or motor-current changes. Profile speed-limit writes are exposed only when the VCU answers the F1/F2 profile protocol with valid AA03-layout blocks; the advertised version word is not the gate (the CFW firmware reports a stock-looking version for stealth). Devices whose profile blocks do not decode are read-only.
- Which acceleration level means "eco", "standard" or "max" is not confirmed, so the app shows plain numbers.
- Pairing keys are created and stored on your device only. A downloaded key file is sensitive.
- Pairing with the Power button can replace the key the scooter used before. Newer firmware may reject the protocol.
- Route search in the web app uses external map services. Scooter communication never leaves your device.

## Repository

| Path | Contents |
| --- | --- |
| `dist/` | The web app (static files, this is what gets deployed), the APK and the analysis documents |
| `android-bridge/` | Android app source, build and test scripts |
| `tests/` | Node tests for the web app and shared crypto test vectors |

Analysis documents in `dist/`: [range display](range-display-analysis.md), [navigation](navigation-analysis.md), [custom sounds](sound-upload-analysis-en.md), [CFW profiles](profiles-protocol.md).

## Development

```sh
npm test                                              # web app tests (Node 20+)
python3 android-bridge/bootstrap.py /path/to/tools    # Android toolchain, hash-checked
python3 android-bridge/build.py /path/to/tools        # builds dist/g3-connect.apk
python3 android-bridge/test.py /path/to/tools         # Android host tests
```

The tests use an encrypted simulated scooter. Real Bluetooth and firmware behaviour can only be checked on hardware.

**Deploying:** import the repo into Vercel without changing any settings. `vercel.json` publishes `dist/`, runs `npm test` as the build (a failing test blocks the deploy) and serves the APK with the right content type.

## Sources

- [segway-ninebot-ble](https://codeberg.org/NootNooot/segway-ninebot-ble): G3 command table and [Encryption2 documentation](https://nootnooot.codeberg.page/segway-ninebot-ble/encryption/)
- [segMod x3regs.h](https://github.com/MacintoshKeyboardHacking/segMod/blob/main/myBLE4/x3regs.h): acceleration register
- [Ninebot-BLE-MQTT-Bridge](https://github.com/Euphonique/Ninebot-BLE-MQTT-Bridge), [NinebotCrypto](https://github.com/scooterhacking/NinebotCrypto), [ha-ninebot](https://github.com/BobMcGlobus/ha-ninebot): crypto reference vectors and handshake details
- Arrow recognition model in the Android app: OpenDash / KTM-Nav-GEN3 (MIT), TensorFlow Lite (Apache 2.0)
