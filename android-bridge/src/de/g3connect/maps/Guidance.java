package de.g3connect.maps;
import java.util.regex.*;
/** Pure parsing: unknown fields stay unknown; street names never supply distance or time. */
public final class Guidance {
 public static Double meters(String text){
  if(text==null)return null;
  Matcher m=Pattern.compile("(?iu)(?<![\\p{L}\\d])([0-9]+(?:[.,][0-9]+)?)\\s*(km|mi|m|ft)\\b").matcher(text.replace('\u00a0',' '));
  if(!m.find())return null;
  if(m.group(1).matches(".*[.,]\\d{3}"))return null; // ambiguous decimal vs thousands separator
  double n=Double.parseDouble(m.group(1).replace(',','.'));String unit=m.group(2).toLowerCase(java.util.Locale.ROOT);
  return n*(unit.equals("km")?1000:unit.equals("mi")?1609.344:unit.equals("ft")?0.3048:1);
 }
 public static Integer seconds(String subtitle){
  if(subtitle==null)return null;
  Matcher m=Pattern.compile("(?iu)(\\d+)\\s*(hours?|hrs?|h|std\\.?|godz\\.?|minutes?|mins?|min|seconds?|secs?|sek\\.?|s)\\b").matcher(subtitle);
  long n=0;boolean found=false;
  while(m.find()){
   String unit=m.group(2).toLowerCase(java.util.Locale.ROOT);int factor=unit.startsWith("h")||unit.startsWith("std")||unit.startsWith("godz")?3600:unit.startsWith("min")?60:1;
   int value;try{value=Integer.parseInt(m.group(1));}catch(NumberFormatException e){return null;}if(value>10000)return null;n+=(long)value*factor;if(n>Integer.MAX_VALUE)return null;found=true;
  }
  return found?(int)n:null;
 }
 /** Convert OpenDash/KTM semantic class IDs into Ninebot NaviState, never pass IDs through. */
 public static int ninebotIcon(int label){
  switch(label){
   case 2:return 9;case 3:case 4:return 8;
   case 5:case 6:case 14:case 16:case 18:return 5;
   case 7:return 3;case 8:return 7;
   case 10:case 11:case 15:case 17:case 19:return 4;
   case 12:return 2;case 13:return 6;case 21:return 15;
   default:if(label>=26&&label<=41)return 11;if(label>=42&&label<=57)return 12;return -1;
  }
 }
 private Guidance(){}
}
