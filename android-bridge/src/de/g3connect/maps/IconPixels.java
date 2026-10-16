package de.g3connect.maps;
/** Convert transparent black/white glyphs or opaque light/dark icons to the model's white-on-black input. */
final class IconPixels {
 static final class Prepared {final int[] gray;final int foreground;final String mode;Prepared(int[] gray,int foreground,String mode){this.gray=gray;this.foreground=foreground;this.mode=mode;}}
 static Prepared prepare(int[] argb){
  int[] gray=new int[argb.length],hist=new int[256];int visible=0,min=255,max=0,transparent=0;
  for(int pixel:argb){int alpha=pixel>>>24;if(alpha<16)transparent++;if(alpha>16){int y=luma(pixel);hist[y]++;min=Math.min(min,y);max=Math.max(max,y);visible++;}}
  if(visible==0)return new Prepared(gray,0,"blank");
  String mode;
  if(max-min>=32){int background=0;for(int i=1;i<256;i++)if(hist[i]>hist[background])background=i;int range=Math.max(Math.abs(max-background),Math.abs(min-background));
   for(int i=0;i<argb.length;i++){int alpha=argb[i]>>>24;gray[i]=Math.min(255,Math.abs(luma(argb[i])-background)*255/Math.max(1,range))*alpha/255;}mode="backgroundContrast";
  }else if(transparent>argb.length/20){for(int i=0;i<argb.length;i++)gray[i]=argb[i]>>>24;mode="alphaMask";
  }else return new Prepared(gray,0,"blank");
  int foreground=0;for(int v:gray)if(v>32)foreground++;
  if(foreground<Math.max(4,argb.length/100)||foreground>argb.length*9/10)return new Prepared(new int[argb.length],0,"blank");
  return new Prepared(gray,foreground,mode);
 }
 private static int luma(int p){return(77*((p>>>16)&255)+150*((p>>>8)&255)+29*(p&255))>>>8;}
 private IconPixels(){}
}
