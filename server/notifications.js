import webpush from 'web-push';

export function createNotifications({workspace,meetings,schedules,config,sendPush=(...args)=>webpush.sendNotification(...args)}) {
  let running=false,closed=false;
  const configured=Boolean(config.vapidPublicKey&&config.vapidPrivateKey&&config.vapidSubject);
  async function tick() {
    if(running||closed)return;
    running=true;
    try {
      const upcoming=await schedules();
      const now=Date.now();
      const reminders=new Set();
      for(const item of upcoming) {
        const start=Date.parse(item.scheduledStart);if(!Number.isFinite(start))continue;
        const key=`reminder:${item.id}:${new Date(start).toISOString()}`;
        if(start>now&&start-now<=10*60000){reminders.add(key);await workspace.notify(item.hostId,{key,kind:'reminder',roomName:item.roomName});}
      }
      for(const meeting of (typeof meetings==='function'?meetings():meetings).values())if(meeting.summary&&Date.parse(meeting.summary.generatedAt)>now-7*86400000)for(const person of meeting.participants.values()) {
        if(!person.isGuest&&person.joinedAt)await workspace.notify(person.employeeId,{key:`summary:${meeting.id}:${meeting.summary.generatedAt}`,kind:'summary',roomName:meeting.roomName,meetingId:meeting.id});
      }
      if(!configured)return;
      const jobs=await workspace.claim();
      for(const job of jobs) {
        if(closed)break;
        if(job.kind==='reminder'&&!reminders.has(job.event_key)){await workspace.delivered(job.id,false);continue;}
        let retry=false;
        const subscriptions=await workspace.subscriptions(job.employee_id);
        for(const subscription of subscriptions) {
          try { await sendPush(subscription,JSON.stringify({id:job.id,title:'BaliCall',body:job.kind==='summary'?'Notulen rapat Anda sudah tersedia.':job.kind==='invitation'?'Anda menerima undangan rapat.':'Rapat Anda dimulai dalam 10 menit.',url:'/?notification='+job.id}),{TTL:600,timeout:8000,vapidDetails:{subject:config.vapidSubject,publicKey:config.vapidPublicKey,privateKey:config.vapidPrivateKey}}); }
          catch(error){if([404,410].includes(error.statusCode))await workspace.unsubscribe(job.employee_id,subscription.endpoint);else retry=true;}
        }
        await workspace.delivered(job.id,retry);
      }
    }catch { console.warn('[NOTIFICATIONS] Sync pending; will retry on the next interval.'); }
    finally{running=false;}
  }
  const timer=setInterval(()=>void tick(),30000);timer.unref?.();
  return {tick,close(){closed=true;clearInterval(timer);}};
}
