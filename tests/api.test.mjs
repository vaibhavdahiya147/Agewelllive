import test from 'node:test';
import assert from 'node:assert/strict';
import carePlan from '../api/care-plan.js';
import status from '../api/status.js';
import stats from '../api/stats.js';
import {database} from '../lib/core.js';
const sample = {consent:true,morning:true,morningTime:'08:00',evening:true,eveningTime:'20:00',walk:false,refill:false,appointmentDay:'None',memberA:'morning',memberB:'evening',question:''};
const request = data => ({method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1:8766',host:'127.0.0.1:8766'},body:data,socket:{remoteAddress:'127.0.0.1'}});
const response = () => ({headers:{},setHeader(k,v){this.headers[k]=v;},end(text){this.body=JSON.parse(text);}});
const reply = (data,code=200) => new Response(JSON.stringify(data),{status:code});
function setup() {
  for(const key of ['SUPABASE_URL','SUPABASE_SERVICE_KEY','VISITOR_SECRET','APP_ORIGIN','VERCEL']) delete process.env[key];
  process.env.GEMINI_API_KEY='test-private-key';
}
test('one key supports a saved plan; write token never reaches browser/model',async t => {
  setup(); const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options) => {
    const data=JSON.parse(options.body); calls.push({url,options,data});
    if(url.includes('agewell_public_reserve')) return reply({allowed:true,id:'record',remaining:2});
    if(url.includes('generateContent')) return reply({candidates:[{content:{parts:[{text:JSON.stringify({refused:false,assignments:[{id:'morning',owner:'member_a'},{id:'evening',owner:'member_b'}]})}]}}],usageMetadata:{promptTokenCount:123,candidatesTokenCount:45}});
    if(url.includes('agewell_public_finish')) return reply({saved:true});
    if(url.includes('agewell_public_stats')) return reply({plansGenerated:1,mostCommonTask:'medicines'});
    throw Error('Unexpected endpoint');
  });
  const res=response(); await carePlan(request(sample),res);
  assert.equal(res.statusCode,200); assert.equal(res.body.tasks[0].time,'08:00');
  const reserve=calls.find(c=>c.url.includes('public_reserve'));
  const finish=calls.find(c=>c.url.includes('public_finish'));
  assert.match(reserve.data.p_write_token,/^[a-f0-9]{64}$/);
  assert.equal(finish.data.p_write_token,reserve.data.p_write_token);
  assert.equal(finish.data.p_input_tokens,123); assert.equal(finish.data.p_status,'completed');
  assert.equal(JSON.stringify(res.body).includes(reserve.data.p_write_token),false);
  assert.equal(JSON.stringify(calls.find(c=>c.url.includes('generateContent')).data).includes(reserve.data.p_write_token),false);
  assert.equal(reserve.options.headers.apikey.startsWith('sb_publishable_'),true);
  assert.equal(reserve.options.headers.Authorization,undefined);
});
test('clinical refusal saves only a safe reason and never calls Gemini',async t => {
  setup(); const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,data:JSON.parse(options.body)}); return url.includes('public_reserve')?reply({allowed:true,id:'refusal',remaining:2}):reply({saved:true});});
  const res=response(); await carePlan(request({...sample,question:'prescribe insulin'}),res);
  assert.equal(res.statusCode,422); assert.equal(calls.length,2);
  assert.deepEqual(calls[0].data.p_input,{refused:true,reason:'clinical_request'});
  assert.equal(calls[1].data.p_status,'refused');
});
test('quota blocks before a Gemini call',async t => {
  setup(); t.mock.method(globalThis,'fetch',async url=>{assert.ok(url.includes('public_reserve'));return reply({allowed:false,message:'Daily limit.'});});
  const res=response(); await carePlan(request(sample),res); assert.equal(res.statusCode,429);
});
test('failed database finish never returns a successful draft',async t => {
  setup(); t.mock.method(globalThis,'fetch',async url=>{
    if(url.includes('public_reserve'))return reply({allowed:true,id:'bad-save',remaining:2});
    if(url.includes('generateContent'))return reply({candidates:[{content:{parts:[{text:JSON.stringify({refused:false,assignments:[{id:'morning',owner:'member_a'},{id:'evening',owner:'member_b'}]})}]}}]});
    if(url.includes('public_finish'))return reply({saved:false});
    throw Error('Stats must not be loaded');
  });
  const res=response();await carePlan(request(sample),res);assert.equal(res.statusCode,503);assert.equal(res.body.tasks,undefined);
});
test('status exposes configuration boolean, not credentials',()=>{
  setup();const res=response();status({method:'GET',headers:{}},res);assert.deepEqual(res.body,{plannerConfigured:true});
  delete process.env.GEMINI_API_KEY;const missing=response();status({method:'GET',headers:{}},missing);assert.deepEqual(missing.body,{plannerConfigured:false});
});
test('public stats return aggregates and do not require Gemini',async t=>{
  delete process.env.GEMINI_API_KEY;t.mock.method(globalThis,'fetch',async url=>{assert.ok(url.endsWith('agewell_public_stats'));return reply({plansGenerated:1,mostCommonTask:'medicines'});});
  const res=response();await stats({method:'GET',headers:{}},res);assert.equal(res.statusCode,200);assert.equal(res.body.plansGenerated,1);
});
test('database helper refuses arbitrary table reads and writes',async()=>{
  await assert.rejects(database('care_requests',{method:'GET'}));
  await assert.rejects(database('waitlist',{data:{email:'fake@example.com'}}));
});
