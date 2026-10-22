import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {sealBundle} from './publish-crypto.mjs';
import {decryptBundle} from '../encrypted-data.js';
test('published data round-trips only with its private key and rejects tampering',async()=>{
 const key=randomBytes(32).toString('base64url'),bundle={snapshot:{schema:'momentum.daily.v1',candidates:[{name:'비공개 후보'}],quotes:[]},status:{state:'completed'}},encrypted=sealBundle(bundle,key);
 assert(!JSON.stringify(encrypted).includes('비공개 후보'));assert(!JSON.stringify(encrypted).includes(key));
 assert.deepEqual(await decryptBundle(encrypted,key),bundle);
 await assert.rejects(()=>decryptBundle(encrypted,randomBytes(32).toString('base64url')));
 await assert.rejects(()=>decryptBundle(encrypted,''));
 const bytes=Buffer.from(encrypted.data,'base64');bytes[0]^=1;
 await assert.rejects(()=>decryptBundle({...encrypted,data:bytes.toString('base64')},key));
});
