import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('Begüm and Eren execute identical mail client code and base styles',()=>{
 for(const name of ['mail-demo.js','mail-demo.css','mail-modern.css'])assert.equal(read('sites/begum/'+name),read('sites/eren/'+name));
 assert.match(read('sites/begum/index.html'),/data-workspace="begum"/);
 assert.match(read('sites/begum/sw.js'),/mail-garden.css/);
});
