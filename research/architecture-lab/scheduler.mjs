// Pure model. No actual cron, dispatch or network access.
export const SLOT=1800000;
export const slotOf=ms=>Math.floor(ms/SLOT)*SLOT;
export function accept(current,incoming,now){
 if(!Number.isSafeInteger(incoming?.observedAt)||incoming.observedAt>now+60000||typeof incoming.id!=='string')return current;
 if(current&&incoming.observedAt<=current.observedAt)return current;
 return incoming;
}
export function plan({now,lastPublished,lastStarted,leaseUntil}){
 if(leaseUntil>now)return {action:'wait',reason:'lease'};
 if(lastPublished!=null&&slotOf(lastPublished)>=slotOf(now))return {action:'wait',reason:'fresh'};
 if(lastStarted!=null&&now-lastStarted<300000)return {action:'wait',reason:'backoff'};
 return {action:'acquire',slot:slotOf(now)};
}
