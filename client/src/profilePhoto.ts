export async function prepareProfilePhoto(file: File) {
  if(!['image/jpeg','image/png'].includes(file.type)||!file.size||file.size>2*1024*1024)throw new Error('Pilih foto JPG/PNG maksimal 2 MB.');
  const bitmap=await createImageBitmap(file);
  try {
    if(bitmap.width*bitmap.height>4000000)throw new Error('Foto maksimal 4 megapiksel. Perkecil foto terlebih dahulu.');
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
    const context=canvas.getContext('2d');if(!context)throw new Error('Pemrosesan foto tidak didukung browser.');
    const size=Math.min(bitmap.width,bitmap.height);context.fillStyle='#fff';context.fillRect(0,0,256,256);
    context.drawImage(bitmap,(bitmap.width-size)/2,(bitmap.height-size)/2,size,size,0,0,256,256);
    return canvas.toDataURL('image/jpeg',.85);
  }finally{bitmap.close();}
}
