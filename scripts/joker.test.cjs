// Extracts the real ability table + shield helper from server/src/index.js and
// replays the endpoint's decision logic against them. Catches drift between the
// two hand-synced catalogs and verifies the charge/cooldown/shield rules.
const fs=require('fs');
const src=fs.readFileSync('server/src/index.js','utf8');

const tbl=src.match(/const SABOTAGE_ABILITIES = \{[\s\S]*?\n\}/)[0];
const cd =src.match(/const SABOTAGE_COOLDOWN_MS = [^\n]+/)[0];
const sh =src.match(/function hasActiveShield[\s\S]*?\n\}/)[0];
eval(tbl.replace('const ','var ')+';'+cd.replace('const ','var ')+';'+sh);

let pass=0,fail=0;
const t=(name,cond)=>{ (cond?pass++:fail++); console.log((cond?'  ok  ':'FAIL  ')+name); };

// --- catalog sync with the client lib ---
const clientSrc=fs.readFileSync('src/lib/sabotageAbilities.js','utf8');
const clientTypes=[...clientSrc.matchAll(/type: '([^']+)'/g)].map(m=>m[1]);
const clientCosts={}, clientTargets={}, clientDur={};
for(const m of clientSrc.matchAll(/type: '([^']+)',\s*\n\s*(?:label[^\n]*\n\s*icon[^\n]*\n\s*)?target: '([^']+)'/g)){}
// simpler: parse each block
for(const blk of clientSrc.split(/\{\s*\n\s*type:/).slice(1)){
  const type=blk.match(/^ '([^']+)'/)?.[1] ?? blk.match(/^\s*'([^']+)'/)?.[1];
  const tgt=blk.match(/target: '([^']+)'/)?.[1];
  const cost=Number(blk.match(/cost: (\d+)/)?.[1]);
  const dur=blk.match(/durationMs: ([^,]+),/)?.[1];
  if(type){ clientTargets[type]=tgt; clientCosts[type]=cost; clientDur[type]=eval(dur); }
}
console.log('\n== katalogsynk klient <-> server ==');
t('samma antal förmågor', Object.keys(SABOTAGE_ABILITIES).length===clientTypes.length);
for(const type of Object.keys(SABOTAGE_ABILITIES)){
  const s=SABOTAGE_ABILITIES[type];
  t(`${type}: target matchar (${s.target})`, s.target===clientTargets[type]);
  t(`${type}: cost matchar (${s.cost}p)`,    s.cost===clientCosts[type]);
  t(`${type}: duration matchar`,             s.durationMs===clientDur[type]);
}

// --- endpoint decision logic, replayed ---
const NOW=Date.now();
function attempt(state, key, type, targetKeyRaw){
  const ability=SABOTAGE_ABILITIES[type];
  if(!ability) return {code:400};
  const targetKey = ability.target==='self' ? key : targetKeyRaw;
  if(ability.target==='enemy'){
    if(targetKey===key) return {code:400};
    if(hasActiveShield(state,targetKey)) return {code:409, shielded:true};
  }
  const log=state.sabotageLog||[];
  const used=log.filter(e=>e.byTeam===key&&e.type===type).length;
  if(used>=ability.maxUses) return {code:409, reason:'charges'};
  const last=log.reduce((m,e)=>e.byTeam===key&&e.at>m?e.at:m,0);
  if(last && NOW-last<SABOTAGE_COOLDOWN_MS) return {code:429};
  return {code:200, targetKey, cost:ability.cost};
}
const fresh=()=>({sabotageLog:[],sabotageEffects:[]});

console.log('\n== målregler ==');
t('self-förmåga riktas alltid mot eget lag',
  attempt(fresh(),'blue','counter-measure','red').targetKey==='blue');
t('self-förmåga med förfalskat mål kapas till eget lag',
  attempt(fresh(),'blue','self-locate','green').targetKey==='blue');
t('enemy-förmåga mot eget lag nekas',
  attempt(fresh(),'blue','screen-lock','blue').code===400);
t('enemy-förmåga mot annat lag går igenom',
  attempt(fresh(),'blue','screen-lock','red').code===200);

console.log('\n== sköld ==');
const shielded={sabotageLog:[],sabotageEffects:[
  {type:'counter-measure',targetTeam:'red',expiresAt:NOW+60000}]};
const r=attempt(shielded,'blue','screen-lock','red');
t('attack mot skyddat lag nekas', r.code===409 && r.shielded===true);
t('ingen laddning förbrukad (loggen orörd)', shielded.sabotageLog.length===0);
t('sköld hindrar inte stöd till eget lag',
  attempt(shielded,'red','recon','red').code===200);
const expired={sabotageLog:[],sabotageEffects:[
  {type:'counter-measure',targetTeam:'red',expiresAt:NOW-1}]};
t('utgången sköld skyddar inte', attempt(expired,'blue','screen-lock','red').code===200);

console.log('\n== motmedel rensar bara fientliga effekter ==');
{
  const SELF=new Set(Object.entries(SABOTAGE_ABILITIES).filter(([,a])=>a.target==='self').map(([t])=>t));
  const clear=(effects,key)=>effects.filter(e=>{
    if(!e||e.targetTeam!==key) return true;
    return e.direction==='self'||SELF.has(e.type);
  });
  const before=[
    {type:'fake-target',   direction:'enemy',targetTeam:'blue'},  // fientlig, ska bort
    {type:'compass-jam',   direction:'enemy',targetTeam:'blue'},  // fientlig, ska bort
    {type:'recon',         direction:'self', targetTeam:'blue'},  // egen, ska vara kvar
    {type:'self-locate',   direction:'self', targetTeam:'blue'},  // egen, ska vara kvar
    {type:'screen-lock',   direction:'enemy',targetTeam:'red'},   // annat lag, orörd
  ];
  const after=clear(before,'blue');
  t('fientliga effekter mot oss rensas', !after.some(e=>e.type==='fake-target'||e.type==='compass-jam'));
  t('egen SPANING överlever',           after.some(e=>e.type==='recon'));
  t('egen EGEN POSITION överlever',     after.some(e=>e.type==='self-locate'));
  t('annat lags effekt rörs inte',      after.some(e=>e.targetTeam==='red'));
  // gamla effekter utan direction klassas på typ
  const legacy=clear([{type:'recon',targetTeam:'blue'},{type:'fake-target',targetTeam:'blue'}],'blue');
  t('gammal effekt utan direction klassas rätt', legacy.length===1 && legacy[0].type==='recon');
}

console.log('\n== laddningar & nedkylning (delad pool) ==');
const spent={sabotageLog:[
  {byTeam:'blue',type:'recon',at:NOW-20*60000},
  {byTeam:'blue',type:'recon',at:NOW-15*60000}],sabotageEffects:[]};
t('slut på laddningar för den typen', attempt(spent,'blue','recon','blue').code===409);
t('annan typ har kvar laddningar',    attempt(spent,'blue','screen-lock','red').code===200);
const hot={sabotageLog:[{byTeam:'blue',type:'recon',at:NOW-60000}],sabotageEffects:[]};
t('nedkylning blockerar stöd',   attempt(hot,'blue','counter-measure','blue').code===429);
t('nedkylning blockerar sabotage',attempt(hot,'blue','screen-lock','red').code===429);
t('nedkylning gäller bara egen joker', attempt(hot,'red','screen-lock','blue').code===200);

console.log('\n== kostnadsstege ==');
t('stöd kostar lika mycket som sabotage (motmedel 20 = lås skärm 20)',
  SABOTAGE_ABILITIES['counter-measure'].cost===SABOTAGE_ABILITIES['screen-lock'].cost);
t('egen position är billigast (10p)', SABOTAGE_ABILITIES['self-locate'].cost===10);
t('egen position varar 30s', SABOTAGE_ABILITIES['self-locate'].durationMs===30000);

console.log(`\n${pass} godkända, ${fail} misslyckade`);
process.exit(fail?1:0);
