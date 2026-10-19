"use strict";
/* ==================== engine ==================== */
/* ---- room settings (Room panel) ---- */
let AMB=22;                  // room temperature, °C
let GDIR=1,GMAG=1;           // gravity: direction (+1 down, -1 up, 0 none) and strength
let WIND=0;                  // horizontal wind, -3..3
let HX=1;                    // heat transfer multiplier
let R_EDGE=.01,R_EMPTY=.02,R_GAS=.012,K_MUL=.35;
function setPhysics(){
  R_EDGE=Math.min(.5,.01*HX);R_EMPTY=Math.min(.5,.02*HX);R_GAS=Math.min(.5,.012*HX);K_MUL=.35*HX;
}
/* ---- events the UI picks up after each step: discoveries, goals, sounds ---- */
const MADE=new Uint8Array(EL.length);     // materials produced naturally this session
const RXSEEN=new Uint8Array(RX_TOTAL);    // reactions discovered (filled from save)
const EV=[];
let pendingBoom=0,boomSeen=false,lampLit=false;
function noteMade(id){if(id&&!MADE[id]){MADE[id]=1;EV.push(['m',id]);}}

let W=0,H=0,N=0,CS=4;
let type,temp,cr,cg,cb,dat,burn,chg,upd,elecStore=new Int16Array(1);
let frame=0,paused=false,replaceMode=false;

const PAL=[];               // parsed rgb palettes per element id
for(let i=1;i<EL.length;i++){
  PAL[i]=EL[i].col.map(h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)]);
  const e=EL[i];
  if(e.cond==null)e.cond=e.mv==='g'?.35:.4;
  if(e.den==null)e.den=1000;
}
const ALPHA=new Float32Array(EL.length);
for(let i=1;i<EL.length;i++)ALPHA[i]=EL[i].alpha!==undefined?EL[i].alpha:1;
const rnd=n=>(Math.random()*n)|0;
const chance=p=>Math.random()<p;

function alloc(w,h,oldCS,newCS){
  const old={W,H,type,temp,cr,cg,cb,dat,burn,es:elecStore};
  W=w;H=h;N=w*h;
  type=new Int16Array(N);temp=new Float32Array(N).fill(AMB);
  cr=new Uint8Array(N);cg=new Uint8Array(N);cb=new Uint8Array(N);
  dat=new Int16Array(N);burn=new Uint8Array(N);chg=new Int32Array(N);upd=new Uint8Array(N);
  const es=new Int16Array(N);
  if(old.type&&old.W){
    /* resample the whole world into the new grid: no clipped edges, no smeared columns */
    for(let ny=0;ny<H;ny++){
      let sy=(ny*old.H/H)|0; if(sy>=old.H)sy=old.H-1;
      for(let nx=0;nx<W;nx++){
        let sx=(nx*old.W/W)|0; if(sx>=old.W)sx=old.W-1;
        const a=sy*old.W+sx,b=ny*W+nx;
        type[b]=old.type[a];temp[b]=old.temp[a];cr[b]=old.cr[a];cg[b]=old.cg[a];cb[b]=old.cb[a];
        dat[b]=old.dat[a];burn[b]=old.burn[a];
        if(old.es)es[b]=old.es[a];
      }
    }
  }
  elecStore=es;
}
function setPx(i,id,tp){
  type[i]=id;burn[i]=0;dat[i]=0;chg[i]=0;
  if(!id){temp[i]=AMB;return;}
  const e=EL[id],p=PAL[id][rnd(PAL[id].length)],v=(rnd(13)-6);
  cr[i]=Math.max(0,Math.min(255,p[0]+v));cg[i]=Math.max(0,Math.min(255,p[1]+v));cb[i]=Math.max(0,Math.min(255,p[2]+v));
  temp[i]=tp!==undefined?tp:(e.hot!==undefined?e.hot:AMB);
  if(e.life)dat[i]=e.life;
}
function swap(a,b){
  let s=type[a];type[a]=type[b];type[b]=s;
  let f=temp[a];temp[a]=temp[b];temp[b]=f;
  s=cr[a];cr[a]=cr[b];cr[b]=s; s=cg[a];cg[a]=cg[b];cg[b]=s; s=cb[a];cb[a]=cb[b];cb[b]=s;
  s=dat[a];dat[a]=dat[b];dat[b]=s; s=burn[a];burn[a]=burn[b];burn[b]=s;
  s=chg[a];chg[a]=chg[b];chg[b]=s;
  upd[a]=1;upd[b]=1;
}
const movable=t=>{if(!t)return true;const e=EL[t];return !(e.imm||e.mv==='s'||e.mv==='w');};
function canSink(t,o){ if(!o)return true; const e=EL[o]; if(e.imm||e.mv==='s'||e.mv==='w')return false; return EL[t].den>e.den+1; }
function canSinkP(t,o){ if(!o)return true; const e=EL[o]; if(e.mv!=='l'&&e.mv!=='g')return false; return EL[t].den>e.den+1; }
function canRise(t,o){ if(!o)return true; const e=EL[o]; if(e.imm||e.mv==='s'||e.mv==='w')return false; return EL[t].den<e.den-1; }

/* ---------- heat, phase, reactions ---------- */
const NB=[[0,-1],[0,1],[-1,0],[1,0]];
function thermal(i,x,y,t){
  const e=EL[t];
  if(e.ins)return;
  const d=NB[rnd(4)],nx=x+d[0],ny=y+d[1];
  if(nx<0||ny<0||nx>=W||ny>=H){temp[i]+=(AMB-temp[i])*R_EDGE;return;}
  const j=ny*W+nx,o=type[j];
  if(!o){temp[i]+=(AMB-temp[i])*R_EMPTY*e.cond;return;}
  if(e.mv==='g'&&t!==ID.fire)temp[i]+=(AMB-temp[i])*R_GAS;
  const eo=EL[o]; if(eo.ins)return;
  const k=Math.min(.5,Math.min(e.cond,eo.cond)*K_MUL),df=(temp[j]-temp[i])*k;
  temp[i]+=df;temp[j]-=df;
}
function phase(i,t){
  const e=EL[t];
  if(e.tH!==undefined&&temp[i]>=e.tH){const tt=temp[i],n=idOf(e.sH);setPx(i,n,tt);noteMade(n);return true;}
  if(e.tL!==undefined&&temp[i]<=e.tL){const n=idOf(e.sL);const tt=temp[i];setPx(i,n,tt);noteMade(n);return true;}
  return false;
}
function react(i,x,y,t){
  const d=NB[rnd(4)],nx=x+d[0],ny=y+d[1];
  if(nx<0||ny<0||nx>=W||ny>=H)return false;
  const j=ny*W+nx,o=type[j]; if(!o)return false;
  const r=RX.get(t*512+o);
  if(r&&chance(r[2])){
    const tt=(temp[i]+temp[j])/2;setPx(i,r[0],tt);setPx(j,r[1],tt);upd[j]=1;
    if(!RXSEEN[r[3]]){RXSEEN[r[3]]=1;EV.push(['r',r[3]]);}
    noteMade(r[0]);noteMade(r[1]);
    return true;
  }
  return false;
}

/* ---------- fire & explosions ---------- */
let _pOut=[],_pFrame=-99;
function portalOuts(){
  if(frame-_pFrame<40)return _pOut;
  _pFrame=frame;_pOut=[];
  for(let i=0;i<N;i++)if(type[i]===ID.portal_out)_pOut.push(i);
  return _pOut;
}
function ignite(i,t){if(!t)return;const e=EL[t];if(!e||!e.fl||burn[i])return;burn[i]=Math.min(255,e.bt||30);}
function explode(cx,cy,r,heatT){
  const r2=r*r;
  if(r>pendingBoom)pendingBoom=r;
  if(!boomSeen){boomSeen=true;EV.push(['boom']);}
  for(let y=cy-r;y<=cy+r;y++){
    if(y<0||y>=H)continue;
    for(let x=cx-r;x<=cx+r;x++){
      if(x<0||x>=W)continue;
      const dx=x-cx,dy=y-cy,d2=dx*dx+dy*dy; if(d2>r2)continue;
      const i=y*W+x,t=type[i];
      if(t&&EL[t].imm)continue;
      const edge=d2/r2;
      if(t&&EL[t].mv==='s'&&!EL[t].tough&&chance(.55-edge*.4)){setPx(i,chance(.5)?EMPTY:ID.gravel);}
      else if(t&&EL[t].tough&&chance(.12-edge*.1))setPx(i,ID.gravel);
      const tough=t&&EL[t].tough;
      if(!tough&&chance(.75-edge*.5))setPx(i,chance(.72)?ID.fire:(chance(.5)?ID.smoke:ID.ember));
      else ignite(i,type[i]);
      temp[i]=Math.max(temp[i],heatT*(1-edge*.6));
      if(edge>.35&&type[i]&&!EL[type[i]].imm&&!EL[type[i]].tough&&EL[type[i]].mv!=='s'&&chance(.6)){
        const ox=x+(dx>0?1:dx<0?-1:0),oy=y+(dy>0?1:dy<0?-1:0);
        if(ox>=0&&oy>=0&&ox<W&&oy<H){const k=oy*W+ox;if(!type[k]||(!EL[type[k]].imm&&EL[type[k]].mv!=='s'))swap(i,k);}
      }
      upd[i]=1;
    }
  }
}

/* ---------- movement ---------- */
function stuck(i,x,y){
  let o;
  if(y>0&&(o=type[i-W])&&EL[o].sticky)return true;
  if(y+1<H&&(o=type[i+W])&&EL[o].sticky)return true;
  if(x>0&&(o=type[i-1])&&EL[o].sticky)return true;
  if(x+1<W&&(o=type[i+1])&&EL[o].sticky)return true;
  return false;
}
/* gravity helpers: neighbour index along gravity ("down") / against it ("up"), or -1 */
function dn(i,y){if(!GDIR)return -1;const ny=y+GDIR;return ny>=0&&ny<H?i+W*GDIR:-1;}
function dnF(i,y){const g=GDIR||1,ny=y+g;return ny>=0&&ny<H?i+W*g:-1;}
function upw(i,y){const g=GDIR||1,ny=y-g;return ny>=0&&ny<H?i-W*g:-1;}
/* zero gravity: slow random drift into empty space or gas */
function zeroDrift(i,x,y,p){
  if(!chance(p))return;
  const d=NB[rnd(4)],nx=x+d[0],ny=y+d[1];
  if(nx<0||ny<0||nx>=W||ny>=H)return;
  const j=ny*W+nx,o=type[j];
  if(!o||(EL[o].mv==='g'&&o!==type[i]))swap(i,j);
}
function movePowder(i,x,y,t){
  if(stuck(i,x,y))return;
  if(!GDIR){zeroDrift(i,x,y,.04);return;}
  if(GMAG<1&&!chance(GMAG))return;
  const bi=dn(i,y); if(bi<0)return;
  if(canSinkP(t,type[bi])){
    swap(i,bi);
    if(GMAG>1&&chance(GMAG-1)){const b2=dn(bi,y+GDIR);if(b2>=0&&canSinkP(t,type[b2]))swap(bi,b2);}
    return;
  }
  const d=Math.random()<.5?1:-1;
  let nx=x+d;
  if(nx>=0&&nx<W&&canSinkP(t,type[bi+d])&&movable(type[i+d])){swap(i,bi+d);return;}
  nx=x-d;
  if(nx>=0&&nx<W&&canSinkP(t,type[bi-d])&&movable(type[i-d])){swap(i,bi-d);return;}
}
function moveLiquid(i,x,y,t){
  const e=EL[t];
  if(!e.sticky&&stuck(i,x,y))return;
  if(!GDIR){zeroDrift(i,x,y,e.visc?.03:.08);return;}
  const bi=dn(i,y);
  if(bi>=0){
    if(GMAG>=1||chance(GMAG)){
      if(canSink(t,type[bi])){
        swap(i,bi);
        if(GMAG>1&&chance(GMAG-1)){const b2=dn(bi,y+GDIR);if(b2>=0&&canSink(t,type[b2]))swap(bi,b2);}
        return;
      }
      const d=Math.random()<.5?1:-1;
      if(x+d>=0&&x+d<W&&canSink(t,type[bi+d])){swap(i,bi+d);return;}
      if(x-d>=0&&x-d<W&&canSink(t,type[bi-d])){swap(i,bi-d);return;}
    } else if(!type[bi])return;          // low gravity: hang in the air, don't smear sideways
  }
  if(e.visc&&chance(e.visc))return;
  const dir=chance(.5)?1:-1;let best=0;
  for(let s=1;s<=3;s++){
    const nx=x+dir*s; if(nx<0||nx>=W)break;
    const o=type[i+dir*s];
    if(o&&!canSink(t,o))break;
    best=s;
  }
  if(best)swap(i,i+dir*best);
}
function moveGas(i,x,y,t){
  if(!GDIR){zeroDrift(i,x,y,.35);return;}
  const ai=upw(i,y);
  if(ai>=0){
    const rp=GMAG<1?.85*Math.max(.25,GMAG):.85;
    if(canRise(t,type[ai])&&chance(rp)){swap(i,ai);return;}
    const d=Math.random()<.5?1:-1;
    if(x+d>=0&&x+d<W&&canRise(t,type[ai+d])&&chance(.6)){swap(i,ai+d);return;}
    if(x-d>=0&&x-d<W&&canRise(t,type[ai-d])&&chance(.6)){swap(i,ai-d);return;}
  }
  const dd=chance(.5)?1:-1,nx=x+dd;
  if(nx>=0&&nx<W&&canRise(t,type[i+dd])&&chance(.55))swap(i,i+dd);
}
/* room wind: pushes gases, and powders/liquids while they are airborne */
function windPush(i,x,y,t,e){
  const mv=e.mv,aw=WIND<0?-WIND:WIND;
  if(mv==='g'){if(!chance(aw*.12))return false;}
  else if(mv==='p'||mv==='l'){
    if(GDIR){const b=dn(i,y);if(b<0||type[b])return false;}
    if(!chance(aw*.08))return false;
  } else return false;
  const d=WIND>0?1:-1,nx=x+d; if(nx<0||nx>=W)return false;
  const j=i+d,o=type[j];
  if(!o||(EL[o].mv==='g'&&o!==t&&mv!=='g')){swap(i,j);return true;}
  return false;
}
function moveBug(i,x,y,t){
  const bi=dn(i,y);
  if(bi>=0&&!type[bi]&&chance(.6)){swap(i,bi);return;}
  if(bi>=0){
    const o=type[bi];
    if(o&&EL[o].mv==='l'&&EL[t].den>EL[o].den+1&&chance(.5)){swap(i,bi);return;}
  }
  const d=NB[rnd(4)],nx=x+d[0],ny=y+d[1];
  if(nx<0||ny<0||nx>=W||ny>=H)return;
  const j=ny*W+nx,o=type[j];
  if(!o){if(chance(.4))swap(i,j);}
  else if(o===ID.plant||o===ID.grass||o===ID.sugar||o===ID.mushroom){
    setPx(j,EMPTY);dat[i]=Math.min(400,dat[i]+120);
    if(chance(.05)){const e2=[i-W,i+W,i-1,i+1][rnd(4)];if(e2>=0&&e2<N&&!type[e2])setPx(e2,t);}
  }
  else if(o===ID.water||o===ID.saltwater||o===ID.acid)setPx(i,ID.blood);
  dat[i]--; if(dat[i]<-600)setPx(i,ID.blood);
}
function moveFish(i,x,y,t){
  const d=NB[rnd(4)],nx=x+d[0],ny=y+d[1];
  if(nx<0||ny<0||nx>=W||ny>=H)return;
  const j=ny*W+nx,o=type[j];
  if(o===ID.water||o===ID.saltwater){swap(i,j);dat[i]=0;}
  else if(!o){ const bi=dn(i,y); if(bi>=0&&!type[bi])swap(i,bi); dat[i]++; if(dat[i]>240)setPx(i,ID.blood); }
}
function pullMetals(x,y,R){
  for(let dy=-R;dy<=R;dy++)for(let dx=-R;dx<=R;dx++){
    const d2=dx*dx+dy*dy; if(d2>R*R||d2<2)continue;
    const nx=x+dx,ny=y+dy; if(nx<0||ny<0||nx>=W||ny>=H)continue;
    const j=ny*W+nx,o=type[j];
    if(!o||EL[o].imm||!EL[o].el||EL[o].magnet||EL[o].emag)continue;
    const sx=nx-(dx>0?1:dx<0?-1:0),sy=ny-(dy>0?1:dy<0?-1:0),k=sy*W+sx;
    if(k!==j&&(!type[k]||(!EL[type[k]].imm&&EL[type[k]].mv!=='s')))swap(j,k);
  }
}
function moveFly(i,x,y,t){
  if(chance(.35))return;
  const d=NB[rnd(4)],nx=x+d[0],ny=y+d[1];
  if(nx<0||ny<0||nx>=W||ny>=H)return;
  const j=ny*W+nx,o=type[j];
  if(!o){swap(i,j);return;}
  if(o===ID.rot||o===ID.meat||o===ID.sugar){dat[i]=Math.min(400,dat[i]+150);setPx(j,EMPTY);}
  else if(o===ID.water||o===ID.saltwater||o===ID.acid)setPx(i,ID.blood);
  dat[i]--; if(dat[i]<-500)setPx(i,ID.blood);
}
function moveWorm(i,x,y,t){
  const d=NB[rnd(4)],nx=x+d[0],ny=y+d[1];
  if(nx<0||ny<0||nx>=W||ny>=H)return;
  const j=ny*W+nx,o=type[j];
  if(!o){const bi=dn(i,y);if(bi>=0&&!type[bi]){swap(i,bi);return;} if(chance(.3))swap(i,j);return;}
  const eo=EL[o];
  if(eo.mv==='p'&&chance(.5)){swap(i,j);return;}
  if(o===ID.water||o===ID.acid)setPx(i,ID.blood);
  dat[i]--; if(dat[i]<-900)setPx(i,ID.blood);
}
const DX4=[0,1,0,-1],DY4=[-1,0,1,0];
function clearPath(o){return EL[o].clear||o===ID.glass||o===ID.water||o===ID.ice||o===ID.diamond||o===ID.saltwater||(EL[o].alpha!==undefined&&EL[o].alpha<1);}
function emitPower(x,y,life){
  let n=0;
  for(const d of NB){
    const nx=x+d[0],ny=y+d[1]; if(nx<0||ny<0||nx>=W||ny>=H)continue;
    const j=ny*W+nx,o=type[j];
    if(o&&EL[o].el&&(!chg[j]||frame-chg[j]>28)){elecStore[j]=o;setPx(j,ID.electricity);dat[j]=life||9;chg[j]=frame;upd[j]=1;n++;}
  }
  return n;
}
function moveLight(i,x,y){
  let d=dat[i]; if(!d){d=dat[i]=1+rnd(4);}
  const dx=DX4[d-1],dy=DY4[d-1];
  let cx=x,cy=y;
  for(let s=0;s<3;s++){
    const nx=cx+dx,ny=cy+dy;
    if(nx<0||ny<0||nx>=W||ny>=H){setPx(i,EMPTY);return;}
    const j=ny*W+nx,o=type[j];
    if(!o){swap(i,j);i=j;cx=nx;cy=ny;continue;}
    const eo=EL[o];
    if(eo.mirror){dat[i]=1+((d+(chance(.5)?1:3))&3);return;}
    if(eo.prism){
      for(let q=0;q<3;q++){
        const nd=1+((d+q)&3),ex=x+DX4[nd-1],ey=y+DY4[nd-1];
        if(ex<0||ey<0||ex>=W||ey>=H)continue;
        const k2=ey*W+ex;
        if(!type[k2]&&chance(.6)){setPx(k2,ID.light);dat[k2]=nd;upd[k2]=1;}
      }
      setPx(i,EMPTY);return;
    }
    if(eo.solar){emitPower(nx,ny,12);setPx(i,EMPTY);return;}
    if(eo.fl&&chance(.15)){ignite(j,o);setPx(i,EMPTY);return;}
    if(clearPath(o)){cx=nx;cy=ny;continue;}
    temp[j]+=1;setPx(i,EMPTY);return;
  }
}
function moveElec(i,x,y){
  dat[i]--;
  const host=elecStore[i];
  if(host){
    const eh=EL[host];
    if(eh.heatOnPower)temp[i]+=eh.heatOnPower;
    if(eh.blowOnPower&&chance(eh.blowOnPower)){elecStore[i]=0;setPx(i,ID.smoke,300);return;}
    if(eh.supercond&&dat[i]<12)dat[i]=12;
    if(eh.cap&&dat[i]<20)dat[i]=20;
  }
  if(host&&EL[host].lamp&&chance(.5)){
    lampLit=true;
    const k=rnd(4),lx=x+DX4[k],ly=y+DY4[k];
    if(lx>=0&&ly>=0&&lx<W&&ly<H){const j=ly*W+lx;if(!type[j]){setPx(j,ID.light);dat[j]=k+1;upd[j]=1;}}
  }
  for(let k=0;k<4;k++){
    const d=NB[k],nx=x+d[0],ny=y+d[1];
    if(nx<0||ny<0||nx>=W||ny>=H)continue;
    const j=ny*W+nx,o=type[j];
    if(!o)continue;
    const e=EL[o];
    if(e.fl&&chance(.5)){ignite(j,o);continue;}
    if(o===ID.water||o===ID.saltwater){temp[j]+=6;}
    const conduct=e.el||o===ID.saltwater||o===ID.water||o===ID.mercury;
    if(conduct&&(!chg[j]||frame-chg[j]>26)&&dat[i]>0){
      elecStore[j]=o;setPx(j,ID.electricity);
      dat[j]=e.supercond?14:Math.max(2,dat[i]-1);
      chg[j]=frame;upd[j]=1;
    }
  }
  if(dat[i]<=0){
    const back=elecStore[i]||0;elecStore[i]=0;
    const tt=temp[i];setPx(i,back,back?tt:AMB);chg[i]=frame;
  }
}

/* ---------- per-pixel update ---------- */
function updatePixel(i,x,y,t){
  const e=EL[t];
  thermal(i,x,y,t);

  // burning
  if(burn[i]){
    temp[i]=Math.max(temp[i],e.bT||620);
    if(chance(.35)){const j=upw(i,y);if(j>=0&&!type[j])setPx(j,ID.fire);}
    if(e.sparks&&chance(.3)){
      const d=NB[rnd(4)],nx=x+d[0],ny=y+d[1];
      if(nx>=0&&ny>=0&&nx<W&&ny<H){const j=ny*W+nx;if(!type[j]){setPx(j,ID[e.sparks]);upd[j]=1;}}
    }
    burn[i]--;
    if(!burn[i]){
      if(e.exp){explode(x,y,e.exp,1400);return;}
      const res=idOf(e.bto||'');setPx(i,res,res?(res===ID.smoke?190:480):AMB);noteMade(res);return;
    }
  } else if(e.fl){
    if(temp[i]>320&&chance(e.fl*.5))ignite(i,t);
    else{
      const d=NB[rnd(4)],nx=x+d[0],ny=y+d[1];
      if(nx>=0&&ny>=0&&nx<W&&ny<H){
        const o=type[ny*W+nx];
        if(o&&(o===ID.electricity||(EL[o].hot!==undefined&&EL[o].hot>=550))){if(chance(e.fl*.6))ignite(i,t);}
      }
    }
  }

  if(phase(i,t))return;
  if(react(i,x,y,t))return;

  // life timer for transient gases
  if(e.life&&t!==ID.electricity){
    dat[i]--;
    if(dat[i]<=0){
      if(t===ID.fire){setPx(i,chance(.35)?ID.smoke:EMPTY,Math.min(temp[i],190));return;}
      if(t===ID.ember){setPx(i,ID.ash,temp[i]);return;}
      if(t!==ID.electricity){setPx(i,EMPTY);return;}
    }
  }

  /* ---- special behaviours ---- */
  if(t===ID.fire){
    temp[i]+=(760-temp[i])*.35;
    const p=PAL[t][rnd(PAL[t].length)];cr[i]=p[0];cg[i]=p[1];cb[i]=p[2];
    const d=NB[rnd(4)],nx=x+d[0],ny=y+d[1];
    if(nx>=0&&ny>=0&&nx<W&&ny<H){const o=type[ny*W+nx];if(o&&EL[o].fl)ignite(ny*W+nx,o);}
  }
  else if(e.glow&&t!==ID.electricity&&chance(.25)){const p=PAL[t][rnd(PAL[t].length)];cr[i]=p[0];cg[i]=p[1];cb[i]=p[2];}
  if(e.heat){for(const d of NB){const nx=x+d[0],ny=y+d[1];if(nx<0||ny<0||nx>=W||ny>=H)continue;const j=ny*W+nx;
    if(!type[j])continue;
    if(e.heat>0){if(temp[j]<4200)temp[j]+=e.heat;}else if(temp[j]>-273)temp[j]+=e.heat;}}
  if(e.oxid){const d=NB[rnd(4)],nx=x+d[0],ny=y+d[1];if(nx>=0&&ny>=0&&nx<W&&ny<H){const j=ny*W+nx;if(type[j]&&EL[type[j]].fl&&temp[j]>150)ignite(j,type[j]);}}
  if(e.douse){for(const d of NB){const nx=x+d[0],ny=y+d[1];if(nx<0||ny<0||nx>=W||ny>=H)continue;const j=ny*W+nx;if(burn[j]&&chance(.4))burn[j]=0;if(temp[j]>AMB)temp[j]=Math.max(AMB,temp[j]-3);}}
  if(t===ID.acid){
    const d=NB[rnd(4)],nx=x+d[0],ny=y+d[1];
    if(nx>=0&&ny>=0&&nx<W&&ny<H){const j=ny*W+nx,o=type[j];
      if(o&&!ACID_SAFE.has(o)&&!EL[o].imm&&chance(.16)){setPx(j,chance(.3)?ID.toxic_gas:EMPTY);if(chance(.35))setPx(i,EMPTY);return;}}
  }
  if(e.dye){
    const d=NB[rnd(4)],nx=x+d[0],ny=y+d[1];
    if(nx>=0&&ny>=0&&nx<W&&ny<H){
      const j=ny*W+nx,o=type[j];
      if(o&&o!==t&&!EL[o].imm&&!EL[o].dye){
        cr[j]=cr[j]*.4+e.dye[0]*.6;cg[j]=cg[j]*.4+e.dye[1]*.6;cb[j]=cb[j]*.4+e.dye[2]*.6;
        if(chance(.25)){setPx(i,EMPTY);return;}
      }
    }
  }
  if(e.emag){
    let powered=false;
    for(const d of NB){const nx=x+d[0],ny=y+d[1];if(nx<0||ny<0||nx>=W||ny>=H)continue;
      if(type[ny*W+nx]===ID.electricity){powered=true;break;}}
    if(powered)pullMetals(x,y,12);
  }
  if(e.magnet){
    const R=11;
    for(let dy2=-R;dy2<=R;dy2++)for(let dx2=-R;dx2<=R;dx2++){
      const d2=dx2*dx2+dy2*dy2; if(d2>R*R||d2<2)continue;
      const nx=x+dx2,ny=y+dy2; if(nx<0||ny<0||nx>=W||ny>=H)continue;
      const j=ny*W+nx,o=type[j];
      if(!o||EL[o].imm||!EL[o].el||EL[o].magnet)continue;
      const sx=nx-(dx2>0?1:dx2<0?-1:0),sy=ny-(dy2>0?1:dy2<0?-1:0),k=sy*W+sx;
      if(k!==j&&(!type[k]||(!EL[type[k]].imm&&EL[type[k]].mv!=='s')))swap(j,k);
    }
  }
  if(e.beam){
    if(!dat[i]){
      for(let k=0;k<4;k++){const nx=x+DX4[k],ny=y+DY4[k];
        if(nx<0||ny<0||nx>=W||ny>=H)continue;
        if(!type[ny*W+nx]){dat[i]=k+1;break;}}
    }
    if(dat[i]&&frame%3===0){
      const k=dat[i]-1,nx=x+DX4[k],ny=y+DY4[k];
      if(nx>=0&&ny>=0&&nx<W&&ny<H){const j=ny*W+nx;
        if(!type[j]){setPx(j,ID.light);dat[j]=dat[i];upd[j]=1;}}
    }
  }
  if(e.lamp){
    const d=NB[rnd(4)],nx=x+d[0],ny=y+d[1];
    if(nx>=0&&ny>=0&&nx<W&&ny<H&&type[ny*W+nx]===ID.electricity){
      lampLit=true;
      for(let k=0;k<4;k++){const lx=x+DX4[k],ly=y+DY4[k];
        if(lx<0||ly<0||lx>=W||ly>=H)continue;
        const j=ly*W+lx;
        if(!type[j]&&chance(.4)){setPx(j,ID.light);dat[j]=k+1;upd[j]=1;}}
    }
  }
  if(e.spout&&frame%(e.rate||60)<2){
    for(let k=0;k<4;k++){
      const nx=x+DX4[k],ny=y+DY4[k];
      if(nx<0||ny<0||nx>=W||ny>=H)continue;
      const j=ny*W+nx;
      if(!type[j]){setPx(j,ID[e.spout]);upd[j]=1;break;}
    }
  }
  if((e.weave||e.weaveOf)&&chance(e.weaveOf?.05:.03)){
    const d=NB[rnd(4)],nx=x+d[0],ny=y+d[1];
    if(nx>=0&&ny>=0&&nx<W&&ny<H){const j=ny*W+nx;if(!type[j]){setPx(j,ID[e.weaveOf||'web']);upd[j]=1;}}
  }
  if(e.impact){const b=dnF(i,y);if(b>=0&&type[b]&&!EL[type[b]].imm&&EL[type[b]].mv!=='g'){explode(x,y,e.impact,1600);return;}}
  if(e.assimilate){
    const d=NB[rnd(4)],nx=x+d[0],ny=y+d[1];
    if(nx>=0&&ny>=0&&nx<W&&ny<H){const j=ny*W+nx,o=type[j];
      if(o&&o!==t&&!EL[o].imm&&chance(e.assimilate)){setPx(j,t);upd[j]=1;}}
  }
  if(e.twist){
    const R=e.twist;
    for(let k=0;k<18;k++){
      const a2=Math.random()*6.28319,rr2=1+Math.random()*R;
      const nx=x+Math.round(Math.cos(a2)*rr2),ny=y+Math.round(Math.sin(a2)*rr2);
      if(nx<1||ny<1||nx>=W-1||ny>=H-1)continue;
      const j=ny*W+nx,o=type[j];
      if(!o||EL[o].imm||EL[o].mv==='s'||EL[o].mv==='w')continue;
      const k2=j-W+(chance(.5)?1:-1);
      if(k2>=0&&k2<N&&(!type[k2]||(!EL[type[k2]].imm&&EL[type[k2]].mv!=='s')))swap(j,k2);
    }
    if(chance(.08)&&x+1<W){const j=i+1;if(!type[j]||(!EL[type[j]].imm&&EL[type[j]].mv!=='s'))swap(i,j);}
  }
  if(e.pump){
    let src=-1,so=0;
    for(let k=1;k<=5&&y+k<H;k++){
      const j=i+k*W,o=type[j];
      if(!o)continue;
      if(EL[o].mv==='l'){src=j;so=o;break;}
      if(EL[o].mv!=='g')break;
    }
    if(src<0)for(const d of [[-1,0],[1,0]]){
      const nx=x+d[0];if(nx<0||nx>=W)continue;
      const o=type[i+d[0]];
      if(o&&EL[o].mv==='l'){src=i+d[0];so=o;break;}
    }
    if(src>=0)for(let k=1;k<7;k++){
      const up=i-k*W;if(up<0)break;
      const ou=type[up];
      if(!ou){const tp=temp[src];setPx(up,so,tp);setPx(src,EMPTY);upd[up]=1;break;}
      if(ou===t)continue;
      if(ou!==so&&EL[ou].mv!=='l')break;
    }
  }
  if(e.crush){
    for(const d of NB){
      const nx=x+d[0],ny=y+d[1];if(nx<0||ny<0||nx>=W||ny>=H)continue;
      const j=ny*W+nx,o=type[j];
      if(o&&!EL[o].imm&&(EL[o].mv==='s'||EL[o].mv==='w')&&chance(.5)){setPx(j,chance(.5)?ID.gravel:ID.sand);upd[j]=1;}
    }
  }
  if(e.belt){
    const dir=1,ax=x+dir;
    if(y>0&&ax>=0&&ax<W){
      const a2=i-W,b2=a2+dir,o=type[a2];
      if(o&&!EL[o].imm&&(!type[b2]||(!EL[type[b2]].imm&&EL[type[b2]].mv!=='s'))&&chance(.9))swap(a2,b2);
    }
  }
  if(e.portalIn){
    for(const d of NB){
      const nx=x+d[0],ny=y+d[1];if(nx<0||ny<0||nx>=W||ny>=H)continue;
      const j=ny*W+nx,o=type[j];
      if(!o||EL[o].imm)continue;
      const outs=portalOuts();
      if(!outs.length)break;
      const p=outs[rnd(outs.length)];
      for(const d2 of NB){
        const ox=(p%W)+d2[0],oy=((p/W)|0)+d2[1];
        if(ox<0||oy<0||ox>=W||oy>=H)continue;
        const k2=oy*W+ox;
        if(!type[k2]){setPx(k2,o);temp[k2]=temp[j];setPx(j,EMPTY);upd[k2]=1;break;}
      }
      break;
    }
  }
  if(e.lantern&&chance(.06)){
    const k=rnd(4),nx=x+DX4[k],ny=y+DY4[k];
    if(nx>=0&&ny>=0&&nx<W&&ny<H){const j=ny*W+nx;if(!type[j]){setPx(j,ID.light);dat[j]=k+1;upd[j]=1;}}
  }
  if(e.pop&&(temp[i]>90||burn[i])){setPx(i,EMPTY);return;}
  if(e.timer&&frame%90<2)emitPower(x,y,10);
  if(e.sensor&&temp[i]>100&&chance(.3))emitPower(x,y,10);
  if(e.pyro&&chance(.05)){
    const d=NB[rnd(4)],nx=x+d[0],ny=y+d[1];
    if(nx>=0&&ny>=0&&nx<W&&ny<H){const o=type[ny*W+nx];if(!o||o===ID.oxygen||o===ID.ozone)ignite(i,t);}
  }
  if(e.wexp){
    for(const d of NB){const nx=x+d[0],ny=y+d[1];if(nx<0||ny<0||nx>=W||ny>=H)continue;
      const o=type[ny*W+nx];
      if(o===ID.water||o===ID.saltwater||o===ID.mud||o===ID.juice){explode(x,y,e.wexp,1200);return;}}
  }
  if(e.rad&&chance(.03)){
    const d=NB[rnd(4)],nx=x+d[0],ny=y+d[1];
    if(nx>=0&&ny>=0&&nx<W&&ny<H){const j=ny*W+nx;if(!type[j]){setPx(j,ID.radiation);upd[j]=1;}}
  }
  if(e.pull){
    const R=4;
    for(let dy=-R;dy<=R;dy++)for(let dx=-R;dx<=R;dx++){
      const d2=dx*dx+dy*dy; if(d2>R*R||d2<1)continue;
      const nx=x+dx,ny=y+dy; if(nx<0||ny<0||nx>=W||ny>=H)continue;
      const j=ny*W+nx,o=type[j]; if(!o||EL[o].imm)continue;
      if(d2<=2){setPx(j,EMPTY);continue;}
      if(chance(.5)){
        const sx=nx-(dx>0?1:dx<0?-1:0),sy=ny-(dy>0?1:dy<0?-1:0);
        const k=sy*W+sx; if(k!==j&&(!type[k]||!EL[type[k]].imm))swap(j,k);
      }
    }
  }
  if(e.vine&&chance(.06)){
    const j=dnF(i,y);
    if(j>=0&&!type[j]&&dat[i]<30){setPx(j,t);dat[j]=dat[i]+1;upd[j]=1;}
  }
  if(e.grow&&chance(.03)){
    const d=NB[rnd(4)],nx=x+d[0],ny=y+d[1];
    if(nx>=0&&ny>=0&&nx<W&&ny<H){const j=ny*W+nx;
      if((type[j]===ID.water||type[j]===ID.saltwater)&&dat[i]<26){setPx(j,t);dat[j]=dat[i]+1;upd[j]=1;}}
  }
  if((e.rain||e.rainOf)&&chance(.004)){const b=dnF(i,y);if(b>=0&&!type[b])setPx(b,ID[e.rainOf||'water']);}
  if(e.bolt&&chance(.0016)){
    const gd=GDIR||1;
    for(let k=1;k<26;k++){
      const yy=y+k*gd; if(yy<0||yy>=H)break;
      const j=i+k*W*gd;
      if(type[j]){if(EL[type[j]].fl)ignite(j,type[j]);temp[j]+=120;break;}
      setPx(j,ID.electricity);dat[j]=6;upd[j]=1;
    }
  }
  if(e.infect){
    const d=NB[rnd(4)],nx=x+d[0],ny=y+d[1];
    if(nx>=0&&ny>=0&&nx<W&&ny<H){const j=ny*W+nx,o=type[j];
      if((o===ID.blood||o===ID.plant||o===ID.bug||o===ID.fish)&&chance(.25)){setPx(j,t);upd[j]=1;}}
  }
  if(e.toxic){
    const d=NB[rnd(4)],nx=x+d[0],ny=y+d[1];
    if(nx>=0&&ny>=0&&nx<W&&ny<H){const j=ny*W+nx,o=type[j];
      if((o===ID.bug||o===ID.fish)&&chance(.2))setPx(j,ID.blood);}
  }
  if(e.src&&chance(.10))emitPower(x,y,9);
  if(e.clone){
    if(!dat[i]){for(const d of NB){const nx=x+d[0],ny=y+d[1];if(nx<0||ny<0||nx>=W||ny>=H)continue;
      const o=type[ny*W+nx];if(o&&!EL[o].imm){dat[i]=o;break;}}}
    else if(chance(.28)){for(const d of NB){const nx=x+d[0],ny=y+d[1];if(nx<0||ny<0||nx>=W||ny>=H)continue;
      const j=ny*W+nx;if(!type[j]){setPx(j,dat[i]);upd[j]=1;break;}}}
  }
  if(e.void){for(const d of NB){const nx=x+d[0],ny=y+d[1];if(nx<0||ny<0||nx>=W||ny>=H)continue;
    const j=ny*W+nx;if(type[j]&&!EL[type[j]].imm)setPx(j,EMPTY);}}
  if(e.anti){
    for(const d of NB){const nx=x+d[0],ny=y+d[1];if(nx<0||ny<0||nx>=W||ny>=H)continue;
      const j=ny*W+nx,o=type[j];
      if(o&&o!==t){setPx(j,ID.fire,1800);temp[j]=1800;if(chance(.06))explode(nx,ny,5,1600);setPx(i,ID.fire,1600);return;}}
  }
  if(e.wind){
    if(!dat[i])dat[i]=chance(.5)?1:-1;
    const dd=dat[i]>0?1:-1,nx=x+dd;
    if(nx>=0&&nx<W){const j=i+dd,o=type[j];
      if(o&&movable(o)){const k=j+dd;if((dd>0?nx+1<W:nx-1>=0)&&!type[k]){swap(j,k);}}
      if(!type[j])swap(i,j);
    }
    if(y>0&&chance(.25)&&!type[i-W])swap(i,i-W);
    return;
  }

  /* ---- movement ---- */
  if(WIND&&windPush(i,x,y,t,e))return;
  switch(e.mv){
    case 'p':movePowder(i,x,y,t);break;
    case 'l':moveLiquid(i,x,y,t);break;
    case 'g':moveGas(i,x,y,t);break;
    case 'b':moveBug(i,x,y,t);break;
    case 'f':moveFish(i,x,y,t);break;
    case 'e':moveElec(i,x,y);break;
    case 'm':moveLight(i,x,y);break;
    case 'y':moveFly(i,x,y,t);break;
    case 'r':moveWorm(i,x,y,t);break;
  }
}

function step(){
  frame++;
  upd.fill(0);
  const rising=GDIR<0;                 // scan against gravity so falling cells move once per step
  for(let k=0;k<H;k++){
    const y=rising?k:H-1-k;
    const rev=(frame+y)&1;
    for(let n=0;n<W;n++){
      const x=rev?n:W-1-n,i=y*W+x,t=type[i];
      if(!t||upd[i])continue;
      upd[i]=1;
      updatePixel(i,x,y,t);
    }
  }
}
