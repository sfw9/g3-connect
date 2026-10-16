package de.g3connect.maps;
import android.content.Context;
import android.graphics.*;
import android.view.View;
/** Draws the maneuver of a G3 navigation icon code (2–9, 11, 12, 15) on a 24-unit grid. */
final class TurnIcon extends View {
 private final Paint stroke=new Paint(Paint.ANTI_ALIAS_FLAG),fill=new Paint(Paint.ANTI_ALIAS_FLAG);private final Path path=new Path();private int icon=-1;
 TurnIcon(Context context){super(context);stroke.setStyle(Paint.Style.STROKE);stroke.setStrokeCap(Paint.Cap.ROUND);stroke.setStrokeJoin(Paint.Join.ROUND);stroke.setStrokeWidth(2.4f);fill.setStyle(Paint.Style.FILL);}
 void set(int code,int color){if(icon==code&&stroke.getColor()==color)return;icon=code;stroke.setColor(color);fill.setColor(color);invalidate();}
 @Override protected void onDraw(Canvas c){
  float size=Math.min(getWidth(),getHeight());if(size<=0)return;
  c.save();c.translate((getWidth()-size)/2f,(getHeight()-size)/2f);c.scale(size/24f,size/24f);
  // Left-hand maneuvers are drawn as their mirrored right-hand counterpart.
  if(icon==2||icon==4||icon==6||icon==12)c.scale(-1,1,12,12);
  switch(icon){
   case 9:turn(c,0,12);break;
   case 2:case 3:turn(c,90,12);break;
   case 4:case 5:turn(c,45,12);break;
   case 6:case 7:turn(c,135,9);break;
   case 8:uTurn(c);break;
   case 11:case 12:roundabout(c);break;
   case 15:arrive(c);break;
   default:compass(c);
  }
  c.restore();
 }
 /** Stem from the bottom to a junction, then a leg at {@code degrees} clockwise from straight ahead. */
 private void turn(Canvas c,float degrees,float junction){
  double a=Math.toRadians(degrees);float dx=(float)Math.sin(a),dy=(float)-Math.cos(a),shift=-dx*3.5f,x=12+shift,len=7;
  float ex=x+dx*len,ey=junction+dy*len;
  path.reset();path.moveTo(x,21);path.lineTo(x,junction);path.lineTo(ex,ey);c.drawPath(path,stroke);head(c,ex,ey,dx,dy);
 }
 private void uTurn(Canvas c){
  path.reset();path.moveTo(16,21);path.lineTo(16,10);path.arcTo(new RectF(8,6,16,14),0,-180,false);path.lineTo(8,15);c.drawPath(path,stroke);head(c,8,15,0,1);
 }
 private void roundabout(Canvas c){
  c.drawCircle(12,10,4,stroke);path.reset();path.moveTo(12,21);path.lineTo(12,14);c.drawPath(path,stroke);
  float d=(float)Math.sqrt(.5);path.reset();path.moveTo(12+4*d,10-4*d);path.lineTo(17.5f,4.5f);c.drawPath(path,stroke);head(c,17.5f,4.5f,d,-d);
 }
 private void arrive(Canvas c){c.drawCircle(12,12,7.5f,stroke);c.drawCircle(12,12,3.2f,fill);}
 private void compass(Canvas c){path.reset();path.moveTo(4,11);path.lineTo(20,4);path.lineTo(13,20);path.lineTo(11,13);path.close();c.drawPath(path,stroke);}
 private void head(Canvas c,float x,float y,float dx,float dy){
  float px=-dy,py=dx;path.reset();path.moveTo(x+dx*3.6f,y+dy*3.6f);path.lineTo(x+px*3.2f,y+py*3.2f);path.lineTo(x-px*3.2f,y-py*3.2f);path.close();c.drawPath(path,fill);
 }
}
