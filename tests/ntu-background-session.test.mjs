import test from 'node:test';
import assert from 'node:assert/strict';
import {ntuSessionKey} from '../cloudflare/mail/runtime/ntu-session-key.mjs';
import {NtuMessageMemory} from '../cloudflare/mail/runtime/ntu-message-memory.mjs';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
test('NTU foreground and scheduled-sync queues are distinct and remain owner scoped',()=>{
 const a={workspace_hash:'owner-a',id:'same-id'},b={workspace_hash:'owner-b',id:'same-id'};
 assert.notEqual(ntuSessionKey(a),ntuSessionKey(a,true));assert.notEqual(ntuSessionKey(a,true),ntuSessionKey(b,true));
 assert(ntuSessionKey(a,true).startsWith(ntuSessionKey(a)+':'));
 const foreground=ntuSessionKey(a),background=ntuSessionKey(a,true),queues=new Map([[background,new Promise(()=>{})],[foreground,Promise.resolve('foreground read')]]);
 return queues.get(foreground).then(value=>assert.equal(value,'foreground read'));
});
test('actual NTU sessions keep a queued background read from delaying the foreground serial queue',async()=>{
 let code=stripTypeScriptTypes(readFileSync(new URL('../cloudflare/mail/runtime/provider/ntu.ts',import.meta.url),'utf8'),{mode:'transform'}).replace(/^import[^;]*;\s*/gm,'').replace(/export /g,'');
 code+='\nRoundcube.prototype.login=async function(){};this.getSession=ntuSession;';
 const env={},context={environment:()=>env,ntuSessionKey,NtuMessageMemory,secret:async()=>JSON.stringify({username:'synthetic',password:'synthetic'}),check:r=>r.data,MailError:class extends Error{constructor(status,message){super(message);this.status=status;}}};
 runInNewContext(code,context);
 const a={workspace_hash:'owner-a',id:'account',secret_name:'synthetic'};
 const foreground=await context.getSession({},a);env.MAIL_NTU_BACKGROUND=true;const background=await context.getSession({},a);assert.notEqual(foreground,background);
 let release;const waiting=background.serial(()=>new Promise(resolve=>{release=resolve;}));await Promise.resolve();
 env.MAIL_NTU_BACKGROUND=false;assert.equal(await context.getSession({},a),foreground);assert.equal(await foreground.serial(async()=> 'ready'),'ready');release('complete');await waiting;
});
