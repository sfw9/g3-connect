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
 private final Wire wire;private final Log log;private NinebotCrypto crypto=new NinebotCrypto();private int board=4;boolean ready;private final java.util.ArrayDeque<byte[]> inbox=new java.util.ArrayDeque<>();
 NinebotClient(Wire w,Log l){wire=w;log=l;}
 private byte[] receive(long timeout)throws Exception {if(!inbox.isEmpty())return inbox.removeFirst();byte[] raw=wire.take(timeout);if(raw==null)return null;try{return crypto.decrypt(raw);}catch(SecurityException|IllegalArgumentException e){log.line("RX verworfen: Authentifizierung oder Zähler ungültig.");return null;}}
 void pump()throws Exception{while(true){byte[] raw=wire.take(0);if(raw==null)break;try{if(inbox.size()>=32)inbox.removeFirst();inbox.addLast(crypto.decrypt(raw));}catch(SecurityException|IllegalArgumentException e){log.line("Veraltete RX-Antwort verworfen.");}}}
 private void send(int b,int cmd,int index,byte[] data)throws Exception {pump();if(cmd==0x5c||cmd==0x5d)for(byte[] p:inbox)if((p[3]&255)==b&&(p[4]&255)==0x3e&&(p[5]&255)==cmd&&(p[6]&255)==1)return;byte[] raw=crypto.encrypt(NinebotCrypto.frame(b,cmd,index,data));log.line(String.format(Locale.ROOT,"TX Board 0x%x / Befehl 0x%x / Index 0x%x · %d B · Zähler %d",b,cmd,index,raw.length,crypto.counter));wire.write(raw);}
 private byte[] await(int b,int cmd,int index,long timeout)throws Exception{long until=System.nanoTime()+timeout*1000000;while(true){long ms=(until-System.nanoTime())/1000000;if(ms<=0)throw new TimeoutException("Keine passende Antwort vom Roller.");byte[] p=receive(ms);if(p==null)continue;if((p[3]&255)==b&&(p[4]&255)==0x3e&&(p[5]&255)==cmd&&(index<0||(p[6]&255)==index)){log.line(String.format(Locale.ROOT,"RX Board 0x%x / Befehl 0x%x / Index %d · %d Datenbytes",b,cmd,p[6]&255,p.length-7));return p;}}}
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
 void close(){ready=false;wire.close();}
}
