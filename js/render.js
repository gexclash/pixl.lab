"use strict";
/* ==================== render ==================== */
const cv=document.getElementById('cv'),ctx=cv.getContext('2d',{alpha:false});
let img=null,px=null,csBias=0,slowN=0,prevCS=0,rzT=0;
/* the canvas is exactly W×CS by H×CS pixels, centred in the stage: cells stay square */
let fieldX=0,fieldY=0,fieldW=0,fieldH=0;
function layoutCanvas(rw,rh){
  fieldW=W*CS;fieldH=H*CS;
  fieldX=Math.floor((rw-fieldW)/2);fieldY=Math.floor((rh-fieldH)/2);
  cv.style.width=fieldW+'px';cv.style.height=fieldH+'px';
  cv.style.left=fieldX+'px';cv.style.top=fieldY+'px';
}
function resize(){
  const st=document.getElementById('stage'),rw=st.clientWidth,rh=st.clientHeight;
  if(rw<10||rh<10)return;
  /* cell size follows the short side of the screen and caps the cell count */
  const iw=window.innerWidth,ih=window.innerHeight;
  const phone=iw<620||ih<520;
  const div=phone?95:(iw<1000?125:150);
  CS=Math.max(3,Math.round(Math.min(rw,rh*1.4)/div)+csBias);
  const w=Math.max(40,Math.floor(rw/CS)),h=Math.max(40,Math.floor(rh/CS));
  if(w===W&&h===H&&CS===prevCS){layoutCanvas(rw,rh);return;}
  alloc(w,h,prevCS||CS,CS);
  prevCS=CS;
  cv.width=W;cv.height=H;
  layoutCanvas(rw,rh);applyCam();
  img=ctx.createImageData(W,H);px=img.data;
  for(let i=3;i<px.length;i+=4)px[i]=255;
  ctx.imageSmoothingEnabled=false;
}
/* heat-map palette: -200 .. 2000 °C */
const HEAT=new Uint8Array(256*3);
(function(){
  const st=[[0,30,60,180],[.14,60,180,220],[.3,60,200,120],[.5,240,220,60],[.72,230,90,30],[1,255,250,235]];
  for(let i=0;i<256;i++){
    const p=i/255;let a=st[0],b=st[st.length-1];
    for(let k=0;k<st.length-1;k++)if(p>=st[k][0]&&p<=st[k+1][0]){a=st[k];b=st[k+1];break;}
    const f=(p-a[0])/((b[0]-a[0])||1);
    HEAT[i*3]=a[1]+(b[1]-a[1])*f;HEAT[i*3+1]=a[2]+(b[2]-a[2])*f;HEAT[i*3+2]=a[3]+(b[3]-a[3])*f;
  }
})();
let viewMode=0;   // 0 materials, 1 temperature, 2 flammability
function draw(){
  if(viewMode===1){
    for(let i=0,o=0;i<N;i++,o+=4){
      if(!type[i]){px[o]=8;px[o+1]=10;px[o+2]=14;continue;}
      let k=((temp[i]+200)/2200*255)|0; if(k<0)k=0; else if(k>255)k=255;
      const c=k*3;px[o]=HEAT[c];px[o+1]=HEAT[c+1];px[o+2]=HEAT[c+2];
    }
  } else if(viewMode===2){
    for(let i=0,o=0;i<N;i++,o+=4){
      const t=type[i];
      if(!t){px[o]=8;px[o+1]=10;px[o+2]=14;continue;}
      if(burn[i]){px[o]=255;px[o+1]=245;px[o+2]=210;continue;}
      const e=EL[t];
      if(e.exp||e.wexp){px[o]=232;px[o+1]=60;px[o+2]=170;continue;}
      if(e.fl){const f=e.fl;px[o]=170+80*f;px[o+1]=170-110*f;px[o+2]=50;continue;}
      const gy=(cr[i]*.3+cg[i]*.59+cb[i]*.11)*.5+18;
      px[o]=gy;px[o+1]=gy;px[o+2]=gy;
    }
  } else {
    for(let i=0,o=0;i<N;i++,o+=4){
      const t=type[i];
      if(!t){px[o]=8;px[o+1]=10;px[o+2]=14;continue;}
      let r=cr[i],g=cg[i],b=cb[i];
      if(burn[i]){const f=.55;r=r*(1-f)+255*f;g=g*(1-f)+140*f;b=b*(1-f)+30*f;}
      else{
        const tp=temp[i];
        if(tp>260){const k=Math.min(.75,(tp-260)/1400);r=r*(1-k)+255*k;g=g*(1-k)+110*k;b=b*(1-k)+20*k;}
        else if(tp<-15){const k=Math.min(.5,(-tp-15)/220);r=r*(1-k)+120*k;g=g*(1-k)+200*k;b=b*(1-k)+255*k;}
      }
      const al=ALPHA[t];
      if(al<1){r=r*al+8*(1-al);g=g*al+10*(1-al);b=b*al+14*(1-al);}
      px[o]=r;px[o+1]=g;px[o+2]=b;
    }
  }
  if(showCur&&ptX>=0&&ptY>=0&&ptX<W&&ptY<H){
    const r=bsize,st=Math.max(14,Math.min(96,r*10));
    for(let a=0;a<st;a++){
      const an=a/st*6.28319;
      const x=ptX+Math.round(Math.cos(an)*r),y=ptY+Math.round(Math.sin(an)*r);
      if(x<0||y<0||x>=W||y>=H)continue;
      const o=(y*W+x)*4;
      px[o]=px[o]*.3+255*.7;px[o+1]=px[o+1]*.3+235*.7;px[o+2]=px[o+2]*.3+190*.7;
    }
  }
  ctx.putImageData(img,0,0);
}
function setView(v){
  viewMode=(v+3)%3;
  const tag=document.getElementById('vtag'),lb=document.getElementById('viewLb');
  lb.textContent=['Materials','Temperature','Flammability'][viewMode];
  document.getElementById('bView').classList.toggle('on',viewMode>0);
  if(!viewMode){tag.hidden=true;return;}
  tag.hidden=false;
  document.getElementById('vtagName').textContent=viewMode===1?'Temperature':'Flammability';
  if(viewMode===1)goalEvent('view');
  const sc=document.getElementById('vtagScale');sc.innerHTML='';
  for(let k=0;k<12;k++){
    const i=Math.round(k/11*255)*3,el=document.createElement('i');
    el.style.background=viewMode===1?'rgb('+HEAT[i]+','+HEAT[i+1]+','+HEAT[i+2]+')'
      :'rgb('+(170+80*k/11)+','+(170-110*k/11)+',50)';
    sc.appendChild(el);
  }
  document.getElementById('vtagRange').textContent=viewMode===1?'−200…2000°C':'inert → burns';
}

/* ==================== input ==================== */
let sel=ID.sand,tool=null,bsize=5,down=false,lastX=-1,lastY=-1,ptX=-1,ptY=-1,showCur=false;
/* ---- camera: zoom and pan ---- */
let zoom=1,camX=0,camY=0;
const ZMAX=10;
function clampCam(){
  if(zoom<1)zoom=1; if(zoom>ZMAX)zoom=ZMAX;
  const vw=W/zoom,vh=H/zoom;
  if(camX>W-vw)camX=W-vw; if(camX<0)camX=0;
  if(camY>H-vh)camY=H-vh; if(camY<0)camY=0;
}
function applyCam(){
  clampCam();
  cv.style.transformOrigin='0 0';
  cv.style.transform='scale('+zoom+') translate('+(-camX/W*100)+'%,'+(-camY/H*100)+'%)';
  const txt='×'+(zoom<10?Math.round(zoom*10)/10:10);
  setTimeout(headScroll,0);
  document.querySelectorAll('.zlvl').forEach(l=>{
    l.textContent=txt;
    if(l.hasAttribute('hidden')||l.tagName==='BUTTON')l.hidden=(zoom===1);
  });
}
function stageRect(){return document.getElementById('stage').getBoundingClientRect();}
function screenToWorld(cx,cy){
  const r=stageRect();
  const x=(cx-r.left-fieldX)/(fieldW||1)*(W/zoom);
  const y=(cy-r.top-fieldY)/(fieldH||1)*(H/zoom);
  return [camX+x, camY+y];
}
function zoomAt(cx,cy,factor){
  const [wx,wy]=screenToWorld(cx,cy);
  const r=stageRect();
  zoom=Math.max(1,Math.min(ZMAX,zoom*factor));
  camX=wx-(cx-r.left-fieldX)/(fieldW||1)*(W/zoom);
  camY=wy-(cy-r.top-fieldY)/(fieldH||1)*(H/zoom);
  applyCam();
}
function zoomCenter(factor){const r=stageRect();zoomAt(r.left+r.width/2,r.top+r.height/2,factor);}
function toCell(ev){
  const p=screenToWorld(ev.clientX,ev.clientY);
  return [Math.floor(p[0]),Math.floor(p[1])];
}
function paint(x,y){
  const rad=bsize,r2=rad*rad;
  for(let dy=-rad;dy<=rad;dy++)for(let dx=-rad;dx<=rad;dx++){
    if(dx*dx+dy*dy>r2)continue;
    const nx=x+dx,ny=y+dy; if(nx<0||ny<0||nx>=W||ny>=H)continue;
    const i=ny*W+nx,cur=type[i];
    recCell(i);
    if(tool==='eraser'){setPx(i,EMPTY);continue;}
    if(tool==='heat'){if(cur)temp[i]+=28;continue;}
    if(tool==='cool'){if(cur)temp[i]-=28;continue;}
    if(tool==='pick'||tool==='mix'||tool==='shake')return;
    if(cur&&!replaceMode)continue;
    if(cur&&EL[cur]&&EL[cur].imm&&!replaceMode)continue;
    const e=EL[sel];
    if((e.mv==='p'||e.mv==='b'||e.mv==='f')&&rad>1&&chance(.35))continue;
    if(e.mv==='g'&&rad>1&&chance(.4))continue;
    setPx(i,sel);painted=true;
    if(sel===ID.electricity)dat[i]=9;
  }
}
/* ---- undo last stroke ---- */
const UNDO_MAX=12;
let undoStack=[],rec=null;
function recStart(){rec={i:[],t:[],tp:[],r:[],g:[],b:[],d:[],bn:[],seen:new Set()};}
function recCell(i){
  if(!rec||rec.seen.has(i))return;
  rec.seen.add(i);
  rec.i.push(i);rec.t.push(type[i]);rec.tp.push(temp[i]);
  rec.r.push(cr[i]);rec.g.push(cg[i]);rec.b.push(cb[i]);rec.d.push(dat[i]);rec.bn.push(burn[i]);
}
function recEnd(){
  if(rec&&rec.i.length){undoStack.push(rec);if(undoStack.length>UNDO_MAX)undoStack.shift();}
  rec=null;
}
function undo(){
  const r=undoStack.pop();
  if(!r){toast('Nothing to undo');return;}
  for(let k=0;k<r.i.length;k++){
    const i=r.i[k];
    type[i]=r.t[k];temp[i]=r.tp[k];cr[i]=r.r[k];cg[i]=r.g[k];cb[i]=r.b[k];dat[i]=r.d[k];burn[i]=r.bn[k];
  }
  toast('Stroke undone');goalEvent('undo');
}
function pickAt(x,y){
  if(x<0||y<0||x>=W||y>=H)return;
  const c=type[y*W+x]; if(!c)return;
  selectEl(c);buildGrid();toast(EL[c].n);
}
function areaCells(x,y){
  const rad=bsize,r2=rad*rad,list=[];
  for(let dy=-rad;dy<=rad;dy++)for(let dx=-rad;dx<=rad;dx++){
    if(dx*dx+dy*dy>r2)continue;
    const nx=x+dx,ny=y+dy; if(nx<0||ny<0||nx>=W||ny>=H)continue;
    const i=ny*W+nx,t=type[i]; if(t&&EL[t].imm)continue;
    list.push(i);
  }
  return list;
}
function mixArea(x,y){
  const l=areaCells(x,y);l.forEach(recCell);
  for(let k=l.length-1;k>0;k--){const j=rnd(k+1);if(chance(.6))swap(l[k],l[j]);}
}
function shakeArea(x,y){
  const l=areaCells(x,y);l.forEach(recCell);
  for(const i of l){
    if(!type[i])continue;
    const d=NB[rnd(4)],nx=(i%W)+d[0],ny=((i/W)|0)+d[1];
    if(nx<0||ny<0||nx>=W||ny>=H)continue;
    const j=ny*W+nx; if(type[j]&&EL[type[j]].imm)continue;
    if(chance(.5))swap(i,j);
  }
}
function line(x0,y0,x1,y1){
  const dx=Math.abs(x1-x0),dy=Math.abs(y1-y0),sx=x0<x1?1:-1,sy=y0<y1?1:-1;
  let err=dx-dy;
  for(;;){paint(x0,y0);if(x0===x1&&y0===y1)break;const e2=2*err;
    if(e2>-dy){err-=dy;x0+=sx}if(e2<dx){err+=dx;y0+=sy}}
}
/* two fingers: zoom + pan; middle/right mouse button or Shift: pan */
const ptrs=new Map();
let pinch=null,panning=null;
function startPinch(){
  const a=[...ptrs.values()];
  if(a.length<2)return;
  recEnd();down=false;showCur=false;
  const cx=(a[0].x+a[1].x)/2,cy=(a[0].y+a[1].y)/2;
  pinch={d:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y),z:zoom,w:screenToWorld(cx,cy)};
}
function movePinch(){
  const a=[...ptrs.values()];
  if(a.length<2||!pinch)return;
  const cx=(a[0].x+a[1].x)/2,cy=(a[0].y+a[1].y)/2;
  const d=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);
  zoom=Math.max(1,Math.min(ZMAX,pinch.z*(d/(pinch.d||1))));
  const r=stageRect();
  camX=pinch.w[0]-(cx-r.left-fieldX)/(fieldW||1)*(W/zoom);
  camY=pinch.w[1]-(cy-r.top-fieldY)/(fieldH||1)*(H/zoom);
  applyCam();
}
function applyTool(c,r){
  if(tool==='pick'){pickAt(c,r);return true;}
  if(tool==='mix'){mixArea(c,r);return true;}
  if(tool==='shake'){shakeArea(c,r);return true;}
  return false;
}
cv.addEventListener('pointerdown',e=>{
  if(uiPause||rotPause){e.preventDefault();return;}
  try{cv.setPointerCapture(e.pointerId);}catch(_){}
  ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(ptrs.size>=2){startPinch();e.preventDefault();return;}
  if(e.button===1||e.button===2||e.shiftKey){
    panning={x:e.clientX,y:e.clientY,cx:camX,cy:camY};
    e.preventDefault();return;
  }
  down=true;recStart();
  const[c,r]=toCell(e);
  lastX=c;lastY=r;ptX=c;ptY=r;showCur=true;
  if(!applyTool(c,r)){paint(c,r);strokeFx();}
  e.preventDefault();
});
cv.addEventListener('pointermove',e=>{
  if(uiPause||rotPause){e.preventDefault();return;}
  if(ptrs.has(e.pointerId))ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(ptrs.size>=2){movePinch();e.preventDefault();return;}
  if(panning){
    const r=stageRect();
    camX=panning.cx-(e.clientX-panning.x)/(fieldW||1)*(W/zoom);
    camY=panning.cy-(e.clientY-panning.y)/(fieldH||1)*(H/zoom);
    applyCam();e.preventDefault();return;
  }
  const[c,r]=toCell(e);ptX=c;ptY=r;probe(c,r);
  showCur=true;
  if(down){if(applyTool(c,r)){lastX=c;lastY=r;}else{line(lastX,lastY,c,r);lastX=c;lastY=r;strokeFx();}}
  e.preventDefault();
});
function endPointer(e){
  if(e&&e.pointerId!==undefined)ptrs.delete(e.pointerId);
  if(ptrs.size<2)pinch=null;
  panning=null;
  if(down)recEnd();
  down=false;
  if(e&&e.pointerType&&e.pointerType!=='mouse')setTimeout(()=>{if(!down)showCur=false;},500);
}
addEventListener('pointerup',endPointer);
addEventListener('pointercancel',endPointer);
cv.addEventListener('pointerleave',()=>{if(!down)showCur=false;});
cv.addEventListener('contextmenu',e=>e.preventDefault());
cv.addEventListener('wheel',e=>{
  if(uiPause)return;
  e.preventDefault();
  zoomAt(e.clientX,e.clientY,e.deltaY<0?1.18:1/1.18);
},{passive:false});
document.querySelectorAll('.zin').forEach(b=>b.onclick=()=>zoomCenter(1.4));
document.querySelectorAll('.zout').forEach(b=>b.onclick=()=>zoomCenter(1/1.4));
document.querySelectorAll('.zrst').forEach(b=>b.onclick=()=>{zoom=1;camX=camY=0;applyCam();});

const pName=document.getElementById('pName'),pInfo=document.getElementById('pInfo'),pSw=document.querySelector('#probe .sw');
function probe(x,y){
  if(x<0||y<0||x>=W||y>=H)return;
  const i=y*W+x,tp=type[i];
  if(!tp){pName.textContent='Empty';pInfo.textContent='room '+Math.round(AMB)+'°C';pSw.style.background='#2b3543';return;}
  const e=EL[tp],tm=temp[i];
  pName.textContent=e.n;
  const c=tm>150?'var(--hot)':tm<0?'var(--cold)':'var(--ink)';
  pInfo.innerHTML='<span class="t" style="color:'+c+'">'+Math.round(tm)+'°C</span> · density '+(e.den>=9e8?'∞':e.den)+(burn[i]?' · 🔥':'');
  pSw.style.background=e.col[0];
}


