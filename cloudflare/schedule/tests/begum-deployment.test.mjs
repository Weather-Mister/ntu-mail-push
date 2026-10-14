import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {metadata,ACCOUNT_ID} from '../scripts/deploy-begum.mjs';
test('deployment is pinned to Begüm account, authenticated task sync and private file storage; excludes mail and notifications',()=>{
  const config=JSON.parse(readFileSync(new URL('../config/begum.json',import.meta.url),'utf8'));
  const owner={app_slug:'begum',workspace_hash:createHash('sha256').update('begum').digest('hex'),cool_feed_url:'https://cool.ntu.edu.tw/test-feed'};
  const result=metadata(config,'test-db',owner,'a'.repeat(64));
  assert.equal(config.account_id,ACCOUNT_ID);
  assert.ok(config.vars.ALLOWED_ORIGINS.includes('http://127.0.0.1:41416'));
  assert.ok(config.vars.ALLOWED_ORIGINS.includes('http://localhost:41416'));
  assert.deepEqual(result.migrations.steps,[{new_sqlite_classes:['TaskSync']},{new_sqlite_classes:['FileStore']}]);
  assert.deepEqual(result.bindings.filter(b=>b.type==='secret_text').map(b=>b.name),['SCHEDULE_KEY_HASH','COOL_FEED_URL','DOWNLOAD_SIGNING_KEY']);
  assert.equal(result.bindings.some(b=>/mail|push|vapid|r2/i.test(b.name+' '+b.type)),false);
  assert.throws(()=>metadata({...config,account_id:'a84b743620b21b93c75b87a3648e82d5'},'test-db',owner,'a'.repeat(64)),/mismatch/);
  assert.throws(()=>metadata(config,'test-db',{...owner,app_slug:'eren'},'a'.repeat(64)),/source owner/);
  assert.throws(()=>metadata(config,'test-db',{...owner,cool_feed_url:'https://evil.invalid'},'a'.repeat(64)),/calendar host/);
});
