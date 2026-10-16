package de.g3connect.maps;
/** Host-testable navigation lifecycle. A changing screen/app is not a navigation stop. */
final class NavigationLoop {
 interface Display {void start()throws Exception;void update(MapsState.Sample s,int total)throws Exception;void stop()throws Exception;}
 private final Display display;private boolean active;private int realTotal;
 NavigationLoop(Display display){this.display=display;}
 boolean active(){return active;}
 void tick(boolean armed,boolean listener,MapsState.Sample sample,long now)throws Exception{
  boolean valid=armed&&listener&&sample!=null&&sample.valid()&&now>=sample.observedAt&&now-sample.observedAt<6000;
  if(!valid){stop();return;}
  if(!active){display.start();active=true;realTotal=0;}
  int total=sample.distancePlaceholder?sample.remaining:(realTotal=Math.max(realTotal,sample.remaining));display.update(sample,total);
 }
 void stop()throws Exception{if(active){display.stop();active=false;realTotal=0;}}
}
