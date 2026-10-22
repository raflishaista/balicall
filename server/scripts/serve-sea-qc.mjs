// Isolated API for SEA acceptance tests. Never uses the production database/store.
import dotenv from 'dotenv';
import {readFileSync,mkdtempSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {loadConfig} from '../config.js';
import {attachSeaLiveProxy} from '../seaLiveProxy.js';

dotenv.config({path:new URL('../.env',import.meta.url)});
const secretFile=process.env.SEA_QC_SECRET_FILE;
const secret=secretFile
 ? readFileSync(secretFile,'utf8').split(/\r?\n/).find(x=>x.startsWith('SEA_LIVE_STT_SECRET='))?.slice('SEA_LIVE_STT_SECRET='.length)
 : process.env.SEA_LIVE_STT_SECRET;
if(!secret || secret.length<32) throw Error('SEA worker secret unavailable');
// db.js loads .env during import and initializes its pool from process.env.
// Clear the URL before importing the app; a config-only override is too late.
process.env.DATABASE_URL='';
const {createApp}=await import('../app.js');
const {getPool}=await import('../db.js');
if(getPool()) throw Error('SEA QC requires the database to be disabled');
const directory=process.env.SEA_QC_STORE_DIR
 ? realpathSync(process.env.SEA_QC_STORE_DIR)
 : mkdtempSync(join(tmpdir(),'balicall-sea-qc-'));
if(dirname(directory)!==realpathSync(tmpdir()) || !/^balicall-sea-qc-[a-zA-Z0-9]{6}$/.test(basename(directory))) {
 throw Error('SEA QC store must be an isolated QC directory in the system temp folder');
}
const port=Number(process.env.SEA_QC_PORT || '3012');
const config=loadConfig({...process.env,PORT:String(port),AUTH_ENABLED:'false',VERIFY_EMPLOYEE_ID:'false',LLM_PROVIDER:'demo',STT_PROVIDER:'server',STT_MODEL:'small',STT_MODELS:'small',STT_BASE_URL:'http://127.0.0.1:8001/v1',
 SEA_LIVE_STT_URL:'/sea-live-stt/asr',SEA_LIVE_STT_SECRET:secret,
 SEA_LIVE_PILOT_ENABLED:'true',
 SEA_LIVE_HEALTH_URL:process.env.SEA_QC_HEALTH_URL || 'http://127.0.0.1:8010/health',
 DATABASE_URL:'',CORS_ORIGINS:'http://localhost:5187,http://127.0.0.1:5187',MEETING_DATA_FILE:join(directory,'meetings.json')});
const {app}=createApp(config,{livekitProbe:async()=>[]});
const server=app.listen(port,'127.0.0.1',()=>console.log('SEA QC API ready on '+server.address().port));
attachSeaLiveProxy(server,config);
