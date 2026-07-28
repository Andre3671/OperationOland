import { computeTeamScore, computeLeaderboard, SCORING } from '../src/lib/scoring.js'

let pass=0,fail=0
const t=(n,c)=>{ (c?pass++:fail++); console.log((c?'  ok  ':'FAIL  ')+n) }

const cp=(i,team,type='task')=>({id:'cp'+i,team,type})
const arr=(i,team,type='task',ts=1000*i)=>({team,checkpointId:'cp'+i,checkpointType:type,timestamp:ts})
const base=(over={})=>({
  checkpoints:[cp(1,'blue'),cp(2,'blue'),cp(3,'blue'),cp(4,'blue'),cp(5,'blue')],
  arrivalLog:[arr(1,'blue'),arr(2,'blue'),arr(3,'blue')],
  teamProgress:{blue:3}, teamCheating:{}, sabotageLog:[],
  teams:{blue:{enabled:true,name:'Blå'},red:{enabled:true,name:'Röd'}},
  ...over,
})

console.log('== grund ==')
const clean=computeTeamScore('blue',base())
t(`ren poäng = 90 (3×10 ankomst + 3×20 uppdrag) [${clean.total}]`, clean.total===90)

console.log('\n== fusk bottnar fortfarande på noll ==')
const cheated=computeTeamScore('blue',base({teamCheating:{blue:{offenses:50,seconds:3000}}}))
t(`grovt fusk ger 0, inte minus [${cheated.total}]`, cheated.total===0)
t('fuskavdraget syns ändå i breakdown', cheated.breakdown.cheatPenalty < 0)

console.log('\n== jokerkostnad går under noll ==')
const spent=computeTeamScore('blue',base({sabotageLog:[
  {byTeam:'blue',type:'fake-target',cost:25},
  {byTeam:'blue',type:'fake-target',cost:25},
  {byTeam:'blue',type:'screen-lock',cost:20},
  {byTeam:'blue',type:'screen-lock',cost:20},
  {byTeam:'blue',type:'counter-measure',cost:20},
]}))
t(`90 intjänat − 110 joker = −20 [${spent.total}]`, spent.total===-20)

console.log('\n== exploiten är stängd ==')
// Ett lag på noll som bränner en till laddning ska sjunka, inte stå still.
const atZero=base({arrivalLog:[],teamProgress:{blue:0},sabotageLog:[
  {byTeam:'blue',type:'recon',cost:15}]})
const one=computeTeamScore('blue',atZero).total
const two=computeTeamScore('blue',{...atZero,sabotageLog:[...atZero.sabotageLog,
  {byTeam:'blue',type:'recon',cost:15}]}).total
t(`en användning utan intjäning = −15 [${one}]`, one===-15)
t(`ytterligare en kostar också [${two}]`, two===-30)
t('varje extra laddning fortsätter kosta', two < one)

console.log('\n== fusk + joker samtidigt ==')
const both=computeTeamScore('blue',base({
  teamCheating:{blue:{offenses:50,seconds:3000}},
  sabotageLog:[{byTeam:'blue',type:'fake-target',cost:25}],
}))
t(`fusk nollar intjäningen, jokern drar därifrån = −25 [${both.total}]`, both.total===-25)

console.log('\n== annat lags joker påverkar inte oss ==')
const other=computeTeamScore('blue',base({sabotageLog:[{byTeam:'red',type:'fake-target',cost:25}]}))
t(`grannens kostnad rör oss inte [${other.total}]`, other.total===90)

console.log('\n== ligan sorterar negativa sist ==')
const lb=computeLeaderboard(base({
  arrivalLog:[arr(1,'blue'),arr(2,'blue'),arr(3,'blue'),arr(1,'red')],
  checkpoints:[cp(1,'blue'),cp(2,'blue'),cp(3,'blue'),cp(1,'red')],
  teamProgress:{blue:3,red:1},
  sabotageLog:[{byTeam:'blue',type:'fake-target',cost:25},{byTeam:'blue',type:'fake-target',cost:25},
               {byTeam:'blue',type:'screen-lock',cost:20},{byTeam:'blue',type:'screen-lock',cost:20},
               {byTeam:'blue',type:'compass-jam',cost:15}],
}))
t(`röd (30 p) leder över blå (${lb[1].total} p)`, lb[0].team==='red' && lb[1].total<0)

console.log(`\n${pass} godkända, ${fail} misslyckade`)
process.exit(fail?1:0)
