/** 整体收敛契约 K18–K25：真实事件与真实组件，期望值不复制生产算法。 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { eventFixture, eventRuntimeInput } from './_eventElementHarness.mjs'
import { nextTick, reactive, computed } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { mountVueSetup, loadVueSetupImports } from './_vueSetupHarness.mjs'
import { mergeFlowBuffOverride, buildFlowBuffEffectText } from '../src/utils/flowBuffTable.ts'
import { buildEventValueTips, buildEventZoneDisplay } from '../src/utils/eventDamageSourceTips.ts'
import { clearHitEvalCache, hitEvalCacheDebugStats } from '../src/utils/hitEvalCache.ts'
import { useCalculatorBuffStore } from '../src/stores/calculatorBuffs.ts'

import { testAgent, mindscapeWithEffects } from './_effectPipelineHarness.mjs'
import { createEmptyBuffEffect } from '../src/utils/buffEffect.ts'
import { createEmptyMultiSlotBuffSelection, collectAllBuffEffects, blockKeyOfCollected } from '../src/utils/panelBuffCalc.ts'
import { createBuffCalculationRuntime, evaluateSkillFlowHit } from '../src/utils/skillFlowCalculation.ts'
import { solveOptimalAffixAllocation } from '../src/utils/affixOptimizer.ts'
import { createAffixLibraryStateForOrigin } from '../src/utils/affixLibrary.ts'
import { evaluateAffixCounts } from '../src/utils/optimalAffixAlloc.ts'
import { buildSkillFlowPageSignature } from '../src/utils/skillFlowPanelSource.ts'
import { resolveEventBuffPreviewInputs } from '../src/utils/optimalAffixAlloc.ts'

const supported = Array.from({ length: 8 }, (_, i) => `K${18 + i}`)
const argument = process.argv.find(arg => arg.startsWith('--cases='))
const requested = argument ? argument.slice(8).split(',') : supported
if (!requested.length || requested.some(item => !supported.includes(item))) {
  throw new Error(`Unknown or empty case selection: ${requested.join(',')}`)
}
let passed = 0, failed = 0, assertions = 0
const equal = (...args) => { assertions++; assert.equal(...args) }
const cases = new Map()
const runtimeInput = eventRuntimeInput
function runtimeFor(f, changes = {}) { return createBuffCalculationRuntime(runtimeInput(f, changes)) }
const deepEqual = (...args) => { assertions++; assert.deepEqual(...args) }
const ok = (...args) => { assertions++; assert.ok(...args) }
const urlFor = name => new URL('../src/components/calculator/'+name+'.vue',import.meta.url)
async function mountSection(name,f,extraProps={},expose=[]) {
  const url = urlFor(name), router = createRouter({history:createMemoryHistory(),routes:[{path:'/',component:{render:()=>null}}]})
  await router.push('/?mode=sweep')
  const props = { agents:f.agents, teamSlots:f.teamSlots, wengines:[],driveDiscs:[],bangboos:[],selectedBangbooId:'none',bangbooRefine:1,
    slotPanels:Object.fromEntries(Object.entries(f.panels).map(([id,panel])=>[id,{active:'imported',importedPanel:panel}])),activeSlotPanels:f.panels,
    extraGains:f.extraGains,enemyInput:f.context.enemyInput,editedSlotIndex:0,staggerPhase:'stagger',damageKind:'direct',calcMode:'panel',active:true,
    hits:f.hits,flowCalculationRuntime:runtimeFor(f),environmentBuffs:[],skillTalentLevelsByAgent:f.context.panelContext.skillTalentLevelsByAgent,
    ...extraProps }
  return mountVueSetup(url,{imports:await loadVueSetupImports(url),props,plugins:[createPinia(),router],expose})
}

function generatedCandidate(f, flatDelta=2000) {
  f.hits=f.hits.map(hit=>({...hit,multOverrides:{...hit.multOverrides,directDmgMult:100}}))
  f.context.hits=f.hits
  const entries=[{id:'candidate-atk',label:'attack',target:'panel:atkFlat',perRoll:flatDelta,cap:1,group:'副词条',rollCost:1,enabledByDefault:true},
    {id:'candidate-gain',label:'gain',target:'gain:dmgBonus',perRoll:10,cap:1,group:'副词条',rollCost:1,enabledByDefault:true}]
  const result=solveOptimalAffixAllocation({ctx:f.context,entries,maxTotalRolls:2,enablePenRatePath:false,initialCandidateThreshold:0,initialCandidateFloor:2,routeRetentionRatio:0})
  const evaluation=evaluateAffixCounts(f.context,result.counts,result.panelDeltas,result.valuePerCount,result.extraGains)
  equal(result.rollsByEntryId['candidate-atk'],1);equal(result.rollsByEntryId['candidate-gain'],1)
  equal(evaluation.external.atk,1000+flatDelta);equal(evaluation.finalPanel.dmgBonus,35)
  return {evaluation,result}
}

const fixed = (id, stat, value, rest = {}) => createEmptyBuffEffect({ id, stat, value, enabledDefault: true, applyTarget: 'team', ...rest })
const convert = (id, rest = {}) => createEmptyBuffEffect({ id, stat: 'dmgBonus', kind: 'convert', enabledDefault: true,
  applyTarget: 'team', convert: { from: 'atk', panelSource: 'final', ratioPercent: 10, initialBase: 0, cap: null }, ...rest })

cases.set('K18', async () => {
  for (const mode of ['ordinary', 'extra-slot', 'extra-team']) {
    const f = eventFixture({ mode, damageType: 'direct', effects: [fixed('source', 'atk', 500), convert('derived')] })
    const items = collectAllBuffEffects(f.context.panelContext)
    const source = items.find(item => item.effect.id.endsWith('source'))
    const derived = items.find(item => item.effect.id.endsWith('derived'))
    for (const [override, expectedBase, expectedAmount, expectedActual] of [
      [null, 1500, 150, 150],
      [{ disabledEffectIds: [source.effect.id] }, 1000, 100, 100],
      [{ disabledBlockIds: [blockKeyOfCollected(source)] }, 1000, 100, 100],
      [{ disabledEffectIds: [derived.effect.id] }, 1500, 150, 0],
      [null, 1500, 150, 150],
    ]) {
      const hit = { ...f.hits[0], multOverrides: { directDmgMult: 100 }, buffOverride: override }
      const detail = evaluateSkillFlowHit(f.context, null, hit, true)
      const preview = resolveEventBuffPreviewInputs(f.context, null, hit, 0, detail)
      equal(preview.configurationParameters[derived.effect.id].convertBase.value, expectedBase, `${mode}: effective configuration base`)
      equal(preview.configurationParameters[derived.effect.id].amount, expectedAmount, `${mode}: configuration amount`)
      equal(preview.effectAmounts[derived.effect.id], expectedActual, `${mode}: actual contribution`)
      equal(Boolean(preview.configurationParameters[source.effect.id]), true, `${mode}: disabled source remains editable`)
      const runtime=runtimeFor(f),url=urlFor('SkillBuffOverrideModal')
      const modal=mountVueSetup(url,{imports:await loadVueSetupImports(url),expose:['convertBaseModel','effectResultText'],props:{
        open:true,effects:items,override,convertResolveInputs:(slot,row)=>runtime.getHitBuffPreview(slot,hit,row),
      }})
      try{
        equal(modal.vm.convertBaseModel(derived),expectedBase)
        ok(modal.vm.effectResultText(derived).includes(expectedActual===0?' 0':'+ '+expectedActual))
        const text=buildFlowBuffEffectText(derived,{slotIndex:0,...preview})
        ok(text.includes(expectedActual===0?' 0':'+ '+expectedActual),text)
      }finally{modal.unmount()}
    }
  }
})

cases.set('K20', async () => {
  for (const mode of ['ordinary','extra-slot','extra-team']) {
    const f = eventFixture({ mode, damageType: 'direct', effects: [fixed('source','atk',500),convert('derived')] })
    const runtime = runtimeFor(f)
    const id = collectAllBuffEffects(f.context.panelContext).find(item => item.effect.id.endsWith('derived')).effect.id
    equal(runtime.getGlobalPanelStages(0).preConvertPanel.atk, 1500)
    equal(runtime.getConfigurationInputs(0,'global').configurationParameters[id].convertBase.value,1500)
    equal(runtime.getGlobalPanelSources(0)[0].final.atk,1500)
    equal(runtime.getGlobalPanelStages(0).finalBreakdown.finalPanel.dmgBonus,150)
    const configured=runtimeFor(f,{contextInput:{enemyInput:{...f.context.enemyInput,level:75}}})
    const section=await mountSection('PanelCalcSection',f,{configurationCalculationRuntime:configured})
    try{
      deepEqual(section.vm.getAttrDefaultsForSlot(0),configured.getConfigurationInputs(0,'global').attrDefaults)
      equal(section.vm.convertAttrDefaults.level,75)
      deepEqual(section.vm.getPanelSourceValuesForSlot(0),configured.getGlobalPanelSources(0)[0])
      equal(section.vm.slotPanelPreviews[0].final.dmgBonus,150)
      deepEqual(section.vm.slotPanelPreviews[0].external,configured.getGlobalPanelStages(0).externalPanel)
    }finally{section.unmount()}
    const partial = runtimeFor(f,{ contextInput:{ activeSlotPanels:{power:f.panels.power},convertSlotPanels:{ owner:{atk:2000} } } })
    equal(partial.getGlobalPanelStages(0).externalPanel.atk,2000)
    equal(partial.getGlobalPanelSources(0)[0].external.atk,2000)
    const empty = runtimeFor(f,{ contextInput:{activeSlotPanels:{power:f.panels.power}} })
    equal(empty.getGlobalPanelStages(0).externalPanel.atk,0)
    equal(empty.getHitNumbers(f.hits[0]),null)
  }
  const a = testAgent('owner'),b = testAgent('power')
  a.mindscapeBuffs = mindscapeWithEffects([convert('self-owner',{applyTarget:'self'})])
  b.mindscapeBuffs = mindscapeWithEffects([convert('self-power',{applyTarget:'self'})])
  const f = eventFixture({mode:'ordinary',damageType:'direct',effects:[convert('self-owner',{applyTarget:'self'})],agents:[a,b]})
  const p = runtimeFor(f).getConfigurationInputs(0,'global').configurationParameters
  const selfItems = collectAllBuffEffects({...f.context.panelContext,mainSlotIndex:1})
  const id = selfItems.find(item=>item.effect.id.endsWith('self-power')).effect.id
  equal(p[id].convertBase.value,2000)
  equal(p[id].amount,200)
  const ownerId = collectAllBuffEffects(f.context.panelContext).find(item=>item.effect.id.endsWith('self-owner')).effect.id
  const foreignView=runtimeFor(f).getConfigurationInputs(1,'global').configurationParameters
  equal(foreignView[ownerId].convertBase.value,1000,'switching query slot keeps owner source panel')
  equal(foreignView[id].convertBase.value,2000,'switching query slot keeps foreign source panel')
})


const globalStageCase=cases.get('K20')
cases.set('K20',async()=>{
  await globalStageCase()
  for(const mode of ['ordinary','extra-slot','extra-team']){
    const f=eventFixture({mode,damageType:'direct',effects:[
      convert('atk-convert',{stat:'atk',convert:{from:'atk',panelSource:'manual',defaultBase:5000,ratioPercent:10,initialBase:0,cap:null}}),convert('derived'),
    ]})
    const r=runtimeFor(f),id=collectAllBuffEffects(f.context.panelContext).find(i=>i.effect.id.endsWith('derived')).effect.id
    equal(r.getGlobalPanelStages(0).finalBreakdown.finalPanel.atk,1500)
    equal(r.getGlobalPanelStages(0).preConvertPanel.atk,1000)
    equal(r.getGlobalPanelSources(0)[0].final.atk,1000)
    equal(r.getConfigurationInputs(0,'global').configurationParameters[id].amount,100)
    equal(r.getHitBuffPreview(0,f.hits[0]).configurationParameters[id].amount,100)
  }
  for(const mode of ['ordinary','extra-team']){
    const own=fixed('own-source','atk',500,{applyTarget:'self'})
    const agents=[testAgent('owner'),testAgent('power',{mindscapeBuffs:mindscapeWithEffects([own])})]
    const f=eventFixture({mode,damageType:'direct',sourceSlot:1,effects:mode==='ordinary'?[own,convert('foreign')]:[convert('foreign')],agents})
    const items=collectAllBuffEffects({...f.context.panelContext,mainSlotIndex:1}),source=items.find(i=>i.effect.id.endsWith('own-source'))
    const selection=createEmptyMultiSlotBuffSelection()
    selection.bySlot[1]={enabledIds:{[source.effect.id]:false},convertInputs:{},stacksByEffectId:{}}
    const inactive=runtimeFor(f,{contextInput:{slotBuffSelections:selection}})
    const derived=collectAllBuffEffects({...f.context.panelContext,extraGains:f.extraGains}).find(i=>i.effect.id.endsWith('foreign'))
    equal(inactive.getHitBuffPreview(0,f.hits[0]).configurationParameters[derived.effect.id].convertBase.value,2000)
    equal(inactive.getHitBuffPreview(0,f.hits[0]).effectAmounts[derived.effect.id],200)
    selection.bySlot[1].enabledIds[source.effect.id]=true
    const active=runtimeFor(f,{contextInput:{slotBuffSelections:selection}})
    equal(active.getHitBuffPreview(0,f.hits[0]).configurationParameters[derived.effect.id].convertBase.value,2500)
    equal(active.getHitBuffPreview(0,f.hits[0]).effectAmounts[derived.effect.id],250)
  }
})

cases.set('K19', async () => {
  for (const mode of ['ordinary','extra-slot','extra-team']) {
    const f = eventFixture({ mode,damageType:'direct',effects:[
      convert('manual',{convert:{from:'atk',panelSource:'manual',defaultBase:3000,ratioPercent:10,initialBase:0,cap:null}}),
      fixed('stacks','atk',0,{kind:'stacked',valuePerStack:10,defaultStacks:2,maxStacks:10}),
    ] })
    const items = collectAllBuffEffects(f.context.panelContext), id=items.find(i=>i.effect.id.endsWith('manual')).effect.id, sid=items.find(i=>i.effect.id.endsWith('stacks')).effect.id
    const selection=createEmptyMultiSlotBuffSelection()
    selection.team.convertInputs[id]= mode === 'ordinary' ? 3000 : 9999
    selection.team.stacksByEffectId[sid]=mode === 'ordinary' ? 2 : 9
    const runtime=runtimeFor(f,{contextInput:{slotBuffSelections:selection}})
    const group={convertInputsByEffectId:{[id]:5000},stacksByEffectId:{[sid]:3}}
    const member={convertInputsByEffectId:{[id]:7000},stacksByEffectId:{[sid]:4}}
    for(const [overlay,base,stacks] of [[null,3000,2],[group,5000,3],[mergeFlowBuffOverride(group,member),7000,4],[mergeFlowBuffOverride(group,{convertInputsByEffectId:{[id]:0},stacksByEffectId:{[sid]:0}}),0,0],[mergeFlowBuffOverride(group,null),5000,3],[null,3000,2]]){
      const hit={...f.hits[0],buffOverride:overlay,multOverrides:{directDmgMult:100}}
      const inputs=runtime.getHitBuffPreview(0,hit)
      equal(inputs.configurationParameters[id].convertBase.value,base,mode+' inherited base')
      equal(inputs.configurationParameters[id].amount,base/10)
      equal(inputs.configurationParameters[sid].stacks,stacks)
      equal(inputs.effectAmounts[sid],stacks*10)
      equal(inputs.effectAmounts[id],base/10)
      const detail=runtime.getHitDetail(hit)
      const records=effectId=>detail.evaluation.effectRecords.filter(record=>record.effectId===effectId&&record.usedInputs.length)
      ok(records(id).length);ok(records(id).every(record=>record.amount===base/10))
      ok(records(sid).length);ok(records(sid).every(record=>record.amount===stacks*10))
      const url=urlFor('SkillBuffOverrideModal'),modal=mountVueSetup(url,{imports:await loadVueSetupImports(url),expose:['convertBaseModel','stacksModel','effectResultText'],props:{
        open:true,effects:items,override:overlay,convertResolveInputs:(slot,row)=>runtime.getHitBuffPreview(slot,hit,row),
      }})
      try{
        equal(modal.vm.convertBaseModel(items.find(i=>i.effect.id===id)),base)
        equal(modal.vm.stacksModel(items.find(i=>i.effect.id===sid).effect),stacks)
        ok(modal.vm.effectResultText(items.find(i=>i.effect.id===id)).includes(base===0?' 0':'+ '+base/10))
      }finally{modal.unmount()}
    }
    const off=mergeFlowBuffOverride({disabledEffectIds:[id]}, {convertInputsByEffectId:{[id]:7000}})
    equal(runtime.getHitBuffPreview(0,{...f.hits[0],buffOverride:off}).effectAmounts[id],0)
    const level=eventFixture({mode,damageType:'direct',sourceSlot:1,effects:[convert('level',{convert:{from:'skillLevelBasic',panelSource:'external',ratioPercent:100,initialBase:0,cap:null}})]})
    const lid=collectAllBuffEffects(level.context.panelContext)[0].effect.id
    const lp=runtimeFor(level).getHitBuffPreview(0,{...level.hits[0],buffOverride:{convertInputsByEffectId:{[lid]:9999}}})
    equal(lp.configurationParameters[lid].convertBase.value,12)
  }
})

cases.set('K21', async () => {
  for(const mode of ['ordinary','extra-team']) {
    const f=eventFixture({mode,damageType:'direct',effects:[fixed('global','dmgBonus',25)]})
    const candidate=generatedCandidate(f),attached=candidate.result.extraGains
    const runtime=runtimeFor(f,{mainExternal:candidate.evaluation.external,sourceExtraGains:attached})
    for(const name of ['PanelCalcSection','OptimalAffixAllocSection']) {
      const mounted=await mountSection(name,f,{flowCalculationRuntime:runtime},name==='OptimalAffixAllocSection'?['recomputeSkillFlowHitMaps','skillFlowHitMapState']:[])
      try {
        const detail=mounted.vm.resolveFlowCalculationDetail(f.hits[0].id)
        equal(detail.evaluation.external.atk,3000)
        equal(detail.evaluation.finalPanel.dmgBonus,35)
        equal(detail.evaluation, runtime.getHitDetail(f.hits[0]).evaluation)
        equal(runtime.getHitNumbers(f.hits[0]).total,detail.evaluation.total)
        if(name==='PanelCalcSection') equal(mounted.vm.getEventBuffPreviewInputs(0,f.hits[0]).effectAmounts[collectAllBuffEffects(f.context.panelContext)[0].effect.id],25)
        else {mounted.vm.recomputeSkillFlowHitMaps();equal(mounted.vm.skillFlowHitMapState.map[f.hits[0].id],detail.evaluation.total)}
        mounted.props.flowCalculationRuntime=runtimeFor(f,{mainExternal:{...f.panels.owner,atk:4000}})
        await nextTick()
        const changed=mounted.vm.resolveFlowCalculationDetail(f.hits[0].id)
        equal(changed.evaluation.external.atk,4000)
        equal(changed.evaluation.finalPanel.dmgBonus,25)
        mounted.props.flowCalculationRuntime=undefined
        await nextTick()
        equal(mounted.vm.resolveFlowCalculationDetail(f.hits[0].id),null)
      } finally {mounted.unmount()}
    }
  }
})

async function checkRealPageRouting(mode='ordinary') {
  const previousWindow=globalThis.window,previousDocument=globalThis.document
  const memory=new Map(),storage={getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,String(value)),removeItem:key=>memory.delete(key)}
  globalThis.window={addEventListener(){},removeEventListener(){},localStorage:storage}
  globalThis.document={addEventListener(){},removeEventListener(){},visibilityState:'visible'}
  const f=eventFixture({mode,damageType:'direct',effects:[fixed('page-global','dmgBonus',25)]}),pinia=createPinia(),store=useCalculatorBuffStore(pinia)
  store.agents=f.agents;store.wengines=[];store.driveDiscs=[];store.bangboos=[f.context.panelContext.bangboo];store.loaded=true;store.customSkills=[{...f.skill,baseMult:100}]
  const url=urlFor('DamageCalcPage'),imports=await loadVueSetupImports(url)
  imports['@/api/crisisAssault']={...imports['@/api/crisisAssault'],fetchCrisisAssaultPhases:async()=>[]}
  imports['@/api/defense']={...imports['@/api/defense'],fetchDefenseSeasons:async()=>[]}
  imports['@/api/deduction']={...imports['@/api/deduction'],fetchDeductionPhases:async()=>[]}
  const mounted=mountVueSetup(url,{imports,plugins:[pinia],expose:['teamSlots','slotPanels','schemeSlots','extraGains','skillFlowPanelSource','skillFlowPanelOptions','skillFlowPageSignature','flowCalculationRuntime','configurationCalculationRuntime','panelCalcMode','hits','buffConvertResolveInputsForSlot','resolveFlowCalculationDetail']})
  try{
    await nextTick();await nextTick()
    for(let i=0;i<f.teamSlots.length;i++)Object.assign(mounted.vm.teamSlots[i],f.teamSlots[i])
    mounted.vm.extraGains=f.extraGains
    Object.assign(mounted.vm.slotPanels,Object.fromEntries(Object.entries(f.panels).map(([id,panel])=>[id,{active:'imported',importedPanel:panel}])))
    mounted.vm.schemeSlots=[{prepared:[{id:'prepared',skillId:f.skill.id,skillSource:'custom',anomalyPowerAgentId:'power',triggerAgentId:'owner'}],flow:[{id:'page-event',ownerAgentId:'owner',preparedId:'prepared',count:1,staggerPhase:'stagger',critMode:'expected'}]}]
    await nextTick()
    equal(mounted.vm.hits.length,1,'real page resolves the prepared/flow event')
    const allocation=generatedCandidate(f),sweep=generatedCandidate(f,3000),attached=allocation.result.extraGains
    for(const source of ['config','allocation','sweep']){
      mounted.vm.skillFlowPanelSource=source
      mounted.vm.skillFlowPanelOptions={allocation:{mode:'allocation',mainExternal:allocation.evaluation.external,signature:mounted.vm.skillFlowPageSignature,label:'candidate',baseDamageSource:'atk',extraGains:attached},sweep:{mode:'sweep',mainExternal:sweep.evaluation.external,signature:mounted.vm.skillFlowPageSignature,label:'sweep',baseDamageSource:'atk',extraGains:attached}}
      for(const mode of ['panel','optimal']){
        mounted.vm.panelCalcMode=mode;await nextTick()
        const hit=mounted.vm.hits[0],runtime=mounted.vm.flowCalculationRuntime,detail=mounted.vm.resolveFlowCalculationDetail(hit.id)
        equal(detail.evaluation,runtime.getHitDetail(hit).evaluation)
        equal(detail.evaluation.finalPanel.dmgBonus,source==='config'?25:35)
        equal(detail.evaluation.external.atk,source==='config'?1000:source==='allocation'?3000:4000)
        const preview=mounted.vm.buffConvertResolveInputsForSlot(0,undefined,hit.id)
        deepEqual(preview,runtime.getHitBuffPreview(0,hit))
        equal(mounted.vm.configurationCalculationRuntime.getGlobalPanelStages(0).externalPanel.atk,1000)
        const section=await mountSection(mode==='optimal'?'OptimalAffixAllocSection':'PanelCalcSection',f,{flowCalculationRuntime:runtime})
        try{equal(section.vm.resolveFlowCalculationDetail(hit.id)?.evaluation??null,null,'foreign hit id is not silently substituted')
          section.props.hits=[hit];await nextTick();equal(section.vm.resolveFlowCalculationDetail(hit.id).evaluation,detail.evaluation)
        }finally{section.unmount()}
      }
    }
    // A second independent fixture: selected panel itself is the conversion base.
    const derived=convert('page-convert',{convert:{from:'atk',panelSource:'external',ratioPercent:10,initialBase:0,cap:null}})
    if(mode==='ordinary')store.agents=[{...f.agents[0],mindscapeBuffs:mindscapeWithEffects([derived])},f.agents[1]]
    else mounted.vm.extraGains=eventFixture({mode,damageType:'direct',effects:[derived]}).extraGains
    await nextTick()
    for(const [external,amount] of [[3000,300],[4000,400]]){
      mounted.vm.skillFlowPanelSource='allocation'
      mounted.vm.skillFlowPanelOptions={allocation:{mode:'allocation',mainExternal:{...f.panels.owner,atk:external},signature:mounted.vm.skillFlowPageSignature,label:'convert candidate',baseDamageSource:'atk'}}
      for(const mode of ['panel','optimal']){
        mounted.vm.panelCalcMode=mode;await nextTick()
        const hit=mounted.vm.hits[0],runtime=mounted.vm.flowCalculationRuntime,detail=runtime.getHitDetail(hit),preview=mounted.vm.buffConvertResolveInputsForSlot(0,undefined,hit.id)
        equal(detail.evaluation.finalPanel.dmgBonus,amount)
        const params=Object.values(preview.configurationParameters).find(p=>p.convertBase)
        equal(params.convertBase.value,external);equal(params.amount,amount)
        equal(runtime.getHitNumbers(hit).total,detail.evaluation.total)
      }
    }
    store.agents=f.agents;mounted.vm.extraGains=f.extraGains;await nextTick()
    mounted.vm.skillFlowPanelSource='allocation'
    mounted.vm.skillFlowPanelOptions={allocation:{mode:'allocation',mainExternal:{...f.panels.owner,atk:9999},signature:'stale',label:'old',baseDamageSource:'atk',extraGains:attached}}
    await nextTick();equal(mounted.vm.flowCalculationRuntime.getHitDetail(mounted.vm.hits[0]).evaluation.external.atk,1000,'stale candidate falls back to config')
    mounted.vm.skillFlowPanelOptions={};await nextTick();equal(mounted.vm.flowCalculationRuntime.getHitDetail(mounted.vm.hits[0]).evaluation.finalPanel.dmgBonus,25,'missing candidate does not retain attached gains')
    store.customSkillGroups=[{id:'runtime-group',name:'group',agentId:'owner',source:'custom',members:[{skillId:f.skill.id,count:1,order:0}]}]
    mounted.vm.schemeSlots=[{prepared:[{id:'group-prepared',skillGroupId:'runtime-group',skillSource:'custom'}],flow:[{id:'group-row',preparedId:'group-prepared',ownerAgentId:'owner',count:1,staggerPhase:'stagger',critMode:'expected'}]}]
    await nextTick()
    const group=mounted.vm.buffConvertResolveInputsForSlot(0,null,'group-row')
    equal(group.contextKind,'group');equal(group.effectSummaries,undefined)
    equal(mounted.vm.buffConvertResolveInputsForSlot(0,null,'missing-event').contextKind,'unavailable')

  }finally{mounted.unmount();globalThis.window=previousWindow;globalThis.document=previousDocument}
}
const sectionRoutingCase=cases.get('K21')
cases.set('K21',async()=>{await sectionRoutingCase();for(const mode of ['ordinary','extra-team'])await checkRealPageRouting(mode)})

cases.set('K22', async () => {
  for (const mode of ['ordinary','extra-team']) {
    const f=eventFixture({mode,damageType:'direct',effects:[fixed('modal-gain','dmgBonus',25)]}),runtime=runtimeFor(f),d=runtime.getHitDetail(f.hits[0]);
    const pinia=createPinia(),store=useCalculatorBuffStore(pinia);store.customSkills=[f.skill];store.agents=f.agents;store.loaded=true;
    const url=urlFor('SkillFlowSection'),previousWindow=globalThis.window,previousDocument=globalThis.document;
    globalThis.window={addEventListener(){},removeEventListener(){}};globalThis.document={addEventListener(){},removeEventListener(){}};
    const ui=mountVueSetup(url,{imports:await loadVueSetupImports(url),plugins:[pinia],expose:['openDetailRoot','zoneTipGroupLabel','zoneTipGroups','detailZoneRows'],props:{teamSlots:f.teamSlots,agents:f.agents,hits:f.hits,slots:[{prepared:[{id:'prepared',skillId:f.skill.id,skillSource:'custom',anomalyPowerAgentId:'power',triggerAgentId:'owner'}],flow:[{id:'A',ownerAgentId:'owner',preparedId:'prepared',count:1,staggerPhase:'stagger'}]}],hitCalcResults:{[f.hits[0].id]:d.evaluation.result},resolveCalculationDetail:()=>d}});
    try {ui.vm.openDetailRoot({kind:'flow',entryId:'A'});await nextTick();const label=ui.vm.zoneTipGroupLabel('增伤');ok(label.includes('owner'),mode+' direct modal label must identify actual owner: '+label);ok(!label.includes('power'));}finally{ui.unmount();globalThis.window=previousWindow;globalThis.document=previousDocument;}
  }

  for(const mode of ['ordinary','extra-team']) {
    const f=eventFixture({mode,damageType:'anomaly',effects:[fixed('electric','dmgBonus',25,{elementFilter:['电']}),fixed('ice','dmgBonus',40,{elementFilter:['冰']})],
      agents:[testAgent('owner',{element:'火'}),testAgent('power',{element:'电'}),testAgent('trigger',{element:'冰'})],
      prepared:[{id:'prepared',skillId:'event-skill',skillSource:'custom',anomalyPowerAgentId:'power',triggerAgentId:'trigger'}],
    })
    const runtime=runtimeFor(f)
    for(const [damageType,element,expected] of [['direct',null,0],['direct','电',25],['anomaly',null,25],['anomaly','火',0],['anomaly',null,25]]){
      const hit={...f.hits[0],skill:{...f.hits[0].skill,damageType},damageKind:damageType==='direct'?'direct':'anomaly',elementOverride:element,multOverrides:{directDmgMult:100,anomalyMult:100}}
      const d=runtime.getHitDetail(hit), preview=runtime.getHitBuffPreview(0,hit),tips=buildEventValueTips(d)
      const key=collectAllBuffEffects(f.context.panelContext).find(i=>i.effect.id.endsWith('electric')).effect.id
      equal(preview.effectAmounts[key],expected)
      equal(d.evaluation.finalPanel.dmgBonus,expected)
      equal(d.evaluation.total,runtime.getHitNumbers(hit).total)
      for(const usage of d.evaluation.damageInputUsages) ok(d.evaluation.viewSnapshots[usage.viewKey])
      const general=JSON.stringify(tips.dmgMultiplier)
      if(expected===25) {ok(general.includes('25'));ok(!general.includes('40'))}
    }
    {
      const f=eventFixture({mode,damageType:'direct',sourceSlot:1,effects:[fixed('indirect-source','atk',500,{applyTarget:'self'}),convert('indirect-derived')]})
      if(mode!=='ordinary')f.extraGains.find(gain=>gain.effects.some(effect=>effect.id==='indirect-source')).applySlot=1
      const detail=runtimeFor(f).getHitDetail({...f.hits[0],multOverrides:{directDmgMult:100}}),tips=buildEventValueTips(detail)
      equal(detail.evaluation.result.baseDamage,1000)
      equal(detail.evaluation.finalPanel.dmgBonus,250)
      ok(detail.evaluation.damageInputUsages.some(usage=>usage.usedView==='convertSourcePanel'),'fixture must exercise an adopted indirect conversion source')
      const dependency=detail.evaluation.damageInputUsages.find(usage=>usage.usedView==='convertSourcePanel')
      equal(detail.evaluation.viewSnapshots[dependency.viewKey].panel.atk,2500,'indirect source snapshot retains its own panel')
      equal(tips.baseDamage.find(group=>group.label==='合计').items[0],'局内攻击力 1,000',mode+' indirect conversion source cannot replace actual base input')
    }
    for(const damageType of ['anomaly','anomalyRelease','disorder','turbulence','radiance']){
      const stat=damageType+'DmgBonus',key=damageType==='radiance'?'radianceCombinedDmgBonusZone':damageType==='anomalyRelease'?'anomalyReleaseCombinedDmgBonusZone':damageType+'DmgBonusZone'
      const f=eventFixture({mode,damageType,effects:[fixed('aliased-bonus',stat,25)],
        agents:[testAgent('owner',{element:damageType==='radiance'?'流明':damageType==='turbulence'?'风':'火'}),testAgent('power',{element:'电'})]})
      const hit={...f.hits[0],elementOverride:damageType==='radiance'?'流明':damageType==='turbulence'?'风':null}
      const detail=runtimeFor(f).getHitDetail(hit),tips=buildEventValueTips(detail)
      equal(detail.evaluation.result[key],1.25,mode+' '+damageType+' actual typed bonus')
      ok(JSON.stringify(tips[key]).includes('25%'),mode+' '+damageType+' typed bonus source must retain aliased owner/trigger view: '+JSON.stringify(tips[key]))
    }
    for(const damageType of ['direct','sharpen','anomaly','anomalyRelease','disorder','turbulence','radiance']){
      const fixture=eventFixture({mode,damageType,effects:[fixed('actual','dmgBonus',25),fixed('unused','energyRegen',50)],
        agents:[testAgent('owner',{element:damageType==='radiance'?'流明':damageType==='turbulence'?'风':'火'}),testAgent('power',{element:'电'})]})
      const r=runtimeFor(fixture),hit={...fixture.hits[0],multOverrides:{directDmgMult:100,anomalyMult:100,anomalyReleaseMult:100,radianceMult:100}}
      const d=r.getHitDetail(hit)
      ok(d,damageType+' must be calculable')
      const tips=buildEventValueTips(d), zones=buildEventZoneDisplay(d)
      ok(zones.length>0)
      for(const zone of zones){ok(Array.isArray(zone.groups),damageType+' shared zone groups '+zone.label);for(const slot of zone.sourceSlots)ok(d.evaluation.damageInputUsages.some(u=>u.usedView!=='convertSourcePanel'&&d.evaluation.viewSnapshots[u.viewKey].slotIndex===slot))}
      if(damageType==='direct') {const base=zones.find(row=>row.label==='面板攻击力');ok(base.sourceLabel.includes('owner'));ok(!base.sourceLabel.includes('power'))}
      for(const record of d.evaluation.effectRecords)if(record.convertBase?.sourceViewKey)ok(d.evaluation.viewSnapshots[record.convertBase.sourceViewKey])
      ok(!JSON.stringify(tips).includes('回能效率 +50'))
      equal(r.getHitNumbers(hit).total,d.evaluation.total)
      const url=urlFor('DamageResultDetail'),mounted=mountVueSetup(url,{imports:await loadVueSetupImports(url),expose:['valueTips'],props:{
        sourceTips:tips,calcParts:d.evaluation.result,finalPanel:d.evaluation.finalPanel,externalPanel:d.evaluation.external,
        sources:d.evaluation.breakdown.sources,pierceMod:d.evaluation.breakdown.totalMods.pierce,piercePower:d.evaluation.piercePower,
        enemyInput:d.enemyInput,isMb:d.isMb,show:damageType==='direct'||damageType==='sharpen'?'direct':'anomaly',anomalySubKind:d.evaluation.anomalySubKind,
      }})
      try {deepEqual(mounted.vm.valueTips,tips)} finally {mounted.unmount()}
    }
  }
})

cases.set('K23', async () => {
  for(const mode of ['ordinary','extra-team']){
    const f=eventFixture({mode,damageType:'direct',effects:[convert('manual',{convert:{from:'atk',panelSource:'manual',defaultBase:1000,ratioPercent:10,initialBase:0,cap:null}})]})
    const item=collectAllBuffEffects(f.context.panelContext)[0], selection=createEmptyMultiSlotBuffSelection()
    selection.team.enabledIds[item.effect.id]=false
    const runtime=runtimeFor(f,{contextInput:{slotBuffSelections:selection}})
    const global=runtime.getConfigurationInputs(0,'global'),group=runtime.getConfigurationInputs(0,'group'),event=runtime.getHitBuffPreview(0,f.hits[0]),unavailable=runtime.getHitBuffPreview(0,null)
    for(const [value,kind] of [[global,'global'],[group,'group'],[event,'event'],[unavailable,'unavailable']]){
      equal(value.contextKind,kind);equal(value.configurationOnly,kind!=='event');equal(value.configurationParameters[item.effect.id].amount,100)
      if(kind!=='event'){equal(value.effectAmounts,undefined);equal(value.effectSummaries,undefined)}
    }
    equal(event.effectAmounts[item.effect.id],mode==='ordinary'?0:100)
    const options={slotIndex:0,selection,...global}
    ok(buildFlowBuffEffectText(item,options).includes('+ 100'),buildFlowBuffEffectText(item,options))
    ok(buildFlowBuffEffectText(item,{...options,...group}).includes('整组配置；数值见成员'))
    ok(buildFlowBuffEffectText(item,{...options,...unavailable}).includes('配置参数；当前事件不可结算'))
    ok(buildFlowBuffEffectText(item,{slotIndex:0,selection}).includes('—'))
    const url=urlFor('SkillBuffOverrideModal'), mounted=mountVueSetup(url,{imports:await loadVueSetupImports(url),expose:['convertBaseModel','effectResultText','setConvertInput','override'],props:{open:true,effects:[item],convertResolveInputs:()=>unavailable}})
    try{
      equal(mounted.vm.convertBaseModel(item),1000)
      ok(mounted.vm.effectResultText(item).includes('当前事件不可结算'))
      mounted.props.convertResolveInputs=()=>group;await nextTick();ok(mounted.vm.effectResultText(item).includes('整组配置'))
      mounted.props.convertResolveInputs=undefined;await nextTick();equal(mounted.vm.convertBaseModel(item),undefined);ok(mounted.vm.effectResultText(item).includes('—'))
      mounted.vm.setConvertInput(item.effect,0);await nextTick()
      equal(mounted.vm.override.convertInputsByEffectId[item.effect.id],0,'missing runtime keeps writable draft zero')
      mounted.props.convertResolveInputs=(slot,row)=>runtime.getHitBuffPreview(slot,f.hits[0],row);await nextTick()
      equal(mounted.vm.convertBaseModel(item),0,'resolved input catches up with retained draft')
    }finally{mounted.unmount()}
  }
})

cases.set('K24', async () => {
  const f=eventFixture({damageType:'direct',sourceSlot:1,effects:[convert('level',{convert:{from:'skillLevelBasic',panelSource:'external',ratioPercent:100,initialBase:0,cap:null}})]})
  const state=reactive(runtimeInput(f,{contextInput:{skillTalentLevelsByAgent:{power:{basic:8}}}}))
  const current=computed(()=>createBuffCalculationRuntime(state)),hit={...f.hits[0],multOverrides:{directDmgMult:100}}
  const before=current.value, n1=before.getHitNumbers(hit)
  state.contextInput.skillTalentLevelsByAgent.power.basic=12
  const after=current.value,n2=after.getHitNumbers(hit)
  ok(before.signature!==after.signature);ok(n1.total!==n2.total)
  equal(before.getHitNumbers(hit).total,n1.total,'old runtime remains bound to its input')
  const sigInput={teamSlots:f.teamSlots,activeSlotPanels:f.panels,mainSlotIndex:0,selectedBangbooId:'none',bangbooRefine:1,environmentBuffIds:[],extraGains:f.extraGains,enemyInput:f.context.enemyInput,
    skillTalentLevelsByAgent:{power:{basic:8}},agentElements:f.agents.map(a=>[a.id,a.element]),hits:f.hits}
  const signature=buildSkillFlowPageSignature(sigInput)
  for(const changed of [ {...sigInput,skillTalentLevelsByAgent:{power:{basic:12}}}, {...sigInput,agentElements:[['owner','火'],['power','冰']]}, {...sigInput,hits:[{...f.hits[0],elementOverride:'火'}]}, {...sigInput,hits:[{...f.hits[0],buffOverride:{disabledEffectIds:['changed']}}]} ])ok(buildSkillFlowPageSignature(changed)!==signature)
  clearHitEvalCache()
  for(let i=0;i<505;i++)after.getHitDetail({...hit,id:'capacity-'+i})
  equal(hitEvalCacheDebugStats().size,500)
  clearHitEvalCache()
})

const identityCase=cases.get('K24')
cases.set('K24',async()=>{
  await identityCase()
  const f=eventFixture({mode:'extra-team',damageType:'direct',effects:[fixed('display-gain','dmgBonus',25)]})
  f.hits=f.hits.map(hit=>({...hit,multOverrides:{directDmgMult:100}}));f.context.hits=f.hits
  let lastDisplay,lastSource
  const mounted=await mountSection('OptimalAffixAllocSection',f,{
    'onUpdate:displayPanelSources':value=>{lastDisplay=value},'onUpdate:panelSourceOptions':value=>{lastSource=value},
  },['sectionMode','affixLibraryState','affixAllocTotalRolls','runAffixAllocation','affixAllocResultStale','affixAllocEval','panelSourceSignature',
    'sweepPanelSource','directAlloc','startCalculation','runSweepRecompute','sweepNeedsCommit','evalCtx','selectedEval','directPoints'])
  try{
    mounted.vm.sectionMode='allocation'
    const library=createAffixLibraryStateForOrigin('empty')
    library.customEntries=[{id:'zero-entry',label:'zero',target:'panel:critRate',perRoll:0,cap:1,group:'副词条',rollCost:1,enabledByDefault:true}]
    mounted.vm.affixLibraryState=library;mounted.vm.affixAllocTotalRolls=1
    await nextTick();await mounted.vm.runAffixAllocation();await nextTick()
    ok(lastDisplay?.allocation,'real solve publishes its display source')
    equal(lastDisplay.allocation.finalPanel.dmgBonus,25)
    const oldExternal=lastDisplay.allocation.mainExternal,oldSignature=lastDisplay.allocation.signature
    mounted.props.extraGains=mounted.props.extraGains.map(gain=>({...gain,effects:gain.effects.map(effect=>({...effect,value:35}))}))
    await nextTick()
    equal(mounted.vm.affixAllocResultStale,true)
    equal(lastDisplay.allocation,null,'changed combat input invalidates display even if external does not change')
    equal(lastSource.allocation,null,'old solve is not restamped as current')
    ok(mounted.vm.panelSourceSignature!==oldSignature)
    await mounted.vm.runAffixAllocation();await nextTick()
    deepEqual(lastDisplay.allocation.mainExternal,oldExternal)
    equal(lastDisplay.allocation.finalPanel.dmgBonus,35)
    equal(lastDisplay.allocation.signature,mounted.vm.panelSourceSignature)
    mounted.vm.sectionMode='sweep'
    Object.assign(mounted.vm.directAlloc,{flatStat:0,pen:0,mastery:0,critRate:0,totalRolls:0,atkPercent:0,hpFlat:0})
    for(const panelSource of ['imported','initial']){
      mounted.vm.sweepPanelSource=panelSource;await nextTick()
      mounted.vm.startCalculation();await mounted.vm.runSweepRecompute();await nextTick()
      ok(mounted.vm.directPoints.length>0,'real sweep produced points')
      equal(mounted.vm.evalCtx.mainBaseExternalPanel===null,panelSource==='initial')
      ok(lastSource.sweep,'real sweep publishes selected source')
      deepEqual(lastSource.sweep.mainExternal,mounted.vm.selectedEval.external)
      deepEqual(lastDisplay.sweep.finalPanel,mounted.vm.selectedEval.finalPanel)
    }
  }finally{mounted.unmount()}
})

cases.set('K25', async () => {
  const pairs=new Map()
  for(const mode of ['ordinary','extra-slot','extra-team']){
    const f=eventFixture({mode,damageType:'direct',effects:[fixed('source','atk',500),convert('derived')]})
    const input=reactive(runtimeInput(f)),before=JSON.stringify(input),team=input.contextInput.teamSlots,slot=team[0]
    const runtime=createBuffCalculationRuntime(input), item=collectAllBuffEffects(f.context.panelContext).find(i=>i.effect.id.endsWith('source'))
    const a={...f.hits[0],multOverrides:{directDmgMult:100},buffOverride:{disabledEffectIds:[item.effect.id]}},b={...f.hits[1],multOverrides:{directDmgMult:100}}
    const hitBefore=JSON.stringify([a,b]),globalBefore=JSON.stringify(runtime.getGlobalPanelStages(0))
    const detailA=runtime.getHitDetail(a),previewA=runtime.getHitBuffPreview(0,a),detailB=runtime.getHitDetail(b)
    equal(runtime.getHitNumbers(a).total,detailA.evaluation.total)
    equal(runtime.getHitNumbers(b).total,detailB.evaluation.total)
    equal(JSON.stringify(input),before);equal(input.contextInput.teamSlots,team);equal(team[0],slot)
    equal(JSON.stringify([a,b]),hitBefore);equal(JSON.stringify(runtime.getGlobalPanelStages(0)),globalBefore)
    equal(runtime.getHitDetail(a).evaluation,detailA.evaluation)
    const captured=JSON.stringify(detailA.evaluation.hit)
    const mutableHit={...a,id:'mutable-hit',skill:{...a.skill}}
    const capturedDetail=runtime.getHitDetail(mutableHit)
    mutableHit.skill.name='changed caller';mutableHit.count=99
    equal(capturedDetail.evaluation.hit.count,a.count);equal(capturedDetail.evaluation.hit.skill.name,a.skill.name)
    equal(JSON.stringify(detailA.evaluation.hit),captured)
    equal(runtime.getHitBuffPreview(0,a),previewA)
    ok(detailA.evaluation.finalPanel.dmgBonus===100&&detailB.evaluation.finalPanel.dmgBonus===150)
    if(mode==='ordinary')pairs.set('result',detailA.evaluation.result)
    else deepEqual(detailA.evaluation.result,pairs.get('result'))
    const url=urlFor('SkillBuffOverrideModal'),modal=mountVueSetup(url,{imports:await loadVueSetupImports(url),expose:['convertBaseModel','effectResultText','restoreGlobal'],props:{
      open:true,effects:collectAllBuffEffects(f.context.panelContext),override:a.buffOverride,
      convertResolveInputs:(slot,row)=>runtime.getHitBuffPreview(slot,a,row),
    }})
    try{
      const derived=collectAllBuffEffects(f.context.panelContext).find(i=>i.effect.id.endsWith('derived'))
      equal(modal.vm.convertBaseModel(derived),1000);ok(modal.vm.effectResultText(derived).includes('+ 100'),modal.vm.effectResultText(derived))
      modal.vm.restoreGlobal();await nextTick();equal(modal.vm.convertBaseModel(derived),1500);ok(modal.vm.effectResultText(derived).includes('+ 150'),modal.vm.effectResultText(derived))
    }finally{modal.unmount()}
  }
  for(const name of ['PanelCalcSection','OptimalAffixAllocSection']){
    const source=fs.readFileSync(urlFor(name),'utf8')
    ok(!/evaluateSkillFlowHit\(|resolveSkillFlowCalculationDetail\(|hitEvalCacheKey\(/.test(source),name+' cannot own event calculation or keys')
  }
  for(const path of ['src/components/calculator/BuffEffectPickerModal.vue','src/components/calculator/SkillBuffOverrideModal.vue','src/utils/flowBuffTable.ts']){
    const source=fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');ok(!/resolveConvertValue|resolveEffectBaseValue/.test(source),path+' cannot calculate amounts')
  }
})

// 只将实际执行并通过的条款计为通过。
for (const id of requested) {
  const start = assertions
  try {
    const run = cases.get(id)
    assert.ok(run, `${id}: acceptance not implemented`)
    await run()
    passed++
    console.log(`PASS ${id}: ${assertions - start} assertions`)
  } catch (error) {
    failed++
    console.error(`FAIL ${id}: ${error.stack}`)
  }
}
console.log(`Executed ${requested.join(',')}; ${passed} passed, ${failed} failed; ${assertions} assertions`)
if (failed) process.exitCode = 1
