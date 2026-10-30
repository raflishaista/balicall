import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/transcriptionStatus.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const exports={};new Function('exports',code)(exports);
const status=patch=>exports.transcriptionStatus({connected:true,isMuted:false,isListening:true,speechEnabled:true,saveBlocked:false,interimText:'',pendingSaves:0,...patch});
test('errors take priority over listening and mute, with honest preservation guidance',()=>{
 assert.equal(status({speechError:'Worker disconnected',isMuted:true}).tone,'error');
 assert.equal(status({saveBlocked:true}).label,'Penyimpanan bermasalah');
 assert.equal(status({speechError:'Worker disconnected'}).label,'Transkripsi bermasalah');
});
test('interim is explicitly provisional, never described as saved',()=>{
 const result=status({interimText:'Rapat hari'});assert.equal(result.label,'Teks sementara');assert.match(result.detail,/berubah/);assert.doesNotMatch(result.detail,/sudah tersimpan/i);
});
test('muting or stopping capture does not hide unfinished processing',()=>{
 assert.equal(status({isMuted:true,pendingSaves:2}).label,'Menyelesaikan transkrip');
 assert.equal(status({speechEnabled:false,pendingSaves:1}).label,'Menyelesaikan transkrip');
 assert.equal(status({pendingSaves:2}).label,'Memproses ucapan');
});
test('idle, starting, paused and disconnected states have distinct explanations',()=>{
 assert.equal(status({}).label,'Mendengarkan');
 assert.equal(status({isListening:false}).label,'Menghubungkan transkripsi');
 assert.equal(status({isMuted:true}).label,'Mikrofon nonaktif');
 assert.equal(status({speechEnabled:false}).label,'Transkripsi dijeda');
 assert.equal(status({connected:false}).label,'Koneksi rapat terputus');
});
