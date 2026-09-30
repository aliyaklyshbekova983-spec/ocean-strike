const SIZE=10;
const FLEET=[{size:4,name:"Линкор"},{size:3,name:"Крейсер"},{size:3,name:"Крейсер"},{size:2,name:"Эсминец"},{size:2,name:"Эсминец"},{size:2,name:"Эсминец"},{size:1,name:"Катер"},{size:1,name:"Катер"},{size:1,name:"Катер"},{size:1,name:"Катер"}];
const COLS=['А','Б','В','Г','Д','Е','Ж','З','И','К'];
let state=null;
let authToken=localStorage.getItem('oceanStrikeToken')||'';
let currentUser=null;
let cloudSaveTimer=null;

const $=id=>document.getElementById(id);
const dirs=[[0,1],[1,0],[0,-1],[-1,0]];
const key=(r,c)=>`${r},${c}`;
const inB=(r,c)=>r>=0&&r<SIZE&&c>=0&&c<SIZE;
const coord=(r,c)=>`${COLS[c]}${r+1}`;

function emptyBoard(){return Array.from({length:SIZE},()=>Array(SIZE).fill(null))}
function neighbors8(r,c){const a=[];for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){if(dr||dc)a.push([r+dr,c+dc])}return a}
function canPlace(board,cells){
  for(const [r,c] of cells){if(!inB(r,c)||board[r][c])return false}
  for(const [r,c] of cells)for(const [nr,nc] of neighbors8(r,c))if(inB(nr,nc)&&board[nr][nc])return false;
  return true;
}
function placeFleet(board){
  const ships=[];
  for(const spec of FLEET){
    let placed=false;
    for(let tries=0;tries<5000&&!placed;tries++){
      const horizontal=Math.random()<.5,r=Math.floor(Math.random()*SIZE),c=Math.floor(Math.random()*SIZE);
      const cells=Array.from({length:spec.size},(_,i)=>[r+(horizontal?0:i),c+(horizontal?i:0)]);
      if(canPlace(board,cells)){
        const id=ships.length;
        cells.forEach(([rr,cc])=>board[rr][cc]={ship:id});
        ships.push({id,size:spec.size,name:spec.name,cells,hits:[],sunk:false});
        placed=true;
      }
    }
    if(!placed)return placeFleet(emptyBoard());
  }
  return {board,ships};
}
function makeGame(){
  const p=placeFleet(emptyBoard()),e=placeFleet(emptyBoard());
  return {player:p,enemy:e,turn:'player',difficulty:$('difficulty').value,radar:2,shots:[],playerShots:0,hits:0,misses:0,sunk:0,aiShots:[],aiTargetQueue:[],aiHits:[],startedAt:Date.now()};
}
function shipArt(size,horizontal,segment,total){
  const rot=horizontal?'':' transform="rotate(90 50 50)"';
  const accent=size===4?'#dcecf1':size===3?'#a8c9d2':size===2?'#79aab8':'#6e9baa';
  const bow=segment===0,stern=segment===total-1;
  const nose=bow?'M8 50 L30 27 L88 27 L96 50 L88 73 L30 73 Z':stern?'M4 27 L70 27 L92 36 L92 64 L70 73 L4 73 Z':'M4 30 L94 30 L94 70 L4 70 Z';
  const turret=size>=3?'<rect x="43" y="22" width="18" height="15" rx="3" fill="#dcecf1"/><rect x="48" y="12" width="8" height="12" rx="2" fill="#6b8e99"/>':size===2?'<rect x="43" y="24" width="14" height="12" rx="3" fill="#dcecf1"/>':'<circle cx="50" cy="50" r="8" fill="#dcecf1"/>';
  const wake=bow?'<path d="M16 50 L3 42 M16 50 L3 58" stroke="#9de9f5" stroke-width="2" opacity=".65"/>':'';
  return `<svg class="ship-svg" viewBox="0 0 100 100" aria-hidden="true"${rot}>${wake}<path d="${nose}" fill="${accent}" stroke="#eefcff" stroke-width="2"/><path d="M12 42 H88 M12 58 H88" stroke="#345865" stroke-width="2" opacity=".9"/>${turret}<circle cx="22" cy="50" r="3" fill="#173b48"/><circle cx="78" cy="50" r="3" fill="#173b48"/></svg>`;
}
function renderBoard(id,data,isEnemy){
  const el=$(id);el.innerHTML='';
  for(let r=0;r<SIZE;r++)for(let c=0;c<SIZE;c++){
    const cell=document.createElement('button');cell.className='cell';
    const x=data.board[r][c];
    if(x?.ship!==undefined){
      const ship=data.ships?.[x.ship];
      const revealed=!isEnemy||!!x.hit||!!x.sunk;
      if(revealed&&ship){
        cell.classList.add('ship',`ship-size-${ship.size}`);
        const horizontal=ship.cells.length<2||ship.cells[0][0]===ship.cells[1][0];
        cell.classList.add(horizontal?'ship-h':'ship-v');
        const idx=ship.cells.findIndex(([rr,cc])=>rr===r&&cc===c);
        cell.classList.add(idx===0?'ship-bow':idx===ship.cells.length-1?'ship-stern':'ship-mid');
        cell.innerHTML=shipArt(ship.size,horizontal,idx,ship.cells.length);
      }
    }
    if(x?.hit){cell.classList.add(x.sunk?'sunk':'hit');const mark=document.createElement('span');mark.className='shot-icon';mark.textContent=x.sunk?'✦':'✕';cell.appendChild(mark)}
    if(x?.miss){cell.classList.add('miss');cell.innerHTML='<span class="miss-splash"><i></i><i></i><i></i></span>'}
    cell.dataset.r=r;cell.dataset.c=c;
    if(isEnemy){cell.classList.add('targetable');cell.addEventListener('click',()=>playerShoot(r,c))}
    el.appendChild(cell);
  }
}
function sunkShip(side,id){return side.ships[id].hits.length>=side.ships[id].size}
function allSunk(side){return side.ships.every(s=>s.hits.length>=s.size)}
function markSunk(side,id){const s=side.ships[id];s.sunk=true;s.cells.forEach(([r,c])=>side.board[r][c].sunk=true)}
function updateUI(){
  if(!state)return;
  renderBoard('playerBoard',state.player,false);renderBoard('enemyBoard',state.enemy,true);
  $('turnBadge').textContent=state.turn==='player'?'Ваш ход':state.turn==='ai'?'Ход противника':'Игра завершена';
  $('statusTitle').textContent=state.turn==='player'?'Ваш ход':state.turn==='ai'?'Противник думает…':'Игра завершена';
  $('statusText').textContent=state.turn==='player'?'Стреляйте по правому полю.':'AI выбирает цель.';
  $('hitStat').textContent=state.hits;$('missStat').textContent=state.misses;$('sunkStat').textContent=state.sunk;$('radarCount').textContent=state.radar;
  $('enemyFleetCount').textContent=`${state.enemy.ships.filter(s=>!s.sunk).length} кораблей`;
  $('playerFleetCount').textContent=`${state.player.ships.filter(s=>!s.sunk).length} кораблей`;
  $('fleetList').innerHTML=state.player.ships.map(s=>`<div class="fleet-item ${s.sunk?'sunk':''}">${s.name} · ${s.size}</div>`).join('');
}
function serializeState(){
  if(!state)return null;
  const copy=JSON.parse(JSON.stringify(state));
  copy.shots=[...(state.shots||[])];copy.aiShots=[...(state.aiShots||[])];copy.aiTargetQueue=[...(state.aiTargetQueue||[])];copy.aiHits=[...(state.aiHits||[])];
  for(const side of [copy.player,copy.enemy])for(const s of side.ships)s.hits=Array.isArray(s.hits)?s.hits:[...(s.hits||[])];
  return copy;
}
function reviveState(raw){
  if(!raw)return null;
  raw.shots=Array.isArray(raw.shots)?raw.shots:[];raw.aiShots=Array.isArray(raw.aiShots)?raw.aiShots:[];raw.aiTargetQueue=Array.isArray(raw.aiTargetQueue)?raw.aiTargetQueue:[];raw.aiHits=Array.isArray(raw.aiHits)?raw.aiHits:[];
  for(const side of [raw.player,raw.enemy]){if(!side||!Array.isArray(side.ships)||!Array.isArray(side.board))return null;for(const s of side.ships){s.hits=Array.isArray(s.hits)?s.hits:[];s.cells=s.cells||[]}}
  return raw;
}
const LOCAL_KEY='oceanStrikeSave';
let storageMode='localStorage';
function writeIndexedDB(value){
  return new Promise(resolve=>{
    try{
      const req=indexedDB.open('OceanStrikeDB',1);
      req.onupgradeneeded=()=>{try{req.result.createObjectStore('saves')}catch{}};
      req.onsuccess=()=>{try{const db=req.result,tx=db.transaction('saves','readwrite');tx.objectStore('saves').put(value,'current');tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>{db.close();resolve(false)}}catch{resolve(false)}};
      req.onerror=()=>resolve(false);
    }catch{resolve(false)}
  });
}
function readIndexedDB(){
  return new Promise(resolve=>{
    try{
      const req=indexedDB.open('OceanStrikeDB',1);
      req.onupgradeneeded=()=>{try{req.result.createObjectStore('saves')}catch{}};
      req.onsuccess=()=>{try{const db=req.result,tx=db.transaction('saves','readonly'),g=tx.objectStore('saves').get('current');g.onsuccess=()=>{const v=g.result;db.close();resolve(v||null)};g.onerror=()=>{db.close();resolve(null)}}catch{resolve(null)}};
      req.onerror=()=>resolve(null);
    }catch{resolve(null)}
  });
}
function localSave(){
  if(!state)return;
  const value=JSON.stringify(serializeState());
  try{localStorage.setItem(LOCAL_KEY,value);storageMode='localStorage'}catch{storageMode='indexedDB'}
  writeIndexedDB(value).then(ok=>{if(!ok&&storageMode==='indexedDB')toast('⚠️ Не удалось сохранить игру на устройстве')});
}
async function loadLocal(){
  try{const raw=localStorage.getItem(LOCAL_KEY);if(raw){const revived=reviveState(JSON.parse(raw));if(revived)return revived}}catch{storageMode='indexedDB'}
  const raw=await readIndexedDB();
  if(raw){try{storageMode='indexedDB';return reviveState(JSON.parse(raw))}catch{}}
  return null;
}
async function refreshResumeButton(){ const saved=await loadLocal(); $('resumeBtn').classList.toggle('hidden',!saved); }
function cloudSave(){
  if(!authToken||!state)return;
  clearTimeout(cloudSaveTimer);cloudSaveTimer=setTimeout(async()=>{try{await api('/api/progress',{method:'PUT',body:JSON.stringify({state:serializeState()})})}catch{}},250);
}
function save(){localSave();cloudSave()}
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),2200)}

function availableAI(){const used=new Set(state.aiShots);const arr=[];for(let r=0;r<SIZE;r++)for(let c=0;c<SIZE;c++)if(!used.has(key(r,c)))arr.push([r,c]);return arr}
function enqueueAround(r,c){for(const [dr,dc] of dirs){const rr=r+dr,cc=c+dc,k=key(rr,cc);if(inB(rr,cc)&&!state.aiShots.includes(k)&&!state.aiTargetQueue.some(p=>p[0]===rr&&p[1]===cc))state.aiTargetQueue.push([rr,cc])}}
function aiTargets(){
  while(state.aiTargetQueue.length&&state.aiShots.includes(key(...state.aiTargetQueue[0])))state.aiTargetQueue.shift();
  return state.aiTargetQueue.length?state.aiTargetQueue:[];
}
function aiTurn(){
  if(!state||state.turn!=='ai')return;
  let candidates=availableAI();
  if(state.difficulty!=='easy'){
    const targeted=aiTargets();
    if(targeted.length)candidates=targeted;
    else if(state.difficulty==='hard'){
      candidates=candidates.filter(([r,c])=>(r+c)%2===0);
      if(!candidates.length)candidates=availableAI();
    }
  }
  const [r,c]=candidates[Math.floor(Math.random()*candidates.length)];
  const k=key(r,c);state.aiShots.push(k);state.aiTargetQueue=state.aiTargetQueue.filter(p=>key(p[0],p[1])!==k);
  const cell=state.player.board[r][c];
  if(cell?.ship!==undefined){
    cell.hit=true;state.player.ships[cell.ship].hits.push(k);state.aiHits.push(k);
    const isSunk=sunkShip(state.player,cell.ship);
    if(isSunk){markSunk(state.player,cell.ship);state.aiHits=[];state.aiTargetQueue=[];toast('💥 Ваш корабль потоплен')}
    else{enqueueAround(r,c);toast('⚠️ AI попал и продолжает поиск рядом')}
    if(allSunk(state.player)){finish(false);return}
  }else{state.player.board[r][c]={miss:true};toast('Компьютер промахнулся')}
  state.turn='player';updateUI();save();
}
function playerShoot(r,c){
  if(!state||state.turn!=='player')return;
  const k=key(r,c);if(state.shots.includes(k)){toast('Вы уже стреляли сюда');return}
  state.shots.push(k);state.playerShots++;
  const cell=state.enemy.board[r][c];
  if(cell?.ship!==undefined){
    cell.hit=true;state.enemy.ships[cell.ship].hits.push(k);state.hits++;
    if(sunkShip(state.enemy,cell.ship)){markSunk(state.enemy,cell.ship);state.sunk++;toast('💥 Корабль потоплен!')}
    else toast('🎯 Попадание! Можно стрелять ещё раз');
    if(allSunk(state.enemy)){finish(true);return}
    state.turn='player';updateUI();save();return;
  }
  state.enemy.board[r][c]={miss:true};state.misses++;state.turn='ai';updateUI();save();toast('Промах — ход компьютера');setTimeout(aiTurn,650);
}
function radar(){
  if(!state||state.radar<=0||state.turn!=='player'){toast('Радар сейчас недоступен');return}
  // Radar scans a real 3×3 area. It reports only hidden, still-active ship cells.
  // Already hit/sunk cells are ignored because their status is already visible.
  const r=Math.floor(Math.random()*8),c=Math.floor(Math.random()*8);
  const foundCells=[];
  for(let rr=r;rr<r+3;rr++)for(let cc=c;cc<c+3;cc++){
    const cell=state.enemy.board[rr][cc];
    // Radar should only detect ships that are still hidden and not already destroyed.
    // Once a cell has been hit/sunk, its status is already known to the player.
    if(cell?.ship!==undefined && !cell.hit && !cell.sunk) foundCells.push([rr,cc]);
  }
  state.radar--;
  $('radarCount').textContent=state.radar;
  const from=coord(r,c),to=coord(r+2,c+2),board=$('enemyBoard');
  const scanEls=[];
  for(let rr=r;rr<r+3;rr++)for(let cc=c;cc<c+3;cc++){
    const el=board.children[rr*SIZE+cc];
    if(el){el.classList.add('radar-scan');scanEls.push(el)}
  }
  const contactEls=[];
  for(const [rr,cc] of foundCells){
    const el=board.children[rr*SIZE+cc];
    if(el){el.classList.add('radar-contact');contactEls.push(el)}
  }
  clearTimeout(radar.timer);
  radar.timer=setTimeout(()=>{
    scanEls.forEach(el=>el.classList.remove('radar-scan'));
    contactEls.forEach(el=>el.classList.remove('radar-contact'));
  },2200);
  if(foundCells.length){
    const exact=foundCells.map(([rr,cc])=>coord(rr,cc)).join(', ');
    toast(`📡 ${from}–${to}: корабль обнаружен · ${exact}`);
  }else{
    toast(`📡 ${from}–${to}: кораблей нет`);
  }
  save();
}

async function finish(win){
  state.turn='done';try{localStorage.removeItem(LOCAL_KEY)}catch{};writeIndexedDB(null);
  const gameRecord={result:win?'win':'loss',difficulty:state.difficulty,hits:state.hits,misses:state.misses,sunk:state.sunk,duration_seconds:Math.max(0,Math.round((Date.now()-state.startedAt)/1000)),played_at:new Date().toISOString()};
  if(authToken?.startsWith('local:')){
    try{const users=JSON.parse(localStorage.getItem('oceanStrikeLocalUsers')||'{}');const k=(currentUser?.username||'').toLowerCase();if(users[k]){users[k].games=Array.isArray(users[k].games)?users[k].games:[];users[k].games.push(gameRecord);localStorage.setItem('oceanStrikeLocalUsers',JSON.stringify(users));}}catch{}
  }else if(authToken){try{await api('/api/games',{method:'POST',body:JSON.stringify(gameRecord)})}catch{}}
  $('gameScreen').classList.add('hidden');$('resultScreen').classList.remove('hidden');
  $('resultIcon').textContent=win?'🏆':'🌊';$('resultTitle').textContent=win?'Победа!':'Поражение';
  $('resultText').textContent=win?'Вы уничтожили весь флот противника. Результат сохранён в историю.':'Компьютер уничтожил ваш флот. Результат сохранён в историю.';
  $('finalStats').innerHTML=`<div><b>${state.hits}</b><span>попаданий</span></div><div><b>${state.misses}</b><span>промахов</span></div><div><b>${state.sunk}</b><span>потоплено</span></div>`;
  if(authToken)loadStats();
}
function start(){
  state=makeGame();
  $('homeScreen').classList.add('hidden');$('startScreen').classList.add('hidden');$('resultScreen').classList.add('hidden');$('gameScreen').classList.remove('hidden');
  updateUI();save();
}
function showStart(){ $('homeScreen').classList.add('hidden');$('startScreen').classList.remove('hidden');$('gameScreen').classList.add('hidden');$('resultScreen').classList.add('hidden') }
function showHome(){ $('homeScreen').classList.remove('hidden');$('startScreen').classList.add('hidden');$('gameScreen').classList.add('hidden');$('resultScreen').classList.add('hidden');refreshResumeButton() }
function setAuthUI(){
  $('authUser').innerHTML=currentUser?`👤 ${currentUser.username}${currentUser.email?`<small class="profile-email">${currentUser.email}</small>`:''}`:'Гость';
  $('loginBtn').textContent='Войти';
  $('loginBtn').classList.toggle('hidden',!!currentUser);
  $('profileBtn').classList.toggle('hidden',!currentUser);
  $('syncBadge').textContent=currentUser?'☁ Синхронизация включена':'Локальное сохранение';
  $('authHint').textContent=currentUser?`Вы вошли как ${currentUser.username}. Прогресс и история доступны на других устройствах после входа.`:'Войдите, чтобы сохранять прогресс, историю и статистику в базе данных.';
}
async function api(path,opts={}){
  const headers={'Content-Type':'application/json',...(opts.headers||{})};if(authToken)headers.Authorization=`Bearer ${authToken}`;
  const res=await fetch(path,{...opts,headers});let data=null;try{data=await res.json()}catch{}
  if(!res.ok)throw new Error(data?.error||'Ошибка сервера');return data;
}
async function localAuthStore(action, username, password, email){
  const key='oceanStrikeLocalUsers';
  const normalized=username.toLowerCase();
  try{
    const users=JSON.parse(localStorage.getItem(key)||'{}');
    if(action==='register'){
      if(users[normalized]) throw new Error('Такой логин уже занят');
      users[normalized]={username,password,email,games:[],createdAt:Date.now()};
      localStorage.setItem(key,JSON.stringify(users));
      return true;
    }
    const u=users[normalized];
    if(!u || u.password!==password) throw new Error('Неверный логин или пароль');
    return true;
  }catch(e){
    if(e.message==='Такой логин уже занят'||e.message==='Неверный логин или пароль') throw e;
    if(!('indexedDB' in window)) throw new Error('Браузер не разрешил локальное сохранение');
    const db=await new Promise((resolve,reject)=>{
      const req=indexedDB.open('OceanStrikeAuth',1);
      req.onupgradeneeded=()=>req.result.createObjectStore('users',{keyPath:'username'});
      req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
    });
    const tx=db.transaction('users',action==='register'?'readwrite':'readonly'), store=tx.objectStore('users');
    if(action==='register'){
      const exists=await new Promise((resolve,reject)=>{const r=store.get(normalized);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
      if(exists) throw new Error('Такой логин уже занят');
      await new Promise((resolve,reject)=>{const r=store.put({username:normalized,displayName:username,password,email,games:[]});r.onsuccess=resolve;r.onerror=()=>reject(r.error)});
    }else{
      const u=await new Promise((resolve,reject)=>{const r=store.get(normalized);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
      if(!u || u.password!==password) throw new Error('Неверный логин или пароль');
    }
    db.close(); return true;
  }
}

async function doAuth(mode){
  const username=$('authUsername').value.trim(),password=$('authPassword').value;
  const email=($('authEmail')?.value||'').trim().toLowerCase();
  const error=$('authError');
  if(error) error.textContent='';
  if(!/^[\p{L}\p{N}_-]{3,24}$/u.test(username)){if(error) error.textContent='Логин: 3–24 символа, только буквы, цифры, _ или -'; else toast('Логин: 3–24 символа, только буквы, цифры, _ или -');return}
  if(password.length<6){if(error) error.textContent='Пароль должен быть не короче 6 символов'; else toast('Пароль должен быть не короче 6 символов');return}
  if(mode==='register' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){if(error) error.textContent='Введите корректную электронную почту'; else toast('Введите корректную электронную почту');return}
  const localMode=location.protocol==='file:';
  try{
    if(localMode){
      await localAuthStore(mode==='register'?'register':'login',username,password,email);
      const localUsers=JSON.parse(localStorage.getItem('oceanStrikeLocalUsers')||'{}');
      const localRecord=localUsers[username.toLowerCase()];
      currentUser={id:'local-'+username.toLowerCase(),username,email:localRecord?.email||email,local:true};
      authToken='local:'+username.toLowerCase();
      localStorage.setItem('oceanStrikeToken',authToken);
      localStorage.setItem('oceanStrikeLocalUser',JSON.stringify(currentUser));
      closeAuth();setAuthUI();refreshResumeButton();toast(`Добро пожаловать, ${username}!`);
      return;
    }
    const data=await api(mode==='register'?'/api/register':'/api/login',{method:'POST',body:JSON.stringify(mode==='register'?{username,password,email}:{username,password})});
    authToken=data.token;currentUser=data.user;localStorage.setItem('oceanStrikeToken',authToken);localStorage.removeItem('oceanStrikeLocalUser');closeAuth();setAuthUI();toast(`Добро пожаловать, ${currentUser.username}!`);await loadCloudState();loadStats();
  }catch(e){
    const msg=e?.message||'Не удалось создать аккаунт';
    if(error) error.textContent=msg; else toast(msg);
  }
}

let authMode='login';
function setAuthMode(mode){
  authMode=mode;
  $('authError').textContent='';
  const register=mode==='register';
  $('authTitle').textContent=register?'Создать аккаунт':'Войти в игру';
  $('authDescription').textContent=register?'Придумайте логин, укажите электронную почту и пароль. После регистрации ваш прогресс, статистика и история будут привязаны к аккаунту.':'Уже есть аккаунт? Введите логин и пароль. Если аккаунта ещё нет — нажмите «Создать аккаунт».';
  $('authUsername').placeholder=register?'Придумайте логин':'Логин';
  $('authEmail').style.display=register?'':'none';
  $('authEmail').required=register;
  $('authPassword').placeholder=register?'Придумайте пароль':'Пароль';
  $('authPassword').autocomplete=register?'new-password':'current-password';
  $('authLogin').style.display=register?'none':'';
  // The registration action must remain available on the login screen for first-time users.
  $('authRegister').style.display='';
  $('authRegister').classList.toggle('primary-btn',register);
  $('authRegister').classList.toggle('ghost-btn',!register);
  $('authBack').style.display=register?'':'none';
}
function openAuth(mode='login'){if(currentUser){openProfile();return} setAuthMode(mode); $('authModal').classList.remove('hidden'); $('authUsername').focus()}
function closeAuth(){$('authModal').classList.add('hidden')}
async function logout(){try{await api('/api/logout',{method:'POST'})}catch{}authToken='';currentUser=null;localStorage.removeItem('oceanStrikeToken');$('profileModal').classList.add('hidden');setAuthUI();toast('Вы вышли из аккаунта')}
async function loadCloudState(){
  if(!authToken)return false;
  try{const data=await api('/api/progress');if(data.state){state=reviveState(data.state);refreshResumeButton();return true}return false}catch(e){toast('Не удалось загрузить облачный прогресс');return false}
}

async function loadStats(){
  if(!authToken)return;
  if(authToken.startsWith('local:')){
    try{
      const users=JSON.parse(localStorage.getItem('oceanStrikeLocalUsers')||'{}');
      const u=users[(currentUser?.username||'').toLowerCase()];
      const games=Array.isArray(u?.games)?u.games:[];
      const wins=games.filter(g=>g.result==='win').length, losses=games.filter(g=>g.result==='loss').length;
      $('profileStats').innerHTML=`<div><b>${games.length}</b><span>игр</span></div><div><b>${wins}</b><span>побед</span></div><div><b>${losses}</b><span>поражений</span></div>`;
      $('historyList').innerHTML=games.length?games.slice().reverse().slice(0,12).map(g=>`<div class="history-item"><span>${g.result==='win'?'🏆':'🌊'} ${g.result==='win'?'Победа':'Поражение'}</span><small>${String(g.difficulty||'normal').toUpperCase()} · ${g.hits||0} попаданий · ${new Date(g.played_at||Date.now()).toLocaleDateString('ru-RU')}</small></div>`).join(''):'<div class="history-empty">История пока пустая</div>';
    }catch{ $('profileStats').innerHTML=''; $('historyList').innerHTML='<div class="history-empty">Не удалось загрузить историю</div>'; }
    return;
  }
  try{const data=await api('/api/stats');
    $('profileStats').innerHTML=`<div><b>${data.stats.games}</b><span>игр</span></div><div><b>${data.stats.wins}</b><span>побед</span></div><div><b>${data.stats.losses}</b><span>поражений</span></div>`;
    $('historyList').innerHTML=data.recent.length?data.recent.map(g=>`<div class="history-item"><span>${g.result==='win'?'🏆':'🌊'} ${g.result==='win'?'Победа':'Поражение'}</span><small>${g.difficulty.toUpperCase()} · ${g.hits} попаданий · ${new Date(g.played_at.replace(' ','T')+'Z').toLocaleDateString('ru-RU')}</small></div>`).join(''):'<div class="history-empty">История пока пустая</div>';
  }catch{}
}
function openProfile(){if(!currentUser){openAuth();return}$('profileModal').classList.remove('hidden');loadStats()}

$('homePlayBtn').onclick=showStart;$('resumeBtn').onclick=async()=>{if(authToken){const ok=await loadCloudState();if(ok){$('homeScreen').classList.add('hidden');$('startScreen').classList.add('hidden');$('resultScreen').classList.add('hidden');$('gameScreen').classList.remove('hidden');updateUI();toast('☁ Игра продолжена')}}else{const saved=await loadLocal();if(saved){state=saved;$('homeScreen').classList.add('hidden');$('startScreen').classList.add('hidden');$('resultScreen').classList.add('hidden');$('gameScreen').classList.remove('hidden');updateUI();toast('▶ Игра продолжена')}else{toast('Сохранённой игры нет')}}};$('homeBtn').onclick=showHome;$('backHomeBtn').onclick=showHome;$('startBtn').onclick=start;$('playAgainBtn').onclick=start;$('newGameBtn').onclick=()=>{if(confirm('Начать новую игру?'))start()};$('radarBtn').onclick=radar;
$('randomBtn').onclick=()=>{if(state?.turn==='player'){state.player=placeFleet(emptyBoard());updateUI();save();toast('Флот переставлен')}};
$('rotateBtn').onclick=()=>toast('Автоматическая расстановка активна — используйте «Случайная расстановка»');
$('loginBtn').onclick=()=>openAuth('login');$('profileBtn').onclick=openProfile;$('authClose').onclick=closeAuth;$('authLogin').onclick=()=>doAuth('login');$('authRegister').onclick=()=>{if(authMode==='register')doAuth('register');else setAuthMode('register')};$('authBack').onclick=()=>setAuthMode('login');$('logoutBtn').onclick=logout;$('profileClose').onclick=()=>$('profileModal').classList.add('hidden');
$('authPassword').addEventListener('keydown',e=>{if(e.key==='Enter')doAuth(authMode)});
window.addEventListener('click',e=>{if(e.target===$('authModal'))closeAuth();if(e.target===$('profileModal'))$('profileModal').classList.add('hidden')});
window.addEventListener('load',async()=>{
  setAuthUI();
  refreshResumeButton();
  // Always open on the landing page. A saved game is offered through "Продолжить игру" instead of forcing the player directly into a match.
  showHome();
  if(authToken){
    if(authToken.startsWith('local:')){
      try{currentUser=JSON.parse(localStorage.getItem('oceanStrikeLocalUser')||'null'); if(currentUser){try{const us=JSON.parse(localStorage.getItem('oceanStrikeLocalUsers')||'{}');currentUser.email=us[currentUser.username.toLowerCase()]?.email||currentUser.email}catch{}}}catch{}
      setAuthUI();refreshResumeButton();
    }else{
      try{const me=await api('/api/me');currentUser=me.user;setAuthUI();await loadCloudState();refreshResumeButton();loadStats()}catch{authToken='';localStorage.removeItem('oceanStrikeToken');setAuthUI();refreshResumeButton()}}
  }
  if(!state){const local=await loadLocal();if(local){state=local;await refreshResumeButton()}}
});
