import {createHandler} from '../checkout-core.mjs';
import {loadPrivateConfiguration} from '../private-config.mjs';
let handler;
const routes=new Set(['/','/return','/cancel','/style.css','/app.js','/api/config','/api/orders','/api/capture']);
export default async function(req,res){
 res.setHeader('X-Checkout-Version','2.3.1');
 try{
  const url=new URL(req.url,'https://placeholder.invalid');const route=url.searchParams.get('route')||url.pathname;
  if(!routes.has(route)){res.statusCode=404;res.end('Rota não encontrada.');return;}
  url.searchParams.delete('route');req.url=route+(url.search?'?'+url.searchParams.toString():'');
  if(!handler)handler=createHandler(loadPrivateConfiguration());await handler(req,res);
 }catch(e){if(!res.headersSent){res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');res.statusCode=503;res.end(JSON.stringify({version:'2.3.1',error:e.status===503?e.message:'Não foi possível iniciar o checkout. Confira as variáveis de ambiente.'}));}else if(!res.writableEnded)res.end();}
}
