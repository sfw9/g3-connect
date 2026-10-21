# Ninebot MAX G3: Upload eigener Sounds

Stand: 21.10.2026, vertiefte Analyse (Revision 2). Statische Untersuchung der vorhandenen Ninebot-/Segway-App und des G3-Gerätepakets. Kein Sound wurde an einen Roller gesendet. Die aktuell auf einem Telefon gewählte Transportvariante und die tatsächliche Annahme durch eine konkrete G3-Firmware sind damit nicht hardwarebestätigt.

## Ergebnis

Die App enthält einen direkten Dateiübertragungsweg für benutzerdefinierte Sounds. Für den G3 nennt das Gerätepaket VCU als Ziel und die Befehle `0x76`, `0x77`, `0x78`. Der native WAV-Pfad verwendet 8 kHz, 16 Bit, Mono und einen zusätzlichen proprietären 12-Byte-Vorspann vor der WAV-Datei. Die Tastenfunktion ist davon getrennt: `setCustomKey = 8` aktiviert die Soundfunktion der benutzerdefinierten Taste, überträgt aber keine Audiodaten.

Die Java-BLE-Dateiübertragung ist bis zur Kommandoerzeugung nachvollzogen. Der Abschlussindex dieses Pfads ist **0**, die Konfigurationsvorgabe 1 wird dabei nicht verwendet. Die aktuelle App aktiviert standardmäßig das neuere Rust-SDK; dessen Aufrufparameter sind ebenfalls rekonstruiert, sein geschützter nativer Nachrichtenaufbau jedoch nicht vollständig.

Der verbleibende zentrale Datenmangel ist die **numerische G3-Zuordnung Ereignis → Upload-Slot**: Die UI übernimmt diese aus einer Serverantwort, die in den vorhandenen Dateien nicht enthalten ist. Die untersuchten zusätzlichen Sound-/Tastenmodule enthalten auch keine eigenständige G3-Slottabelle. Ein universell funktionierender Uploader ist damit noch nicht belegt. Ein Mitschnitt wird für diese Analyse nicht vorausgesetzt oder vom Nutzer angefordert.

## Untersuchte Quellen

- Android-Paket `cn.ninebot.ninebot`, Version `6.10.12`, versionCode `610124167`.
- APK-SHA-256: `6ac8bfb50504a7bef741b74fe9c7f6399985f19bd9afecfddcc924cee7dc7f8c`.
- G3-Konfiguration: `device_ui_sound`, `device_ui_custom_button`, `device_commands`.
- Öffentlich ausgeliefertes React-Native-Modul `CustomSoundEffect`, Version `1543`, aus dem Modulverzeichnis der App.
- Modulquelle: https://oms-oss-public.ninebot.com/device-config/rn/1790133267017_CustomSoundEffect_android_v1543_inland.zip
- Entschlüsselter Hermes-Bundle-SHA-256: `3833dd9b38f2ef11d570553a622c8456a9999712883caacea97c4463834f285c`.
- Native Klassen: `RecordModule`, `SoundEffectHelper`, `FileConverter`, `FileTransferHelper`, `AudioUpdater`, `BaseFileUpdater`, `Firmware`, `FormatUtilsKt`, `AudioUtilsKt`.

Die Angaben beziehen sich auf diese untersuchten Dateien. Java-Decompilation erzeugt teilweise fehlerhafte Kontrollflussdarstellungen; konkrete Formatfelder wurden über direkt erkennbare Methoden, Konstanten, Geräte-JSON und Hermes-Disassembly gegengeprüft. Es wird hier keine vollständige Funktionsgleichheit aller App-Pfade behauptet.

## 1. UI und Freigabebits

`device_ui_sound` öffnet `CustomSoundEffect` → `SoundEffectList`. Der zugehörige Sichtbarkeitswert ist `rFunDisplayBool3 & 0x0800` beziehungsweise der entsprechende gecachte App-Wert.

`device_ui_custom_button` zeigt „Custom Sound Effect“, wenn `rFunDisplayBool3 & 0x2000` gesetzt ist, und wählt dafür `setCustomKey` mit Wert `8`.

Im G3-Gerätepaket:

| Name | Ziel | Register | Operation |
| --- | --- | --- | --- |
| `rCustomKey` | VCU `0x16` | `0x4A` | Lesen, zwei Bytes |
| `setCustomKey` | VCU `0x16` | `0x4A` | Schreiben ohne Register-ACK, Standardbefehl `0x03` |
| `rVoiceVolume` / `setVoiceVolume` | VCU `0x16` | `0x76` | Lautstärke lesen/schreiben |
| `playSound` | VCU `0x16` | `0x77` | Vorhandenen Sound abspielen, Standardschreibbefehl `0x03` |

Achtung auf die Protokollfelder: Lautstärkeregister **Index** `0x76` und Upload-**Befehl** `0x76` sind unterschiedliche Nachrichten. Ebenso unterscheidet sich `playSound` über Register `0x77` vom Datenübertragungsbefehl `0x77`.

## 2. Auswahl und native Übergabe

Der untersuchte Sound-Dialog bezieht seine Listen über `/vehicle/sound/setting-info`. Die Antwort wird unter anderem als `setting_info`, `sound_list`, `sys_sound_list`, `max_sound_count` verarbeitet. Bei Auswahl übernimmt die App `index` aus dem Sound-/Ereigniseintrag in den Uploadauftrag. Daher lässt sich aus „Taste = 8“ kein Upload-Slot `8` ableiten.

`RecordModule.setSoundEffect` verarbeitet:

```text
local_url      lokale Quelldatei
resource_url   alternativ herunterzuladende Datei
index          Ziel-Sound-Slot / resType
source         Herkunft; Sonderfall "1" = bereitgestellter gemeinsamer/Co-Brand-Sound
module         optionale Zielbaugruppe
audioType      "wav" oder "opus", Standard "wav"
```

Aufrufkette:

```text
CustomSoundEffect / SetSoundEffect
  → RecordModule.setSoundEffect
  → sendAudio2Vehicle
  → FileTransferHelper.sendFile2Vehicle
  → AudioUpdater / BaseFileUpdater
  → authentifizierte Bluetooth-Dateiübertragung
```

Die offizielle App hat zusätzlich Cloud-Aufrufe wie `/vehicle/sound/user-add` und `/vehicle/sound/user-set` für eigene Einträge und Zuordnungen. Diese wurden ausschließlich im Code untersucht; es wurde kein Nutzerkonto verwendet oder verändert. Die Cloud-Verwaltung und der lokale BLE-Dateitransfer sind verschiedene Schritte. Ob jede Firmware eine lokale Änderung ohne Cloud-Verwaltung dauerhaft beibehält, ist nicht geprüft.

## 3. WAV und Opus

Für den Konvertierungspfad ohne aktivierten alternativen Remote-Config-Decoder und ohne Sonderfall `source = "1"`:

- WAV: Konvertierung auf **8.000 Hz, 16 Bit, einen Kanal**, Ausgabe als WAV-Datei.
- Opus: eigener Pfad mit **48.000 Hz, Mono, Opus in Ogg**, Zielbitrate standardmäßig 48.000 bit/s.
- Bei aktivierter alternativer Decoder-Konfiguration beziehungsweise Sonderquelle wird die vorhandene Datei weitergereicht; daher nicht pauschal jeden App-Pfad auf dieselbe Konvertierung reduzieren.
- Der WAV-Pfad setzt `addHeader = true`, der Opus-Pfad und die Sonderquelle setzen es nicht.

Für TFT-Ziele fragt die UI `rWidgetAudioInfo` ab. Ohne Erweiterungsbit `0x02` verwendet sie WAV. Mit dem Bit wird der Codec aus `(value & 0x3C) >> 2` abgeleitet: `1 = WAV`, `2 = OPUS`, andere Werte unbekannt. Für andere Ziele fällt der untersuchte Dialog auf WAV zurück. Das vorhandene G3-Gerätepaket definiert `rWidgetAudioInfo` nicht; daraus folgt keine bestätigte Opus-Unterstützung des G3.

Die UI enthält einen Standard-Aufnahme-/Zuschnittwert von vier Sekunden. Neuere Dialoge führen zusätzliche konfigurierbare Längen; für Gang-Sounds wird eine eigene Zwei-Sekunden-Prüfung verwendet. Vier Sekunden sind deshalb kein belegtes universelles Firmwarelimit aller Slots.

### Proprietärer Vorspann beim WAV-Pfad

Die irreführend benannte Methode `getPreWavFileHeaderByteArray` erzeugt **zwölf Bytes**, keinen normalen RIFF-Header. `FileTransferHelper` stellt diese Bytes vor die komplette vorbereitete Datei.

Für `N = Länge der vorbereiteten WAV-Datei`:

| Offset | Länge | Inhalt |
| --- | --- | --- |
| 0 | 4 | `12`, unsigned little endian |
| 4 | 4 | `N + 12`, little endian |
| 8 | 2 | `8000`, little endian (`40 1F`) |
| 10 | 1 | `16` (`10`) |
| 11 | 1 | `1` (`01`, Mono) |
| 12 | N | vollständige WAV-Datei |

Eigenständige Beschreibung des gefundenen Formats:

```python
import struct
payload = struct.pack("<IIHBB", 12, len(wav_bytes) + 12, 8000, 16, 1) + wav_bytes
```

Ankündigungslänge und Abschlussprüfsumme beziehen sich auf `payload`, einschließlich dieses Vorspanns. Eine beliebige MP3 oder eine unverändert gesendete WAV-Datei entspricht diesem Pfad nicht.

## 4. BLE-Dateiübertragung des G3

Voraussetzung ist eine erfolgreich gekoppelte und authentifizierte Sitzung, wie sie G3 Connect bereits für andere Nachrichten verwendet. Beim untersuchten G3 ist dies Encryption2 über Nordic UART. Die folgenden Werte sind Felder innerhalb des Ninebot-Protokolls, keine separaten GATT-UUIDs.

| Schritt | Zielboard im G3-Gerätepaket | Befehl | Nutzdaten |
| --- | --- | --- | --- |
| `fileInfo` | VCU `0x16` | `0x76` | vier Byte Dateilänge little endian, danach `01` |
| `fileWrite` | VCU `0x16` | `0x77` | Dateiabschnitt |
| `fileCRC` | VCU `0x16` | `0x78` | vier Byte Abschlussprüfsumme little endian |

`AudioUpdater.createDataPacket` erzeugt genau die fünf Bytes der Ankündigung. Im nativen normalen Transfer wird als Ankündigungsindex `firmware.resType` verwendet; `FileTransferHelper` setzt diesen Wert auf den vom Soundauftrag gelieferten `index`.

Der BLE-Helfer startet mit einer Protokoll-Blocklänge von **128 Bytes**. Das ist die Datei-Nutzlast, nicht die gesamte verschlüsselte ATT-Schreiboperation. Bei Encryption2 ergeben sich dafür 141 Bytes auf dem Draht; für eine einzelne ATT-Schreiboperation muss die ausgehandelte MTU mindestens 144 betragen. Eine alternative Fragmentierung muss dem Transport entsprechen. Der bisherige Navigations-Mindestwert allein genügt nicht als Upload-Prüfung.

### Antworten und Flusssteuerung

Die App liest die Antwort auf `0x76` und übernimmt Paketgruppen-/Pausenwerte:

- Alter Antwortpfad: erstes LE16-Feld gleich `64`, anschließend LE16-Wartezeit. Der Wert `64` wird als Zahl kleiner Pakete pro Gruppe verwendet.
- Erweiterter Pfad: ein Byte Übertragungsprotokoll, LE16-Gruppengröße, LE32-Wiederaufnahmepunkt, LE32-Wartezeit.
- Standardwert vor einer Antwort: acht kleine Pakete pro Gruppe; das ist kein Ersatz für die ausgehandelte Antwort.
- Bei Protokoll `1` kann die App einen Wiederaufnahmepunkt berücksichtigen.
- Datenindizes zählen innerhalb der Gruppe; nach dem Gruppenende erfolgt eine Auswertung der Bestätigung. Fehlerstatus und bestätigter Fortschrittsindex steuern die Wiederholung.
- Ein gemeldeter Wartewert `5000` wird von `AudioUpdater` als Kompatibilitätssonderfall auf null Pause umgesetzt.

Ein Uploader darf diese Nachrichten deshalb nicht als unbegrenzt ungeprüfte GATT-Schreibschleife senden. Die zunächst schlecht dekompilierten Wiederholungszweige wurden zusätzlich in der instruktionstreuen JADX-Fallback-Darstellung gelesen. Bestätigt ist: Nur Status **2** am Gruppenende löst die spezielle Indexkorrektur aus. Die nächste absolute Paketnummer ist `mSuccessIndex + 1`; daraus werden Gruppe, Gruppenindex und Byteoffset neu berechnet. Bei unverändertem Fortschritt werden bis zu zehn solche Korrekturen zugelassen; neuer bestätigter Fortschritt setzt den Wiederholungszähler zurück. Andere Fehler am Gruppenende brechen ab.

Der letzte Datenabschnitt enthält nur die verbleibenden Datei-Bytes, **keine Auffüllung auf 128 Byte**. Normale Gruppen-/Abschlusswartezeit: 10.000 ms; Dateistart standardmäßig 3.000 ms. `getRetryCount()` liefert 5 und wird an die Befehlswiederholung übergeben; `failResendDelay` beträgt 100 ms. Zwischen nicht bestätigten kleinen Abschnitten wird die vom Gerät angegebene Pause eingehalten. Diese Werte beschreiben den untersuchten Java-Pfad, nicht eine am G3 gemessene Übertragungszeit.

### Abschlussprüfsumme

`Firmware.getCrc()` summiert die unsigned Datei-Bytes in einem 32-Bit-Wert und invertiert anschließend die Bits. `FormatUtilsKt.toBytes(int)` serialisiert little endian:

```python
checksum = (~sum(payload)) & 0xFFFFFFFF
checksum_bytes = checksum.to_bytes(4, "little")
```

Das ist **keine CRC32**.

**Abschlussindex im Java-Pfad: eindeutig 0.** Das wurde bis zur Erstellung des Kommandos weiterverfolgt:

```text
BaseFileUpdater.updateViaNormal
  write(board, 0, checksum, 0x78, timeout)
    → NbBluetoothDevice.writeIAP
      → CommandFactory.obtainIAPCommand
        → obtainCustomWriteCommand(board, index, cmd, data, ...)
          → BleEncryption2Protocol.createRequestData
```

`CommandFactory.obtainIAPCommand` ist `final`. `DynamicCommandFactory` kann diesen Aufruf daher nicht durch die deklarative Standardadresse ersetzen. Die G3-Konfiguration nennt für `fileCRC` zwar Index 1; auf diesem nativen Pfad werden aus dieser Konfiguration aber nur die Befehlsnummer und vorher das Zielmodul bezogen. Der Index wird als 0 separat übergeben und unverändert in das Protokoll übernommen. Das ist eine geklärte Aufrufpfadfrage, keine Bestätigung, dass jede Firmware beliebige Indexvarianten akzeptiert.

Für IAP-Antworten dient das Antwort-Indexfeld als **Status**, nicht als unverändertes Echo des gesendeten Slot-/Paketindex. `0 = OK`, `1 = Fehler`, `2 = Indexfehler`, `3 = Speichern fehlgeschlagen` gemäß Audio-Statusdefinition. Ein allgemeiner Register-ACK-Parser darf diese Fälle nicht durcheinanderbringen.

### Neuerer Rust-SDK-Pfad

`BleSdkConfig.useBleSdk` und `BleAnalyticsManager.enableSdkTransFile` sind in dieser App-Version beide standardmäßig **true**. Für BLE-Dateiübertragung wird damit standardmäßig `BaseFileUpdater.iapUpdateWithBleSdk` gewählt. Einstellungen/weitere Laufzeitentscheidungen können abweichen; es wurde keine konkrete Telefonsitzung beobachtet.

Die untersuchte Übergabe an `RustBridge.startIAP` enthält:

| Parameter | Wert im Audio-BLE-Pfad |
| --- | --- |
| `deviceType` | explizites `module`, andernfalls `fileInfo.module`, beim G3 `vcu` |
| `chunkSize` | 128 |
| `translateMode` | 5 (Dateiübertragungspfad) |
| `translateChannel` | `ble` |
| `resourceType` | Upload-`index`, über `clampToU8` auf acht Bits begrenzt |
| `resourceCode`, `resourceVersion` | im einfachen Soundaufruf 0, 0 |
| `needReboot` | **false** |
| `beginTimeout` | aus dem Dateiwrapper, Standard 3.000 ms |
| `timeoutMs` | in diesem Aufruf standardmäßig 10.000 ms |

Die vorbereiteten Audiodaten werden als Bytearray separat übergeben. Es ist in diesem Übergabepfad keine zusätzliche Hersteller-Dateisignatur zu finden. Die authentifizierte Bluetooth-Sitzung bleibt erforderlich.

Die native Bibliothek `librust_lib.so` wurde aus der vorhandenen APK untersucht. Nutzlastbereiche/Symbole sind in dieser Fassung geschützt bzw. verschleiert; die benötigten Rust-Funktionen und Nachrichtenzeichenketten sind daraus nicht als normaler Quelltext/normaler Symbolbestand rekonstruierbar gewesen. Die Java-JNI-Schnittstelle beweist deshalb **nicht** den exakten nativen Abschlussindex oder jede Rust-interne Flusssteuerungsvariante. Die Java-Sequenz ist vollständig sichtbarer Referenzpfad; sie darf nicht ohne Kennzeichnung als aus dem Rust-SDK ausgelesener Mitschnitt bezeichnet werden.

### Neustart und Firmware-Signatur

Der Audio-Updater wird mit einer leeren `FwUpdateStrategyConfig` erzeugt: kein Lock-State, `needPowerOff = false`, `resetTogether = false`. `FileTransferHelper` markiert die Datei im Wrapper mit `needReset = true`; der äußere Ablauf setzt dadurch auch `hasReset = true`, und der normale Audio-IAP-Pfad selbst verschickt keinen separaten Firmware-Reset. Zusammen mit `needReboot = false` beim SDK gibt es auf den untersuchten Standardpfaden **keinen expliziten Neustart-/Firmware-Update-Befehl nach dem Soundupload**. Ein möglicher firmwareinterner Neustart ist damit nicht ausgeschlossen.

Die Bezeichnung `Firmware` ist hier die wiederverwendete Java-Dateiwrapperklasse. Die App erstellt den Upload aus selbst aufgenommenen bzw. konvertierten Audiodaten; sie erwartet dafür kein signiertes Controller-Firmwareimage. Die Bluetooth-Authentifizierung und Paketintegrität werden dadurch nicht aufgehoben.

## 5. Weitere untersuchte Varianten

Zusätzlich zur G3-Konfiguration und `CustomSoundEffect` wurden die öffentlich ausgelieferten Module `NBScooterSound` v507 und `NBScooterCustomButton` v504 untersucht. Diese bauen die Einstellungsoberfläche auf bzw. verwenden die Gerätekonfiguration. Die Taste „Soundeffekt“ wählt weiterhin Funktionswert 8. Eine numerische Ereignis-Slottabelle für den G3 wird dadurch nicht geliefert.

Die Sound-UI kennt als Spezialfall `wake_up_sound` einen eingebauten Standardton mit `default_index = 207` (`0xCF`). Das ist **kein belegter benutzerdefinierter G3-Upload-Slot**: `default_index` dient der Auswahl/Wiedergabe eines Werkstons, während der Upload `setting_info[].index` übernimmt. Auch ein künstlicher Menüeintrag für Gang-Sounds mit `default_index = -1` ist kein Uploadziel. Die Tastenfunktion 8, Standardtonnummern und Datei-Slotnummern sind deshalb getrennt zu behandeln.

Der alternative Android-Audio-Decoder wurde ebenfalls untersucht: Er schreibt nach Dekodierung/Resampling einen WAV-Header für 8 kHz, Mono, PCM16. `getCustomSoundEffectConfig` fällt ohne gelieferten Remote-Wert auf false zurück. Beim Standardpfad erfolgt die Konvertierung über `FileConverter`; beim alternativen Pfad übernimmt `AudioDecoder` die Vorbereitung. Daraus lässt sich keine zusätzliche, am G3 bestätigte Opus-Unterstützung ableiten.

Eine Web-/Quellcodesuche sowie die bereits vorhandenen offenen Protokollprojekte ergaben keinen unabhängigen, vollständigen G3-Sound-Uploader mit verifizierter Slottabelle. Fremde Produkt-/Anleitungsangaben zu MP3 betreffen überwiegend die vom Benutzer ausgewählte Eingabedatei. Sie widerlegen nicht die im App-Code belegte interne Konvertierung vor der BLE-Übertragung. Die Analyse stützt sich für das Wire-Format auf die untersuchten Primärdateien, nicht auf solche Anleitungen.

## 6. Berechnetes Beispiel ohne Gerät

Für eine unabhängig erzeugte WAV-Datei mit genau einer Sekunde digitaler Stille (8 kHz, 16 Bit, Mono) ergibt sich:

| Wert | Ergebnis |
| --- | --- |
| WAV-Dateilänge | 16.044 Byte |
| Uploadlänge einschließlich Vorspann | 16.056 Byte |
| 12-Byte-Vorspann | `0C 00 00 00 B8 3E 00 00 40 1F 10 01` |
| Nutzlast der Ankündigung `0x76` | `B8 3E 00 00 01` |
| Abschluss-Prüfsumme | `0xFFFFF651` |
| Nutzlast für `0x78` | `51 F6 FF FF` |
| Anzahl Datenabschnitte | 126 |
| Länge des letzten Abschnitts | 56 Byte |

Nur als Beispiel für eine **angenommene** alte Geräteantwort `40 00 00 00` entstehen zwei Gruppen: Indizes 0–63 und 0–61. Diese Antwort wurde nicht von einem echten G3 empfangen. Eine angenommene Bestätigung bis absolutem Paket 69 würde bei Paket 70 fortsetzen: Gruppe 1, Index 6, Byteoffset 8.960. Die konkrete Upload-Slotnummer bleibt im Beispiel absichtlich unbekannt.

Geprüft wurden RIFF-Längenfelder, vollständige Rekonstruktion des Payloads aus den Abschnitten und `sum(payload) + checksum == 0xFFFFFFFF` modulo 2^32. Das bestätigt die Berechnung und Formatkonsistenz des Beispiels, keine Hardwareannahme. `protocol-findings.json` und `offline-example.json` enthalten dieselben Ergebnisse maschinenlesbar.

## 7. Belastbares Ergebnis und verbleibende Grenzen

**Offline geklärt:** UI-Einstieg, Sichtbarkeitsbits, getrennte Tastenbelegung und Wiedergabe, native Aufrufkette, Audioaufbereitung, 12-Byte-Vorspann, Uploadbefehle, Zielmodul, Java-Abschlussindex, Prüfsumme, Paketgruppen, Statusauswertung, Wiederaufnahmerechnung, Wiederholungsgrenzen, wesentliche Wartewerte sowie die Parameter und Standardauswahl des Rust-SDK-Pfads.

**In den verfügbaren Daten nicht enthalten oder nicht vollständig rekonstruiert:**

1. Numerische G3-Slots für Einschalten, Ausschalten, Alarm und Taste. Ihre Quelle ist eine nicht vorliegende, fahrzeugbezogene Serverantwort. Das Hochladen einer beliebigen Zahl wäre eine Vermutung.
2. Firmwareseitiges Größen-/Zeitlimit pro Slot. Vier Sekunden sind ein belegter UI-Standard; beispielsweise ergeben vier Sekunden PCM16-Mono bei 8 kHz einschließlich kanonischer WAV und Vorspann 64.056 Byte. Daraus folgt kein bewiesenes Flash-Limit von 64 KiB oder ein Recht, längere Clips hochzuladen.
3. Exakte interne Frames des geschützten nativen Rust-SDKs und Unterschiede gegenüber dem sichtbaren Java-Referenzpfad.
4. Annahme, korrekte Wiedergabe und dauerhafte Speicherung auf der konkreten G3-Firmware. Es wurde keine Hardwarekommunikation ausgeführt.

Diese vertiefte Analyse ist mit dem verfügbaren Material abgeschlossen. Weitere Sicherheit erfordert zusätzliche Primärdaten, etwa eine passende Serverantwort oder Firmware-Dokumentation; vom Nutzer wird hier kein Mitschnitt verlangt. Die Untersuchung hat weder die veröffentlichte App noch das auf Google Maps beschränkte GitHub-Paket verändert.
