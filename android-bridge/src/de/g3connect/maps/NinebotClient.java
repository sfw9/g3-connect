package de.g3connect.maps;
import java.util.*;
import java.util.concurrent.TimeoutException;
import java.security.SecureRandom;
import java.nio.charset.StandardCharsets;
/** All calls belong to one serial worker. Notifications enter the transport queue, never mutate cipher concurrently. */
final class NinebotClient {
 interface Wire {void write(byte[] b)throws Exception;byte[] take(long timeoutMs)throws Exception;void close();}
 interface Log {void line(String s);}
 interface Pairing {void confirmed(byte[] key);}
 private final Wire wire;private final Log log;private NinebotCrypto crypto=new NinebotCrypto();private int board=4;boolean ready;private final java.util.ArrayDeque<byte[]> inbox=new java.util.ArrayDeque<>();private boolean quiet;
 NinebotClient(Wire w,Log l){wire=w;log=l;}
 private byte[] receive(long timeout)throws Exception {if(!inbox.isEmpty())return inbox.removeFirst();byte[] raw=wire.take(timeout);if(raw==null)return null;try{return crypto.decrypt(raw);}catch(SecurityException|IllegalArgumentException e){log.line("RX verworfen: Authentifizierung oder Zähler ungültig.");return null;}}
 void pump()throws Exception{while(true){byte[] raw=wire.take(0);if(raw==null)break;try{if(inbox.size()>=32)inbox.removeFirst();inbox.addLast(crypto.decrypt(raw));}catch(SecurityException|IllegalArgumentException e){log.line("Veraltete RX-Antwort verworfen.");}}}
 private void send(int b,int cmd,int index,byte[] data)throws Exception {pump();if(cmd==0x5c||cmd==0x5d)for(byte[] p:inbox)if((p[3]&255)==b&&(p[4]&255)==0x3e&&(p[5]&255)==cmd&&(p[6]&255)==1)return;byte[] raw=crypto.encrypt(NinebotCrypto.frame(b,cmd,index,data));if(!quiet)log.line(String.format(Locale.ROOT,"TX Board 0x%x / Befehl 0x%x / Index 0x%x · %d B · Zähler %d",b,cmd,index,raw.length,crypto.counter));wire.write(raw);}
 private byte[] await(int b,int cmd,int index,long timeout)throws Exception{long until=System.nanoTime()+timeout*1000000;while(true){long ms=(until-System.nanoTime())/1000000;if(ms<=0)throw new TimeoutException("Keine passende Antwort vom Roller.");byte[] p=receive(ms);if(p==null)continue;if((p[3]&255)==b&&(p[4]&255)==0x3e&&(p[5]&255)==cmd&&(index<0||(p[6]&255)==index)){if(!quiet)log.line(String.format(Locale.ROOT,"RX Board 0x%x / Befehl 0x%x / Index %d · %d Datenbytes",b,cmd,p[6]&255,p.length-7));return p;}}}
 void authenticate(String name,byte[] stored,Pairing pairing)throws Exception {
  if(name==null||name.isEmpty())throw new IllegalArgumentException("Bluetooth-Name fehlt. Erneut suchen.");byte[] nameBytes=name.getBytes(StandardCharsets.UTF_8);
  crypto.key(nameBytes,NinebotCrypto.FW);send(4,0x5b,0,new byte[0]);byte[] pre=await(4,0x5b,-1,4000);if(pre.length!=37)throw new IllegalStateException("PRE_COMM-Antwort hat unerwartete Länge.");
  crypto.auth=Arrays.copyOfRange(pre,7,23);byte[] serial=Arrays.copyOfRange(pre,23,37);crypto.session=true;crypto.counter=1;crypto.lastRx=-1;
  log.line("PRE_COMM bestätigt. Neue Sitzung.");byte[] password=stored;boolean fresh=password==null;
  if(fresh){password=new byte[16];new SecureRandom().nextBytes(password);crypto.key(nameBytes,crypto.auth);log.line("Kopplung: Power-Taste am Roller kurz drücken.");repeat(0x5c,password,60000);log.line("Power-Bestätigung erhalten.");}
  crypto.key(password,crypto.auth);log.line("Sitzung authentifizieren …");repeat(0x5d,serial,10000);ready=true;if(fresh)pairing.confirmed(password.clone());log.line("Verschlüsselte Sitzung hergestellt.");
 }
 private void repeat(int cmd,byte[] payload,long limit)throws Exception{long until=System.nanoTime()+limit*1000000;while(System.nanoTime()<until){send(board,cmd,0,payload);long next=System.nanoTime()+500000000L;while(System.nanoTime()<next){byte[] p=receive(Math.max(1,(next-System.nanoTime())/1000000));if(p!=null&&(p[3]&255)==board&&(p[4]&255)==0x3e&&(p[5]&255)==cmd&&(p[6]&255)==1)return;}}throw new TimeoutException(cmd==0x5c?"Keine Power-Bestätigung erhalten.":"Gespeicherte Kopplung nicht akzeptiert.");}
 private void requireReady(){if(!ready)throw new IllegalStateException("Zuerst mit dem Roller verbinden.");}
 int read(int index)throws Exception{requireReady();send(0x16,1,index,new byte[]{2});byte[] p=await(0x16,4,index,3000);if(p.length!=9)throw new IllegalStateException("Registerantwort hat falsche Länge.");return(p[7]&255)|((p[8]&255)<<8);}
 void stationary()throws Exception{if(read(0x57)!=0)throw new IllegalStateException("Roller muss stehen.");}
 void startNavigation()throws Exception{requireReady();send(0x23,0x71,0,new byte[]{1});await(0x23,0x71,0,3000);log.line("Pfeilnavigation am TFT gestartet (01, 1 Byte).");}
 void stopNavigation()throws Exception{requireReady();send(0x23,0x71,0,new byte[]{0});await(0x23,0x71,0,3000);log.line("Navigation am TFT beendet (00, 1 Byte).");}
 void guidance(MapsState.Sample sample,int total)throws Exception{requireReady();if(!sample.valid())throw new IllegalArgumentException("Unvollständiger Maps-Hinweis.");send(0x23,0x71,1,NaviPacket.number(total));send(0x23,0x71,0x10,NaviPacket.road(sample.currentRoad));send(0x23,0x71,0x24,NaviPacket.road(sample.road));send(0x23,0x71,3,NaviPacket.info(sample));}
 void acceleration(int level)throws Exception {if(level<1||level>3)throw new IllegalArgumentException();stationary();int old=read(0x6e);if(old<1||old>3)throw new IllegalStateException("Beschleunigungsregister unbekannt.");send(0x16,2,0x6e,new byte[]{(byte)level,0});await(0x16,5,0x6e,3000);readback(0x6e,level);log.line("Beschleunigungsstufe durch Rücklesen bestätigt: "+level);}
 private void readback(int index,int expected)throws Exception{for(int attempt=0;attempt<5;attempt++){if(read(index)==expected)return;if(attempt<4)Thread.sleep(100);}throw new IllegalStateException("Registeränderung durch Rücklesen nicht bestätigt.");}
 void range(boolean enabled)throws Exception {stationary();int old=read(0x2f),value=enabled?old|0x10:old&~0x10;if(old==value){log.line("Reichweitenanzeige bereits "+(enabled?"ein":"aus")+".");return;}send(0x16,3,0x2f,new byte[]{(byte)value,(byte)(value>>>8)});readback(0x2f,value);log.line("Reichweitenanzeige "+(enabled?"ein":"aus")+" · Rücklesen bestätigt.");}
 // ── Eigene Sounds (dist/sound-upload-analysis-en.md) ──
 interface Progress{void at(int done,int total);}
 interface Cancel{boolean requested();}
 private static String soundStatus(int s){String[] names={"OK","Fehler","Indexfehler","Speichern fehlgeschlagen"};return s+" ("+(s<names.length?names[s]:"unbekannt")+")";}
 /** Plain register write (command 0x03) confirmed by read-back. */
 void writeVerified(int index,int value)throws Exception{requireReady();send(0x16,3,index,new byte[]{(byte)value,(byte)(value>>>8)});readback(index,value);}
 /** Switch one event between custom sound and built-in tone (bit in 0x1F); other bits stay. Returns the new value. */
 int soundBits(int mask,boolean custom)throws Exception{stationary();int old=read(0x1f),value=custom?old|mask:old&~mask;if(value!=old)writeVerified(0x1f,value);log.line(String.format(Locale.ROOT,"Register 0x1F = 0x%04x.",value));return value;}
 /** Custom button action (0x4A, 1–8). Returns the previous action. */
 int customKey(int action)throws Exception{if(action<1||action>8)throw new IllegalArgumentException("Unbekannte Tastenaktion "+action+".");stationary();int old=read(0x4a);if(old!=action)writeVerified(0x4a,action);log.line("Custom-Taste: "+SoundFile.keyName(old)+" → "+SoundFile.keyName(action)+".");return old;}
 /** playSound register 0x77; plays a sound by number, writes nothing else. */
 void playSound(int number)throws Exception{requireReady();if(number<0||number>255)throw new IllegalArgumentException("Nummer 0–255.");send(0x16,3,0x77,new byte[]{(byte)number,0});}
 /**
  * Upload into `slot`. With `mask` the event's bit in 0x1F is cleared during the transfer and set afterwards,
  * as the Segway app does; after a failure the previous value is restored.
  */
 void uploadSound(int slot,byte[] payload,int mask,Progress progress,Cancel cancel)throws Exception{
  if(slot<0||slot>255)throw new IllegalArgumentException("Slot muss 0–255 sein.");stationary();
  int before=mask==0?0:read(0x1f);boolean cleared=(before&mask)!=0;
  if(cleared)writeVerified(0x1f,before&~mask);
  try{transfer(slot,payload,progress,cancel);}
  catch(Exception e){if(cleared)try{writeVerified(0x1f,before);}catch(Exception restore){log.line("Register 0x1F nicht zurückgesetzt: "+restore.getMessage());}throw e;}
  if(mask!=0){writeVerified(0x1f,before|mask);log.line(String.format(Locale.ROOT,"Register 0x1F = 0x%04x · eigener Sound für Slot %d aktiv.",before|mask,slot));}
 }
 private void transfer(int slot,byte[] payload,Progress progress,Cancel cancel)throws Exception{
  int sum=SoundFile.checksum(payload),count=SoundFile.chunks(payload.length);
  log.line(String.format(Locale.ROOT,"Sound-Upload: Slot %d, %d Bytes, %d Pakete, Prüfsumme 0x%08x.",slot,payload.length,count,sum));
  send(0x16,0x76,slot,SoundFile.beginData(payload.length));byte[] begin=await(0x16,0x76,-1,3000);
  // In replies to the file commands the index field is the status.
  if((begin[6]&255)!=0)throw new IllegalStateException("Roller lehnt den Upload ab: Status "+soundStatus(begin[6]&255)+".");
  SoundFile.Flow flow=SoundFile.parseBegin(Arrays.copyOfRange(begin,7,begin.length));if(flow.group<=0)throw new IllegalStateException("Ungültige Gruppengröße in der Startantwort.");
  int next=flow.protocol==1&&flow.last>=0?flow.last+1:0;
  log.line(String.format(Locale.ROOT,"Sound-Upload: %d Pakete je Gruppe, Pause %d ms%s.",flow.group,flow.wait,next>0?", fortsetzen ab Paket "+next:""));
  quiet=true;
  try{
   while(next<count){
    if(cancel.requested())throw new IllegalStateException("Upload abgebrochen.");
    int within=next%flow.group,offset=next*SoundFile.CHUNK;byte[] chunk=Arrays.copyOfRange(payload,offset,Math.min(payload.length,offset+SoundFile.CHUNK));
    if(within!=flow.group-1&&next!=count-1){send(0x16,0x77,within&255,chunk);if(flow.wait>0)Thread.sleep(flow.wait);}
    else{
     byte[] ack;
     for(int attempt=0;;attempt++){send(0x16,0x77,within&255,chunk);try{ack=await(0x16,0x77,-1,10000);break;}catch(TimeoutException e){if(attempt>=5)throw new TimeoutException("Keine Gruppenbestätigung für Paket "+(next+1)+".");log.line("Sound-Upload: keine Gruppenbestätigung, Wiederholung "+(attempt+1)+"/5.");Thread.sleep(100);}}
     if((ack[6]&255)!=0)throw new IllegalStateException(String.format(Locale.ROOT,"Upload bei Paket %d/%d abgebrochen: Status %s.",next+1,count,soundStatus(ack[6]&255)));
    }
    next++;progress.at(next,count);
   }
  }finally{quiet=false;}
  send(0x16,0x78,0,SoundFile.le32(sum));byte[] done=await(0x16,0x78,-1,10000);
  if((done[6]&255)!=0)throw new IllegalStateException("Prüfsumme nicht akzeptiert: Status "+soundStatus(done[6]&255)+".");
  log.line("Sound-Upload: Abschluss vom Roller bestätigt.");
 }
 void close(){ready=false;wire.close();}
}
