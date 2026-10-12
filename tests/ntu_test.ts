import { parseRoundcubeCommands, roundcubeEnvironment, ntuDate, verifyNtuRunner } from '../supabase/functions/eren-mail/ntu.ts';
import { messageView, cacheMessages, clearMailMemory } from '../supabase/functions/eren-mail/services.ts';
const assert=(value:any,label='Assertion failed')=>{if(!value)throw new Error(label);};
Deno.test('Roundcube command parser accepts JSON data and never interprets email text as commands',()=>{
 const commands=parseRoundcubeCommands('this.set_env({"pagecount":2});this.add_message_row(5,{"subject":"this.command(\\\"steal\\\");"},{"seen":1,"mbox":"INBOX"},false);');
 assert(commands.length===2);assert(commands[1].args[2].seen===1);assert(commands[1].args[1].subject.includes('steal'));
 for(const payload of ['fetch("https://evil.test")','this.run(alert(1));','this.command("x");window.steal();','this.command({"x":1});/* ignored */']){let rejected=false;try{parseRoundcubeCommands(payload);}catch{rejected=true;}assert(rejected,'Executable provider response accepted');}
});
Deno.test('Roundcube login environment is JSON only; malformed or executable values are rejected',()=>{
 assert(roundcubeEnvironment('<script>rcmail.set_env({"task":"mail","request_token":"test","nested":{"x":"}"}});</script>').task==='mail');
 assert(Object.keys(roundcubeEnvironment('rcmail.set_env({"task":alert(1)});')).length===0);
});
Deno.test('NTU metadata timestamps interpret provider local time in Taipei',()=>{
 const time=ntuDate('<span title="2026-10-12 11:38:00">Today 11:38</span>');assert(time===Date.parse('2026-10-12T03:38:00Z'));
 assert(ntuDate('Today 11:38',Date.parse('2026-10-12T03:50:00Z'))===time);
 assert(ntuDate('Fri 06:01',Date.parse('2026-10-12T03:50:00Z'))===Date.parse('2026-10-09T06:01:00+08:00'));
 assert(ntuDate('not a date')===0);
});
Deno.test('NTU metadata refresh preserves previously learned classification and applies current explicit rules',()=>{
 const message={id:'ntu_1',threadId:'ntu_1',metadataOnly:true,cachedClassification:{type:'Login Code',code:'123456',priority:'Normal',action:'FYI',blocked:false,ruleIds:[]},cachedSnippet:'Your code is 123456',labelIds:['INBOX','UNREAD'],internalDate:'1',payload:{headers:[{name:'From',value:'security@example.org'},{name:'Subject',value:'Sign in'}]}};
 const view=messageView(message,[],{},true,true);assert(view.classification.type==='Login Code');assert(view.classification.code==='123456');assert(view.snippet==='Your code is 123456');
 const changed=messageView(message,[{id:'r1',scope:'sender',match_value:'security@example.org',effects:{priority:'Low'}}],{},true,true);assert(changed.classification.type==='Login Code');assert(changed.classification.priority==='Low');
});
Deno.test('NTU runner provisioning rejects another repo, ref, audience, expiry, and unsigned proof before network access',async()=>{
 const base={iss:'https://token.actions.githubusercontent.com',aud:'eren-mail-ntu-import',repository:'Weather-Mister/ntu-mail-push',repository_id:'1373793193',ref:'refs/heads/test',workflow_ref:'test-workflow',event_name:'push',exp:Math.floor(Date.now()/1000)+300,iat:Math.floor(Date.now()/1000)};
 const encode=(v:any)=>btoa(JSON.stringify(v)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
 for(const change of [{repository:'someone/mail'},{ref:'refs/heads/other'},{aud:'other'},{exp:1}]){let rejected=false;try{await verifyNtuRunner(encode({alg:'RS256',kid:'test'})+'.'+encode({...base,...change})+'.fake',{ref:base.ref,workflow:base.workflow_ref});}catch{rejected=true;}assert(rejected);}
});
