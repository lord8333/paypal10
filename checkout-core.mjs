import crypto from 'node:crypto';
import fs from 'node:fs';
const error=(status,message)=>Object.assign(new Error(message),{status});
const hash=s=>crypto.createHash('sha256').update(String(s)).digest();
const equal=(a,b)=>crypto.timingSafeEqual(hash(a),hash(b));
export function configuration(e=process.env){
 const missing=['PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET','PUBLIC_URL'].filter(k=>!e[k]);
 if(missing.length)throw error(503,'Configure na Vercel: '+missing.join(', ')+'. Depois faça Redeploy.');
 const env=e.PAYPAL_ENV||'sandbox',amount=e.AMOUNT||'1.00',currency=e.CURRENCY||'BRL';
 if(!['sandbox','live'].includes(env))throw error(503,'PAYPAL_ENV deve ser sandbox ou live.');
 let url;try{url=new URL(e.PUBLIC_URL);}catch{throw error(503,'PUBLIC_URL deve ser uma URL HTTPS válida.');}
 if(url.protocol!=='https:'||url.pathname!=='/'||url.username||url.password||url.search||url.hash)throw error(503,'PUBLIC_URL deve conter apenas o domínio HTTPS, sem caminho.');
 if(!/^(?:0|[1-9]\d{0,3})\.\d{2}$/.test(amount)||Number(amount)<=0||Number(amount)>100)throw error(503,'AMOUNT deve estar entre 0.01 e 100.00, com duas casas decimais.');
 if(!['BRL','USD','EUR'].includes(currency))throw error(503,'CURRENCY deve ser BRL, USD ou EUR.');
 if(env==='live'&&e.ALLOW_LIVE_PAYMENTS!=='true')throw error(503,'Live bloqueado. Para cobrança real, defina ALLOW_LIVE_PAYMENTS=true.');
 return {env,amount,currency,publicUrl:url.origin,client:e.PAYPAL_CLIENT_ID,secret:e.PAYPAL_CLIENT_SECRET};
}
export function paypalFailure(data,httpStatus,{authentication=false}={}){
 const code=value=>typeof value==='string'&&/^[A-Za-z_]{1,80}$/.test(value)?value.toUpperCase():null;
 const name=code(data?.name)||code(data?.error);
 const issues=[...new Set((Array.isArray(data?.details)?data.details:[]).slice(0,3).map(d=>code(d?.issue)).filter(Boolean))];
 const hintByCode={
  CURRENCY_NOT_SUPPORTED:'A moeda não é aceita para esta operação. Confira a configuração e a habilitação da conta.',
  PAYEE_ACCOUNT_RESTRICTED:'A conta recebedora está restrita. Confira o painel ou o suporte PayPal.',
  PAYEE_ACCOUNT_LOCKED:'A conta recebedora está bloqueada. Confira o painel ou o suporte PayPal.',
  PAYEE_ACCOUNT_INVALID:'O PayPal informou um problema com a conta recebedora. Confira a conta vinculada ao aplicativo.',
  NOT_AUTHORIZED:'O aplicativo não tem autorização para esta operação. Confira as permissões da conta.',
  PERMISSION_DENIED:'O PayPal negou a permissão da operação. Confira as permissões da conta.',
  AUTHENTICATION_FAILURE:'Confira se Client ID e Secret pertencem ao mesmo aplicativo e ao ambiente Live/Sandbox correto.',
  INVALID_CLIENT:'Confira se Client ID e Secret pertencem ao mesmo aplicativo e ao ambiente Live/Sandbox correto.',
  INSTRUMENT_DECLINED:'O meio de pagamento foi recusado. Não repita tentativas automaticamente.',
  TRANSACTION_REFUSED:'O PayPal recusou a transação. Confira o painel ou o suporte antes de repetir.',
  PAYER_CANNOT_PAY:'O comprador não pode realizar este pagamento. Confira a restrição com o PayPal.'
 };
 const hint=issues.map(c=>hintByCode[c]).find(Boolean)||hintByCode[name]||(authentication?'Confira as credenciais e o ambiente do aplicativo.':'Confira o painel PayPal antes de repetir.');
 const reference=typeof data?.debug_id==='string'?data.debug_id.replace(/[^a-zA-Z0-9]/g,'').slice(0,128):'';
 const diagnostic=[name,...issues].filter(Boolean).join(' / ');
 return error(502,'PayPal recusou a operação'+(diagnostic?' ('+diagnostic+')':'')+'. '+hint+(Number.isInteger(httpStatus)?' HTTP '+httpStatus+'.':'')+(reference?' Referência: '+reference+'.':''));
}
export function client(cfg,{transport=fetch}={}){
 const base=cfg.env==='live'?'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com';let token,expiry=0;
 return async(method,path,body,key)=>{
  if(!token||Date.now()>expiry){
   const r=await transport(base+'/v1/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(cfg.client+':'+cfg.secret).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials',signal:AbortSignal.timeout(15000)});
   const d=await r.json();if(!r.ok||!d.access_token)throw paypalFailure(d,r.status,{authentication:true});token=d.access_token;expiry=Date.now()+Math.max(0,(d.expires_in-60))*1000;
  }
  const r=await transport(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Prefer:'return=representation',...(key?{'PayPal-Request-Id':key}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)});
  const d=await r.json();if(!r.ok)throw paypalFailure(d,r.status);return d;
 };
}
export function createHandler(cfg,{api=client(cfg),now=Date.now}={}){
 // Chave derivada somente no servidor. Rotacionar credenciais invalida sessões antigas.
 const scope=[cfg.client,cfg.env,cfg.publicUrl].join('|');
 const sign=(purpose,text)=>crypto.createHmac('sha256',cfg.secret).update('checkout-v2|'+scope+'|'+purpose+'|'+text).digest('base64url');
 const requestId=(purpose,id)=>sign(purpose,id).slice(0,36);
 const pack=(kind,payload)=>{const raw=Buffer.from(JSON.stringify(payload)).toString('base64url');return raw+'.'+sign(kind,raw);};
 const unpack=(kind,value)=>{try{if(typeof value!=='string'||value.length>2048)return null;const parts=value.split('.');if(parts.length!==2||!equal(parts[1],sign(kind,parts[0])))return null;return JSON.parse(Buffer.from(parts[0],'base64url').toString());}catch{return null;}};
 const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
 const money=a=>a?.currency_code===cfg.currency&&a?.value===cfg.amount;
 const result=d=>{const captures=d.purchase_units?.flatMap(p=>p.payments?.captures||[])||[];if(d.status!=='COMPLETED'||captures.length!==1||captures[0].status!=='COMPLETED'||!money(captures[0].amount))throw error(409,'Pagamento ainda não confirmado. Consulte o painel PayPal; não inicie outra compra.');return {status:'COMPLETED',orderId:d.id,captureId:captures[0].id,amount:cfg.amount,currency:cfg.currency};};
 const body=async req=>{if(req.body!==undefined){const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);if(raw.length>4096)throw error(413,'Requisição muito grande.');try{return JSON.parse(raw);}catch{throw error(400,'JSON inválido.');}}let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)throw error(413,'Requisição muito grande.');}try{return JSON.parse(raw||'{}');}catch{throw error(400,'JSON inválido.');}};
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Strict-Transport-Security','max-age=31536000');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try{
   const route=new URL(req.url,cfg.publicUrl).pathname;
   if(req.method==='GET'&&['/','/return','/cancel','/style.css','/app.js'].includes(route)){
    const name=route==='/style.css'?'style.css':route==='/app.js'?'app.js':'index.html';res.writeHead(200,{'Content-Type':name.endsWith('.css')?'text/css; charset=utf-8':name.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8'});res.end(fs.readFileSync(new URL('./web/'+name,import.meta.url)));return;
   }
   const cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim()).filter(s=>s.includes('=')).map(s=>[s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)]));
   let session=unpack('session',cookies.session);const valid=session&&/^[a-f0-9]{64}$/.test(session.id)&&Number.isFinite(session.created)&&session.created<=now()&&now()-session.created<10800000;
   if(!valid){
    if(req.method==='POST')throw error(403,'Sessão expirada ou inválida. Confira o painel PayPal antes de começar outra compra.');
    session={id:crypto.randomBytes(32).toString('hex'),created:now()};res.setHeader('Set-Cookie',`session=${pack('session',session)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=10800`);
   }
   const csrf=sign('csrf',session.id),owner=sign('owner',session.id);
   if(req.method==='GET'&&route==='/api/config'){send(res,200,{env:cfg.env,amount:cfg.amount,currency:cfg.currency,ready:true,csrf});return;}
   if(req.method!=='POST'||!['/api/orders','/api/capture'].includes(route))throw error(404,'Rota não encontrada.');
   if(req.headers.origin!==cfg.publicUrl||!equal(req.headers['x-csrf-token']||'',csrf))throw error(403,'Sessão/origem inválida. Use o domínio configurado em PUBLIC_URL.');
   if(!req.headers['content-type']?.startsWith('application/json'))throw error(415,'Envie application/json.');
   const input=await body(req);
   if(route==='/api/orders'){
    if(input.confirm!==true)throw error(400,'Confirme o valor para continuar.');
    // A mesma sessão/valor/moeda produz a mesma chave, mesmo em outra instância.
    const key=requestId('create',[session.id,cfg.amount,cfg.currency].join('|'));
    const order=await api('POST','/v2/checkout/orders',{intent:'CAPTURE',purchase_units:[{custom_id:owner,description:'Compra de teste autorizada',amount:{currency_code:cfg.currency,value:cfg.amount}}],payment_source:{paypal:{experience_context:{shipping_preference:'NO_SHIPPING',user_action:'PAY_NOW',return_url:cfg.publicUrl+'/return',cancel_url:cfg.publicUrl+'/cancel'}}}},key);
    if(typeof order.id!=='string'||!/^[A-Z0-9]{8,40}$/.test(order.id))throw error(502,'PayPal retornou um pedido inesperado.');
    if(order.status==='COMPLETED'){send(res,200,{orderId:order.id,approvalUrl:cfg.publicUrl+'/return?token='+encodeURIComponent(order.id)});return;}
    const link=order.links?.find(l=>['payer-action','approve'].includes(l.rel));if(!link)throw error(502,'PayPal não retornou o link de aprovação. Consulte o painel antes de repetir.');
    const url=new URL(link.href);if(url.protocol!=='https:'||url.hostname!==(cfg.env==='live'?'www.paypal.com':'www.sandbox.paypal.com'))throw error(502,'URL de aprovação inesperada.');
    send(res,200,{orderId:order.id,approvalUrl:url.href});return;
   }
   const id=input.orderId;if(typeof id!=='string'||!/^[A-Z0-9]{8,40}$/.test(id))throw error(400,'Pedido inválido.');
   let detail=await api('GET','/v2/checkout/orders/'+id);
   if(detail.id!==id||detail.purchase_units?.length!==1||!equal(detail.purchase_units[0].custom_id||'',owner))throw error(403,'Este pedido não pertence à sessão.');
   if(!money(detail.purchase_units[0].amount))throw error(409,'Valor ou moeda divergente. Captura bloqueada.');
   if(detail.status!=='COMPLETED'){
    if(detail.status!=='APPROVED')throw error(409,'O pedido não está aprovado. Consulte o PayPal antes de repetir.');
    detail=await api('POST','/v2/checkout/orders/'+id+'/capture',{},requestId('capture',id));
   }
   if(detail.id!==id)throw error(409,'Pedido divergente.');send(res,200,result(detail));
  }catch(e){if(res.headersSent){if(!res.writableEnded)res.end();return;}send(res,e.status||502,{error:e.status?e.message:'Falha de conexão. Consulte o painel PayPal antes de repetir; não inicie outra compra automaticamente.'});}
 };
}
