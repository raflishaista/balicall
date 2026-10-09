import webpush from 'web-push';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const output=process.argv[2];
if(!output){console.error('Gunakan: node server/scripts/push-keys.js <file-lokal-di-luar-repo>. Kunci tidak dicetak ke terminal.');process.exitCode=1;}
else{
  const path=resolve(output),repo=resolve(fileURLToPath(new URL('../..',import.meta.url)));
  if(path.toLowerCase().startsWith(repo.toLowerCase()))throw new Error('Simpan kunci di luar repository.');
  const keys=webpush.generateVAPIDKeys();
  await writeFile(path,`VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=\n`,{flag:'wx',mode:0o600});
  console.log('Kunci dibuat di file lokal yang diminta. Isi VAPID_SUBJECT dengan mailto: kontak admin atau URL HTTPS sebelum konfigurasi server.');
}
