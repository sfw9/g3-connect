package de.g3connect.maps;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
final class NaviPacket {
 static byte[] number(long value){return ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt((int)Math.max(0,Math.min(0xffffffffL,value))).array();}
 static byte[] info(MapsState.Sample s){return ByteBuffer.allocate(18).order(ByteOrder.LITTLE_ENDIAN).putInt(s.remaining).putInt(s.seconds).putShort((short)s.icon).putInt(s.step).putShort((short)0).putShort((short)1).array();}
 static byte[] road(String text){byte[] b=text.getBytes(StandardCharsets.UTF_8);int n=Math.min(39,b.length);while(n<b.length&&n>0&&(b[n]&0xc0)==0x80)n--;byte[] out=Arrays.copyOf(b,n+1);out[n]=0;return out;}
}
