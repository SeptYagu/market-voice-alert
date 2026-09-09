// Diagnostic reproductions for the accompanying handoff, not regression tests.
// Uses jsdom, synthetic inputs and a fetch stub; does not request market data.
import '../../tests/_jsdom-setup.cjs';
import { formatQuoteSpeechDelta } from '../../src/js/tts.js';
import { createLimitUpController, buildLimitUpGroupsForState } from '../../src/js/controllers/limitUpController.js';
import { createMomentumController } from '../../src/js/controllers/momentumController.js';
import { ChartRowManager, createChartState } from '../../src/js/controllers/chartRowController.js';
import { klineCacheSet } from '../../src/js/storage.js';
import { getBeijingDate } from '../../src/js/time.js';
import { getMarketSession, isFuturesMarketOpen, isVoiceAllowedInSession, DEFAULT_SMART_SCHEDULE } from '../../src/js/marketSession.js';
import { getFuturesSession } from '../../server/futures/futuresSessionService.js';
import { parseFutureInput } from '../../server/futures/contractCatalog.js';

let memory;
for (const [price, changePercent] of [[10,1],[11,1],[11,1],[11,1]]) {
  const result = formatQuoteSpeechDelta({code:'sh600000',name:'测试股',price,changePercent}, memory);
  if (result.spoken) memory = result.spoken;
  console.log('voice', JSON.stringify({price,changePercent,...result}));
}

const lu = { selectedDate:getBeijingDate(),items:[{code:'sh600000',name:'测试股',price:11,changePercent:10,limitUpCount:1}],
  expandedCodes:new Set(), chartInstances:new Map(),pinnedCodes:new Set(),selectedCodes:new Set(),sortKey:'amount',groupSort:{},groups:[] };
lu.groups=buildLimitUpGroupsForState(lu);
let reloadArgs;
const mgr={klineCtlMap:new Map(),intradayCtlMap:new Map(),loadKline:(...args)=>{reloadArgs=args;}};
const state={limitUp:lu,quotes:new Map([['sh600000',{price:10.5,changePercent:5}]])};
const ctrl=createLimitUpController({getState:()=>state,limitUpChartMgr:mgr});
const root=document.createElement('div'); document.body.append(root); ctrl.setRootEl(root); ctrl.render();
ctrl.applyLiveTicks();
console.log('group',JSON.stringify({stateGroup:lu.groups.find(g=>g.items.length).key,domGroup:root.querySelector('tr[data-code]').closest('[data-group]').dataset.group,percent:root.querySelector('[data-field="percent"]').textContent}));
lu.chartInstances.set('sh600000',createChartState());
ctrl.handleForceReloadChart('sh600000');
console.log('forceReloadArgs',JSON.stringify(reloadArgs));

globalThis.fetch=(_url,{signal}={})=>new Promise((_resolve,reject)=>{signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});
const mState={items:[],pinnedCodes:new Set(),loading:false};
const mc=createMomentumController({getState:()=>({momentum:mState}),momentumChartMgr:{}});
const first=mc.handleScan(); mc.stopScan(); const second=mc.handleScan(); const owner=mState.abort;
await first;
console.log('scanRace',JSON.stringify({newRequestStillActive:mState.abort===owner,loading:mState.loading}));
mc.stopScan(); await second;

const code='sh600099';
Object.defineProperty(globalThis,'localStorage',{value:window.localStorage,configurable:true});
klineCacheSet(code,'1d',{code,name:'测试股',items:[{time:'2026-09-08',open:10,high:11,low:9,close:10,volume:100}]});
const oldInst=createChartState(); const newInst=createChartState(); const instances=new Map([[code,oldInst]]); let chartWrites=0;
const cm=new ChartRowManager({hasIntraday:false,getChartInstances:()=>instances,isExpanded:()=>true});
cm.klineCtlMap.set(code,{setPeriod(){},setKline(){chartWrites++;},setVolume(){},clearMA(){},fitContent(){}});
const loading=cm.loadKline(code); instances.set(code,newInst); await loading;
console.log('chartRace',JSON.stringify({chartWrites,newInstanceHasData:!!newInst.klineData}));
const now=new Date('2026-09-08T21:10:00+08:00');
console.log('nightPolicy',JSON.stringify({futuresOpen:isFuturesMarketOpen(now),scheduleAllowed:isVoiceAllowedInSession(getMarketSession(now),DEFAULT_SMART_SCHEDULE)}));
console.log('serverNightEnd',JSON.stringify({declaredEnd:parseFutureInput('RB0').nightSessionEnd,session:getFuturesSession('RB0',new Date('2026-09-08T23:30:00+08:00'))}));
const syntheticCalendar=['2026-09-08','2026-09-10'];
console.log('calendarPolicy',JSON.stringify({frontend:isFuturesMarketOpen(now,syntheticCalendar),backend:getFuturesSession('RB0',now,syntheticCalendar).isTrading}));
process.exit(0);
