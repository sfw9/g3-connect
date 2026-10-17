package de.g3connect.maps;
import android.bluetooth.*;
import android.content.Context;
import android.os.Build;
import java.util.*;
import java.util.concurrent.*;
import java.io.IOException;
/** One GATT instance per session; callbacks never run the blocking protocol worker. */
final class BleWire implements NinebotClient.Wire {
 private static final UUID SERVICE=UUID.fromString("6e400001-b5a3-f393-e0a9-e50e24dcca9e"),TX=UUID.fromString("6e400002-b5a3-f393-e0a9-e50e24dcca9e"),RX=UUID.fromString("6e400003-b5a3-f393-e0a9-e50e24dcca9e"),CCCD=UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"),NINEBOT=UUID.fromString("6e400001-0000-0000-006e-696e65626f74");
 private final BlockingQueue<byte[]> incoming=new LinkedBlockingQueue<>();private final NinebotCrypto.Frames frames=new NinebotCrypto.Frames();
 private final CountDownLatch connected=new CountDownLatch(1),mtuDone=new CountDownLatch(1),discovered=new CountDownLatch(1),subscribed=new CountDownLatch(1);
 private volatile CountDownLatch written;private volatile BluetoothGatt gatt;private BluetoothGattCharacteristic tx;private volatile int mtu=23;private volatile String failure;private volatile boolean closed;private volatile int writeStatus;
 private final BluetoothGattCallback callback=new BluetoothGattCallback(){
  @Override public void onConnectionStateChange(BluetoothGatt g,int status,int state){if(closed)return;if(status!=BluetoothGatt.GATT_SUCCESS||state==BluetoothProfile.STATE_DISCONNECTED){fail("Bluetooth-Verbindung getrennt (GATT "+status+").");return;}if(state==BluetoothProfile.STATE_CONNECTED)connected.countDown();}
  @Override public void onMtuChanged(BluetoothGatt g,int value,int status){if(closed)return;if(status==BluetoothGatt.GATT_SUCCESS)mtu=value;mtuDone.countDown();}
  @Override public void onServicesDiscovered(BluetoothGatt g,int status){if(closed)return;if(status!=BluetoothGatt.GATT_SUCCESS)fail("GATT-Services nicht lesbar.");discovered.countDown();}
  @Override public void onDescriptorWrite(BluetoothGatt g,BluetoothGattDescriptor d,int status){if(closed)return;if(status!=BluetoothGatt.GATT_SUCCESS)fail("Notifications konnten nicht aktiviert werden.");subscribed.countDown();}
  @Override public void onCharacteristicWrite(BluetoothGatt g,BluetoothGattCharacteristic c,int status){if(closed)return;writeStatus=status;CountDownLatch latch=written;if(latch!=null)latch.countDown();}
  @Override public void onCharacteristicChanged(BluetoothGatt g,BluetoothGattCharacteristic c){accept(c,c.getValue());}
  @Override public void onCharacteristicChanged(BluetoothGatt g,BluetoothGattCharacteristic c,byte[] value){accept(c,value);}
 };
 private synchronized void accept(BluetoothGattCharacteristic c,byte[] value){if(!closed&&RX.equals(c.getUuid())&&value!=null)for(byte[] frame:frames.push(value.clone()))incoming.offer(frame);}
 BleWire(Context context,BluetoothDevice device){gatt=device.connectGatt(context,false,callback,BluetoothDevice.TRANSPORT_LE);if(gatt==null)fail("GATT konnte nicht gestartet werden.");}
 void open()throws Exception {
  waitFor(connected,12000);if(!gatt.requestMtu(185))throw new IOException("MTU-Anfrage abgelehnt.");waitFor(mtuDone,6000);if(mtu<34)throw new IOException("Bluetooth-MTU zu klein für Navigationsdaten: "+mtu);
  if(!gatt.discoverServices())throw new IOException("Service-Suche nicht gestartet.");waitFor(discovered,8000);BluetoothGattService service=gatt.getService(SERVICE);if(service==null)throw new IOException(gatt.getService(NINEBOT)!=null?"Dieser Roller nutzt den neueren Ninebot-BLE-Dienst. Die Android-App unterstützt bisher nur Nordic UART (wie beim G3); bitte die Web-App verwenden.":"Nordic UART fehlt. Dieser BLE-Dienst wird noch nicht unterstützt.");
  tx=service.getCharacteristic(TX);BluetoothGattCharacteristic rx=service.getCharacteristic(RX);if(tx==null||rx==null)throw new IOException("UART-Characteristics fehlen.");
  if(!gatt.setCharacteristicNotification(rx,true))throw new IOException("Notifications abgelehnt.");BluetoothGattDescriptor descriptor=rx.getDescriptor(CCCD);if(descriptor==null)throw new IOException("Notification-Descriptor fehlt.");
  boolean queued;if(Build.VERSION.SDK_INT>=33)queued=gatt.writeDescriptor(descriptor,BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)==BluetoothStatusCodes.SUCCESS;else{descriptor.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);queued=gatt.writeDescriptor(descriptor);}if(!queued)throw new IOException("Notification-Abo nicht gestartet.");waitFor(subscribed,5000);
 }
 private void waitFor(CountDownLatch latch,long ms)throws Exception{if(!latch.await(ms,TimeUnit.MILLISECONDS))throw new IOException("Bluetooth-Zeitlimit überschritten.");check();}
 private void check()throws IOException{if(closed||failure!=null)throw new IOException(failure==null?"Bluetooth-Verbindung geschlossen.":failure);}
 @Override public void write(byte[] raw)throws Exception{check();if(raw.length>mtu-3)throw new IOException("Paket überschreitet die GATT-MTU.");written=new CountDownLatch(1);writeStatus=-1;int type=(tx.getProperties()&BluetoothGattCharacteristic.PROPERTY_WRITE)!=0?BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT:BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE;
  boolean queued;if(Build.VERSION.SDK_INT>=33)queued=gatt.writeCharacteristic(tx,raw,type)==BluetoothStatusCodes.SUCCESS;else{tx.setWriteType(type);tx.setValue(raw);queued=gatt.writeCharacteristic(tx);}if(!queued)throw new IOException("GATT-Schreiben abgelehnt.");waitFor(written,5000);if(writeStatus!=BluetoothGatt.GATT_SUCCESS)throw new IOException("GATT-Schreibfehler "+writeStatus);written=null;
 }
 @Override public byte[] take(long timeout)throws Exception{check();byte[] b=timeout==0?incoming.poll():incoming.poll(timeout,TimeUnit.MILLISECONDS);check();return b;}
 private void fail(String message){failure=message;connected.countDown();mtuDone.countDown();discovered.countDown();subscribed.countDown();CountDownLatch w=written;if(w!=null)w.countDown();incoming.offer(new byte[0]);}
 @Override public void close(){if(closed)return;closed=true;fail("Bluetooth-Verbindung geschlossen.");BluetoothGatt g=gatt;if(g!=null){try{g.disconnect();}catch(Exception ignored){}g.close();}incoming.clear();incoming.offer(new byte[0]);}
}
