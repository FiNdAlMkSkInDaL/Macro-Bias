const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync('src/lib/analytics/admin-access.ts','utf8');
let user = null, authError = null;
const context = {exports:{},Set,require(name){
 if(name==='server-only')return{};
 if(name==='react')return{cache:fn=>fn};
 if(name==='@/lib/supabase/server')return{createSupabaseServerClient:async()=>({auth:{getUser:async()=>({data:{user},error:authError})}})};
 throw new Error('Unexpected import');
}};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
(async()=>{
 const check=context.exports.getAnalyticsAdminUser;
 for(const email of ['finlayp32@gmail.com','finphillips21@gmail.com',' FINLAYP32@gmail.com ']){user={id:'verified',email,email_confirmed_at:'2026-01-01'};assert.equal((await check()).id,'verified');}
 for(const email of ['ordinary-free@example.com','ordinary-paid@example.com','finlayp32@gmail.com.attacker.invalid']){user={email,email_confirmed_at:'2026-01-01',app_metadata:{is_pro:true,subscription_status:'active'}};assert.equal(await check(),null);}
 user={email:'finlayp32@gmail.com'};assert.equal(await check(),null);
 user=null;assert.equal(await check(),null);
 user={email:'finlayp32@gmail.com',email_confirmed_at:'2026-01-01'};authError=new Error('Unavailable');assert.equal(await check(),null);
 console.log(JSON.stringify({passed:9,checks:'Exact confirmed owner accounts allowed; anonymous, Free, ordinary Pro, lookalike, unconfirmed and provider-error states denied.'}));
})().catch(e=>{console.error(e);process.exitCode=1});
