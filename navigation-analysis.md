# Navigation in G3 Connect · Beta 10

Stand 15.10.2026. Zwei Datenquellen stehen zur Verfügung: eigene Fahrradnavigation im Browser und Google-Maps-Hinweise über eine zusätzlich installierbare Android-Brücke. Die Übertragung auf das originale G3-Display ist experimentell und noch nicht mit Hardware bestätigt. Es wird keine Kartenbild- oder Videoübertragung behauptet.

## Belegte Grundlagen und offene Punkte

Das bereits untersuchte [offizielle G3-Gerätepaket](https://oms-oss-public.ninebot.com/dsIKKa6d22/device-config/package/1787736756055__H1_0x102_600021201.zip), serverId 10258, enthält in `device_commands` folgende Befehle auf dem Modul `tft`:

| Funktion | Befehl | Index | Operation |
|---|---|---|---|
| Start | `0x71` | `0x00` | write, Antwort `0x71` / Index `0x00` |
| Gesamtdistanz | `0x71` | `0x01` | writeNR |
| Navigationsinfo | `0x71` | `0x03` | writeNR |
| Aktuelle Straße | `0x71` | `0x10` | writeNR |
| Nächste Straße | `0x71` | `0x24` | writeNR |
| Text | `0x71` | `0x38` | writeNR; in dieser App nicht verwendet |
| Displayseitiges Ende bestätigen | `0x71` | `0xFF` | writeNR |

TFT-Zieladresse `0x23` stammt aus der [segMod-Boardzuordnung](https://github.com/MacintoshKeyboardHacking/segMod/blob/main/myBLE4/x3regs.h). Die [NinebotEnhance-Navigationsimplementierung](https://github.com/Margele/NinebotEnhance/blob/9044b52d5964aff4f98c5284728634dc4c511472/app/src/main/java/dev/ichinomiya/ninebotenhance/core/NaviTestData.java) beschreibt folgende Nutzdaten des Ninebot-App-Messengers:

- Gesamtdistanz: uint32 little endian, Meter.
- Info: 18 Bytes; Reststrecke uint32 bei Offset 0, Restzeit uint32 bei 4, Pfeil uint16 bei 8, Entfernung zum Manöver uint32 bei 10, Ampelanzahl uint16 bei 14, GPS-Stufe uint16 bei 16.
- Straßennamen: UTF-8, mit Null abgeschlossen.
- Richtungen: links 2, rechts 3, links vorne 4, rechts vorne 5, links hinten 6, rechts hinten 7, wenden 8, geradeaus 9, Kreisverkehr 11/12, angekommen 15.

Diese Referenz wurde auf einer anderen Ninebot-Baureihe entwickelt. Sie ist kein G3-Hardwarebeleg. Die optionale DriveInfo-Funktion der Referenz ist nicht in der vorliegenden G3-Konfiguration enthalten und wird daher nicht gesendet. Die Ampelanzahl wird mangels Daten als 0 übertragen.

**Start seit Beta 10:** Der aus der Hersteller-App rekonstruierte Typ `ScreenCastType.SimpleNavi` hat Wert 1; die Start-Koroutine übergibt exakt ein Byte an `setNaviStart`. Die Pfeilnavigation startet deshalb mit `01`. Das bisherige `03 00` aus Beta 07–09 war falsch: 3 bezeichnet Cruise und wird von der Hersteller-App ebenfalls nur als einzelnes Byte kodiert. Der Hersteller-Code bestätigt außerdem den 18-Byte-Infoaufbau und UTF-8-Straßennamen mit Nullabschluss. Der Hersteller beendet die laufende Navigation mit `setNaviStart` und genau einem Byte `00`; Beta 10 verwendet dafür ebenfalls die passende TFT-Antwort. `setNaviExit` mit null Daten dient im untersuchten Code der Antwort auf ein displayseitiges Beenden und wird beim normalen App-Stopp nicht mehr gesendet. Ob die sichtbare Wirkung auf der jeweiligen G3-Firmware stimmt, bleibt durch den Standtest zu prüfen. Eine passende Startantwort allein beweist keine Darstellung. Ohne sichtbar bestätigten Linkspfeil mit 100 m bleibt die laufende Display-Navigation gesperrt; ein Startfehler stoppt vor dem Datenstrom.

## Browser-Navigation

Einmalige manuelle Zielsuche über [Nominatim](https://nominatim.org/release-docs/latest/api/Search/); kein Autocomplete. Auch Koordinaten `Breite,Länge` werden akzeptiert. Die Route kommt vom Fahrrad-Backend `routing.openstreetmap.de/routed-bike`. Dass der OSRM-Pfad dabei `/driving/` heißt, ändert nicht den ausgewählten Fahrrad-Backendserver. Die erreichbaren Endpunkte wurden mit einer Beispielroute und CORS-Antworten geprüft. Das sind öffentliche Dienste ohne Verfügbarkeitsgarantie; diese Beta ist für gelegentliche persönliche Nutzung, nicht für Massennutzung vorgesehen.

GPS wird lokal auf die Route projiziert. Begrenzte Fortschrittsfenster vermindern Sprünge an Kreuzungen und späteren Schleifen. Ungenaue Positionen, mehr als 45 m Abweichung oder fehlende/frische GPS-Daten halten die Navigation an. Es gibt keine automatische Neuberechnung. Die gezeigte Restzeit ist eine Schätzung aus der Route. Das SVG zeigt den schematischen Routenverlauf, keine vollständige Straßenkarte. Die reine Handy-Navigation benötigt keine Roller-Verbindung.

Suchanfragen gehen an Nominatim, Start/Ziel an den Router. Die nachfolgenden GPS-Positionen werden nicht an diese Dienste übertragen oder serverseitig gespeichert. Fahrradprofile garantieren keine örtliche E-Scooter-Zulässigkeit.

## Google Maps über Android

Der vom Nutzer verlinkte [TikTok-Beitrag](https://www.tiktok.com/@bmw.e90.cluster.g/video/7696651892679593248) trägt den Titel „Free navi for Segway-Ninebot F3/G3“. Die abgerufene Vorschau zeigt Google Maps und ein originales Fahrzeugdisplay. Der Videostream war hier nicht abrufbar; die konkrete dort verwendete App und deren Protokoll wurden dadurch nicht identifiziert. Der Beitrag ist eine Referenz für den gewünschten Ablauf, kein Protokollbeleg für diese Umsetzung.

Eine Webseite kann Benachrichtigungen der Google-Maps-App nicht selbst lesen. Die mitgelieferte Android-Brücke verwendet dafür Androids NotificationListenerService nach ausdrücklicher Systemfreigabe. Andere Apps werden vor dem Lesen ihrer Benachrichtigungsinhalte herausgefiltert. Die Brücke benötigt keine Bluetooth- oder Standortberechtigung und verbindet sich nicht selbst mit dem Roller. Sie liefert Daten ausschließlich auf dem lokalen Loopback-Endpunkt. Die bestehende Web-Bluetooth-Verbindung bleibt in Chrome.

Die normale Maps-Meldung enthält den Pfeil häufig nur als großes Symbolbild. Das lokale Klassifikationsmodell aus [OpenDash / KTM-Nav-GEN3](https://github.com/Pavanayi1/KTM-Nav-GEN3) erkennt dessen semantische Klasse; deren IDs werden ausdrücklich in Ninebot-IDs übersetzt. Es werden keine KTM-Bluetooth-Befehle auf den G3 übertragen. Der Modellscore muss mindestens 0,90 betragen; unbekannte Klassen, unvollständige Werte und mehrdeutige Entfernungsformate sperren die Übertragung. Ein hoher Modellscore ist keine Garantie eines richtigen Pfeils. Änderungen in Google Maps können die Erkennung unterbrechen.

Der native Dienst erwartet die exakte Website-Origin und einen zufälligen Token im Header. Die Android-App öffnet Chrome mit dem Token im URL-Fragment; die Webseite entfernt es und hält den Token im Sitzungsspeicher. Ein Fragment wird nicht mit der HTTP-Anfrage an den Site-Server geschickt. Keine Tokens, Rohbenachrichtigungen, Straßennamen oder GPS-Koordinaten werden in den Logger übernommen. Chrome kann eine [Loopback-/lokale Netzwerkfreigabe](https://github.com/WICG/local-network-access/blob/main/explainer.md) verlangen; diese wird nicht umgangen. Ob die Site-Auslieferung und der konkrete Android-Browser die lokale Verbindung zulassen, ist noch auf dem Handy zu prüfen.

## Grenzen und Prüfung

- Keine Karten- oder Videoprojektion, keine native Hintergrund-BLE-Übertragung, keine iOS-Brücke.
- Chrome muss für zuverlässige Verarbeitung im Vordergrund bleiben. Gesperrter Bildschirm oder Browser-Suspendierung können Updates verhindern und die letzte Displayanzeige stehen lassen. Die Webapp ist kein Ersatz für eine zuverlässige native Hintergrundnavigation.
- Der GPS- oder Maps-Datenstrom stoppt bei Ausfall; das Display-Ende wird ohne Protokollbestätigung gesendet und kann bei abgerissener Verbindung nicht garantiert werden.
- Der Standtest kann eine sichtbare Reaktion bestätigen, aber keine vollständige Pfeilzuordnung für jede Firmware. Alle Richtungen und das Ende müssen vor dem Fahren geprüft werden.
- JavaScript-Tests prüfen Formatvektoren, Route/Fortschritt, Ankunft, GPS-Abweichung, Displayadressierung, unsichere Maps-Daten, Token-Lebenszyklus und den Handyablauf ohne Bluetooth.
- Native Hosttests prüfen Entfernungs-/Zeitparser, Richtungsklassen und den echten Loopback-HTTP-Endpunkt mit erlaubten/verbotenen Origins und Tokens. APK-Bau und Signaturprüfung bestanden. Das Modellformat und die Labelanzahl wurden anhand des FlatBuffers geprüft.
- Es steht hier kein Android-Gerät oder G3 zur Verfügung. Android-Runtime, Google-Maps-Benachrichtigungen, native Modellausführung, Chrome-Zugriff und Displayreaktionen wurden nicht durch Hardwaretests bestätigt. Auch eine echte Browser-Bedienprüfung war in dieser Umgebung nicht verfügbar.


## Hardware-Rückmeldung und Beta 09

Der Nutzer meldet einen Startton ohne Displayinhalt. Welche Startantwort und welche anschließenden Pakete vorlagen, ist ohne den Navigationslog nicht bekannt. Das Startformat wird daher weiter als unbestätigt geführt. Insbesondere wird aus dem Ton keine Bestätigung des 18-Byte-Infoformats abgeleitet.

Beta 09 ersetzt den einzelnen Testdatensatz durch eine begrenzte Testschleife: nach passender Startantwort bei Sekunde 0 bis 14 je ein vollständiger Datensatz (Distanz, beide Straßennamen, Info), ab Sekunde 15 das vorhandene Navigationsende. Die Wiederholung soll die Anzeige auch nach einer möglichen Verzögerung beim Öffnen erreichen; ob dies die gemeldete Störung behebt, ist offen. Der gesamte Datensatz wird nur im synthetischen Standtest wiederholt. Für echte Routen gilt weiterhin die normale Übertragung mit Info pro Sekunde und Straßennamen bei Änderung.

Ein Timeout benennt ausdrücklich, dass keine Abbiegedaten gesendet wurden. Der Logger enthält jetzt außerdem die Boards und Indizes verifizierter RX-Pakete sowie nicht passende Startantworten. Damit lässt sich zwischen fehlender Startbestätigung, gescheitertem ATT-Schreiben und gesendeten, aber nicht dargestellten Daten unterscheiden. Es gibt weiterhin keine Bestätigung der sichtbaren Darstellung durch BLE.


## Offline-Beleg für die Korrektur in Beta 10

Der Nutzer möchte die offizielle App nicht mit seinem Roller verbinden. Die Untersuchung benötigt das nicht. Die bereits von [Xiaomi](https://app.mi.com/download/117460?ref=search) heruntergeladene chinesische Hersteller-App wurde ausschließlich als Datei ausgewertet:

- Paket `cn.ninebot.ninebot`, Version 6.10.12, Build 610124167, per `aapt2 dump badging` ermittelt.
- APK SHA-256: `6ac8bfb50504a7bef741b74fe9c7f6399985f19bd9afecfddcc924cee7dc7f8c`.
- Der äußere DEX enthält 30 Wrapperklassen. Dahinter liegen eingebettete DEX-Daten mit erhaltenen Map-Listen und großen Teilen der Tabellen. Aus diesen wurden offline 21 DEX-Blöcke mit 82.203 Klassendefinitionen strukturell wiederhergestellt. Header und String-Offsettabellen wurden rekonstruiert; App-Code wurde nicht ausgeführt.
- Der relevante rekonstruierte DEX hat SHA-256 `2a8bd2d21a674c4407d8d9b3a54d1d64056890621e97616778ef9edc2f71c3e9`.
- `cn.ninebot.device.motor.navi.ScreenCastType` definiert `SimpleNavi(1)`, `MapNavi(2)` und `Cruise(3)`.
- `DashNaviDataMessenger.start()` ruft den gemeinsamen Startweg mit `ScreenCastType.SimpleNavi` auf. `DashNaviDataMessenger$Companion$start$2.invokeSuspend` baut dafür ein Array aus genau einem Byte des Enumwerts und übergibt es an `setNaviStart`. Die beiden gezielt dekompilierten Klassen für Enum und Start-Koroutine wurden von JADX ohne Dekompilierungsfehler ausgegeben. Die gesamte Messenger-Klasse hat zwei andere, nicht vollständig dekompilierte Methoden; deren Fehler wurden nicht als Beleg für die Startkodierung verwendet.
- `DashNaviDataMessenger.naviInfo` bestätigt die Felder des vorhandenen 18-Byte-Formats. `stopNavi` sendet `setNaviStart` mit einem Byte `00`; `onReport` antwortet auf ein displayseitiges Beenden getrennt mit `setNaviExit` ohne Nutzdaten. Die zusätzlichen modellabhängigen Befehle für DriveInfo oder Displaythema bleiben außerhalb der G3-Implementierung, weil sie im G3-Gerätepaket fehlen.

Dies ersetzt den bisherigen Recherchebefund, die vorhandene APK sei grundsätzlich nicht statisch auswertbar. Für die konkrete Startkodierung ist die Hersteller-App nun die Primärquelle; NinebotEnhance wird dafür nicht mehr als Ersatz verwendet. Es wird kein vollständiger Herstellerquelltext, DEX oder APK mit der Site verbreitet.

Der neue verschlüsselte Integrationstest prüft die komplette Sequenz Anmeldung, Stillstandslesen, `SimpleNavi`-Start und -Stopp sowie beide verifizierten TFT-Antworten. Das entschlüsselte Startpaket lautet `5a a5 01 3e 23 71 00 01`, das Stopppaket `5a a5 01 3e 23 71 00 00` (je 8 Bytes vor Verschlüsselung; 14 auf GATT). Ein Simulatorbeleg ersetzt weiterhin nicht die Bestätigung des sichtbaren Pfeils auf echter Hardware.


## Stand Beta 11

Der Nutzer hat nach Beta 10 ausdrücklich eine funktionierende Anzeige gemeldet. Die hier beschriebenen SimpleNavi-Pakete sind damit zusätzlich am Nutzergerät bestätigt. G3 Connect gibt es jetzt als native Android-App mit eigener Kopplung und Bluetooth-Verbindung. Google-Maps-Hinweise können ohne Chrome oder zusätzliche Brücken-App zum TFT gelangen. APK: [g3-connect.apk](g3-connect.apk); Einrichtung und Grenzen: [android-readme.md](android-readme.md). Die native Android-Laufzeit und Maps-Erkennung wurden noch nicht auf einem Handy getestet; der APK-Build und 113 Prüfungen des nativen Kerns ersetzen diesen Test nicht.


## Beta 12: tatsächliches Maps-Meldungsformat und lokale Diagnose

Der übermittelte Screenshot zeigt eine kombinierte Anweisung „350 m · Turn right onto Aggerstraße“ mit separater Ankunftsuhrzeit „Arrive 21:34“. Der native Parser unterstützt jetzt kombinierte oder getrennte Anweisungen in Titel, erweitertem Titel, Text, erweitertem Text und Textzeilen. Explizite unterstützte englische/deutsche Abbiegeanweisungen liefern die Richtung direkt; ansonsten bleibt die Bilderkennung erhalten. Die Zusammenfassungsfelder werden einzeln geprüft, damit eine reine ETA in einem Feld eine echte Restfahrzeit/Reststrecke in einem anderen nicht verdeckt. Straßennamen liefern keine Richtung und die Abbiegedistanz ersetzt keine Gesamt-Reststrecke.

Die sichtbare Meldung allein liefert weiterhin keine Reststrecke und Restfahrzeit für den vollständigen TFT-Datensatz. Ohne diese Werte wird der erkannte Hinweis angezeigt, aber kein unvollständiger Datensatz gesendet. Ein verifiziertes TFT-Format zum Ausblenden fehlender Restwerte liegt nicht vor. Mit „Maps-Diagnose kopieren“ kann der Nutzer die tatsächlich von Android gelieferten Google-Maps-Textfelder und den Parserbefund lokal kopieren. Die Diagnose enthält Navigationstext/Straßennamen, jedoch keine anderen Apps, Bluetooth-Schlüssel oder Gerätekennungen. Es findet kein Upload statt. Ein Screenshot belegt nicht die Android-Extras; diese müssen am echten Handy geprüft werden.

129 Prüfungen des nativen Kerns bestehen, darunter der aus dem Screenshot transkribierte Text, getrennte und kombinierte Formate, versteckte Zusammenfassungen, unbekannte Restwerte, Text-Richtung ohne Modell und Erhalt des bisherigen Icon-Formats. Die APK wird mit gleicher Signatur und höherem Versionscode als Update gebaut. Native Android-Laufzeit weiterhin ohne Handy-/Rollertest.


## Beta 13: Restfahrzeit aus Ankunft minus Handy-Uhrzeit

Der Nutzerhinweis ist korrekt: Fehlt eine direkte Dauer, kann die App aus der lokalen Ankunftsuhrzeit und der aktuellen Handy-Uhrzeit eine ungefähre Restfahrzeit ableiten. Beta 13 verwendet echte relative Dauer bevorzugt und berechnet andernfalls eine Schätzung aus ausdrücklich beschrifteten ETA-Uhrzeiten. Die Handy-Zeitzone, 24-Stunden-/AM-PM-Formate und Ankunft nach Mitternacht werden berücksichtigt. Die App zeigt „ca.“; der Diagnoseexport nennt Quelle und Zeitzone. Der konkrete Nutzerzeitstempel ergibt in Europe/Berlin 21:36:32, daher bis 21:44 etwa acht Minuten.

Innerhalb der Ankunftsminute wird auf ungefähr null begrenzt. Ein überholter Zeitpunkt wird nicht zu einer fast 24-stündigen Fahrt: Ohne Datumsangabe sind nur plausible Differenzen bis zwölf Stunden zulässig. Die Zeit wird bei jedem Poll neu ausgewertet. Die Gesamt-Reststrecke fehlt in der gelieferten Meldung weiterhin und wird nicht aus Minuten oder der Entfernung zur nächsten Kurve erfunden; der vollständige TFT-Datensatz bleibt deshalb ohne Reststrecke gesperrt.

145 Prüfungen des nativen Kerns bestehen, darunter der gelieferte Diagnosezeitstempel, Countdown, Mitternacht, gleiche Minute, veraltete ETA, ungültige Zeiten und Vorrang echter Dauer. APK gebaut/signiert; native Hardwareprüfung weiterhin nur am Nutzergerät möglich.


## Beta 14: fester Platzhalter 1337 km für fehlende Reststrecke

Auf ausdrücklichen Nutzerwunsch wird fehlende Gesamt-Reststrecke beim Erzeugen des TFT-Datensatzes durch exakt 1.337.000 Meter ersetzt. Sowohl Gesamtstrecken-Paket als auch Reststrecken-Feld verwenden diesen Wert. Die ursprünglichen Maps-Daten behalten eine unbekannte Reststrecke; Oberfläche und Diagnose kennzeichnen den übertragenen Wert als „1337 km (Platzhalter)“. Echte von Maps gelieferte Reststrecke bleibt vorrangig und übernimmt keinen künstlich großen Gesamtstreckenwert. Abbiegedistanz, Richtung und reale/aus ETA geschätzte Restfahrzeit bleiben unverändert.

Damit ist die gelieferte Maps-Meldung mit Rechts / 350 m / „Arrive 21:44“ im Referenzzeitpunkt für die Display-Übertragung freigegeben. Fehlende Zeit, unbekannter Pfeil, veraltete oder entfernte Meldungen bleiben gesperrt. 173 native Prüfungen bestehen, einschließlich tatsächlich verschlüsselter TFT-Schreibpakete für 1337 km, korrekter 350-m-Abbiegedistanz und Wechsel zu echten Routendaten. APK gebaut/signiert; wie das reale TFT den großen Platzhalter formatiert, bleibt am Nutzergerät zu prüfen.


## Beta 15: Startanweisung ohne Meterangabe und Symbolaufbereitung

Der reale Android-16-Log bestätigt Bluetooth-Authentifizierung; die Navigation wurde durch „Head towards Alfred-Delp-Straße“ ohne Distanz und einen abgelehnten Bildscore blockiert. Der Parser erkennt diese Meldung jetzt als Startanweisung: Vorwärts-/Startpfeil 9, Zielstraße, „jetzt“ / 0 Meter, ETA-Restzeit und der gewünschte 1337-km-Platzhalter. Weitere explizite Anweisungen ohne Meterpräfix werden ebenfalls als unmittelbar erkannt; eine spätere echte Abbiegedistanz ersetzt die Null. Straßennamen allein ergeben keine Richtung. Diagnosefelder kennzeichnen Startanweisung und unmittelbare Distanz ausdrücklich.

Die Symbolverarbeitung zeichnet auf transparenten statt schwarzen Hintergrund und wandelt schwarze/weiße Masken sowie helle/dunkle Bildhintergründe in das vom Modell erwartete weiße Symbol auf Schwarz um. Leere Eingaben werden vor der Inferenz verworfen; die Konfidenzschwelle bleibt unverändert. Dadurch wird die nachweisbare Schwarz-auf-Schwarz-Auslöschung beseitigt; die tatsächliche Bilderkennungsqualität am Handy muss weiter geprüft werden.

Live-Start/Neustart der reinen TFT-Navigation funktioniert auch während der Fahrt; synthetischer Standtest, Beschleunigung und Reichweitenanzeige behalten ihre Stillstandsprüfung. 214 native Prüfungen bestehen, einschließlich verschlüsselter Übertragung des konkreten Startfalls, Wechsel zu Rechts / 350 m und Ende bei entfernter Meldung sowie Normalisierung schwarzer/weißer/heller/dunkler Testpixel. APK gebaut/signiert. Sichtbare Navigation mit diesem Update am Nutzergerät noch zu prüfen.


## Beta 16: manueller Sender mit Dauersenden und Laufzeit

Der neue Button „Manuell senden / Dauersenden …“ öffnet eine schlichte Eingabemaske für Richtung, Straße, Abbiegedistanz, Restfahrzeit und Reststrecke. „Dauersenden“ wiederholt den kompletten Datensatz ungefähr einmal pro Sekunde, „Einmal“ sendet ihn einmal. Die Sendedauer ist getrennt einstellbar: 0 Sekunden = bis Stopp, sonst automatisches bestätigtes TFT-Ende nach der gewählten Laufzeit. Optional zählt die Restfahrzeit herunter; sonst bleiben alle Werte fest. Letzte Eingaben werden privat gespeichert, laufendes Senden startet nach App-Neustart nicht automatisch.

Manuelles Senden funktioniert ohne Maps und ohne Benachrichtigungszugriff. Es pausiert die Maps-Automatik. Der eigene Stopp-Button, globaler Navigationsstopp und Trennung beenden den Modus; erneutes Aktivieren der Maps-Automatik übergibt nach Stop des manuellen Datensatzes wieder an Maps. Laufzeit und Sendetakt basieren auf monotoner Zeit. Alle Pakete bleiben auf derselben serialisierten, verschlüsselten GATT-Sitzung; keine Motorbefehle werden durch den manuellen Sender eingeführt.

276 native Prüfungen bestehen. Zusätzliche Fälle prüfen Endlos-/Einmalmodus, Zeitlimit, Stopp ohne spätere Wiederholungen, Countdown, Komma-Eingaben, Grenzen und Moduswechsel sowie tatsächlich verschlüsselte TFT-Nutzdaten mit frei gewählter Straße/Richtung/Zeit/Distanz. APK gebaut und signiert. Die neue Eingabemaske und sichtbare Ausgabe müssen noch am Nutzergerät geprüft werden.
