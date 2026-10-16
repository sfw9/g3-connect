# G3 Connect

Eine Webapp in deutscher Sprache für eine direkte GATT-Verbindung zum Ninebot MAX G3. Sie implementiert Encryption2, liest und ändert die Reichweitenanzeige sowie die Sport-Beschleunigung (Stufen 1–3) an VCU 0x16. Die Beschleunigung liegt im Register 0x6E (`setSGear`, Befehl 0x02, zwei Bytes little endian). Beschleunigungsänderungen erfordern einen erfolgreich gelesenen Stillstand und einen bekannten alten Stufenwert. Ihr Erfolg wird erst nach ACK und identischem Rücklesewert angezeigt. Die Reichweitenanzeige wird über den separaten Schreibbefehl ohne ACK geändert und durch Rücklesen bestätigt.

## Start

Keine Installation und kein Build erforderlich. Im Projektordner:

```sh
python3 -m http.server 8080 --directory dist
```

Auf demselben Rechner in Chrome oder Edge `http://localhost:8080` öffnen. Für ein Android-Handy die Dateien aus `dist/` auf einem HTTPS-Host bereitstellen. Eine HTTP-Adresse im Heimnetz reicht nicht. Safari/iOS und Firefox unterstützen Web Bluetooth nicht. Die Seite muss als eigener Tab geöffnet werden; manche eingebetteten Vorschauen erlauben keinen Bluetooth-Zugriff.

1. Roller einschalten und Segway-App vollständig schließen.
2. „Verbinden“ klicken und den eigenen MAX G3 auswählen. Ein vorhandener Schlüssel muss nicht ausgelesen oder eingetragen werden.
3. Sobald die App dazu auffordert, die Power-Taste am Roller einmal kurz drücken. Die App erzeugt einen kryptografisch zufälligen 16-Byte-Schlüssel, sendet ihn mit SET_PWD und wartet bis zu 60 Sekunden auf die Bestätigung. Alle Wiederholungen verwenden denselben Schlüssel.
4. Nach Annahme des Schlüssels authentifiziert die App die Sitzung mit AUTH. Mit aktiviertem „Kopplung in diesem Browser merken“ wird der Schlüssel pro Bluetooth-Gerät lokal gespeichert und bei erneuter Verbindung verwendet. Er kann zusätzlich privat heruntergeladen werden. Scheitert die Anmeldung mit dem gemerkten Schlüssel, startet die Power-Tasten-Kopplung einmalig mit neuer GATT-Verbindung und neuem Handshake. Mit „Neu koppeln (Power-Taste)“ lässt sich ein alter Schlüssel direkt überspringen.
5. Stufe 1, 2 oder 3 wählen und im Stillstand übernehmen.

Der Pairing-Schlüssel wird auf deinem Gerät erzeugt und verarbeitet. Standardmäßig merkt sich die App ihn pro Bluetooth-Gerät im Local Storage dieses Browsers. Du kannst „Kopplung in diesem Browser merken“ vor dem Verbinden ausschalten; neue Schlüssel bleiben dann nur im Arbeitsspeicher der geöffneten Seite. Bereits gespeicherte Schlüssel lassen sich über die Website-Daten des Browsers löschen. Die App überträgt keine Schlüssel an einen Server und benötigt für die Rollerkommunikation keine Segway-Cloud und kein Segway-Konto. Die neuen Kartendienste sind im Navigationsabschnitt beschrieben. Ein heruntergeladener Pairing-Schlüssel ist sensibel und muss privat aufbewahrt werden. Die Oberfläche lädt keine externen Schriftarten oder Grafiken.

## Quellen und Grenzen

- [G3-Befehlstabelle](https://codeberg.org/NootNooot/segway-ninebot-ble/src/branch/main/docs/devices/segway-ekickscooter-ninebot-max-g3max-g3-plus.md): `rSGear` und `setSGear`, Register 0x6E, Lesen/Schreiben, 2 Bytes.
- [segMod x3regs.h](https://github.com/MacintoshKeyboardHacking/segMod/blob/main/myBLE4/x3regs.h): VCU_SGear 0x6E, „SportsAcceleration 1-3“. Dieses Projekt wurde auf GT3 Pro/F3 entwickelt, G3-Anwendung ist daraus zusammen mit der G3-Tabelle abgeleitet.
- [Encryption2-Dokumentation](https://nootnooot.codeberg.page/segway-ninebot-ble/encryption/): AES-128, SHA-1-Schlüsselableitung, CTR-ähnliche Verschlüsselung und CBC-MAC.
- [G3 BLE-MQTT Bridge](https://github.com/Euphonique/Ninebot-BLE-MQTT-Bridge/blob/main/ninebot_crypto.py): kryptografischer Referenzvektor und verketteter RX/TX-Nachrichtenzähler.
- [NinebotCrypto](https://github.com/scooterhacking/NinebotCrypto): fortlaufendes Senden von 0x5C bis zur Bestätigung mit Index 1; Wiederholungen von 0x5D.
- [ha-ninebot](https://github.com/BobMcGlobus/ha-ninebot): auf G3 bestätigter Nordic-UART-/Gen2-Handshake und Hinweise zu Account-Bindung, vorhandenem Schlüssel, vollständigem GATT-Gerätenamen und ATT-MTU. Dies ist Protokollreferenz; die JavaScript-Implementierung ist unabhängig.

**Beta. Authentifizierung und Registerlesen sind durch den bereitgestellten G3-Hardwarelog bestätigt; Schreibzugriffe wurden noch nicht am echten Roller verifiziert.** Die Zuordnung von 1–3 zu „Energiesparen“, „Standard“ und „Max. Geschwindigkeit“ ist nicht belastbar bestätigt; die Oberfläche benennt deshalb numerische Stufen. Das Rücklesen bestätigt den Registerwert, nicht die Bedeutung oder die physische Wirkung. Beim ersten Einsatz anschließend die Segway-App öffnen und vergleichen. Neuere oder abweichende Firmware kann das Protokoll ablehnen. Unbekannte Registerwerte sperren Schreibzugriffe.

Ein bereits gesetztes PRE_COMM-Kopplungsflag ist kein Abbruchgrund: Ohne eigenen gültigen Schlüssel fordert die App eine neue Kopplung an und wartet auf die physische Power-Tasten-Bestätigung. Die Firmware kann sie beispielsweise wegen einer Account-Bindung verweigern; dann meldet die App einen Timeout oder eine getrennte Verbindung. Ein Schlüssel gilt erst nach der SET_PWD-Antwort mit Index 1 als akzeptiert. Bis dahin speichert die App ihn nicht und startet AUTH nicht. Eine angenommene Kopplung kann den bislang im Roller verwendeten Schlüssel ersetzen.

Ein bereits vorhandener 32-stelliger Hex-Schlüssel kann optional in den erweiterten Einstellungen eingetragen werden. Das ist ein zusätzlicher Wiederverbindungsweg; der Standardablauf erzeugt seinen Schlüssel selbst. Schlüssel nicht öffentlich teilen.

Alle Protokollframes werden als ein vollständiger ATT-Schreibvorgang gesendet. Für SET_PWD muss das Betriebssystem eine ausreichend große MTU aushandeln (mindestens 32). Web Bluetooth bietet dafür keine direkte MTU-Steuerung. Die Empfangsseite setzt fragmentierte Notifications zusammen, überprüft Tags/Prüfsummen und verwirft Replay-Frames.

Die App bietet keine Firmware-Aktualisierung oder Änderung von Region, Geschwindigkeitslimit oder Motorstrom.

## Prüfung

```sh
npm test
```

46 Tests prüfen Verschlüsselung gegen Python-/AES-Referenzvektoren, MAC-Manipulation, Replay, fragmentierte Notifications, die Beschleunigungs-Schreibsequenz und den vollständigen verschlüsselten Handshake mit simuliertem GATT-Gerät. Die Kopplungstests umfassen ein gesetztes bestehendes Kopplungsflag, zeitversetzte Power-Bestätigungen zwischen zwei Sendeversuchen, Wiederholung mit identischem Schlüssel, den gemeinsamen RX/TX-Zähler, verspätete AUTH-Antworten, ein abweichendes BLE-Quellboard, Timeout, Abbruch und erneute Kopplung bei ungültigem gemerktem Schlüssel. Ein zusätzlicher Referenzvektor aus der separaten G3-Python-Implementierung prüft, dass nach RX-Zähler 7 der nächste AUTH-Frame Zähler 8 verwendet. Bluetooth und Verhalten der tatsächlichen Firmware können nur mit Hardware geprüft werden.

## Beta 03: Power-Tasten-Bestätigung

Die vorherige Beta konnte ein asynchrones 0x5C/Index-1-Paket während der Pause zwischen zwei Anfragen verlieren. Außerdem führte sie TX- und RX-Zähler getrennt; nach einer Antwort mit erhöhtem Fahrzeugzähler konnte die nächste Anfrage einen bereits verbrauchten Zähler tragen. Beta 03 wartet während des gesamten Kopplungsfensters auf die Bestätigung, sendet denselben Schlüssel alle 500 ms und setzt den nächsten TX-Zähler nach einer kryptografisch überprüften Antwort über deren RX-Zähler fort. ACK/Index 0 beendet das Warten nicht. AUTH wird bis zu 10 Sekunden wiederholt. Der Schlüssel wird erst nach einer bestätigten Annahme verwendet.

Die Diagnose enthält jetzt GATT-Paketlängen, verifizierte Befehls-/Statuswerte und Zähler; keine Schlüssel, Seriennummern, Challenges oder Nutzdaten. „Power-Taste gedrückt“ allein ist kein Beweis der Annahme: Die App wartet auf das bestätigte 0x5C/Index-1-Paket. Bei weiterhin ausbleibender Bestätigung können die Diagnoseeinträge zwischen Funkstille und verworfenen Antworten unterscheiden. Die konkrete Firmware und reale Bluetooth-Hardware sind weiterhin ungetestet.

## Beta 04: schlichte Logger-Oberfläche

Die Oberfläche enthält native Bedienelemente für Verbinden, Abbrechen, Auslesen und Ändern der Beschleunigungsstufe. Illustration, Dashboard, externe Schriftarten und das bisherige Design wurden entfernt. Der Logger ist immer sichtbar. Er zeigt ISO-Zeitstempel mit Millisekunden, Laufzeit seit Seitenstart, Browser-/API-Unterstützung, GATT-Services und Characteristic-Eigenschaften, aktive Notifications, Handshake-Versuche, TX/RX-Paketgrößen, verifizierte Antwortstatus und Nachrichtenzähler sowie Fehler. Bis zu 2.000 Einträge werden im Arbeitsspeicher gehalten. Automatisches Scrollen kann ausgeschaltet werden. Kopieren, Text-Download, JSON-Diagnose und Leeren sind direkt erreichbar. Es werden keine Nutzdaten oder Schlüssel protokolliert; zusätzliche 32-stellige Hex-Werte werden in der Logger-Ausgabe entfernt.

## Beta 05: damaliger Stand der Display-Diagnose

Der gewünschte Ein-/Aus-Schalter für die Reichweite auf dem Roller-Display ist noch nicht implementiert. Die öffentlich gefundene Maske `rFunBool / 0x4000` stammt aus der Referenzfamilie `serverId 81` (E-Serie/Moped), nicht aus einer bestätigten G3-Konfiguration. Sie wird deshalb nicht auf G3-Register übertragen. Da der Nutzer den Schalter auch in der offiziellen App nicht hat, ist ein Vergleich EIN/AUS/EIN über die App ebenfalls nicht möglich. Der vorbereitete Erkennungsansatz wird nicht veröffentlicht.

Die neue Schaltfläche „Display-Diagnose lesen“ erfasst ausschließlich bekannte Leseregister: BLE-, VCU- und MCU-Firmware, `rFunBool` bis `rFunBool4`, `rInstumentKey` und `rFunDisplayBool` bis `rFunDisplayBool5`. Die Werte erscheinen als Hex und Dezimal im Logger und im JSON-Diagnoseexport. Seriennummer, Pairing-Schlüssel und CodeLock-PIN werden dabei nicht gelesen. Einzelne unbeantwortete Register werden als Fehler aufgezeichnet. Die Funktion ändert keine Einstellung. Ein einzelner Diagnoseexport belegt noch keine bestimmte Bitbedeutung; für den eigentlichen Schalter ist weiterhin eine G3-spezifische Referenzzuordnung bzw. ein kontrollierter Mitschnitt einer erfolgreichen Umschaltung nötig.


## Beta 06: Reichweitenanzeige aus offizieller G3-Konfiguration

Die Zuordnung ist jetzt anhand des offiziellen G3-Gerätepakets `serverId 10258` belegt: `rFunBool4` / VCU `0x16` / Register `0x2F`, Maske `0x0010` (gesetzt = ein). `setFunBool4` verwendet Befehl `0x03` / `writeNR`. Der getrennte Sichtbarkeitstest des Segway-Schalters prüft `rFunDisplayBool4` / Register `0x32`, Maske `0x0040`. Im geposteten Nutzerlog ist dieses Fähigkeits-Bit nicht gesetzt; die bekannte UI-Bedingung erklärt damit den fehlenden Schalter, ohne eine Versionsprüfung anzunehmen.

Nach dem Verbinden wird der aktuelle Anzeigestatus gelesen. „Reichweite auf dem Roller-Display anzeigen“ und „Anzeige übernehmen“ ändern die Präferenz im Stillstand; der Schalter bleibt auch bei ausgeblendeter Segway-Option erreichbar. Ein frischer Lesezugriff erhält die anderen Bits. Nur der exakt zurückgelesene Zielwert bestätigt die Änderung. Es gibt keine automatische Wiederholung von Schreibbefehlen; bei verzögerter Anwendung wird nur das Lesen wiederholt. Die sichtbare Wirkung bei LC ist am Roller zu prüfen. Die 7 zusätzlichen Tests prüfen Bitzuordnung, fehlendes Fähigkeits-Bit, Erhalt anderer Einstellungen, Stillstand, unveränderte Werte, verzögerte oder abgelehnte Anwendung sowie den verschlüsselten Transport ohne Protokoll-ACK und Abbruch beim Trennen.

Die vollständige Herkunft und die Grenzen der Untersuchung stehen in [range-display-analysis.md](range-display-analysis.md). Die Untersuchung verwendet die chinesische offizielle Android-App und deren G3-Gerätepaket; der genaue Programmablauf der installierten globalen App und die LC-Firmware wurden nicht ausgeführt.


## Beta 07: Navigation und Google-Maps-Brücke

Die schlichte Oberfläche enthält jetzt Zielsuche, Fahrradroute, GPS-Abbiegehinweise, schematischen Routenverlauf und eine experimentelle TFT-Übertragung. Handy-Navigation funktioniert unabhängig von einer Roller-Verbindung. Die Darstellung am originalen G3 wird erst nach einem bestätigten sichtbaren Standtest freigegeben. Die G3-Befehle sind im offiziellen Gerätepaket vorhanden; Datenformat und insbesondere das Startpaket sind nicht am G3 bestätigt. Ein erfolgreich gebautes Programm ist kein Hardwarebeleg.

Google Maps kann als zweite Quelle über die zusätzliche [Android-Brücke](android-bridge-source.zip) verwendet werden. APK und Brücken-Quellcode sind direkt in der Webapp downloadbar. Die Brücke verarbeitet nur Google-Maps-Navigationsmeldungen, erkennt Pfeile lokal und überträgt vollständige Hinweise über einen mit Origin und Zufallstoken geschützten Loopback-Endpunkt an Chrome. Unsichere oder fehlende Werte werden nicht durch erfundene Pfeile ersetzt. Die Android-Brücke ist neu und noch nicht auf einem echten Handy getestet; Chrome muss im Vordergrund bleiben. Kein Maps-API-Schlüssel ist erforderlich.

Die App überträgt keine Scooter-Firmware und verändert für die Navigation keine VCU-/Motor-Einstellungen. Der bestehende Logger bleibt unverändert sichtbar. Die vollständigen Belege, abgeleiteten Annahmen und Grenzen stehen in [navigation-analysis.md](navigation-analysis.md). Die in früheren Abschnitten beschriebene ausschließlich lokale Datennutzung gilt weiterhin für Schlüssel und Rollerkommunikation; die neue manuelle Zielsuche und Routenberechnung nutzen ausdrücklich externe Kartendienste.


## Beta 08: neuer Handshake nach gescheiterter gespeicherter Kopplung

Der Nutzerlog mit gemeldeter BLE 0.4.0 zeigt weiterhin erfolgreiche PRE_COMM-Antworten, aber keine erfolgreich authentifizierte Sitzung. Ein einzelnes AUTH-Antwortpaket scheitert an der MAC-Prüfung. Das passt zu einem nicht mehr passenden gespeicherten Schlüssel oder abweichendem Sitzungszustand; der Log beweist weder eine bestimmte Ursache noch liest er die BLE-Version erfolgreich aus. Es werden deshalb keine versionsabhängigen Kryptografie-Konstanten erfunden oder Prüfungen abgeschaltet.

Beta 07 ging nach erfolglosem AUTH direkt zu SET_PWD über und behielt die bereits verwendete Sitzung und deren Zähler. Beta 08 schließt stattdessen die alte GATT-Verbindung, wartet gegebenenfalls auf deren Trennereignis und beginnt einmalig mit neuem PRE_COMM, frischer Challenge und zurückgesetztem Kryptografie-Zustand. Das gilt auch, wenn der Roller während des gespeicherten AUTH trennt. Ein gültiger gespeicherter Schlüssel nutzt weiterhin den bisherigen Wiederverbindungsweg. Nach einem bewusst ausgelösten Abbruch gibt es keinen automatischen Neuversuch; nach gescheiterter neuer Power-Kopplung ebenfalls keine Wiederverbindungsschleife.

„Neu koppeln (Power-Taste)“ neben „Verbinden“ überspringt sowohl einen gemerkten als auch einen eingetragenen Schlüssel für diesen Versuch. Eine bisherige Browser-Kopplung bleibt erhalten, bis der Roller einen neuen Schlüssel mit SET_PWD/Index 1 bestätigt. Für den Versuch Segway und andere Roller-Apps vollständig schließen, die Seite neu laden, Beta 08 prüfen, „Neu koppeln“ wählen und erst bei der Aufforderung die Power-Taste einmal kurz drücken. Bei weiterem Scheitern den neuen Log exportieren. Die Firmware-Unterstützung von BLE 0.4.0 und die physische Power-Kopplung sind mit dieser Änderung noch nicht am echten Roller geprüft.

Zusätzliche Tests verwenden echte verschlüsselte Frames für gültige und veraltete gespeicherte Schlüssel, ungültige MACs, neue Challenges und Sitzungszähler nach Wiederverbindung, Trennung durch den Roller, Abbruch und ausbleibende physische Bestätigung. Die UI-Prüfung bestätigt, dass „Neu koppeln“ auch einen ungültigen Eingabewert überspringt, die Geräteauswahl aus dem Klick startet und vor Bestätigung keinen alten Schlüssel überschreibt. Insgesamt 43 Node-Tests; keine echte Browser-/Android-/Roller-Prüfung für Beta 08.


## Beta 09: begrenzter, wiederholter Displaytest und genauere Startdiagnose

Der Nutzer meldet einen Navigationsstartton, aber keine Anzeige. Das belegt eine Reaktion des Rollers, noch keine passende Startantwort oder erfolgreiche Darstellung der Folgedaten. Ohne den zugehörigen Navigationslog bleibt offen, ob die Datenübertragung schon vor den Info-Paketen stoppt oder ob das TFT die gesendeten Nutzdaten nicht darstellt. Das Startformat `03 00` und die leere End-Nutzlast bleiben unbestätigt; es werden keine alternativen Formate geraten oder automatisch ausprobiert.

Der bisherige Standtest sendete genau einen Datensatz unmittelbar nach der Startbestätigung. Der neue Test wiederholt Distanz, Straßennamen und die 18-Byte-Info jede Sekunde für höchstens 15 Sekunden. So kann auch eine erst nach dem Start geöffnete Displayansicht erneut die Felder erhalten. Das ist eine gezielte Änderung am Testablauf, kein Nachweis der Ursache oder einer funktionierenden G3-Anzeige. Danach sendet die App das vorhandene Navigationsende. Der Nutzer kann vorher beenden; ein getrennter oder gewechselter Roller und ein Hintergrundwechsel beenden die Testschleife. Es werden keine echten GPS-Daten und keine Route benötigt. Ein neuer Verbindungsaufbau verlangt einen neuen sichtbaren Test.

Logs nennen jetzt Quell-/Zielboard, Befehl, Index, Nutzdatenlänge und Zähler. Verifizierte Antworten, die nicht zur offenen Startanfrage passen, werden als solche markiert. Ohne passende Startbestätigung sendet der Test weiterhin keine Abbiegedaten; die Fehlermeldung macht das ausdrücklich sichtbar. Erst vollständig gesendete Datensätze werden protokolliert. Schlüssel, Seriennummern, Straßennamen und GPS-Positionen bleiben aus den Logs heraus.

45 Node-Tests bestehen. Die zusätzlichen Tests prüfen Wiederholung ohne Route/GPS, Ablauf nach 15 Sekunden, manuelles Ende, Hintergrundwechsel, verfallene Displaybestätigung bei Wiederverbindung und fehlende Startbestätigung. Am echten G3 ist die Anzeige weiterhin zu prüfen; ein Startton ersetzt diese Prüfung nicht.


## Beta 10: SimpleNavi-Start aus der Hersteller-App

Die normale Pfeilnavigation startet mit exakt einem Nutzbyte `01`. In der statisch untersuchten chinesischen Hersteller-App definiert `ScreenCastType` die Werte SimpleNavi=1, MapNavi=2 und Cruise=3. `DashNaviDataMessenger.start()` wählt SimpleNavi; die Start-Koroutine übergibt den Typ als Array mit genau einem Byte an `setNaviStart`. Beta 07–09 hatte stattdessen `03 00` gesendet: ein falscher Modus und eine unbelegte Länge. Das ist jetzt korrigiert. Auch der Stopp folgt nun dem Hersteller-Code: ein Byte `00` auf derselben Adresse, mit bestätigter Antwort. Der G3-spezifische Befehl, Zielboard und Antwortfilter bleiben TFT 0x23 / Befehl 0x71 / Index 0.

Die Herstellerklassen wurden offline aus den vorhandenen eingebetteten DEX-Daten rekonstruiert. Dazu wurden Header und String-Offsettabellen anhand erhaltener Map-Listen wiederhergestellt; die App wurde weder installiert noch ausgeführt und kein Roller verbunden. Der frühere Befund, mit der vorhandenen APK sei kein statischer Zugriff auf die Navigationsmethoden möglich, ist damit überholt. Original-APK, wiederhergestellte DEX-Dateien und dekompilierte Herstellerquelltexte werden nicht mit dieser Webapp veröffentlicht. Belegangaben und Grenzen stehen in der Navigationsanalyse.

46 Node-Tests bestehen. Ein neuer Test durchläuft den verschlüsselten GATT-Handshake mit gemerktem Schlüssel, liest Stillstand, entschlüsselt die tatsächlich erzeugten 14-Byte-Start-/Stopppakete und prüft die gültigen leeren TFT-Antworten. Das beweist den Paketaufbau und den Ablauf im Simulator; die sichtbare Anzeige am echten G3 muss weiterhin geprüft werden. Dafür ist die Segway-App nicht erforderlich: Seite neu laden, Beta 10 prüfen, verbinden und im Stand den Displaytest ausführen. Die reine Navigation über G3 Connect enthält keinen Firmware-Schreibablauf.


## Beta 11: G3 Connect als vollständige Android-App

Der gewünschte Ablauf ist jetzt als native Android-Beta implementiert: G3 Connect koppelt selbst per BLE und Power-Taste und hält die Verbindung als verbundenes Vordergrundgerät aufrecht. Danach kann die normale Google-Maps-App im Vordergrund navigieren; erkannte Navigationsmeldungen starten die TFT-Navigation automatisch, aktualisieren die Anzeige und beenden sie beim Ende der Maps-Navigation. Kein Google-API-Schlüssel, Chrome oder zusätzliche Brücken-App nötig. APK: `g3-connect.apk`, Einrichtung und technische Grenzen: [android-bridge/README.md](android-readme.md). Der Verzeichnisname ist aus der früheren Brücke erhalten; es handelt sich jetzt um die vollständige App.

Die App enthält auch Beschleunigungsstufen, Reichweitenanzeige, einen 15-Sekunden-Displaytest und kopierbaren Logger. Die Webseite bietet die native APK und Quellen an; die frühere Brücken-Oberfläche wurde entfernt. Die eigenständige Browser-Navigation bleibt verfügbar.

Native Hosttests prüfen den verschlüsselten Transport gegen unabhängige Python-Vektoren und einen simulierten Roller sowie Kopplung, Registerschutz und Navigations-Lebenszyklus. Ein APK-Build bestätigt noch keinen echten Android-Betrieb: Ein Handy-/Rollertest der nativen App fehlt. Die Navigationpakete selbst hat der Nutzer bereits mit der Webapp am G3 bestätigt.


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
