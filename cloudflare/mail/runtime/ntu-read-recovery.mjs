// Only idempotent inbox reads use this retry. Sends and mailbox mutations do not.
const recoverable=new Set(['ntu_session_expired','ntu_action_failed','ntu_unavailable']);
export async function readNtuWithFreshSession(getSession,retireSession,read){
 for(let attempt=0;attempt<2;attempt++){
  const session=await getSession();
  try{return await session.serial(()=>read(session));}
  catch(error){if(attempt!==0||!recoverable.has(error?.code))throw error;retireSession(session);}
 }
}
export function retireNtuSessionWhenIdle(session){
 session.retired=true;
 // Work already queued on this session, including a send, is allowed to finish.
 // Clearing its cookies immediately would interrupt that operation.
 void session.chain.catch(()=>{}).then(()=>session.close()).catch(()=>{});
}
