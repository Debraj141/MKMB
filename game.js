(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const pauseBtn = document.getElementById('pause');
  const overlay = document.getElementById('overlay');
  const title = document.getElementById('overlay-title');
  const copy = document.getElementById('overlay-copy');
  const primary = document.getElementById('primary');
  const toast = document.getElementById('toast');
  const faceImage = new Image();
  faceImage.src = 'assets/stickman-face.webp';
  const gunshotSound = new Audio('assets/gunshot-attached.mp3');
  gunshotSound.preload='auto';
  const extraGunshotSound = new Audio('assets/gunshot-extra.mp3');
  extraGunshotSound.preload='auto';
  const flyPassSound = new Audio('assets/fly-pass.mp3');
  flyPassSound.preload='auto';
  const flyPassRightSound = new Audio('assets/fly-pass-right.mp3');
  flyPassRightSound.preload='auto';
  const missSound = new Audio('assets/miss.mp3');
  missSound.preload='auto';
  missSound.volume=.8;

  let W=600,H=950, dpr=1, score=0, best=Number(localStorage.getItem('hm-best')||0);
  let running=false, paused=false, last=0, mosquitoes=[], shot=null, particles=[], spawn=0, aim=null;
  let nextSpeedScore=10, mosquitoSpeedScale=1, speedFrom=1, speedTarget=1, speedTransitionElapsed=1;
  let nextFlyScore=25, fliesPerWave=1;
  let audio=null, hovering=false, dragging=false, dragStart=null;
  bestEl.textContent=best;

  function ensureAudio(){
    if(!audio){
      const AudioContext=window.AudioContext||window.webkitAudioContext;
      if(AudioContext)audio=new AudioContext();
    }
    if(audio&&audio.state==='suspended')audio.resume();
    return audio;
  }

  function playHitSound(startAt){
    ensureAudio();
    if(!audio)return;
    const now=startAt;
    const hit=audio.createOscillator(), hitGain=audio.createGain();
    hit.type='triangle';hit.frequency.setValueAtTime(180,now);
    hit.frequency.exponentialRampToValueAtTime(65,now+.11);
    hitGain.gain.setValueAtTime(.22,now);hitGain.gain.exponentialRampToValueAtTime(.001,now+.13);
    hit.connect(hitGain);hitGain.connect(audio.destination);hit.start(now);hit.stop(now+.14);
    const thud=audio.createOscillator(), thudGain=audio.createGain();
    thud.type='sine';thud.frequency.setValueAtTime(90,now+.09);
    thud.frequency.exponentialRampToValueAtTime(42,now+.28);
    thudGain.gain.setValueAtTime(.16,now+.09);thudGain.gain.exponentialRampToValueAtTime(.001,now+.31);
    thud.connect(thudGain);thudGain.connect(audio.destination);thud.start(now+.09);thud.stop(now+.32);
  }

  function playGunshotSound(){
    gunshotSound.pause();
    gunshotSound.currentTime=0;
    gunshotSound.play().catch(error=>console.error('Unable to play gunshot audio:',error));
    extraGunshotSound.pause();
    extraGunshotSound.currentTime=0;
    extraGunshotSound.play().catch(error=>console.error('Unable to play additional gunshot audio:',error));
  }

  function playFlyPassSound(){
    flyPassSound.pause();
    flyPassSound.currentTime=0;
    flyPassSound.play().catch(error=>console.error('Unable to play fly-pass audio:',error));
  }

  function playFlyPassRightSound(){
    flyPassRightSound.pause();
    flyPassRightSound.currentTime=0;
    flyPassRightSound.play().catch(error=>console.error('Unable to play right-to-left fly audio:',error));
  }

  function playHitSounds(){
    const context=ensureAudio();
    if(!context)return;
    playGunshotSound();
    playHitSound(context.currentTime+.02);
  }

  function playMissSound(){
    missSound.pause();
    missSound.currentTime=0;
    missSound.play().catch(()=>{});
  }

  function resize(){
    const r=canvas.getBoundingClientRect(); dpr=Math.min(devicePixelRatio||1,2);
    W=r.width; H=r.height; canvas.width=Math.round(W*dpr); canvas.height=Math.round(H*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  new ResizeObserver(resize).observe(canvas); resize();

  const rand=(a,b)=>a+Math.random()*(b-a);
  function newMosquito(side){
    if(side===undefined)side=Math.random()<.5?-1:1;
    return {x:side<0?W+25:-25,y:rand(H*.22,H*.53),vx:side*rand(55,105),vy:rand(-25,25),phase:rand(0,6.28),alive:true,dead:false,fallTime:0,rotation:0,passSoundPlayed:false};
  }
  function spawnWave(){
    const firstSide=Math.random()<.5?-1:1;
    for(let i=0;i<fliesPerWave;i++){
      const side=i===0?firstSide:i===1?-firstSide:(Math.random()<.5?-1:1);
      mosquitoes.push(newMosquito(side));
    }
  }
  function start(){
    score=0; scoreEl.textContent=0; mosquitoes=[]; shot=null; particles=[]; spawn=.5;
    nextSpeedScore=10; mosquitoSpeedScale=1; speedFrom=1; speedTarget=1; speedTransitionElapsed=1;
    nextFlyScore=25; fliesPerWave=1;
    running=true; paused=false; overlay.classList.remove('show'); last=performance.now();
    ensureAudio();
    requestAnimationFrame(loop);
  }
  function pause(){
    if(!running)return;
    paused=true; running=false; title.textContent='Ⅱ PAUSED'; copy.textContent='Take a breath. The mosquitoes are still out there.'; primary.textContent='▶ RESUME'; overlay.classList.add('show');
  }
  function resume(){ paused=false; overlay.classList.remove('show'); running=true; last=performance.now(); requestAnimationFrame(loop); }
  function end(){
    running=false; title.textContent='GAME OVER'; copy.textContent=`You swatted ${score} mosquito${score===1?'':'es'}. Best score: ${best}.`; primary.textContent='↻ PLAY AGAIN'; overlay.classList.add('show');
  }
  primary.addEventListener('click',()=> paused?resume():start());
  pauseBtn.addEventListener('click',pause);

  function line(x1,y1,x2,y2,color='#222',width=3){
    ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();
  }
  function drawBed(time=performance.now()){
    const x=W*.11,y=H*.72,bw=W*.8,bh=H*.105,s=W/600;
    const px=(n)=>x+bw*n, py=(n)=>y+bh*n;
    const handY=Math.sin(time/320)*bh*.24;
    ctx.save();ctx.lineCap='round';ctx.lineJoin='round';

    ctx.strokeStyle='#171717';ctx.lineWidth=10*s;
    line(px(.08),py(.88),px(.08),py(1.2));
    line(px(.95),py(.94),px(.95),py(1.18));

    ctx.fillStyle='#242424';ctx.strokeStyle='#111';ctx.lineWidth=5*s;
    ctx.beginPath();ctx.moveTo(px(.04),py(.92));ctx.lineTo(px(.025),y-H*.11);
    ctx.lineTo(px(.31),y-H*.2);ctx.lineTo(px(.31),py(.76));ctx.closePath();
    ctx.fill();ctx.stroke();
    ctx.fillStyle='#48494c';
    ctx.beginPath();ctx.moveTo(px(.075),py(.72));ctx.lineTo(px(.07),y-H*.09);
    ctx.lineTo(px(.27),y-H*.17);ctx.lineTo(px(.27),py(.69));ctx.closePath();ctx.fill();

    ctx.fillStyle='#d6d1c7';ctx.strokeStyle='#171717';ctx.lineWidth=5*s;
    ctx.beginPath();ctx.ellipse(px(.29),py(.1),bw*.11,bh*.27,-.12,0,Math.PI*2);ctx.fill();ctx.stroke();

    ctx.fillStyle='#85858a';ctx.strokeStyle='#171717';ctx.lineWidth=5*s;
    ctx.beginPath();ctx.moveTo(px(.2),py(.02));ctx.lineTo(px(.98),py(.28));
    ctx.lineTo(px(.96),py(1.02));ctx.lineTo(px(.2),py(.84));ctx.closePath();ctx.fill();ctx.stroke();
    ctx.strokeStyle='#67686b';ctx.lineWidth=3*s;
    line(px(.23),py(.78),px(.94),py(.92));

    ctx.strokeStyle='#151515';ctx.lineWidth=5*s;
    line(px(.43),py(.38),px(.72),py(.58));
    line(px(.46),py(.49),px(.82),py(.73));
    line(px(.72),py(.58),px(.87),py(.55));
    line(px(.82),py(.73),px(.91),py(.7));

    ctx.fillStyle='#29423e';ctx.strokeStyle='#171717';ctx.lineWidth=4*s;
    ctx.beginPath();ctx.moveTo(px(.25),py(.16));ctx.lineTo(px(.4),py(.1));
    ctx.lineTo(px(.56),py(.25));ctx.lineTo(px(.53),py(.92));
    ctx.lineTo(px(.24),py(.83));ctx.closePath();ctx.fill();ctx.stroke();

    const headX=px(.29),headY=py(.02),faceR=32*s;
    if(faceImage.complete&&faceImage.naturalWidth){
      const faceHeight=faceR*2.8;
      const faceWidth=faceHeight*faceImage.naturalWidth/faceImage.naturalHeight;
      ctx.save();
      ctx.translate(headX,headY);ctx.rotate(-Math.PI/4);
      ctx.beginPath();ctx.ellipse(0,0,faceWidth*.5,faceHeight*.5,0,0,Math.PI*2);ctx.clip();
      ctx.drawImage(faceImage,-faceWidth*.5,-faceHeight*.5,faceWidth,faceHeight);
      ctx.restore();
    }else{
      ctx.fillStyle='#d6c5a7';ctx.strokeStyle='#171717';ctx.lineWidth=3*s;
      ctx.beginPath();ctx.ellipse(headX,headY,faceR*.9,faceR, -.18,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.fillStyle='#77716a';
      ctx.beginPath();ctx.arc(headX,headY-9*s,faceR,Math.PI*1.05,Math.PI*1.95);ctx.fill();
      ctx.fillStyle='#171717';
      ctx.beginPath();ctx.arc(headX-9*s,headY+1*s,2.5*s,0,Math.PI*2);
      ctx.arc(headX+9*s,headY+1*s,2.5*s,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#171717';ctx.lineWidth=2.5*s;
      ctx.beginPath();ctx.ellipse(headX-9*s,headY+1*s,9*s,8*s,0,0,Math.PI*2);
      ctx.ellipse(headX+9*s,headY+1*s,9*s,8*s,0,0,Math.PI*2);
      ctx.moveTo(headX-2*s,headY+1*s);ctx.lineTo(headX+2*s,headY+1*s);ctx.stroke();
      ctx.strokeStyle='#6a3930';ctx.lineWidth=2*s;
      ctx.beginPath();ctx.arc(headX,headY+12*s,7*s,.15,Math.PI-.15);ctx.stroke();
    }

    const shoulder={x:px(.37),y:py(.26)};
    const elbow={x:px(.47),y:py(.4)};
    const belly={x:px(.57),y:py(.48)};
    const hand={x:belly.x,y:belly.y+handY};
    line(belly.x,belly.y-7*s,belly.x,belly.y+7*s,'#171717',3*s);
    ctx.strokeStyle='#29423e';ctx.lineWidth=13*s;
    line(shoulder.x,shoulder.y,elbow.x,elbow.y);
    ctx.strokeStyle='#d6c5a7';ctx.lineWidth=11*s;
    line(elbow.x,elbow.y,hand.x,hand.y);
    ctx.fillStyle='#d6c5a7';ctx.strokeStyle='#171717';ctx.lineWidth=2*s;
    ctx.beginPath();ctx.ellipse(hand.x,hand.y,11*s,7*s,-.2,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.restore();
  }
  function idleScene(time){
    if(!running)draw(time);
    requestAnimationFrame(idleScene);
  }
  function drawMosquito(m){
    ctx.save();ctx.translate(m.x,m.y);ctx.rotate(m.dead?m.rotation:Math.sin(m.phase)*.25);
    ctx.strokeStyle='#222';ctx.lineWidth=2;
    // wings
    ctx.fillStyle='#c9d5d2';ctx.beginPath();ctx.ellipse(-4,-7,5,10,-.6,0,7);ctx.ellipse(5,-7,5,10,.6,0,7);ctx.fill();ctx.stroke();
    // body
    ctx.fillStyle='#a8322d';ctx.beginPath();ctx.ellipse(0,0,10,5,-.15,0,7);ctx.fill();ctx.stroke();
    ctx.fillStyle='#242424';ctx.beginPath();ctx.arc(8,-1,3.5,0,7);ctx.fill();
    line(10,-1,19,-5,'#222',1.2);
    for(let i=0;i<3;i++){line(-3+i*4,3, -8+i*5,11,'#222',1.2);}
    ctx.restore();
  }
  function drawAim(){
    if(!aim||!dragging)return;
    const sx=W*.56,sy=H*.77;
    ctx.save();
    ctx.setLineDash([5,7]);ctx.strokeStyle='#252525';ctx.lineWidth=2.5;
    ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(aim.x,aim.y);ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();ctx.arc(sx,sy,5,0,Math.PI*2);
    ctx.fillStyle='#d75c35';ctx.fill();
    ctx.beginPath();ctx.arc(aim.x,aim.y,8,0,Math.PI*2);
    ctx.strokeStyle=hovering?'#d75c35':'#222';ctx.lineWidth=2;ctx.stroke();
    ctx.restore();
  }
  function drawShot(){
    if(!shot)return;
    ctx.save();ctx.strokeStyle='#e77c37';ctx.lineWidth=3;ctx.globalAlpha=.85;
    ctx.beginPath();ctx.moveTo(shot.sx,shot.sy);ctx.lineTo(shot.x,shot.y);ctx.stroke();
    ctx.fillStyle='#f3a044';ctx.beginPath();ctx.arc(shot.x,shot.y,7,0,7);ctx.fill();ctx.restore();
  }
  function draw(time=performance.now()){
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle='#f2f0e9';ctx.fillRect(0,0,W,H);
    // subtle paper texture dots
    ctx.fillStyle='#e7e4dc';for(let i=0;i<24;i++){let x=(i*137)%W,y=(i*211)%H;ctx.fillRect(x,y,1.5,1.5);}
    drawBed(time); drawAim();
    mosquitoes.forEach(drawMosquito);
    drawShot();
    particles.forEach(p=>{ctx.globalAlpha=Math.max(0,p.life);ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,3,3);});ctx.globalAlpha=1;
  }
  function hitMosquito(mosquito){
    if(!mosquito||mosquito.dead)return;
    score++;scoreEl.textContent=score;
    if(score>=nextFlyScore){
      fliesPerWave++;
      nextFlyScore+=25;
    }
    if(score>=nextSpeedScore&&speedTarget<2.5){
      speedFrom=mosquitoSpeedScale;
      speedTarget=Math.min(speedTarget*rand(1.08,1.18),2.5);
      speedTransitionElapsed=0;
      nextSpeedScore=score+Math.floor(rand(3,9));
    }
    if(score>best){best=score;bestEl.textContent=best;localStorage.setItem('hm-best',best);}
    for(let i=0;i<18;i++)particles.push({x:mosquito.x,y:mosquito.y,vx:rand(-90,90),vy:rand(-100,80),life:1,color:['#d75c35','#383838','#c9bda6'][i%3]});
    mosquito.dead=true;
    mosquito.alive=false;
    mosquito.vx=rand(-18,18);
    mosquito.vy=rand(-20,15);
    mosquito.fallTime=0;
    shot=null;
    playHitSounds();
    toast.classList.remove('pop');void toast.offsetWidth;toast.classList.add('pop');
  }
  function loop(t){
    if(!running)return;
    const dt=Math.min((t-last)/1000,.04);last=t;
    if(speedTransitionElapsed<1){
      speedTransitionElapsed=Math.min(1,speedTransitionElapsed+dt);
      const progress=speedTransitionElapsed;
      const eased=progress*progress*(3-2*progress);
      mosquitoSpeedScale=speedFrom+(speedTarget-speedFrom)*eased;
    }
    if(!mosquitoes.length){spawn-=dt;if(spawn<=0)spawnWave();}
    for(let i=mosquitoes.length-1;i>=0;i--){
      const mosquito=mosquitoes[i];
      if(mosquito.dead){
        mosquito.fallTime+=dt;
        mosquito.vy+=H*.9*dt;
        mosquito.x+=mosquito.vx*dt;
        mosquito.y+=mosquito.vy*dt;
        mosquito.rotation+=dt*4.8;
        const floor=H*.84;
        if(mosquito.y>=floor){
          mosquito.y=floor;
          mosquito.vy=0;
          mosquito.vx=0;
          mosquito.rotation=Math.PI*.5;
          if(mosquito.fallTime>.65){
            mosquitoes.splice(i,1);
            if(!mosquitoes.length)spawn=.45;
          }
        }
      }else{
        const previousX=mosquito.x;
        mosquito.x+=mosquito.vx*mosquitoSpeedScale*dt;mosquito.y+=mosquito.vy*mosquitoSpeedScale*dt+Math.sin(t/220+mosquito.phase)*18*dt;mosquito.phase+=dt*13;
        if(mosquito.vx>0&&!mosquito.passSoundPlayed&&previousX<0&&mosquito.x>=0){
          mosquito.passSoundPlayed=true;
          playFlyPassSound();
        }else if(mosquito.vx<0&&!mosquito.passSoundPlayed&&previousX>W&&mosquito.x<=W){
          mosquito.passSoundPlayed=true;
          playFlyPassRightSound();
        }
        if(mosquito.x<-45||mosquito.x>W+45){end();draw();return;}
      }
    }
    if(shot){
      shot.life-=dt;shot.x+=shot.vx*dt;shot.y+=shot.vy*dt;
      const hit=mosquitoes.find(m=>!m.dead&&Math.hypot(shot.x-m.x,shot.y-m.y)<22);
      if(hit)hitMosquito(hit);
      if(shot&&shot.life<=0)shot=null;
    }
    particles=particles.filter(p=>p.life>0);particles.forEach(p=>{p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt*1.8;});
    draw();requestAnimationFrame(loop);
  }
  function pointer(e){
    if(!running||paused)return;
    const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
    aim={x,y};
    hovering=Boolean(lineHitsMosquito());
    canvas.classList.toggle('targeting',hovering);
  }
  function lineHitsMosquito(){
    if(!dragging||!aim)return null;
    const sx=W*.56,sy=H*.77,dx=aim.x-sx,dy=aim.y-sy;
    const lengthSq=dx*dx+dy*dy;
    for(const mosquito of mosquitoes){
      if(mosquito.dead)continue;
      const t=lengthSq?Math.max(0,Math.min(1,((mosquito.x-sx)*dx+(mosquito.y-sy)*dy)/lengthSq)):0;
      if(Math.hypot(sx+t*dx-mosquito.x,sy+t*dy-mosquito.y)<=17)return mosquito;
    }
    return null;
  }
  canvas.addEventListener('pointermove',e=>{
    if(!running||paused)return;
    const r=canvas.getBoundingClientRect();
    aim={x:e.clientX-r.left,y:e.clientY-r.top};
    hovering=Boolean(lineHitsMosquito());
    canvas.classList.toggle('targeting',hovering);
    if(dragging)canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointerleave',()=>{
    if(dragging)return;
    hovering=false;
    aim=null;
    canvas.classList.remove('targeting');
  });
  canvas.addEventListener('pointerdown',e=>{
    if(!running||paused)return;
    e.preventDefault();
    ensureAudio();
    dragging=true;
    dragStart={x:e.clientX-canvas.getBoundingClientRect().left,y:e.clientY-canvas.getBoundingClientRect().top};
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
    pointer(e);
  });
  canvas.addEventListener('pointerup',e=>{
    if(!dragging)return;
    const r=canvas.getBoundingClientRect();
    const x=e.clientX-r.left,y=e.clientY-r.top;
    const didDrag=dragStart&&Math.hypot(x-dragStart.x,y-dragStart.y)>=8;
    pointer(e);
    const hit=didDrag?lineHitsMosquito():null;
    dragging=false;
    canvas.classList.remove('dragging');
    if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
    if(hit){
      hitMosquito(hit);
    }else{
      playMissSound();
    }
    dragStart=null;
  });
  canvas.addEventListener('pointercancel',()=>{
    dragging=false;
    dragStart=null;
    hovering=false;
    aim=null;
    canvas.classList.remove('dragging','targeting');
  });
  // initial scene
  draw(); overlay.classList.add('show'); requestAnimationFrame(idleScene);
})();
