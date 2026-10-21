package de.g3connect.maps;
import java.util.*;
import java.util.concurrent.*;
import java.nio.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import org.json.*;
public final class NativeTests {
 static int checks;
 static void check(boolean value,String what){checks++;if(!value)throw new AssertionError(what);}
 static void same(byte[] a,byte[] b,String message){check(Arrays.equals(a,b),message+": "+NinebotCrypto.hex(a));}
 static void expectFailure(RunnableThrows r,String what)throws Exception{boolean failed=false;try{r.run();}catch(Exception e){failed=true;}check(failed,what);}
 interface RunnableThrows{void run()throws Exception;}
 static final byte[] NAME="1CGBC2510C0000".getBytes(StandardCharsets.UTF_8),CHALLENGE=NinebotCrypto.unhex("00112233445566778899aabbccddeeff"),PASSWORD=NinebotCrypto.unhex("ffeeddccbbaa99887766554433221100");
 static void crypto(String vectors)throws Exception{
  JSONObject v=new JSONArray(new String(Files.readAllBytes(Paths.get(vectors)),StandardCharsets.UTF_8)).getJSONObject(0);NinebotCrypto c=new NinebotCrypto();c.key(NAME,NinebotCrypto.FW);
  same(c.encrypt(NinebotCrypto.unhex(v.getString("pre"))),NinebotCrypto.unhex(v.getString("preEncrypted")),"Python PRE_COMM vector");
  same(c.decrypt(NinebotCrypto.unhex(v.getString("preEncrypted"))),NinebotCrypto.unhex(v.getString("pre")),"PRE_COMM decrypt");
  c.auth=CHALLENGE;c.session=true;c.counter=1;c.key(PASSWORD,CHALLENGE);
  same(c.encrypt(NinebotCrypto.unhex(v.getString("plain"))),NinebotCrypto.unhex(v.getString("encrypted")),"Python encrypted vector");
  same(c.encrypt(NinebotCrypto.unhex(v.getString("multi"))),NinebotCrypto.unhex(v.getString("multiEncrypted")),"Python multiblock vector");
  byte[] bad=NinebotCrypto.unhex(v.getString("encrypted"));bad[7]^=1;expectFailure(()->c.decrypt(bad),"tampering rejected");check(c.lastRx==-1,"tampering does not consume RX counter");
  c.decrypt(NinebotCrypto.unhex(v.getString("encrypted")));c.decrypt(NinebotCrypto.unhex(v.getString("multiEncrypted")));expectFailure(()->c.decrypt(NinebotCrypto.unhex(v.getString("encrypted"))),"replay rejected");
  c.counter=65535;expectFailure(()->c.encrypt(NinebotCrypto.frame(4,1,1,new byte[0])),"counter exhaustion");
  NinebotCrypto.Frames f=new NinebotCrypto.Frames();byte[] a=NinebotCrypto.unhex(v.getString("multiEncrypted"));check(f.push(Arrays.copyOf(a,9)).isEmpty(),"fragment buffered");List<byte[]> got=f.push(Arrays.copyOfRange(a,9,a.length));check(got.size()==1,"fragment recovered");same(got.get(0),a,"fragment intact");
 }
 static final class Vehicle implements NinebotClient.Wire {
  final BlockingQueue<byte[]> queue=new LinkedBlockingQueue<>();NinebotCrypto peer=new NinebotCrypto();List<byte[]> sent=new ArrayList<>();byte[] password;int pairs;int speed,range=0x9414,accel=1;boolean lateConfirm,pendingPower;int applyDelay,pendingRange;boolean closed;String stage="pre";boolean corruptNext;
  final Map<Integer,Integer> regs=new HashMap<>();java.io.ByteArrayOutputStream file;int fileSlot=-1,fileLength,fileStatus,finishStatus;byte[] begin=NinebotCrypto.unhex("012000ffffffff1e000000");List<Integer> plays=new ArrayList<>();int dropAcks;
  Vehicle(byte[] stored)throws Exception{password=stored;peer.key(NAME,NinebotCrypto.FW);}
  void reply(int board,int cmd,int index,byte[] data)throws Exception{byte[] p=NinebotCrypto.frame(board,cmd,index,data);p[3]=(byte)board;p[4]=0x3e;byte[] raw=peer.encrypt(p);if(corruptNext){raw[8]^=1;corruptNext=false;}queue.offer(raw);}
  public void write(byte[] raw)throws Exception{if(closed)throw new IllegalStateException("closed");int n=((raw[raw.length-2]&255)<<8)|(raw[raw.length-1]&255);if(peer.session)check(n>peer.counter,"TX advances beyond peer counter");byte[] p=peer.decrypt(raw);sent.add(p);int board=p[4]&255,cmd=p[5]&255,index=p[6]&255;byte[] data=Arrays.copyOfRange(p,7,p.length);
   if(stage.equals("pre")){check(cmd==0x5b,"PRE first");byte[] info=new byte[30];System.arraycopy(CHALLENGE,0,info,0,16);System.arraycopy(NAME,0,info,16,14);reply(4,0x5b,1,info);peer.auth=CHALLENGE;peer.session=true;peer.counter=1;peer.key(password==null?NAME:password,CHALLENGE);stage=password==null?"pair":"auth";return;}
   if(cmd==0x5c){if(password==null)password=data.clone();else same(data,password,"same key across SET_PWD retries");pairs++;reply(4,cmd,0,new byte[0]);if(lateConfirm){pendingPower=true;return;}if(pairs>=2){reply(4,cmd,1,new byte[0]);peer.key(password,CHALLENGE);stage="auth";}return;}
   if(cmd==0x5d){same(data,NAME,"AUTH raw 14-byte serial");reply(4,cmd,1,new byte[0]);stage="ready";return;}
   check(stage.equals("ready"),"auth before control");if(cmd==1){if(index==0x2f&&applyDelay>0&&--applyDelay==0)range=pendingRange;int value=regs.containsKey(index)?regs.get(index):index==0x57?speed:index==0x2f?range:accel;reply(board,4,index,new byte[]{(byte)value,(byte)(value>>>8)});}
   else if(board==0x23&&index==0){check(data.length==1&&(data[0]==1||data[0]==0),"confirmed SimpleNavi one-byte start/stop");reply(board,cmd,index,new byte[0]);}
   else if(board==0x16&&cmd==2){accel=data[0]&255;reply(board,5,index,new byte[0]);}
   else if(board==0x16&&cmd==3&&index==0x77){plays.add((data[0]&255)|((data[1]&255)<<8));}
   else if(board==0x16&&cmd==3&&(index==0x1f||index==0x4a)){regs.put(index,(data[0]&255)|((data[1]&255)<<8));}
   else if(board==0x16&&cmd==3){int value=(data[0]&255)|((data[1]&255)<<8);if(applyDelay>0)pendingRange=value;else range=value;}
   // File transfer as in the captured Segway app upload: 32 packets per group, 30 ms, status in the index field.
   else if(board==0x16&&cmd==0x76){fileSlot=index;fileLength=ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN).getInt();check(data.length==5&&data[4]==1,"announce = length LE + 01");file=new java.io.ByteArrayOutputStream();reply(board,cmd,fileStatus,begin);}
   else if(board==0x16&&cmd==0x77){int packet=file.size()/128;check(index==packet%32,"index counts inside the group");check(data.length==Math.min(128,fileLength-file.size()),"128-byte chunks, last one unpadded");file.write(data);if(index==31||file.size()==fileLength){if(dropAcks>0){dropAcks--;file=truncate(file,packet*128);return;}reply(board,cmd,0,new byte[0]);}}
   else if(board==0x16&&cmd==0x78){check(index==0,"finish index 0");byte[] all=file.toByteArray();check(all.length==fileLength,"all bytes received");same(data,SoundFile.le32(SoundFile.checksum(all)),"inverted byte sum");reply(board,cmd,finishStatus,data);}
  }
  public byte[] take(long ms)throws Exception{if(closed)throw new IllegalStateException("closed");if(ms==0&&pendingPower){pendingPower=false;reply(4,0x5c,1,new byte[0]);peer.key(password,CHALLENGE);stage="auth";}return ms==0?queue.poll():queue.poll(ms,TimeUnit.MILLISECONDS);}
  public void close(){closed=true;}
 }
 static java.io.ByteArrayOutputStream truncate(java.io.ByteArrayOutputStream b,int size){java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream();out.write(b.toByteArray(),0,size);return out;}
 static void sound()throws Exception{
  // Format: one second of silence matches the reference example of the analysis.
  byte[] silence=SoundFile.payload(SoundFile.wav(new float[8000]));check(silence.length==16056,"silence upload length");
  same(Arrays.copyOf(silence,12),NinebotCrypto.unhex("0c000000b83e0000401f1001"),"12-byte header");same(SoundFile.beginData(silence.length),NinebotCrypto.unhex("b83e000001"),"announce payload");
  check(SoundFile.checksum(silence)==0xfffff651,"checksum of the reference example");check(SoundFile.chunks(silence.length)==126,"126 chunks");
  SoundFile.Flow f=SoundFile.parseBegin(NinebotCrypto.unhex("012000ffffffff1e000000"));check(f.protocol==1&&f.group==32&&f.last==-1&&f.wait==30,"captured begin reply");
  f=SoundFile.parseBegin(NinebotCrypto.unhex("40008813"));check(f.group==64&&f.wait==0,"legacy reply, 5000 ms becomes 0");check(SoundFile.parseBegin(new byte[0]).group==8,"default group");
  float[] tone=SoundFile.testTone();check(tone.length==12000,"test tone 1.5 s");float[] cut=SoundFile.prepare(new float[44100*10],44100,1f,9f,true);check(cut.length==32000,"cut to 4 s at 8 kHz");
  expectFailure(()->SoundFile.prepare(new float[44100],44100,2f,4f,true),"start after the end");
  // Upload of the captured 26 768-byte size into slot 71 with the custom-button bit.
  Vehicle v=new Vehicle(PASSWORD);List<String> logs=new ArrayList<>();NinebotClient c=new NinebotClient(v,logs::add);c.authenticate(new String(NAME,StandardCharsets.UTF_8),PASSWORD,k->{});
  v.regs.put(0x1f,0x1001);v.regs.put(0x4a,6);byte[] payload=new byte[26768];for(int i=0;i<payload.length;i++)payload[i]=(byte)i;int[] progress={0,0};
  int logBefore=logs.size();c.uploadSound(71,payload,0x1000,(d,t)->{progress[0]=d;progress[1]=t;},()->false);
  check(v.fileSlot==71&&progress[0]==210&&progress[1]==210,"210 packets into slot 71");check(v.regs.get(0x1f)==0x1001,"bit set again, other bits kept");
  List<Integer> writes=new ArrayList<>();for(byte[] p:v.sent)if((p[5]&255)==3&&(p[6]&255)==0x1f)writes.add((p[7]&255)|((p[8]&255)<<8));check(writes.equals(Arrays.asList(0x0001,0x1001)),"0x1F cleared before and set after the upload");
  check(logs.size()-logBefore<30,"data packets are not logged one by one");
  check(c.customKey(8)==6&&v.regs.get(0x4a)==8,"button action set to sound, previous hazard lights returned");expectFailure(()->c.customKey(9),"unknown action rejected");
  check(c.soundBits(0x4000,true)==0x5001&&c.soundBits(0x1000,false)==0x4001,"toggle one event bit");
  int sent=v.sent.size();c.playSound(14);check(v.plays.equals(Arrays.asList(14))&&v.sent.size()==sent+1,"playSound writes only register 0x77");
  // Failures restore 0x1F; a missing group reply is retried.
  v.regs.put(0x1f,0x1000);v.finishStatus=3;expectFailure(()->c.uploadSound(71,payload,0x1000,(d,t)->{},()->false),"save failure stops");check(v.regs.get(0x1f)==0x1000,"previous 0x1F restored after failure");v.finishStatus=0;
  v.fileStatus=1;int before=v.sent.size();expectFailure(()->c.uploadSound(72,payload,0,(d,t)->{},()->false),"refused announce");check(v.sent.size()==before+2,"refusal: only speed read and announce");v.fileStatus=0;
  v.dropAcks=1;c.uploadSound(73,silence,0,(d,t)->{},()->false);check(v.fileSlot==73,"retried group reply completes");
  int[] count={0};expectFailure(()->c.uploadSound(71,payload,0,(d,t)->count[0]=d,()->count[0]>=10),"cancel");check(count[0]==10,"cancel stops before the next chunk");
  v.speed=2;expectFailure(()->c.uploadSound(71,payload,0,(d,t)->{},()->false),"moving scooter refuses upload");
 }
 static MapsState.Sample sample(long time){return new MapsState.Sample(100,3100,900,2,.99f,"Hauptstraße",time);}
 static void protocol()throws Exception{
  Vehicle v=new Vehicle(null);List<String> logs=new ArrayList<>();NinebotClient c=new NinebotClient(v,logs::add);byte[][] saved={null};c.authenticate(new String(NAME,StandardCharsets.UTF_8),null,k->saved[0]=k);
  check(c.ready&&v.pairs==2,"physical pairing receipt zero does not prematurely authenticate");same(saved[0],v.password,"confirmed key persisted");
  c.startNavigation();int before=v.sent.size();c.guidance(sample(1000),3100);check(v.sent.size()==before+4,"complete guidance packet set");byte[] last=v.sent.get(v.sent.size()-1);check((last[4]&255)==0x23&&(last[5]&255)==0x71&&(last[6]&255)==3&&last.length==25,"TFT 18-byte navigation info");same(Arrays.copyOfRange(last,7,last.length),NinebotCrypto.unhex("1c0c00008403000002006400000000000100"),"golden navigation payload");
  c.stopNavigation();c.range(false);check(v.range==0x9404,"range preserves unrelated flags");v.applyDelay=4;c.range(true);check(v.range==0x9414,"range restores only mask16");c.acceleration(3);check(v.accel==3,"acceleration ACK and readback");
  v.speed=1;before=v.sent.size();expectFailure(()->c.range(false),"moving cannot write range");check(v.sent.size()==before+1,"moving only reads speed");before=v.sent.size();c.startNavigation();check(v.sent.size()==before+1&&(v.sent.get(before)[4]&255)==0x23,"live navigation may start while moving and only writes TFT");
  v.speed=0;v.corruptNext=true;v.reply(0x16,4,0x57,new byte[]{0,0});v.peer.counter--;c.pump();check(c.read(0x57)==0,"bad unsolicited MAC cannot poison session");
  check(!String.join("\n",logs).contains(NinebotCrypto.hex(v.password)),"key excluded from logger");c.close();expectFailure(()->c.read(0x57),"closed client cannot read");
  Vehicle reused=new Vehicle(v.password);NinebotClient next=new NinebotClient(reused,s->{});next.authenticate(new String(NAME,StandardCharsets.UTF_8),v.password,k->{throw new AssertionError("no replacement key");});check(reused.pairs==0&&next.ready,"remembered key reuses session without Power");next.close();
  Vehicle late=new Vehicle(null);late.lateConfirm=true;NinebotClient boundary=new NinebotClient(late,s->{});boundary.authenticate(new String(NAME,StandardCharsets.UTF_8),null,k->{});check(late.pairs==1&&boundary.ready,"Power confirmation at retry boundary prevents an extra SET_PWD after key switch");boundary.close();
 }
 static void lifecycle()throws Exception{
  List<String> events=new ArrayList<>();NavigationLoop loop=new NavigationLoop(new NavigationLoop.Display(){public void start(){events.add("start");}public void update(MapsState.Sample s,int total){events.add("data");}public void stop(){events.add("stop");}});
  loop.tick(true,true,null,1000);check(events.isEmpty(),"no guessed navigation");loop.tick(true,true,sample(1000),1000);loop.tick(true,true,sample(2000),2000);check(events.equals(Arrays.asList("start","data","data")),"starts once and streams unchanged valid notification");loop.tick(true,true,null,3000);check(events.get(3).equals("stop"),"unknown guidance stops TFT");
  loop.tick(true,true,sample(4000),4000);loop.tick(false,true,sample(5000),5000);check(!loop.active()&&events.get(events.size()-1).equals("stop"),"switch off stops TFT");
  loop.tick(true,true,sample(6000),6000);loop.tick(true,false,sample(7000),7000);check(!loop.active(),"listener loss stops TFT");loop.tick(true,true,sample(8000),15000);check(!loop.active(),"stale observation not reused");
  NavigationLoop failed=new NavigationLoop(new NavigationLoop.Display(){public void start()throws Exception{throw new Exception("no ACK");}public void update(MapsState.Sample s,int total){throw new AssertionError("no data before ACK");}public void stop(){}});expectFailure(()->failed.tick(true,true,sample(1000),1000),"start error propagated");check(!failed.active(),"missing ACK never marks active");
  for(String road:new String[]{"Hauptstraße","äöüäöüäöüäöüäöüäöüäöüäöüäöü","🚲🚲🚲🚲🚲🚲🚲🚲🚲🚲🚲🚲🚲"}){byte[] b=NaviPacket.road(road);check(b.length<=40&&b[b.length-1]==0,"bounded null-terminated street");String s=new String(b,0,b.length-1,StandardCharsets.UTF_8);check(!s.contains("�"),"UTF8 truncation preserves characters");}
 }
 static void parsing(){check(Guidance.meters("110 m")==110.,"meters");check(Guidance.meters("1,5 km")==1500.,"German decimal");check(Guidance.meters("1.000 m")==null,"ambiguous distance unknown");check(Guidance.meters("Straße des 17. Juni")==null,"street not distance");check(Guidance.seconds("1 Std. 25 min · 19 km · 12:45")==5100,"duration not ETA");check(Guidance.seconds("999999999999999999999 min")==null,"oversized duration stays unknown");check(Guidance.seconds("19 km · 12:45")==null,"ETA is not duration");check(Guidance.ninebotIcon(12)==2&&Guidance.ninebotIcon(7)==3&&Guidance.ninebotIcon(2)==9,"model labels translated");check(Guidance.ninebotIcon(999)==-1,"unknown label not guessed");}
 static Map<String,String> fields(String... pairs){Map<String,String> map=new LinkedHashMap<>();for(int i=0;i<pairs.length;i+=2)map.put(pairs[i],pairs[i+1]);return map;}
 static void notificationFormats(){
  MapsNotification.Result screenshot=MapsNotification.parse(fields(MapsNotification.TITLE,"350 m · Turn right onto\nAggerstraße",MapsNotification.SUB,"Arrive 21:34"),-1,0,1792092392422L,TimeZone.getTimeZone("Europe/Berlin"));
  check(screenshot.step==350&&screenshot.icon==3,"screenshot combined instruction yields 350 m and right arrow");check(screenshot.road.equals("Aggerstraße"),"screenshot street extracted from combined title");check(screenshot.textDirection,"explicit instruction works without large icon/model");check(screenshot.seconds==448&&screenshot.secondsEstimated&&screenshot.remaining==null,"arrival minus phone time estimates duration but never invents distance");check(screenshot.sample(1000)!=null&&screenshot.sample(1000).remaining==1_337_000&&screenshot.sample(1000).distancePlaceholder,"missing distance uses user-requested 1337 km placeholder");
  Map<String,String> split=fields(MapsNotification.TITLE,"350 m",MapsNotification.TEXT,"Turn right onto Aggerstraße",MapsNotification.SUB,"8 min · 2,4 km · Arrive 21:34");MapsNotification.Result complete=MapsNotification.parse(split,-1,0);
  check(complete.sample(1000)!=null&&complete.icon==3&&complete.step==350&&complete.remaining==2400&&complete.seconds==480,"split title/text and real route summary produce eligible sample");
  MapsNotification.Result alternate=MapsNotification.parse(fields(MapsNotification.TITLE,"Maps",MapsNotification.BIG_TEXT,"350 m · Turn right onto Aggerstraße",MapsNotification.INFO,"2.4 km",MapsNotification.SUMMARY,"8 min"),-1,0);
  check(alternate.sample(1000)!=null,"big text and separate summary/info fields supported");
  MapsNotification.Result iconOnly=MapsNotification.parse(fields(MapsNotification.TITLE,"110 m",MapsNotification.TEXT,"Hauptstraße",MapsNotification.SUB,"5 min · 1.2 km"),2,.99f);
  check(iconOnly.sample(1000)!=null&&!iconOnly.textDirection&&iconOnly.road.equals("Hauptstraße"),"existing icon-based format retained");
  MapsNotification.Result street=MapsNotification.parse(fields(MapsNotification.TITLE,"350 m",MapsNotification.TEXT,"Turn Right Onto Street"),-1,0);check(street.icon==3,"instruction case insensitive");
  MapsNotification.Result named=MapsNotification.parse(fields(MapsNotification.TITLE,"350 m",MapsNotification.TEXT,"Rechtsstraße",MapsNotification.SUB,"8 min · 2 km"),-1,0);check(named.icon==-1&&named.sample(1000)==null,"street names cannot supply a guessed direction");
  MapsNotification.Result noTurn=MapsNotification.parse(fields(MapsNotification.TITLE,"Maps",MapsNotification.SUB,"8 min · 2 km"),-1,0);check(!noTurn.candidate()&&noTurn.step==null,"route summary is never mistaken for turn distance");
  MapsNotification.Result german=MapsNotification.parse(fields(MapsNotification.TITLE,"In 350 m · Rechts abbiegen auf die Aggerstraße",MapsNotification.SUB,"8 Min. · 2,4 km"),-1,0);check(german.sample(1000)!=null&&german.road.equals("Aggerstraße"),"German instruction and decimal comma");
  MapsNotification.Result disagree=MapsNotification.parse(split,2,.999f);check(disagree.icon==3&&disagree.textDirection,"literal right instruction takes precedence over mistaken left model result");
  MapsNotification.Result noDistance=MapsNotification.parse(fields(MapsNotification.TITLE,"Turn right onto Aggerstraße",MapsNotification.SUB,"8 min · 2 km"),3,.99f);check(noDistance.step==0&&noDistance.stepImmediate&&noDistance.sample(1000)!=null,"explicit direction without distance is an immediate instruction, not summary kilometers");
  MapsNotification.Result wrongSummary=MapsNotification.parse(fields(MapsNotification.TITLE,"350 m · Turn right onto Aggerstraße",MapsNotification.SUB,"350 m · Turn right onto Aggerstraße"),-1,0);check(wrongSummary.remaining==null,"repeated instruction in summary cannot masquerade as total distance");
  MapsNotification.Result eta=MapsNotification.parse(fields(MapsNotification.TITLE,"350 m · Turn right onto Aggerstraße",MapsNotification.SUB,"Arrive 21:34",MapsNotification.SUMMARY,"8 min · 2.4 km"),-1,0);check(eta.seconds==480&&eta.remaining==2400,"ETA subtext does not hide real duration/distance in summary");
 }
 static long local(String zone,int hour,int minute,int second){Calendar c=Calendar.getInstance(TimeZone.getTimeZone(zone));c.clear();c.set(2026,Calendar.OCTOBER,15,hour,minute,second);return c.getTimeInMillis();}
 static void arrivalTimes(){
  TimeZone berlin=TimeZone.getTimeZone("Europe/Berlin"),utc=TimeZone.getTimeZone("UTC");
  check(ArrivalTime.seconds("Arrive 21:44",1792092992422L,berlin)==448,"actual diagnostic timestamp: Berlin 21:36:32 to 21:44 gives about eight minutes");
  check(ArrivalTime.seconds("Arrive 21:44",local("Europe/Berlin",21,36,0),berlin)==480,"ordinary ETA subtraction");
  check(ArrivalTime.seconds("Arrive 21:44",local("Europe/Berlin",21,37,0),berlin)==420,"unchanged notification ETA counts down on next poll");
  check(ArrivalTime.seconds("Arrive 00:08",local("Europe/Berlin",23,58,0),berlin)==600,"midnight rolls to the next local day");
  check(ArrivalTime.seconds("Arrive 21:44",local("Europe/Berlin",21,44,40),berlin)==0,"same minute clamps to zero, never adds a day");
  check(ArrivalTime.seconds("Arrive 21:44",local("Europe/Berlin",21,45,0),berlin)==null,"expired ETA cannot become a 24-hour route");
  check(ArrivalTime.seconds("Arrive 25:44",local("UTC",21,0,0),utc)==null&&ArrivalTime.seconds("Arrive 21:99",local("UTC",21,0,0),utc)==null,"invalid clocks rejected");
  check(ArrivalTime.seconds("Turn right onto 21:44 Straße",local("UTC",21,0,0),utc)==null,"clock without arrival label cannot be a duration");
  check(ArrivalTime.seconds("Ankunft um 21:44",local("Europe/Berlin",21,36,0),berlin)==480,"German arrival label");
  check(ArrivalTime.seconds("Arrive 9:44 PM",local("Europe/Berlin",21,36,0),berlin)==480,"12-hour PM");
  check(ArrivalTime.seconds("Arrive 12:08 AM",local("Europe/Berlin",23,58,0),berlin)==600,"12-hour midnight");
  check(ArrivalTime.seconds("Arrive 13:08 PM",local("Europe/Berlin",12,58,0),berlin)==null,"invalid 12-hour clock");
  Map<String,String> f=fields(MapsNotification.TITLE,"350 m · Turn right onto Aggerstraße",MapsNotification.SUB,"Arrive 21:44",MapsNotification.SUMMARY,"9 min · 2.4 km");MapsNotification.Result r=MapsNotification.parse(f,-1,0,1792092992422L,berlin);
  check(r.seconds==540&&!r.secondsEstimated&&r.sample(1000)!=null,"explicit relative duration wins over rounded ETA");
  Map<String,String> actual=fields(MapsNotification.TITLE,"350\u00a0m · Turn right onto Aggerstraße",MapsNotification.SUB,"Arrive 21:44");r=MapsNotification.parse(actual,-1,.04029575f,1792092992422L,berlin);
  check(r.icon==3&&r.step==350&&r.seconds==448&&r.secondsEstimated&&r.remaining==null,"real diagnostic fields fully parsed without model");check(r.sample(1000)!=null&&r.sample(1000).remaining==1_337_000,"ETA plus fixed placeholder enables the supplied real navigation hint");check(r.status().contains("ca. 8 min Restfahrzeit"),"UI labels ETA-derived duration approximate");
 }
 static void placeholderDistance()throws Exception{
  MapsNotification.Result parsed=MapsNotification.parse(fields(MapsNotification.TITLE,"350\u00a0m · Turn right onto Aggerstraße",MapsNotification.SUB,"Arrive 21:44"),-1,.04029575f,1792092992422L,TimeZone.getTimeZone("Europe/Berlin"));
  MapsState.Sample hint=parsed.sample(1000);check(parsed.remaining==null&&parsed.distancePlaceholder(),"Maps distance remains unknown in raw diagnostics");check(parsed.displayRemaining()==1_337_000&&hint!=null&&hint.distancePlaceholder,"exact meter conversion for placeholder");check(parsed.status().contains("1337 km (Platzhalter)")&&!parsed.status().contains("Keine Display"),"UI identifies placeholder without blocking eligible guidance");
  MapsState.Sample real=MapsNotification.parse(fields(MapsNotification.TITLE,"350 m · Turn right onto Aggerstraße",MapsNotification.SUB,"8 min · 2.4 km"),-1,0).sample(2000);check(real.remaining==2400&&!real.distancePlaceholder,"actual Maps distance takes precedence");
  List<Integer> totals=new ArrayList<>();NavigationLoop loop=new NavigationLoop(new NavigationLoop.Display(){public void start(){}public void stop(){}public void update(MapsState.Sample s,int total){totals.add(total);}});loop.tick(true,true,hint,1000);loop.tick(true,true,real,2000);loop.tick(true,true,new MapsState.Sample(100,2000,400,3,1,"Road",3000),3000);loop.tick(true,true,new MapsState.Sample(100,1_337_000,300,3,1,"Road",4000,true),4000);loop.tick(true,true,new MapsState.Sample(100,1800,250,3,1,"Road",5000),5000);check(totals.equals(Arrays.asList(1_337_000,2400,2400,1_337_000,2400)),"placeholder never poisons the actual route total");
  Vehicle vehicle=new Vehicle(PASSWORD);NinebotClient client=new NinebotClient(vehicle,s->{});client.authenticate(new String(NAME,StandardCharsets.UTF_8),PASSWORD,k->{});client.startNavigation();client.guidance(hint,1_337_000);
  byte[] distance=vehicle.sent.get(vehicle.sent.size()-4),info=vehicle.sent.get(vehicle.sent.size()-1);ByteBuffer d=ByteBuffer.wrap(distance).order(ByteOrder.LITTLE_ENDIAN),i=ByteBuffer.wrap(info).order(ByteOrder.LITTLE_ENDIAN);check(d.getInt(7)==1_337_000&&i.getInt(7)==1_337_000,"encrypted TFT distance and remaining fields carry 1337000 meters");check(i.getShort(15)==3&&i.getInt(17)==350,"right arrow and actual 350-meter turn distance preserved");client.stopNavigation();client.close();
  MapsNotification.Result noTime=MapsNotification.parse(fields(MapsNotification.TITLE,"350 m · Turn right onto Aggerstraße"),-1,0);check(noTime.sample(1000)==null,"placeholder does not bypass missing time guard");MapsNotification.Result noArrow=MapsNotification.parse(fields(MapsNotification.TITLE,"350 m",MapsNotification.SUB,"8 min"),-1,0);check(noArrow.sample(1000)==null,"placeholder does not bypass unknown arrow guard");
 }
 static void departuresAndIcons()throws Exception{
  TimeZone zone=TimeZone.getTimeZone("Europe/Berlin");long now=1792093720507L;
  Map<String,String> raw=fields(MapsNotification.TITLE,"Head towards Alfred-Delp-Straße",MapsNotification.SUB,"Arrive 21:55");MapsNotification.Result depart=MapsNotification.parse(raw,-1,.04029575f,now,zone);MapsState.Sample first=depart.sample(1000);
  check(first!=null&&first.icon==9&&first.step==0&&first.remaining==1_337_000,"actual departure diagnostic becomes a complete start instruction");check(depart.departure&&depart.stepImmediate&&depart.road.equals("Alfred-Delp-Straße")&&depart.seconds==380,"departure has target street, immediate semantics and actual ETA-derived time");check(depart.status().contains("jetzt")&&!depart.status().contains("Keine Display"),"departure no longer blocks streaming");
  MapsNotification.Result turn=MapsNotification.parse(fields(MapsNotification.TITLE,"350 m · Turn right onto Aggerstraße",MapsNotification.SUB,"Arrive 21:55"),-1,0,now,zone);MapsState.Sample next=turn.sample(2000);check(next.icon==3&&next.step==350&&!turn.stepImmediate,"next real turn replaces departure zero and direction");
  MapsNotification.Result immediate=MapsNotification.parse(fields(MapsNotification.TITLE,"Turn left onto Bahnhofstraße",MapsNotification.SUB,"Arrive 21:55"),-1,0,now,zone);check(immediate.sample(1000)!=null&&immediate.step==0&&immediate.icon==2,"immediate turn without meter prefix supported");
  check(MapsNotification.parse(fields(MapsNotification.TITLE,"Starte in Richtung Bahnhofstraße",MapsNotification.SUB,"8 min"),-1,0).departure,"German departure supported");check(MapsNotification.parse(fields(MapsNotification.TITLE,"Head north towards Bahnhofstraße",MapsNotification.SUB,"8 min"),-1,0).departure,"cardinal heading treated as departure, not a left/right turn");
  check(MapsNotification.parse(fields(MapsNotification.TITLE,"Continue onto Bahnhofstraße",MapsNotification.SUB,"8 min"),-1,0).sample(1000)!=null,"continue on road without distance supported");
  check(MapsNotification.parse(fields(MapsNotification.TITLE,"Head towards",MapsNotification.SUB,"8 min"),-1,0).sample(1000)==null,"incomplete heading cannot trigger generic navigation");
  check(MapsNotification.parse(fields(MapsNotification.TITLE,"Alfred-Delp-Straße",MapsNotification.SUB,"8 min"),-1,0).sample(1000)==null,"street-only notification still cannot invent direction or distance");
  Vehicle vehicle=new Vehicle(PASSWORD);vehicle.speed=120;NinebotClient client=new NinebotClient(vehicle,s->{});client.authenticate(new String(NAME,StandardCharsets.UTF_8),PASSWORD,k->{});
  List<Integer> icons=new ArrayList<>();NavigationLoop live=new NavigationLoop(new NavigationLoop.Display(){public void start()throws Exception{client.startNavigation();}public void stop()throws Exception{client.stopNavigation();}public void update(MapsState.Sample s,int total)throws Exception{icons.add(s.icon);client.guidance(s,total);}});live.tick(true,true,first,1000);live.tick(true,true,next,2000);check(icons.equals(Arrays.asList(9,3)),"encrypted moving scooter receives departure then right turn");
  byte[] info=vehicle.sent.get(vehicle.sent.size()-1);ByteBuffer buffer=ByteBuffer.wrap(info).order(ByteOrder.LITTLE_ENDIAN);check(buffer.getShort(15)==3&&buffer.getInt(17)==350,"subsequent TFT bytes have actual right / 350 m, no departure values reused");live.tick(true,true,null,3000);check(!live.active(),"notification removal ends live navigation after departure");client.close();
  int[] black=new int[100],white=new int[100],darkOnLight=new int[100],lightOnDark=new int[100];Arrays.fill(darkOnLight,0xffffffff);Arrays.fill(lightOnDark,0xff000000);
  for(int y=2;y<8;y++)for(int x=3;x<6;x++){int i=y*10+x;black[i]=0xff000000;white[i]=0xffffffff;darkOnLight[i]=0xff000000;lightOnDark[i]=0xffffffff;}
  IconPixels.Prepared a=IconPixels.prepare(black),b=IconPixels.prepare(white),c=IconPixels.prepare(darkOnLight),d=IconPixels.prepare(lightOnDark);check(a.foreground==18&&a.mode.equals("alphaMask"),"transparent black glyph retains visible foreground instead of disappearing on black canvas");check(Arrays.equals(a.gray,b.gray),"black and white transparent glyphs produce the same model input");check(Arrays.equals(a.gray,c.gray)&&Arrays.equals(c.gray,d.gray),"opaque light/dark themes normalize to the same glyph");
  check(IconPixels.prepare(new int[100]).foreground==0,"empty transparent icon rejected");int[] blank=new int[100];Arrays.fill(blank,0xff000000);check(IconPixels.prepare(blank).foreground==0,"solid black input rejected before running inference");Arrays.fill(blank,0xffffffff);check(IconPixels.prepare(blank).foreground==0,"solid white input rejected");
 }
 static final class ManualDisplay implements NavigationLoop.Display {
  final List<String> events=new ArrayList<>();final List<MapsState.Sample> samples=new ArrayList<>();
  public void start(){events.add("start");}public void update(MapsState.Sample sample,int total){events.add("data");samples.add(sample);}public void stop(){events.add("stop");}
 }
 static void manualSending()throws Exception{
  ManualSender.Config parsed=ManualSender.Config.parse(7,"Meine Straße","321","2345,5","1,5","3",true,false);check(parsed.icon==7&&parsed.step==321&&parsed.remaining==2345500&&parsed.seconds==90&&parsed.duration==3,"manual units and comma decimal converted correctly");
  expectFailure(()->ManualSender.Config.parse(7,"Road","-1","1337","5","0",true,false),"negative manual distance rejected");expectFailure(()->ManualSender.Config.parse(7,"Road","100","0","5","0",true,false),"route distance cannot be less than turn distance");expectFailure(()->ManualSender.Config.parse(7,"Road","100","1337","5","86401",true,false),"manual duration bounded to 24h or explicit unlimited zero");expectFailure(()->ManualSender.Config.parse(7,"Road","100","9999999999999999","5","0",true,false),"route distance overflow rejected");expectFailure(()->ManualSender.Config.parse(7,"Road","100","1337","NaN","0",true,false),"invalid manual time rejected");expectFailure(()->new ManualSender.Config(10,"Road",0,100,30,0,true,false),"unknown direction not sent");
  ManualDisplay display=new ManualDisplay();NavigationLoop navigation=new NavigationLoop(display);ManualSender sender=new ManualSender();sender.start(parsed,10000);sender.tick(navigation,1000,10000);sender.tick(navigation,1250,10250);check(display.samples.size()==1,"no immediate duplicate before one second");sender.tick(navigation,-100000,11000);sender.tick(navigation,999999999,12000);check(display.samples.size()==3,"repeats on monotonic seconds independent of phone clock changes");for(MapsState.Sample sample:display.samples)check(sample.icon==7&&sample.road.equals("Meine Straße")&&sample.step==321&&sample.seconds==90,"custom direction street distance and fixed remaining time preserved");sender.tick(navigation,0,13000);check(!sender.active()&&!navigation.active()&&display.events.get(display.events.size()-1).equals("stop"),"runtime expires with display stop");int after=display.events.size();sender.tick(navigation,100000,999999);check(display.events.size()==after,"no writes after timed stop");
  sender.start(new ManualSender.Config(2,"Endlos",100,1337000,60,0,true,false),20000);sender.tick(navigation,1,20000);sender.tick(navigation,2,100000000);check(sender.active()&&navigation.active(),"zero duration repeats until explicit stop");sender.stop(navigation);after=display.events.size();sender.tick(navigation,3,100001000);check(display.events.size()==after&&!sender.active(),"explicit stop prevents all later manual writes");
  sender.start(new ManualSender.Config(3,"Einmal",10,2000,90,3,false,false),200000000);sender.tick(navigation,100,200000000);int sent=display.samples.size();sender.tick(navigation,200,200001000);sender.tick(navigation,300,200002000);check(display.samples.size()==sent,"one-shot mode never repeats");sender.tick(navigation,400,200003000);check(!sender.active()&&!navigation.active(),"one-shot duration still issues stop at deadline");
  sender.start(new ManualSender.Config(9,"Countdown",10,2000,2,0,true,true),300000000);sender.tick(navigation,100,300000000);sender.tick(navigation,200,300001000);sender.tick(navigation,300,300005000);int n=display.samples.size();check(display.samples.get(n-3).seconds==2&&display.samples.get(n-2).seconds==1&&display.samples.get(n-1).seconds==0,"optional rest-time countdown reaches zero without underflow");sender.stop(navigation);navigation.tick(true,true,sample(1000),1000);after=display.events.size();sender.tick(navigation,2000,300006000);check(display.events.size()==after&&navigation.active(),"switching back to Maps cannot be overwritten by old manual timer");navigation.stop();
  Vehicle vehicle=new Vehicle(PASSWORD);NinebotClient client=new NinebotClient(vehicle,s->{});client.authenticate(new String(NAME,StandardCharsets.UTF_8),PASSWORD,k->{});NavigationLoop actual=new NavigationLoop(new NavigationLoop.Display(){public void start()throws Exception{client.startNavigation();}public void stop()throws Exception{client.stopNavigation();}public void update(MapsState.Sample sample,int total)throws Exception{client.guidance(sample,total);}});ManualSender tx=new ManualSender();tx.start(parsed,0);tx.tick(actual,1000,0);tx.tick(actual,2000,1000);tx.tick(actual,3000,3000);
  int infoCount=0,stopCount=0;for(byte[] packet:vehicle.sent){if((packet[5]&255)!=0x71)continue;check((packet[4]&255)==0x23,"manual transmission writes TFT only");int index=packet[6]&255;if(index==3){infoCount++;ByteBuffer b=ByteBuffer.wrap(packet).order(ByteOrder.LITTLE_ENDIAN);check(b.getInt(7)==2345500&&b.getInt(11)==90&&b.getShort(15)==7&&b.getInt(17)==321,"encrypted manual payload carries all configured numeric values");}if(index==0x10||index==0x24){same(Arrays.copyOfRange(packet,7,packet.length),NaviPacket.road("Meine Straße"),"configured manual street arrives in current and next-road fields");}if(index==0&&packet.length==8&&packet[7]==0)stopCount++;}
  check(infoCount==2&&stopCount==1,"encrypted repeats terminate with exactly one confirmed stop");client.close();
 }
 public static void main(String[] args)throws Exception{crypto(args[0]);parsing();notificationFormats();arrivalTimes();placeholderDistance();departuresAndIcons();manualSending();protocol();sound();lifecycle();System.out.println("Android native: "+checks+" checks passed (Python crypto vectors, encrypted fake scooter, pairing, settings, Maps lifecycle, UTF8).");}
}
