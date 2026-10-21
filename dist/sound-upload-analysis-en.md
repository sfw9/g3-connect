# Ninebot MAX G3: Uploading Custom Sounds

How the official Segway/Ninebot app puts custom sounds on the MAX G3, and how G3 Connect does the same over Bluetooth.

Based on (details in [Sources](#8-sources-and-how-this-was-found)):

- a static analysis of the Segway app (`cn.ninebot.ninebot` 6.10.12) and its G3 device package,
- a fully decrypted Bluetooth capture of the Segway app uploading sounds,
- the Segway server's sound settings for a MAX G3,
- tests with G3 Connect on a real scooter.

German version: [sound-upload-analysis.md](sound-upload-analysis.md).

## 1. Summary

- Custom sounds are uploaded straight to the scooter's **VCU** (board `0x16`) over the normal authenticated Bluetooth connection. No firmware update, file signature or restart is involved.
- The audio is **8 kHz, 16-bit, mono WAV** with an extra **12-byte header** in front.
- The transfer uses three commands: **`0x76`** (announce), **`0x77`** (data, 128-byte chunks), **`0x78`** (finish with checksum).
- Each sound event has a fixed **slot number** and an **on/off bit** in register `0x1F`:

| Event | Slot | Bit in `0x1F` | Built-in tone no. | Status |
| --- | --- | --- | --- | --- |
| Custom button | **71** (`0x47`) | `0x1000` | 8 | Upload confirmed by capture |
| Abnormality alarm | **72** (`0x48`) | `0x2000` | 14 | From server only, not tested yet |
| Power on | **73** (`0x49`) | `0x4000` | 31 | **Works**, tested with G3 Connect |

- The server reports **no slot for a power-off sound**.
- The custom button only plays the sound if its **action** is set to "custom sound" (register `0x4A` = 8). Uploading a sound does not change the action.

## 2. Step by step

You need an authenticated session (Encryption2 over Nordic UART, as G3 Connect already uses), and the scooter must be standing still.

### 2.1 Prepare the audio

1. Convert to **8000 Hz, 16-bit PCM, 1 channel**, saved as a normal WAV file (44-byte RIFF header).
2. Keep it short. The Segway app cuts to **4 seconds** by default; the capture shows a 3.9 s clip being accepted. The real firmware limit is unknown.
3. Put this 12-byte header in front of the complete WAV file (all values little endian):

| Offset | Size | Value |
| --- | --- | --- |
| 0 | 4 | `12` (header length) |
| 4 | 4 | WAV length + 12 (total upload length) |
| 8 | 2 | `8000` (sample rate) |
| 10 | 1 | `16` (bits per sample) |
| 11 | 1 | `1` (channels) |

```python
payload = struct.pack("<IIHBB", 12, len(wav) + 12, 8000, 16, 1) + wav
```

Everything below (length, chunks, checksum) refers to this `payload`, header included. Sending an MP3 or a plain WAV without the header is not what the app does.

### 2.2 Switch the event's custom sound off

Read register `0x1F`, clear the event's bit (e.g. `0x1000` for the button) and write it back (write command `0x03`), then read it again to confirm. Leave all other bits as they are.

The Segway app does exactly this in the capture: `0x1000` → `0x0000` before the upload.

### 2.3 Announce the file: command `0x76`

| Field | Value |
| --- | --- |
| Target | VCU `0x16` |
| Command | `0x76` |
| Index | **slot number** (e.g. `0x47`) |
| Data | upload length as 4 bytes LE, then `01` |

The scooter replies with `0x76`. In replies to the file commands, the **index field is a status code** (0 = OK, see [section 4](#4-status-codes)). The data tells you how to send:

- **Extended reply** (seen on the G3): 1 byte protocol version, 2 bytes packets per group, 4 bytes last packet already stored (`-1` = none), 4 bytes pause in ms.
  The capture shows `01 20 00 FF FF FF FF 1E 00 00 00` = version 1, **32 packets per group**, nothing stored yet, **30 ms pause**.
- **Old reply:** first 2 bytes = `64`, next 2 bytes = pause in ms.
- A pause of exactly 5000 ms is treated as 0 by the app.
- With protocol version 1 and a last stored packet ≥ 0, the app resumes after that packet.

### 2.4 Send the data: command `0x77`

1. Split the payload into **128-byte chunks**. The last chunk is just the rest; it is **not padded**.
2. Send them in groups (32 per group on the G3). The **index is the packet's position inside its group** (0…31), not the absolute packet number.
3. Packets inside a group are sent **without waiting for a reply**; wait the announced pause between them.
4. Only the **last packet of each group** (and the very last packet) gets a reply. Check its status:
   - `0` = OK, continue.
   - `2` = index error: the app restarts from the last confirmed packet + 1 (up to 10 times without progress).
   - anything else: stop.
5. If no reply arrives, the app retries up to 5 times (100 ms apart, 10 s timeout).

Wire size: 128 bytes of file data become 141 bytes encrypted, so one BLE write needs an MTU of at least 144.

### 2.5 Finish: command `0x78`

| Field | Value |
| --- | --- |
| Command | `0x78` |
| Index | **0** |
| Data | checksum, 4 bytes LE |

The checksum is **not a CRC32**. Add up all payload bytes as a 32-bit number, then invert all bits:

```python
checksum = (~sum(payload)) & 0xFFFFFFFF
```

The scooter replies with status 0 and echoes the checksum.

### 2.6 Switch the custom sound back on

Set the event's bit in `0x1F` again and confirm by reading it back. The capture shows `0x0000` → `0x1000`.

### 2.7 Custom button only: set the button action

The button plays slot 71 only if its action is **8**. Register `0x4A` on the VCU holds the action as a 16-bit LE value (sound = `08 00`):

| Value | Action |
| --- | --- |
| 1 | Toggle park mode |
| 2 | Toggle hill hold |
| 3 | Toggle walk mode |
| 4 | Change regenerative braking level |
| 5 | Switch single/dual motor (no effect on the single-motor MAX G3) |
| 6 | Hazard lights |
| 7 | BOOST |
| 8 | **Play custom sound** |

The scooter can take a moment before a written value reads back. G3 Connect reads it up to 4 times, 100 ms apart.

## 3. Registers and commands at a glance

All on VCU `0x16`. "Register" means a normal read (`0x01`) / write (`0x03`) of a 16-bit value.

| What | Type | Number | Notes |
| --- | --- | --- | --- |
| Speed | register | `0x57` | must be 0 before uploading |
| Custom-sound bits (`rFunBool3`) | register | `0x1F` | one bit per event, see table in section 1 |
| Button action (`rCustomKey`) | register | `0x4A` | 1–8, see 2.7 |
| Volume (`rVoiceVolume`) | register | `0x76` | |
| Play a sound (`playSound`) | register | `0x77` | plays a tone by number; whether slot numbers play the custom sound is not confirmed |
| File announce | command | `0x76` | index = slot |
| File data | command | `0x77` | index = position in group |
| File finish | command | `0x78` | index = 0 |

Careful: register `0x76`/`0x77` and command `0x76`/`0x77` are different messages that share a number.

The "built-in tone numbers" (8, 14, 31) are **not** upload slots, and neither is button action 8. Built-in tones, slot numbers and button actions are three separate number ranges.

## 4. Status codes

In replies to `0x76`, `0x77` and `0x78`:

| Status | Meaning |
| --- | --- |
| 0 | OK |
| 1 | Error |
| 2 | Index error (wrong packet order) |
| 3 | Saving failed |

## 5. Worked examples

### One second of silence (calculated)

| Item | Value |
| --- | --- |
| WAV size | 16,044 bytes |
| Upload size incl. header | 16,056 bytes |
| Header | `0C 00 00 00 B8 3E 00 00 40 1F 10 01` |
| `0x76` data | `B8 3E 00 00 01` |
| Chunks | 126 (last one 56 bytes) |
| Checksum | `0xFFFFF651` → `0x78` data `51 F6 FF FF` |

### Real upload from the capture (Segway app, slot 71)

| Item | Value |
| --- | --- |
| Clip | 1.67 s, 26,756-byte WAV |
| Upload size | 26,768 bytes, header `0C 00 00 00 90 68 00 00 40 1F 10 01` |
| `0x76` | index `0x47`, data `90 68 00 00 01` |
| Reply | status 0, 32 packets per group, 30 ms pause |
| Data | 210 packets, last one 16 bytes; group replies after packets 31, 63, 95, 127, 159, 191, 209 |
| `0x78` | index 0, data `BF A9 D0 FF` (checksum `0xFFD0A9BF`), confirmed with status 0 |
| Duration | about 9.2 s |
| Register `0x1F` | `0x1000` → `0x0000` before, back to `0x1000` after |

The capture contains two more accepted uploads to slot 71 (63,176 bytes each, 3.9 s clips).

## 6. Still unknown

- **Firmware limits:** maximum length or size per slot. The server reports `max_file_duration = 600` and `max_sound_count = 6`, but the unit of 600 is unknown.
- **Slot 72 (alarm):** not tested on a scooter yet.
- **Power-off sound:** no slot reported.
- **Other bits in `0x1F`:** only `0x1000`, `0x2000` and `0x4000` are known. Other bits may control unrelated functions, so do not guess them.
- **Reading sounds back:** there is no known command to download a sound from the scooter.
- **Persistence:** not systematically checked across restarts. The power-on sound working after power cycling suggests it is stored.
- **Newer app transfer path:** the current Segway app uses a Rust library for the transfer by default. Its parameters match the above (128-byte chunks, VCU, slot as resource type, no reboot), but its internals are obfuscated. The capture shows the result on the wire, which matches this document.
- **Opus:** the app has an Opus path for other devices; there is no evidence that the G3 supports it.

## 7. How G3 Connect implements this

In the web app under "Roller" → "Eigene Sounds":

- Converts any audio file in the browser to the format above (max. 4 s, optional normalisation), or uses a built-in test tone.
- Event picker for slots 71, 72, 73, plus any manual slot 0–255 with an optional single bit in `0x1F`. Custom slots can be saved by name.
- Does steps 2.2–2.6 automatically, with read-back for every register write. If the upload fails, the previous `0x1F` value is restored.
- After a custom-button upload it also sets the button action to 8 (step 2.7) and remembers the old action so it can be restored. Any of the eight actions can be chosen by hand.
- Toggles each event between custom sound and built-in tone.
- "Alle Sounds abspielen" plays a range of numbers with `playSound`. The "Dumper" does the same and records each sound with the phone's microphone, since a digital download is not possible.

Source: `dist/sound.js`, `dist/sound-ui.js`, `dist/sound-dump.js`.

## 8. Sources and how this was found

1. **App analysis.** The Segway app 6.10.12 (APK SHA-256 `6ac8bfb5…7f8c`), its G3 device configuration and the `CustomSoundEffect` module were decompiled and read. This gave the audio format, the 12-byte header, the three commands, the checksum, the flow control and the status codes. The slot numbers were missing because the app gets them from the server.
2. **Bluetooth capture.** A full HCI log of the Segway app was decrypted: all 1,932 Ninebot frames, with every message authentication code verified. It shows three accepted uploads to slot 71 and confirms the format, the 32-packet groups, the 30 ms pause, finish index 0 and the `0x1F` change around the upload.
3. **Server.** The app's request `/vehicle/sound/setting-info` was reproduced with the account owner's permission, using the app's own encryption library and a normal email login. The server returned the slot table in section 1. An earlier anonymous attempt failed only because the request was not encrypted the way the app does it.
4. **Scooter tests.** G3 Connect uploaded to slot 73 and the power-on sound played. The custom button kept its hazard-light action after the upload, which led to step 2.7. That the button plays the sound once `0x4A` is 8 is not confirmed on the scooter yet.
