import {createHash} from 'node:crypto';

const writes=new Set(['createProject','createTask','updateTask','updateTaskStatus','updateProject','assignSprintTasks','createSprint','updateSprint','startSprint','completeSprint','deleteSprint','removeSprintTask','createComment']);
const reads=new Set(['taskOptions','projectTasks','projectOptions','userProjects','projectDetail','projectSprints','listQueryableModels','queryData']);
const fields=['itProjectTaskDispatch','itProjectProjectDispatch'];
const canonical=value=>JSON.stringify(value,(_key,item)=>item && typeof item==='object' && !Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const symbolic=value=>canonical(value)?.includes('@review:');
const replace=(value,ids)=>JSON.parse(JSON.stringify(value,(_key,item)=>typeof item==='string' && ids[item]?ids[item]:item));

export function createMcpReview({store,client,plan,destination=''}) {
  const locks=new Set();
  const summaryOf=m=>m?.postMeetingBatch?.status==='done'?m.postMeetingBatch.summary:m?.summary;
  const context=()=>({destination,projectId:client.projectId,taskTypeId:client.taskTypeId,taskCategoryId:client.taskCategoryId,taskStatusName:client.taskStatusName});
  const revision=(m,s)=>hash({summary:{...s,dbSummaryId:undefined},transcripts:m.transcripts,context:context()});
  function register(meeting,summary) {
    if (!summary || !meeting?.hostId) return null;
    const key=revision(meeting,summary);
    if (!store.get(meeting.id)?.mcpReviews?.[key]) store.transact(()=>{
      const current=store.get(meeting.id);current.mcpReviews ||= {};
      current.mcpReviews[key]={revision:key,hostId:meeting.hostId,status:'pending',createdAt:new Date().toISOString(),operations:[],reads:[]};
    });
    return store.get(meeting.id).mcpReviews[key];
  }
  function current(id) {
    const meeting=store.get(id);
    if (!meeting) throw fail('Rapat tidak ditemukan.',404);
    if (!meeting.hostId) throw fail('Identitas host rapat tidak tersedia; pengiriman diblokir.',409);
    if (!summaryOf(meeting)) throw fail('Notulen belum tersedia untuk ditinjau.',409);
    return {meeting,summary:summaryOf(meeting),record:register(meeting,summaryOf(meeting))};
  }
  const save=(id,key,update)=>store.transact(()=>Object.assign(store.get(id).mcpReviews[key],update));
  function publicRecord(record,actor,meeting) {
    const host=actor===meeting.hostId;
    return {revision:record.revision,planDigest:record.planDigest || '',status:record.status,
      canDecide:host && ['pending','ready','rejected','blocked'].includes(record.status),
      operations:host?record.operations:[],evidence:host?(summaryOf(meeting)?.sourceEvidence?.items || []):[],error:record.error || null,
      decidedBy:record.decidedBy || null,decidedAt:record.decidedAt || null,
      results:host?record.results || []:[],note:record.note || null};
  }
  async function prepare(id,actor) {
    const {meeting,summary,record}=current(id);
    if(actor!==meeting.hostId)return publicRecord(record,actor,meeting);
    if(record.status==='sending' && !locks.has(id)) save(id,record.revision,{status:'needs_check',error:'Pengiriman terputus. Periksa hasil di IT Project; sistem tidak mengirim ulang otomatis.'});
    if(record.status==='blocked')save(id,record.revision,{status:'pending'});
    if(record.status!=='pending')return publicRecord(record,actor,meeting);
    if(locks.has(id))return publicRecord(record,actor,meeting);
    if(!client.authenticated) {save(id,record.revision,{status:'blocked',error:'Koneksi akun IT Project belum tersedia.'});return publicRecord(record,actor,meeting);}
    locks.add(id);
    try {
      const shadow={meetings:structuredClone(store.meetings),get(key){return this.meetings.get(key)},transact(fn){return fn()}};
      const operations=[],conditions=[];
      const proxy=new Proxy(client,{get(target,key){
        if(writes.has(key))return async args=>{
          const operation={method:key,args:structuredClone(args),ref:`@review:${operations.length}`};operations.push(operation);
          return {data:{data:{id:operation.ref,title:args.title,created_at:new Date().toISOString()}}};
        };
        if(reads.has(key))return async(...args)=>{
          if(symbolic(args))throw fail('Opsi proyek baru belum tersedia; tinjau task setelah proyek dibuat.');
          const result=await target[key](...args);conditions.push({method:key,args:structuredClone(args),digest:hash(result.data)});return result;
        };
        const value=Reflect.get(target,key);if(typeof value==='function')throw fail('Operasi MCP tidak dikenal.',400);return value;
      }});
      let note=null;
      try{await plan(shadow.get(id),structuredClone(summary),proxy,shadow);}catch(error){
        if(operations.length && operations.every(op=>op.method==='createProject')) note='Tinjauan ini hanya membuat proyek. Task untuk proyek baru memerlukan tinjauan berikutnya setelah opsi proyek tersedia.';
        else throw error;
      }
      if(revision(store.get(id),summaryOf(store.get(id)))!==record.revision)throw fail('Notulen berubah saat menyiapkan tinjauan. Muat ulang.');
      const claims=['actionItems','taskUpdates','taskEdits','projectCreations','projectUpdates'].flatMap(field=>summary[field] || []);
      if(!operations.length && claims.length)throw fail('Tidak ada perubahan yang dapat disiapkan. Periksa target proyek/task dan hasil sinkronisasi sebelumnya.');
      const markers=Object.fromEntries(fields.map(field=>[field,shadow.get(id)[field] || {}]));
      const planDigest=hash({operations,conditions,markers});
      save(id,record.revision,{status:'ready',operations,reads:conditions,markers,planDigest,note,error:null});
    } catch(error){save(id,record.revision,{status:'blocked',error:error.message});}
    finally{locks.delete(id);}
    return publicRecord(record,actor,meeting);
  }
  async function decide(id,actor,body) {
    const {meeting,summary,record}=current(id);
    if(actor!==meeting.hostId)throw fail('Hanya host rapat yang boleh menyetujui.',403);
    if(typeof body.decision!=='boolean')throw fail('Pilih Ya atau Tidak.',400);
    if(body.revision!==record.revision || body.planDigest!==record.planDigest)throw fail('Versi tinjauan sudah berubah. Muat ulang.');
    if(record.status==='sent')return publicRecord(record,actor,meeting);
    if(locks.has(id) || ['sending','needs_check'].includes(record.status))throw fail('Hasil pengiriman perlu diperiksa; tidak dikirim ulang otomatis.');
    if(!body.decision && ['pending','blocked','ready','rejected'].includes(record.status)){save(id,record.revision,{status:'rejected',decidedBy:actor,decidedAt:new Date().toISOString()});return publicRecord(record,actor,meeting);}
    if(!['ready','rejected'].includes(record.status) || !record.planDigest)throw fail('Rencana belum siap ditinjau.');
    locks.add(id);
    let sending=false;
    try {
      for(const condition of record.reads){
        const result=await client[condition.method](...condition.args);
        if(hash(result.data)!==condition.digest){save(id,record.revision,{status:'pending',planDigest:'',operations:[],error:'Data IT Project berubah. Tinjau rencana terbaru.'});throw fail('Data IT Project berubah. Muat ulang untuk meninjau kembali.');}
      }
      if(revision(store.get(id),summaryOf(store.get(id)))!==record.revision)throw fail('Notulen berubah; perlu persetujuan baru.');
      save(id,record.revision,{status:'sending',decidedBy:actor,decidedAt:new Date().toISOString(),results:[]});sending=true;
      const ids={};
      for(const [index,operation] of record.operations.entries()) {
        if(revision(store.get(id),summaryOf(store.get(id)))!==record.revision)throw fail('Notulen berubah ketika pengiriman berlangsung. Periksa hasil parsial.');
        const args=replace(operation.args,ids);
        if(symbolic(args))throw fail('Target aksi belum terkonfirmasi.');
        save(id,record.revision,{activeOperation:index});
        const result=await client[operation.method](args);
        const data=result?.data?.data || result?.data?.project || result?.data;
        if(['createTask','createProject'].includes(operation.method)){
          if(!data?.id)throw fail('Layanan menerima aksi tetapi ID hasil tidak tersedia. Periksa IT Project.');
          ids[operation.ref]=data.id;
        }
        store.transact(()=>{
          const m=store.get(id),r=m.mcpReviews[record.revision];r.results.push({index,method:operation.method,status:'sent',id:data?.id || null});
          for(const field of fields){
            const entries=replace(record.markers[field],ids);
            m[field] ||= {};
            for(const [key,entry] of Object.entries(entries))if(!symbolic(entry))m[field][key]=entry;
          }
        });
      }
      if(record.note){
        save(id,record.revision,{status:'pending',completedPlans:[...(record.completedPlans || []),{planDigest:record.planDigest,results:record.results,decidedBy:actor,decidedAt:record.decidedAt}],operations:[],reads:[],planDigest:'',error:null});
      } else save(id,record.revision,{status:'sent',sentAt:new Date().toISOString(),activeOperation:null,error:null});
    } catch(error){
      if(sending){save(id,record.revision,{status:'needs_check',error:'Hasil pengiriman belum pasti. Periksa IT Project sebelum tindakan selanjutnya.'});}
      else throw error;
    } finally{locks.delete(id);}
    return publicRecord(record,actor,meeting);
  }
  return {register,review:prepare,decide};
}
