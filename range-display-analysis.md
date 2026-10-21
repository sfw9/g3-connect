# MAX G3: Analyse der Reichweitenanzeige

Untersuchung am 15.10.2026 zur Interoperabilität von G3 Connect. Grundlage ist das offizielle G3-Gerätepaket, nicht eine Registermaske eines anderen Modells. Es werden hier nur die abgeleiteten Protokollfakten dokumentiert; APK, vollständige Herstellerkonfigurationen und Konfigurationsschlüssel werden nicht mitveröffentlicht.

## Herkunft

- [Offizielles Ninebot-Downloadportal](https://app.ninebot.com/downloads/v5/cn.html), dessen Android-Link auf den Xiaomi-Store verweist.
- [Android-Download im Xiaomi-Store](https://app.xiaomi.com/download/117460?ref=search), chinesische Variante `cn.ninebot.ninebot`.
- SHA-256 des am 15.10.2026 geladenen APK: `6ac8bfb50504a7bef741b74fe9c7f6399985f19bd9afecfddcc924cee7dc7f8c`.
- `assets/backup_config.nb` enthält nach Dekodierung das Gerätepaket für `serverId 10258` (MAX G3 / MAX G3 Plus).
- [Offizielles G3-Gerätepaket](https://oms-oss-public.ninebot.com/dsIKKa6d22/device-config/package/1787736756055__H1_0x102_600021201.zip), SHA-256 `147affe0c2561e85d4a8fedbd27205eff159152287d6c9164477f8ddcf26655c`.
- Die eingebettete Paketliste meldet Version `600021300`. Maßgebliche Dateien: `code/device_ui_set_dashboard`, `code/device_commands`, `strings/en`, jeweils aus den `.nb`-Dateien des Pakets.

## Ergebnis

| Zweck | Modul / Board | Register | Maske | Bedeutung |
|---|---|---|---|---|
| Reichweitenanzeige ein/aus | VCU / `0x16` | `rFunBool4`, `0x2F` | `0x0010`, Bit 4 | gesetzt = ein; gelöscht = aus |
| Schalter in der Segway-Oberfläche anzeigen | VCU / `0x16` | `rFunDisplayBool4`, `0x32` | `0x0040`, Bit 6 | gesetzt = sichtbar |

Die UI-Zeile mit dem Schlüssel `range_display_title` bindet ihren Zustand an `rFunBool4` mit Maske 16. Sowohl Ein als auch Aus schreiben `setFunBool4`. Die Bedingung `visible_condition` prüft `rFunDisplayBool4` mit Maske 64. Für die Bedienbarkeit prüft diese Zeile eine Bluetooth-Verbindung. In dieser Zeile steht keine Firmwareversionsprüfung. Andere äußere Bedingungen oder App-Versionen sind damit nicht ausgeschlossen.

`device_commands` ordnet `setFunBool4` dem Register 47 (hex `2F`) auf der VCU zu, Operation `writeNR`. Der Standard-Schreibbefehl ohne Protokollantwort ist `0x03`. Der zugehörige Lesezugriff liest zwei Bytes; der Wert wird little endian verarbeitet. Nach dem Schreiben wird ein separater Lesezugriff ausgeführt. Ein ATT-Schreibabschluss alleine bestätigt die Einstellung nicht.

Im bereitgestellten Nutzerlog stehen `rFunBool4 = 0x0010` und `rFunDisplayBool4 = 0x0000`. Das entspricht einer gesetzten Reichweitenpräferenz bei ausgeblendeter Segway-Option. Der Sichtbarkeitstest aus dieser Konfiguration schlägt bereits wegen des zweiten Werts fehl. Eine gespoofte Versionsnummer ist als Erklärung dafür nicht erforderlich. Warum LC dieses Fähigkeitswort so meldet, ist nicht untersucht.

## Umsetzung und Grenzen

G3 Connect liest das aktuelle Präferenzwort unmittelbar vor dem Schreiben und setzt oder löscht ausschließlich `0x0010`. Es schreibt keine Fähigkeitsregister und keine Versionsnummer. Der Schalter bleibt auch bei fehlendem Sichtbarkeits-Bit bedienbar, um die belegte Präferenz bei LC direkt ansprechen zu können. Unmittelbar vor Änderungen wird Stillstand geprüft.

Beispiel für die geposteten Werte: Ausschalten schreibt den Präferenzwert `0x0000` als Daten `00 00` an VCU `0x16`, Befehl `0x03`, Register `0x2F`. Das ist ein Beispiel für genau diesen Ausgangswert, kein pauschaler Wert für andere Geräte. Bei einem anderen aktuellen Präferenzwort bleiben alle übrigen Bits erhalten.

Es wird einmal geschrieben und bis zu viermal zurückgelesen, mit 100 ms Abstand zwischen weiteren Lesungen. Nur ein vollständig identischer Rücklesewert bestätigt die Änderung. Ein ignorierter Schreibbefehl oder veränderte andere Bits erzeugen eine Fehlermeldung und keinen automatischen erneuten Schreibversuch.

Diese Analyse belegt die G3-App-Zuordnung. Sie beweist nicht, dass jede LC-Version die Präferenz sichtbar umsetzt oder dauerhaft speichert. Ein bestätigtes Register und eine tatsächlich veränderte Displayanzeige sind getrennte Beobachtungen. Die neue Funktion wurde mit simulierten Protokollzugriffen und verschlüsseltem Transport geprüft, noch nicht am echten Roller.
