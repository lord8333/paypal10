import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import fs from 'node:fs';
import {configuration,createHandler} from './checkout-core.mjs';
const env={PAYPAL_CLIENT_ID:'fake-client',PAYPAL_CLIENT_SECRET:'fake-secret-not-real',CHECKOUT_PASSWORD:'very-long-private-password',PUBLIC_URL:'https://example.com'};
test('configuração não usa Redis, bloqueia Live e valida segredos no servidor',()=>{
 assert.equal(configuration(env).env,'sandbox');assert.throws(()=>configuration({...env,PAYPAL_ENV:'live'}),/Live bloqueado/);assert.throws(()=>configuration({...env,PUBLIC_URL:'http://example.com'}),/HTTPS/);assert.throws(()=>configuration({...env,PAYPAL_CLIENT_SECRET:''}),/PAYPAL_CLIENT_SECRET/);assert.equal(configuration({...env,PAYPAL_ENV:'live',ALLOW_LIVE_PAYMENTS:'true'}).env,'live');
});
async function harness(t){
 const cfg=configuration(env);let owner,mismatch=false,pending=false,foreign=false,captureCalls=0,complete=false,clock=Date.now();const createKeys=[],captureKeys=[];
 const id='TESTORDER12345';
 const api=async(method,path,body,key)=>{
  if(method==='GET')return {id,status:complete?'COMPLETED':'APPROVED',purchase_units:[{custom_id:foreign?'wrong':owner,amount:{currency_code:'BRL',value:mismatch?'2.00':'1.00'},...(complete?{payments:{captures:[{id:'CAPTURE123',status:'COMPLETED',amount:{currency_code:'BRL',value:'1.00'}}]}}:{})}]};
  if(path.endsWith('/capture')){captureCalls++;captureKeys.push(key);if(!pending)complete=true;return {id,status:'COMPLETED',purchase_units:[{payments:{captures:[{id:'CAPTURE123',status:pending?'PENDING':'COMPLETED',amount:{currency_code:'BRL',value:'1.00'}}]}}]};}
  owner=body.purchase_units[0].custom_id;createKeys.push(key);return {id,links:[{rel:'payer-action',href:'https://www.sandbox.paypal.com/checkoutnow?token='+id}]};
 };
 const servers=[1,2].map(()=>http.createServer(createHandler(cfg,{api,now:()=>clock})));
 for(const s of servers)await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(async()=>await Promise.all(servers.map(s=>new Promise(r=>s.close(r)))));
 const base=servers.map(s=>'http://127.0.0.1:'+s.address().port),auth='Basic '+Buffer.from('teste:'+cfg.password).toString('base64');
 const r=await fetch(base[0]+'/api/config',{headers:{Authorization:auth}});const config=await r.json();const cookie=r.headers.get('set-cookie').split(';')[0];
 const call=async(i,route,body,extra={})=>{const r=await fetch(base[i]+route,{method:'POST',headers:{Authorization:auth,Origin:cfg.publicUrl,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':config.csrf,...extra},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 return {base,auth,config,cookie,call,id,createKeys,captureKeys,get captures(){return captureCalls;},setMismatch:v=>mismatch=v,setPending:v=>pending=v,setForeign:v=>foreign=v,advance:()=>clock+=10800001};
}
test('sessão assinada funciona em duas instâncias e chaves de operação permanecem estáveis',async t=>{
 const h=await harness(t);assert.equal((await fetch(h.base[0]+'/api/config')).status,200);assert.ok(!JSON.stringify(h.config).includes(env.PAYPAL_CLIENT_SECRET));
 assert.equal((await h.call(0,'/api/orders',{confirm:true},{'X-CSRF-Token':'bad'})).status,403);assert.equal((await h.call(0,'/api/orders',{confirm:true},{Cookie:h.cookie+'x'})).status,403);assert.equal((await h.call(0,'/api/orders',{confirm:false})).status,400);
 const created=await h.call(0,'/api/orders',{confirm:true});assert.equal(created.status,200);assert.match(created.data.approvalUrl,/www.sandbox.paypal.com/);await h.call(1,'/api/orders',{confirm:true});assert.equal(h.createKeys[0],h.createKeys[1]);
 assert.equal((await h.call(1,'/api/capture',{orderId:h.id})).data.status,'COMPLETED');assert.equal((await h.call(0,'/api/capture',{orderId:h.id})).data.status,'COMPLETED');assert.equal(h.captures,1);
});
test('bloqueia captura com valor divergente e pedido de outra sessão',async t=>{const h=await harness(t);await h.call(0,'/api/orders',{confirm:true});h.setMismatch(true);assert.equal((await h.call(1,'/api/capture',{orderId:h.id})).status,409);h.setMismatch(false);h.setForeign(true);assert.equal((await h.call(1,'/api/capture',{orderId:h.id})).status,403);assert.equal(h.captures,0);});
test('captura pendente não vira sucesso, retentativa conserva a chave',async t=>{const h=await harness(t);await h.call(0,'/api/orders',{confirm:true});h.setPending(true);assert.equal((await h.call(0,'/api/capture',{orderId:h.id})).status,409);h.setPending(false);assert.equal((await h.call(1,'/api/capture',{orderId:h.id})).data.status,'COMPLETED');assert.equal(h.captureKeys[0],h.captureKeys[1]);});
test('sessão expirada bloqueia operação em vez de criar compra automaticamente',async t=>{const h=await harness(t);h.advance();assert.equal((await h.call(0,'/api/orders',{confirm:true})).status,403);assert.equal(h.createKeys.length,0);});
test('somente a função exporta entrada e raiz tem rota explícita',async()=>{const {default:fn}=await import('./api/checkout.js');assert.equal(typeof fn,'function');const cfg=JSON.parse(fs.readFileSync(new URL('./vercel.json',import.meta.url),'utf8'));assert.equal(cfg.rewrites[0].source,'/');assert.equal(cfg.rewrites[0].destination,'/api/checkout?route=%2F');assert.equal(fs.existsSync(new URL('./server.mjs',import.meta.url)),false);});

test('arquivo privado substitui variáveis manuais e detecta domínio automático',async()=>{
 const {loadPrivateConfiguration}=await import('./private-config.mjs');
 const settings={clientId:'test-client',clientSecret:'test-secret',accessPassword:'a-long-private-test-password',environment:'live',allowLivePayments:true,amount:'1.00',currency:'BRL',publicUrl:''};
 const read=()=>JSON.stringify(settings);
 const cfg=loadPrivateConfiguration({read,platform:{VERCEL_ENV:'production',VERCEL_PROJECT_PRODUCTION_URL:'test-project.vercel.app'}});
 assert.equal(cfg.env,'live');assert.equal(cfg.publicUrl,'https://test-project.vercel.app');assert.equal(cfg.client,'test-client');
 assert.throws(()=>loadPrivateConfiguration({read,platform:{VERCEL_ENV:'preview',VERCEL_URL:'test-preview.vercel.app'}}),/Live bloqueado em Preview/);
 settings.clientSecret='';assert.throws(()=>loadPrivateConfiguration({read,platform:{}}),/Preencha clientSecret/);
});
test('configuração privada é empacotada para função e não é arquivo estático',()=>{
 const config=JSON.parse(fs.readFileSync(new URL('./vercel.json',import.meta.url),'utf8'));
 assert.equal(config.outputDirectory,'public');assert.equal(config.functions['api/checkout.js'].includeFiles,'web/**');
 assert.equal(fs.existsSync(new URL('./public/config.server.mjs',import.meta.url)),false);assert.ok(fs.existsSync(new URL('./config.server.mjs',import.meta.url)));
 assert.ok(fs.readFileSync(new URL('./.gitignore',import.meta.url),'utf8').includes('config.server.mjs'));
});

test('configuração carregada por import sem depender de pasta oculta',async()=>{
 const {loadPrivateConfiguration}=await import('./private-config.mjs');
 const cfg=loadPrivateConfiguration({platform:{VERCEL_ENV:'production',VERCEL_PROJECT_PRODUCTION_URL:'test-project.vercel.app'}});
 assert.equal(cfg.env,'live');assert.equal(cfg.amount,'1.00');assert.equal(cfg.publicUrl,'https://test-project.vercel.app');
 assert.ok(cfg.client.length>0);assert.ok(cfg.secret.length>0);assert.equal('password' in cfg,false);
});

test('página e API de configuração abrem sem autenticação; POST mantém CSRF',async t=>{
 const h=await harness(t);
 const page=await fetch(h.base[0]+'/');assert.equal(page.status,200);assert.equal(page.headers.get('www-authenticate'),null);
 const response=await fetch(h.base[0]+'/api/config');const data=await response.json();assert.equal(response.status,200);assert.ok(data.csrf);assert.equal('password' in data,false);assert.equal('secret' in data,false);
 assert.equal((await h.call(0,'/api/orders',{confirm:true},{Authorization:''})).status,200);
 assert.equal((await h.call(0,'/api/orders',{confirm:true},{Authorization:'','X-CSRF-Token':'bad'})).status,403);
});

test('erro PayPal mostra código, issue e referência sem dados pessoais ou tokens',async()=>{
 const {paypalFailure}=await import('./checkout-core.mjs');
 const failure=paypalFailure({name:'UNPROCESSABLE_ENTITY',debug_id:'22362ff3ec85a',details:[{issue:'CURRENCY_NOT_SUPPORTED',description:'FAKE-PRIVATE-CARD-DATA',value:'FAKE-SECRET-VALUE'}],payer:{email_address:'private@example.invalid'},access_token:'FAKE-ACCESS-TOKEN'},422);
 assert.equal(failure.status,502);assert.match(failure.message,/CURRENCY_NOT_SUPPORTED/);assert.match(failure.message,/HTTP 422/);assert.match(failure.message,/22362ff3ec85a/);
 for(const privateText of ['FAKE-PRIVATE-CARD-DATA','FAKE-SECRET-VALUE','private@example.invalid','FAKE-ACCESS-TOKEN'])assert.ok(!failure.message.includes(privateText));
});
test('erro realista na criação fica detalhado e não dispara captura/retentativa automática',async()=>{
 const {client}=await import('./checkout-core.mjs');let calls=0;
 const transport=async()=>{calls++;return calls===1?{ok:true,status:200,json:async()=>({access_token:'fake-oauth-token',expires_in:3600})}:{ok:false,status:422,json:async()=>({name:'UNPROCESSABLE_ENTITY',details:[{issue:'PAYEE_ACCOUNT_RESTRICTED'}],debug_id:'TESTREF123'})};};
 const api=client(configuration(env),{transport});await assert.rejects(api('POST','/v2/checkout/orders',{},'fake-idempotency-key'),e=>e.status===502&&e.message.includes('PAYEE_ACCOUNT_RESTRICTED'));assert.equal(calls,2);
});
