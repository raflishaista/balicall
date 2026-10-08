import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getPool } from '../db.js';
import { initAuthDb, PgAuthStore } from '../authStore.js';

const args=process.argv.slice(2), value=flag=>args[args.indexOf(flag)+1];
const pool=getPool();
try {
  if(!pool)throw new Error('DATABASE_URL belum dikonfigurasi.');
  if(args.includes('--create-test-account')) {
    const existing=await pool.query('SELECT email FROM balicall_employees WHERE employee_id=$1',['BT-99001']);
    if(existing.rows[0]&&existing.rows[0].email!=='qa.balicall@example.test')throw new Error('NIK pengujian sudah dipakai karyawan lain.');
    await pool.query(`INSERT INTO balicall_employees(employee_id,name,email,department,position,status) VALUES($1,$2,$3,$4,$5,'active') ON CONFLICT(employee_id) DO NOTHING`,['BT-99001','Akun Uji BaliCall','qa.balicall@example.test','IT Operations','Testing']);
  }
  await initAuthDb(pool);
  if(args.includes('--migrate-only')) { console.log('Skema login berhasil diperbarui.'); }
  else {
    const id=args.includes('--create-test-account')?'BT-99001':value('--employee-id');
    if(!id||!/^BT-\d{5}$/.test(id))throw new Error('Gunakan --employee-id BT-XXXXX atau --create-test-account.');
    const invite=await new PgAuthStore(pool).invite(id);
    const output=args.includes('--output')?value('--output'):null;
    if(output) {
      await writeFile(resolve(output),JSON.stringify(invite,null,2)+'\n',{encoding:'utf8',mode:0o600,flag:'wx'});
      console.log('Kode aktivasi dibuat dan disimpan ke file lokal yang diminta (berlaku 24 jam).');
    } else console.log(JSON.stringify(invite,null,2));
  }
} catch(error) { console.error(error.code?'Operasi database gagal ('+error.code+').':error.message);process.exitCode=1; }
finally {await pool?.end();}
