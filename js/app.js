"use strict";
/* ==================== config ==================== */
const REVEAL_COOLDOWN=180000;  // one free recipe reveal per 3 minutes
const KEY='pxl_';              // localStorage prefix

/* ==================== shared state ==================== */
let uiPause=false,rotPause=false,started=false,painted=false,bootDone=false;

/* ==================== storage (localStorage) ==================== */
const Store={
  get(k){try{const v=localStorage.getItem(KEY+k);return v==null?null:v;}catch(e){return null;}},
  set(k,v){
    try{localStorage.setItem(KEY+k,v);}
    catch(e){if(e&&e.name==='QuotaExceededError')toast('Save failed: storage is full');}
  },
  del(k){try{localStorage.removeItem(KEY+k);}catch(e){}},
  getJ(k,d){const v=this.get(k);if(v==null)return d;try{return JSON.parse(v);}catch(e){return d;}},
  setJ(k,v){this.set(k,JSON.stringify(v));}
};

/* ==================== audio (Web Audio, synthesized) ==================== */
let actx=null,master=null,noiseBuf=null,userMute=false;
const audioAllowed=()=>!userMute;
function unlockAudio(){
  if(!actx){
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
    try{
      actx=new AC();master=actx.createGain();master.gain.value=0;master.connect(actx.destination);
      noiseBuf=actx.createBuffer(1,(actx.sampleRate*.7)|0,actx.sampleRate);
      const d=noiseBuf.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
    }catch(e){actx=null;return;}
  }
  /* iOS leaves the context 'suspended'/'interrupted' after backgrounding: resume on a real gesture */
  if(actx.state!=='running')actx.resume().catch(()=>{});
  applyMute();
}
['pointerdown','touchend','keydown','click'].forEach(ev=>document.addEventListener(ev,unlockAudio,true));
function applyMute(){
  if(actx&&master)master.gain.setTargetAtTime(audioAllowed()?.55:0,actx.currentTime,.03);
  renderSound();
}
const sndReady=()=>actx&&master&&actx.state==='running'&&audioAllowed();
function tone(f,dur,type,vol,delay,to){
  if(!sndReady())return;
  const t0=actx.currentTime+(delay||0),o=actx.createOscillator(),g=actx.createGain();
  o.type=type||'sine';o.frequency.setValueAtTime(f,t0);
  if(to)o.frequency.exponentialRampToValueAtTime(to,t0+dur);
  g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(vol,t0+.006);
  g.gain.exponentialRampToValueAtTime(.0001,t0+dur);
  o.connect(g);g.connect(master);o.start(t0);o.stop(t0+dur+.05);
}
function noise(dur,ft,f,vol,q,to){
  if(!sndReady())return;
  const t0=actx.currentTime,s=actx.createBufferSource(),fl=actx.createBiquadFilter(),g=actx.createGain();
  s.buffer=noiseBuf;fl.type=ft;fl.frequency.setValueAtTime(f,t0);fl.Q.value=q||1;
  if(to)fl.frequency.exponentialRampToValueAtTime(to,t0+dur);
  g.gain.setValueAtTime(vol,t0);g.gain.exponentialRampToValueAtTime(.0001,t0+dur);
  s.connect(fl);fl.connect(g);g.connect(master);s.start(t0,Math.random()*.1);s.stop(t0+dur+.05);
}
let sfxT={};
function gate(k,ms){const n=performance.now();if(n-(sfxT[k]||0)<ms)return false;sfxT[k]=n;return true;}
function strokeFx(){
  if(!gate('stroke',75))return;
  if(tool==='eraser'){noise(.05,'lowpass',900,.05);return;}
  if(tool==='heat'){noise(.08,'bandpass',700,.05,2);return;}
  if(tool==='cool'){noise(.07,'highpass',6000,.03);return;}
  const mv=EL[sel].mv;
  if(mv==='l')tone(260+rnd(180),.07,'sine',.05,0,140);
  else if(mv==='g'||mv==='e'||mv==='m')noise(.06,'highpass',4500,.03);
  else if(mv==='p')noise(.045,'bandpass',2800,.06,1.4);
  else noise(.04,'bandpass',1100,.06,1.2);
}
function sfxBoom(r){
  if(!gate('boom',130))return;
  const v=Math.min(.5,.14+r*.014);
  noise(.7,'lowpass',1100,v,.7,70);tone(95,.45,'sine',v*.8,0,32);
}
function sfxChime(){if(!gate('chime',260))return;tone(1046,.28,'sine',.07);tone(1568,.38,'sine',.06,.08);}
function sfxGoal(){[523,659,784,1047].forEach((f,k)=>tone(f,.24,'triangle',.07,k*.085));}
function sfxClick(){if(gate('click',40))tone(1300,.03,'sine',.02);}
document.addEventListener('click',e=>{if(e.target.closest&&e.target.closest('button'))sfxClick();});
const ICO_ON='<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12"/>';
const ICO_OFF='<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>';
function renderSound(){
  const ico=document.getElementById('sndIco'),b=document.getElementById('bSound');if(!ico)return;
  const off=userMute;
  ico.innerHTML=off?ICO_OFF:ICO_ON;
  b.classList.toggle('on',off);
  b.title=userMute?'Sound off (M)':'Sound on (M)';
}
document.getElementById('bSound').onclick=()=>{
  userMute=!userMute;Store.set('mute',userMute?'1':'0');applyMute();
};

/* ==================== palette UI ==================== */
const CATS=['all','powder','liquid','gas','solid','metal','chem','food','life','energy','special','tool'];
const CAT_N={all:'All',powder:'Powders',liquid:'Liquids',gas:'Gases',solid:'Solids',metal:'Metals',chem:'Chemistry',
  food:'Food',life:'Life',energy:'Energy',special:'Special',tool:'Tools'};
let cat='all',query='';
const tabsEl=document.getElementById('tabs'),gridEl=document.getElementById('grid');
function curInfo(){
  if(tool){const tl=TOOLS.find(x=>x.k===tool);return[tl?tl.n:'',tl?tl.col:'#666'];}
  const e=EL[sel];return[e.n,e.col[0]];
}
function updateCur(){
  const[n,c]=curInfo();
  const nm=document.getElementById('curNm'),sw=document.getElementById('curSw');
  if(nm){nm.textContent=n;sw.style.background=c;}
}
function selectEl(id){sel=id;tool=null;updateCur();}
function buildTabs(){
  tabsEl.innerHTML='';
  CATS.forEach(c=>{
    const b=document.createElement('button');
    b.className='tab'+(c===cat?' on':'');
    b.textContent=CAT_N[c];
    b.onclick=()=>{cat=c;buildTabs();buildGrid();};
    tabsEl.appendChild(b);
  });
}
function buildGrid(){
  gridEl.innerHTML='';
  if(cat==='tool'||cat==='all'||query){
    TOOLS.forEach(tl=>{
      if(query&&!tl.n.toLowerCase().includes(query))return;
      const b=document.createElement('button');
      b.className='el'+(tool===tl.k?' on':'');
      b.style.borderLeftColor=tl.col;
      b.innerHTML='<span>'+tl.n+'</span>';
      b.onclick=()=>{tool=tl.k;updateCur();buildGrid();};
      gridEl.appendChild(b);
    });
  }
  DEF.forEach(e=>{
    if(!query){if(cat==='tool'||(cat!=='all'&&e.c!==cat))return;}
    else if(!e.n.toLowerCase().includes(query))return;
    const b=document.createElement('button');
    b.className='el'+(sel===e.id&&!tool?' on':'');
    b.style.borderLeftColor=e.col[0];
    b.innerHTML='<span>'+e.n+'</span>';
    b.onclick=()=>{selectEl(e.id);buildGrid();};
    gridEl.appendChild(b);
  });
}
document.getElementById('search').addEventListener('input',e=>{query=e.target.value.trim().toLowerCase();buildGrid();});
document.getElementById('brush').addEventListener('input',e=>{bsize=+e.target.value;document.getElementById('bsz').textContent=bsize;});

/* ==================== header controls ==================== */
const bPause=document.getElementById('bPause');
function setPaused(v){
  paused=v;bPause.classList.toggle('on',paused);
  bPause.querySelector('.lb').textContent=paused?'Play':'Pause';
  document.getElementById('bStep').hidden=!paused;
  setTimeout(headScroll,0);
  if(paused)goalEvent('pause');
}
bPause.onclick=()=>setPaused(!paused);
const bRep=document.getElementById('bRepl2');
bRep.onclick=()=>{replaceMode=!replaceMode;bRep.classList.toggle('on',replaceMode);};
function doClear(){
  recStart();for(let i=0;i<N;i++)if(type[i])recCell(i);recEnd();
  type.fill(0);burn.fill(0);dat.fill(0);temp.fill(AMB);elecStore.fill(0);chg.fill(0);
  toast('Field cleared');
}

/* ---- intro ---- */
const INTRO=[
  ['bPause','Pause and Step','Freeze time. While paused, Step advances one frame so you can watch every reaction.'],
  ['bSpeed','Speed','From ×0.25 to ×4. Slow down to look closely, speed up to see the outcome sooner.'],
  ['bUndo','Undo','Takes back your last stroke — even after clearing the field.'],
  ['bRoom','Room','Set the room temperature, gravity, wind and heat flow, or pick a preset like Moon, Arctic or Upside down.'],
  ['bGoals','Goals and reactions','Short goals teach the basics. Every new reaction you trigger is added to your collection of '+RX_TOTAL+'.'],
  ['bView','View mode','Switch the field between materials, a heat map and a flammability map.'],
  ['bSave','Saves','Three slots plus autosave. Your progress is kept between sessions.'],
  ['zoomBar','Zoom','+ and −, the mouse wheel or two fingers. Two fingers or a right-drag pan the field.'],
  ['bRepl2','Brush and Replace','The slider sets the brush size. Replace lets you draw over filled cells.',
   '<path d="M6 19c2.2 0 3.4-1.2 3.4-3.2M9.4 15.8l7.4-9.4a2.1 2.1 0 013 3l-9.4 7.4"/>']
];
function buildIntro(){
  document.getElementById('inLead').textContent='Pick a material from the palette and draw on the field. Everything interacts on its own: lava turns water into steam, acid eats metal, current runs along wires, plants grow toward water.';
  const box=document.getElementById('inList');box.innerHTML='';
  INTRO.forEach(([src,ti,de,fallback])=>{
    const row=document.createElement('div');row.className='row';
    const ic=document.createElement('div');ic.className='ic';
    const svg=document.querySelector('#'+src+' .ico');
    if(svg){const c=svg.cloneNode(true);c.removeAttribute('id');c.style.width='22px';c.style.height='22px';ic.appendChild(c);}
    else if(fallback)ic.innerHTML='<svg class="ico" viewBox="0 0 24 24" style="width:22px;height:22px">'+fallback+'</svg>';
    const txt=document.createElement('div');txt.innerHTML='<b></b><span></span>';
    txt.querySelector('b').textContent=ti;txt.querySelector('span').textContent=de;
    row.appendChild(ic);row.appendChild(txt);box.appendChild(row);
  });
}
function openIntro(){uiPause=true;buildIntro();document.getElementById('intro').hidden=false;}
function closeIntro(){
  uiPause=false;document.getElementById('intro').hidden=true;
}
function openConfirm(){uiPause=true;document.getElementById('confirm').hidden=false;}
function closeConfirm(){uiPause=false;document.getElementById('confirm').hidden=true;}
document.getElementById('bClear').onclick=openConfirm;
document.getElementById('cfNo').onclick=closeConfirm;
document.getElementById('cfYes').onclick=()=>{closeConfirm();doClear();};
document.getElementById('confirm').addEventListener('click',e=>{if(e.target.id==='confirm')closeConfirm();});
document.getElementById('bUndo').onclick=()=>undo();
document.getElementById('bHelp').onclick=()=>openIntro();
document.getElementById('inX').onclick=()=>closeIntro();
document.getElementById('intro').addEventListener('click',e=>{if(e.target.id==='intro')closeIntro();});
document.getElementById('bSpeed').onclick=()=>setSpeed(speedIdx+1);
document.getElementById('bStep').onclick=()=>stepOnce();
document.getElementById('bView').onclick=()=>setView(viewMode+1);
document.getElementById('bSave').onclick=()=>openModal();
document.getElementById('mClose').onclick=()=>closeModal();
document.getElementById('modal').addEventListener('click',e=>{if(e.target.id==='modal')closeModal();});
document.getElementById('bGoals').onclick=()=>openLab('goals');
document.getElementById('goal').onclick=()=>openLab('goals');
document.getElementById('labX').onclick=()=>closeLab();
document.getElementById('lab').addEventListener('click',e=>{if(e.target.id==='lab')closeLab();});
document.querySelectorAll('#lab .ltab').forEach(b=>b.onclick=()=>{labTab=b.dataset.t;renderLab();});

/* ---- toasts (queued, so discoveries don't overwrite each other) ---- */
const tq=[];let tBusy=false;
function toast(html,cls){
  tq.push([html,cls||'']);
  while(tq.length>3)tq.shift();
  if(!tBusy)nextToast();
}
function nextToast(){
  const el=document.getElementById('toast'),it=tq.shift();
  if(!it){tBusy=false;return;}
  tBusy=true;el.innerHTML=it[0];el.className='show '+it[1];
  setTimeout(()=>{el.classList.remove('show');setTimeout(nextToast,260);},it[1]?2600:1700);
}
/* bottom drawer on phones */
document.getElementById('drawer').onclick=()=>{
  const sd=document.getElementById('side');sd.classList.toggle('hid');
  document.querySelector('#drawer .ico').style.transform=sd.classList.contains('hid')?'':'rotate(180deg)';
  setTimeout(resize,60);
};

/* ==================== room settings ==================== */
const ROOM_DEF={temp:22,grav:1,wind:0,heat:1};
const PRESETS=[
  ['Earth',{temp:22,grav:1,wind:0,heat:1}],
  ['Moon',{temp:-20,grav:.25,wind:0,heat:.5}],
  ['Space',{temp:-250,grav:0,wind:0,heat:.25}],
  ['Arctic',{temp:-40,grav:1,wind:1,heat:1}],
  ['Desert',{temp:60,grav:1,wind:2,heat:1}],
  ['Inferno',{temp:450,grav:1,wind:0,heat:2}],
  ['Upside down',{temp:22,grav:-1,wind:0,heat:1}],
  ['Hurricane',{temp:12,grav:1,wind:-3,heat:1}],
  ['Heavy',{temp:22,grav:2,wind:0,heat:1}]
];
let room={...ROOM_DEF};
const clampN=(v,a,b,d)=>{v=+v;return isFinite(v)?Math.min(b,Math.max(a,v)):d;};
function applyRoom(r,user){
  r=r||{};
  room={temp:clampN(r.temp,-250,500,22),grav:clampN(r.grav,-2,2,1),wind:Math.round(clampN(r.wind,-3,3,0)),heat:clampN(r.heat,.25,3,1)};
  AMB=room.temp;GDIR=Math.sign(room.grav);GMAG=Math.abs(room.grav);WIND=room.wind;HX=room.heat;
  setPhysics();syncRoomUI();
  if(user){
    Store.setJ('room',room);
    goalEvent('room');
    if(room.temp<0)goalEvent('cold');
    if(room.grav<0)goalEvent('flip');
  }
}
const fmtG=g=>g===0?'0 g float':(Math.abs(g)+' g '+(g>0?'↓':'↑'));
const fmtW=w=>w===0?'calm':(w>0?'→ '+w:'← '+(-w));
function syncRoomUI(){
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v;};
  set('rTemp',room.temp);set('rGrav',room.grav);set('rWind',room.wind);set('rHeat',room.heat);
  document.getElementById('oTemp').textContent=room.temp+'°C';
  document.getElementById('oGrav').textContent=fmtG(room.grav);
  document.getElementById('oWind').textContent=fmtW(room.wind);
  document.getElementById('oHeat').textContent='×'+room.heat;
  document.querySelectorAll('#presets button').forEach((b,k)=>{
    const p=PRESETS[k][1];
    b.classList.toggle('on',p.temp===room.temp&&p.grav===room.grav&&p.wind===room.wind&&p.heat===room.heat);
  });
  document.getElementById('bRoom').classList.toggle('on',!document.getElementById('room').hidden);
}
(function buildPresets(){
  const box=document.getElementById('presets');
  PRESETS.forEach(([name,p])=>{
    const b=document.createElement('button');b.textContent=name;
    b.onclick=()=>{applyRoom(p,true);toast('Room: '+name);};
    box.appendChild(b);
  });
  [['rTemp','temp'],['rGrav','grav'],['rWind','wind'],['rHeat','heat']].forEach(([id,k])=>{
    document.getElementById(id).addEventListener('input',e=>applyRoom({...room,[k]:+e.target.value},true));
  });
})();
function toggleRoom(v){
  const el=document.getElementById('room');
  el.hidden=v===undefined?!el.hidden:!v;
  document.getElementById('side').classList.toggle('rm',!el.hidden);
  syncRoomUI();
}
/* phones: the room panel lives in the bottom panel; wide screens: floating over the field */
function placeRoom(){
  const rm=document.getElementById('room'),side=document.getElementById('side'),stage=document.getElementById('stage');
  if(window.innerWidth<=860){if(rm.parentNode!==side)side.insertBefore(rm,document.getElementById('tabs'));}
  else if(rm.parentNode!==stage)stage.appendChild(rm);
}
document.getElementById('bRoom').onclick=()=>{toggleRoom();if(window.innerWidth<=860)setTimeout(resize,60);};
document.getElementById('roomX').onclick=()=>{toggleRoom(false);if(window.innerWidth<=860)setTimeout(resize,60);};

/* ==================== reactions collection ==================== */
const rxKey=i=>RXDEF[i][0]+'+'+RXDEF[i][1];
let rxCount=0,revealed=new Set(),lastReveal=0;
const elName=k=>{const id=idOf(k);return id?EL[id].n:k;};
const sw=k=>{const id=idOf(k);return id?'<i style="background:'+EL[id].col[0]+'"></i>':'';};
function rxHTML(i){
  const r=RXDEF[i],prods=[...new Set([r[2],r[3]].filter(Boolean))];
  return sw(r[0])+elName(r[0])+' + '+sw(r[1])+elName(r[1])+' → '+
    (prods.length?prods.map(p=>sw(p)+elName(p)).join(' + '):'nothing');
}
function rxText(i){
  const r=RXDEF[i],prods=[...new Set([r[2],r[3]].filter(Boolean))];
  return elName(r[0])+' + '+elName(r[1])+' → '+(prods.length?prods.map(elName).join(' + '):'nothing');
}
let rxSaveT=0;
function saveRx(){
  clearTimeout(rxSaveT);
  rxSaveT=setTimeout(()=>{
    const keys=[];for(let i=0;i<RX_TOTAL;i++)if(RXSEEN[i])keys.push(rxKey(i));
    Store.setJ('rx',keys);
  },1200);
}
function onDiscover(i){
  rxCount++;
  toast('<b>New reaction '+rxCount+'/'+RX_TOTAL+'</b> · '+rxText(i),'rx');
  sfxChime();saveRx();
  GOALS.forEach(g=>{if(g.rx&&rxCount>=g.rx)completeGoal(g);});
  updateGoalChip();
  if(!document.getElementById('lab').hidden)renderLab();
}
/* first undiscovered reactions: free partial hints and the rewarded reveal */
function undiscovered(skipRevealed,n){
  const out=[];
  for(let i=0;i<RX_TOTAL&&out.length<n;i++)
    if(!RXSEEN[i]&&!(skipRevealed&&revealed.has(rxKey(i))))out.push(i);
  return out;
}

/* ==================== goals ==================== */
const GOALS=[
  {id:'draw',t:'Draw something',d:'Pick a material and drag across the field.'},
  {id:'pause',t:'Freeze time',d:'Press Pause (or Space). While paused, Step plays one frame at a time.'},
  {id:'steam',t:'Boil water',d:'Heat water past 100°C — try the Heat + tool, fire or lava.',m:'steam'},
  {id:'ice',t:'Freeze water',d:'Use the Cool − tool, a Cooler block or a freezing room.',m:'ice'},
  {id:'view',t:'See the heat',d:'Switch View to the temperature map.'},
  {id:'plant',t:'Grow a plant',d:'Drop seeds into water or onto dirt.',m:'plant'},
  {id:'rx5',t:'Curious chemist',d:'Discover 5 different reactions.',rx:5},
  {id:'room',t:'Rearrange the room',d:'Open Room and change any setting or preset.'},
  {id:'cold',t:'Deep freeze',d:'Set the room below 0°C and watch the water freeze.'},
  {id:'flip',t:'Flip gravity',d:'Drag Gravity below zero — everything falls up.'},
  {id:'boom',t:'Make it go boom',d:'Light gunpowder, TNT or methane.'},
  {id:'glass',t:'Glassblower',d:'Pour sand into lava and let the molten glass cool.',m:'glass'},
  {id:'obsidian',t:'Volcanic glass',d:'Hit lava with liquid nitrogen.',m:'obsidian'},
  {id:'lamp',t:'Let there be light',d:'Connect a battery to a lamp with wire.'},
  {id:'bread',t:'Bake bread',d:'Flour + water makes dough. Heat it above 120°C.',m:'bread'},
  {id:'save',t:'Keep your world',d:'Save the field to a slot.'},
  {id:'rx25',t:'Lab regular',d:'Discover 25 reactions.',rx:25},
  {id:'bronze',t:'Bronze age',d:'Melt copper and drop tin into it.',m:'bronze'},
  {id:'rx100',t:'Mad scientist',d:'Discover 100 reactions.',rx:100},
  {id:'rxall',t:'Complete collection',d:'Discover all '+RX_TOTAL+' reactions.',rx:RX_TOTAL}
];
const GOAL_BY_M={};GOALS.forEach(g=>{if(g.m)GOAL_BY_M[ID[g.m]]=g;});
let goalsDone=new Set();
function goalEvent(id){const g=GOALS.find(x=>x.id===id);if(g)completeGoal(g);}
function completeGoal(g){
  if(goalsDone.has(g.id)||!bootDone)return;
  goalsDone.add(g.id);Store.setJ('goals',[...goalsDone]);
  toast('<b>Goal complete</b> · '+g.t,'goal');sfxGoal();
  updateGoalChip(true);
  if(!document.getElementById('lab').hidden)renderLab();
}
function nextGoal(){return GOALS.find(g=>!goalsDone.has(g.id));}
function updateGoalChip(flash){
  const g=nextGoal(),chip=document.getElementById('goal');
  document.getElementById('goalTxt').textContent=g?g.t:'All goals complete';
  document.getElementById('goalRx').textContent=rxCount+'/'+RX_TOTAL;
  chip.title=g?g.d:'';
  if(flash){chip.classList.add('flash');setTimeout(()=>chip.classList.remove('flash'),900);}
}

/* ==================== lab window ==================== */
let labTab='goals',labTimer=0;
function openLab(tab){labTab=tab||labTab;uiPause=true;document.getElementById('lab').hidden=false;renderLab();
  clearInterval(labTimer);labTimer=setInterval(()=>{if(labTab==='rx')updateRevealBox();},1000);}
function closeLab(){uiPause=false;document.getElementById('lab').hidden=true;clearInterval(labTimer);}
function refreshLab(){if(!document.getElementById('lab').hidden)renderLab();}
function renderLab(){
  document.querySelectorAll('#lab .ltab').forEach(b=>b.classList.toggle('on',b.dataset.t===labTab));
  document.getElementById('lgCnt').textContent=goalsDone.size+'/'+GOALS.length;
  document.getElementById('lrCnt').textContent=rxCount+'/'+RX_TOTAL;
  const body=document.getElementById('labBody');
  let h='';
  if(labTab==='goals'){
    const cur=nextGoal();
    h+='<div class="prog"><i style="width:'+(goalsDone.size/GOALS.length*100)+'%"></i></div>';
    GOALS.forEach(g=>{
      const done=goalsDone.has(g.id);
      h+='<div class="gl'+(done?' done':'')+(g===cur?' cur':'')+'"><div class="ck">'+(done?'✓':'')+'</div><div><b>'+g.t+'</b><span>'+g.d+'</span></div></div>';
    });
  }else{
    h+='<div class="prog"><i style="width:'+(rxCount/RX_TOTAL*100)+'%"></i></div>';
    h+='<div class="rxsec">Discovered '+rxCount+' / '+RX_TOTAL+'</div>';
    if(rxCount<RX_TOTAL){
      h+='<div class="rxsec">Hints</div>';
      const rev=[];for(let i=0;i<RX_TOTAL;i++)if(!RXSEEN[i]&&revealed.has(rxKey(i)))rev.push(i);
      rev.forEach(i=>{const r=RXDEF[i];
        h+='<div class="rxl hint"><span class="n">#'+(i+1)+'</span><span>'+sw(r[0])+elName(r[0])+' + '+sw(r[1])+elName(r[1])+' → <span class="q">?</span></span></div>';});
      undiscovered(true,2).forEach(i=>{const r=RXDEF[i];
        h+='<div class="rxl hint"><span class="n">#'+(i+1)+'</span><span>'+sw(r[0])+elName(r[0])+' + <span class="q">?</span></span></div>';});
      h+='<div id="rwSlot"></div>';
    }
    if(rxCount){
      h+='<div class="rxsec">Collection</div>';
      for(let i=0;i<RX_TOTAL;i++)if(RXSEEN[i])h+='<div class="rxl"><span class="n">#'+(i+1)+'</span><span>'+rxHTML(i)+'</span></div>';
    }else h+='<div class="rxl hint">Mix materials on the field — every new reaction appears here.</div>';
  }
  body.innerHTML=h;
  if(labTab==='rx')updateRevealBox(true);
}
/* free recipe reveal: shows both ingredients of one undiscovered reaction, once per cooldown */
function revealState(){
  if(!undiscovered(true,1).length)return 'hidden';
  if(Date.now()-lastReveal<REVEAL_COOLDOWN)return 'cooldown';
  return 'ready';
}
let rwShown='';
function updateRevealBox(force){
  const slot=document.getElementById('rwSlot');if(!slot)return;
  const st=revealState();
  const left=Math.max(0,REVEAL_COOLDOWN-(Date.now()-lastReveal)),mm=Math.floor(left/60000),ss=String(Math.floor(left/1000)%60).padStart(2,'0');
  const key=st+(st==='cooldown'?mm+':'+ss:'');
  if(!force&&key===rwShown)return;rwShown=key;
  if(st==='hidden'){slot.innerHTML='';return;}
  slot.innerHTML='<div class="rwbox">Stuck? Reveal both ingredients of an undiscovered reaction. Or keep experimenting — the hints above show the first one.'+
    '<button class="btn pro" id="rwBtn"'+(st==='cooldown'?' disabled':'')+'>'+BULB_ICO+'<span>'+(st==='cooldown'?'Next reveal in '+mm+':'+ss:'Reveal a recipe')+'</span></button></div>';
  const b=document.getElementById('rwBtn');if(b)b.onclick=revealRecipe;
}
const BULB_ICO='<svg class="ico" viewBox="0 0 24 24"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 00-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0012 3z"/></svg>';
function revealRecipe(){
  if(revealState()!=='ready')return;
  const i=undiscovered(true,1)[0];
  if(i===undefined)return;
  lastReveal=Date.now();Store.set('reveal_t',String(lastReveal));
  revealed.add(rxKey(i));Store.setJ('reveal',[...revealed]);
  const r=RXDEF[i];toast('<b>Recipe revealed</b> · '+elName(r[0])+' + '+elName(r[1]),'rx');sfxChime();
  refreshLab();
}

/* ==================== world save / load ==================== */
/* RLE: header "w,h,cs|" then "id[xN]." tokens; temperatures are not stored */
function serialize(){
  let out=W+','+H+','+CS+'|',run=1,prev=type[0];
  const enc=(t,n)=>(n>1?t.toString(36)+'x'+n.toString(36):t.toString(36))+'.';
  for(let i=1;i<N;i++){
    const t=type[i];
    if(t===prev&&run<60000)run++; else {out+=enc(prev,run);prev=t;run=1;}
  }
  return out+enc(prev,run);
}
function loadWorld(str){
  const cut=str.indexOf('|');if(cut<0)return false;
  const h=str.slice(0,cut).split(',').map(Number),sw2=h[0],sh=h[1];
  if(!sw2||!sh)return false;
  const src=new Int16Array(sw2*sh);let p=0;
  for(const tok of str.slice(cut+1).split('.')){
    if(!tok)continue;
    const xi=tok.indexOf('x');
    let id,n;
    if(xi<0){id=parseInt(tok,36);n=1;} else {id=parseInt(tok.slice(0,xi),36);n=parseInt(tok.slice(xi+1),36);}
    if(!(id>=0)||!(n>0))continue;
    if(id>=EL.length)id=0;
    for(let k=0;k<n&&p<src.length;k++)src[p++]=id;
  }
  for(let ny=0;ny<H;ny++){                       // scale the saved world into the current grid
    let sy=(ny*sh/H)|0; if(sy>=sh)sy=sh-1;
    for(let nx=0;nx<W;nx++){
      let sx=(nx*sw2/W)|0; if(sx>=sw2)sx=sw2-1;
      setPx(ny*W+nx,src[sy*sw2+sx]);
    }
  }
  elecStore.fill(0);chg.fill(0);undoStack=[];
  return true;
}
const SLOTS=['auto','1','2','3'];
const slotKey=n=>'world_'+n;
const readSlot=n=>Store.getJ(slotKey(n),null);
function saveSlot(n,quiet){
  Store.setJ(slotKey(n),{t:Date.now(),d:serialize(),room});
  if(quiet)return;
  toast('World saved');buildSlots();goalEvent('save');
}
function restoreSlot(n){
  const v=readSlot(n);
  if(!v||!v.d)return false;
  if(v.room){applyRoom(v.room,false);Store.setJ('room',room);}
  return loadWorld(v.d);
}
function loadSlot(n){
  if(!restoreSlot(n))return;
  toast('World loaded');closeModal();
}
function delSlot(n){Store.del(slotKey(n));buildSlots();}
function buildSlots(){
  const box=document.getElementById('slots');if(!box)return;
  box.innerHTML='';
  SLOTS.forEach(n=>{
    const v=readSlot(n),row=document.createElement('div');row.className='slot';
    const narrow=window.innerWidth<=860;
    const title=n==='auto'?(narrow?'Auto':'Autosave'):(narrow?n:'Slot '+n);
    const when=v?new Date(v.t).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'empty';
    row.innerHTML='<div class="nm">'+title+'<i>'+when+'</i></div>';
    const mk=(label,fn,dis)=>{const b=document.createElement('button');b.textContent=label;if(dis)b.disabled=true;b.onclick=fn;row.appendChild(b);};
    if(n!=='auto')mk('Save',()=>saveSlot(n));
    mk('Load',()=>loadSlot(n),!v);
    mk('Delete',()=>delSlot(n),!v);
    box.appendChild(row);
  });
}
function openModal(){uiPause=true;buildSlots();document.getElementById('modal').hidden=false;}
function closeModal(){uiPause=false;document.getElementById('modal').hidden=true;}
function autosave(){if(started)saveSlot('auto',true);}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')autosave();});
addEventListener('pagehide',autosave);

function loadProgress(){
  applyRoom(Store.getJ('room',ROOM_DEF),false);
  const keys=Store.getJ('rx',[]),map=new Map();
  for(let i=0;i<RX_TOTAL;i++)map.set(rxKey(i),i);
  if(Array.isArray(keys))keys.forEach(k=>{const i=map.get(k);if(i!==undefined&&!RXSEEN[i]){RXSEEN[i]=1;rxCount++;}});
  const g=Store.getJ('goals',[]);if(Array.isArray(g))goalsDone=new Set(g.filter(id=>GOALS.some(x=>x.id===id)));
  const rv=Store.getJ('reveal',[]);if(Array.isArray(rv))revealed=new Set(rv);
  userMute=Store.get('mute')==='1';
  lastReveal=+Store.get('reveal_t')||0;
}

/* ==================== start scene ==================== */
function scene(){
  const gy=Math.floor(H*.72);
  for(let x=0;x<W;x++){
    const hh=gy+Math.round(Math.sin(x*.08)*2+Math.sin(x*.021)*3);
    for(let y=hh;y<H;y++){
      const i=y*W+x;
      setPx(i,y<hh+3?ID.dirt:(y>H-4?ID.stone:(chance(.25)?ID.gravel:ID.dirt)));
    }
    if(x>W*.32&&x<W*.62)for(let y=hh-6;y<hh;y++)setPx(y*W+x,y<hh-6?EMPTY:ID.water);
    if(chance(.05)){const i=(gy-1)*W+x;if(!type[i])setPx(i,ID.plant);}
  }
  for(let x=Math.floor(W*.32);x<Math.floor(W*.62);x++)
    for(let y=gy-7;y<gy;y++){const i=y*W+x;if(!type[i])setPx(i,ID.water);}
  for(let x=Math.floor(W*.06);x<Math.floor(W*.2);x++)
    for(let y=gy-14;y<gy-11;y++)setPx(y*W+x,ID.sand);
}

/* ==================== main loop ==================== */
const SPEEDS=[0.25,0.5,1,2,4];
let speedIdx=2,acc=0,last=performance.now(),fpsT=0,fpsN=0;
function fmtSpeed(v){return '×'+(v<1?v.toString().replace('0.','.'):v);}
function setSpeed(i){
  speedIdx=(i+SPEEDS.length)%SPEEDS.length;
  const v=SPEEDS[speedIdx];
  document.getElementById('spdLb').textContent=fmtSpeed(v);
  document.getElementById('bSpeed').classList.toggle('on',v!==1);
  setTimeout(headScroll,0);
}
function stepOnce(){if(!uiPause){step();processEvents();draw();}}
function processEvents(){
  if(painted){painted=false;goalEvent('draw');}
  if(EV.length){
    for(const ev of EV){
      if(ev[0]==='r')onDiscover(ev[1]);
      else if(ev[0]==='m'){const g=GOAL_BY_M[ev[1]];if(g)completeGoal(g);}
      else if(ev[0]==='boom')goalEvent('boom');
    }
    EV.length=0;
  }
  if(lampLit){lampLit=false;goalEvent('lamp');}
  if(pendingBoom){sfxBoom(pendingBoom);pendingBoom=0;}
}
function loop(now){
  const dt=now-last;last=now;
  if(!paused&&!uiPause&&!rotPause){
    const sp=SPEEDS[speedIdx];
    acc+=dt*sp;
    let steps=0,cap=sp>2?8:(sp>1?5:3);
    const t0=performance.now();
    while(acc>=16.6&&steps<cap){
      step();acc-=16.6;steps++;
      if(performance.now()-t0>11)break;          // never let a frame hang
    }
    if(acc>100)acc=0;
  }
  processEvents();
  draw();
  fpsN++;
  if(now-fpsT>500){
    const f=Math.round(fpsN*1000/(now-fpsT));
    document.getElementById('fps').textContent=f+' fps';
    if(!paused&&f<28){if(++slowN>=2&&csBias<4){csBias++;slowN=0;resize();}}else slowN=0;
    fpsT=now;fpsN=0;
  }
  requestAnimationFrame(loop);
}
/* height comes from the visual viewport: address bar, keyboard and fullscreen changes don't cut the UI */
function setVH(){
  const vv=window.visualViewport;
  const h=(vv&&vv.height)?vv.height:window.innerHeight;
  document.documentElement.style.setProperty('--vh',h+'px');
  const q=document.getElementById('quick');
  if(q)document.documentElement.style.setProperty('--qh',q.offsetHeight+'px');
}
/* probe: overlay on wide screens, a row in the bottom panel on phones */
function placeProbe(){
  const pr=document.getElementById('probe'),side=document.getElementById('side'),
        stage=document.getElementById('stage'),tabs=document.getElementById('tabs');
  if(!pr||!side||!stage)return;
  if(window.innerWidth<=860){
    if(pr.parentNode!==side)side.insertBefore(pr,tabs);
  }else if(pr.parentNode!==stage){
    stage.insertBefore(pr,document.getElementById('cv').nextSibling);
  }
}
/* phones are portrait-only: this overlay pauses the game while a phone is held sideways */
/* a phone, not just a small window: touch-only + small screen */
function isPhone(){
  const coarse=matchMedia('(pointer:coarse)').matches&&!matchMedia('(hover:hover)').matches;
  return coarse&&Math.min(screen.width,screen.height)<620;
}
function checkOrientation(){
  const iw=window.innerWidth,ih=window.innerHeight;
  const need=isPhone()&&iw>ih;
  const el=document.getElementById('rotate');if(!el)return;
  el.hidden=!need;rotPause=need;
  if(need)down=false;
}
function headScroll(){
  const h=document.querySelector('header');
  if(h)h.classList.toggle('scroll',h.scrollWidth>h.clientWidth+2);
}
function relayout(d){clearTimeout(rzT);rzT=setTimeout(()=>{setVH();resize();headScroll();placeProbe();placeRoom();checkOrientation();},d||160);}
addEventListener('resize',()=>{setVH();relayout(160);});
addEventListener('orientationchange',()=>{setVH();relayout(340);});
document.addEventListener('fullscreenchange',()=>{setVH();relayout(220);});
document.addEventListener('webkitfullscreenchange',()=>{setVH();relayout(220);});
if(window.visualViewport){
  visualViewport.addEventListener('resize',()=>{setVH();relayout(160);});
  visualViewport.addEventListener('scroll',setVH);
}
/* no text selection, context menu, page scroll or pinch-zoom of the page */
const scrollable='#grid,#slots,.tabs,#modal .win,#intro .body,#confirm .win,#lab .lbody,#room,header';
document.addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('selectstart',e=>{if(!/^(INPUT|TEXTAREA)$/.test(e.target.tagName))e.preventDefault();});
document.addEventListener('dragstart',e=>e.preventDefault());
document.addEventListener('gesturestart',e=>e.preventDefault());
document.addEventListener('touchmove',e=>{
  if(e.target&&e.target.closest&&e.target.closest(scrollable))return;
  if(e.cancelable)e.preventDefault();
},{passive:false});
document.addEventListener('dblclick',e=>e.preventDefault());
addEventListener('keydown',e=>{
  const code=e.code||'';
  if(code==='Space'||code.startsWith('Arrow')){if(e.target.tagName!=='INPUT'||e.target.type==='range')e.preventDefault();}
  if(e.target.tagName==='INPUT'&&e.target.type!=='range')return;
  const k=e.key.toLowerCase(),anyModal=uiPause;
  if(e.key==='Escape'){
    if(!document.getElementById('modal').hidden)closeModal();
    else if(!document.getElementById('confirm').hidden)closeConfirm();
    else if(!document.getElementById('intro').hidden)closeIntro();
    else if(!document.getElementById('lab').hidden)closeLab();
    else if(!document.getElementById('room').hidden)toggleRoom(false);
    return;
  }
  if(anyModal)return;
  if(e.code==='Space')setPaused(!paused);
  if((e.ctrlKey||e.metaKey)&&k==='z'){e.preventDefault();undo();return;}
  if(k==='v')setView(viewMode+1);
  if(k==='r')toggleRoom();
  if(k==='g')openLab('goals');
  if(k==='m')document.getElementById('bSound').click();
  if(e.key==='='||e.key==='+')zoomCenter(1.4);
  if(e.key==='-'||e.key==='_')zoomCenter(1/1.4);
  if(e.key==='0'){zoom=1;camX=camY=0;applyCam();}
  if(e.key===','||e.key==='<')setSpeed(speedIdx-1);
  if(e.key==='.'||e.key==='>'){if(paused)stepOnce();else setSpeed(speedIdx+1);}
  if(e.key==='['){document.getElementById('brush').value=bsize=Math.max(1,bsize-1);document.getElementById('bsz').textContent=bsize;}
  if(e.key===']'){document.getElementById('brush').value=bsize=Math.min(24,bsize+1);document.getElementById('bsz').textContent=bsize;}
});

addEventListener('keyup',e=>{if(e.code==='Space'&&e.target.tagName==='BUTTON')e.preventDefault();});

/* ==================== boot ==================== */
(function boot(){
  setVH();resize();
  bootDone=true;
  const bootEl=document.getElementById('boot');
  loadProgress();
  if(!restoreSlot('auto'))scene();
  buildTabs();buildGrid();updateCur();setView(0);applyCam();setSpeed(speedIdx);
  headScroll();placeProbe();placeRoom();checkOrientation();updateGoalChip();renderSound();syncRoomUI();
  if(bootEl)bootEl.remove();
  started=true;
  /* straight into play (no blocking popup): first launch gets a one-line hint, Help has the full guide */
  if(Store.get('intro')!=='1'){Store.set('intro','1');setTimeout(()=>toast('<b>Pick a material</b> · then drag on the field to draw','goal'),400);}
  setInterval(()=>{if(!paused&&!uiPause&&document.visibilityState==='visible')autosave();},90000);
  last=performance.now();
  requestAnimationFrame(loop);
})();
