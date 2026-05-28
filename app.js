'use strict';

const firebaseConfig = {
  apiKey:"AIzaSyC5n6GlLjEUFbKXLVHB_J6ZFHqAevkmg-U",
  authDomain:"sandeshtalk.firebaseapp.com",
  projectId:"sandeshtalk",
  storageBucket:"sandeshtalk.firebasestorage.app",
  messagingSenderId:"624752270762",
  appId:"1:624752270762:web:2db73d47e5e00f9dc95fd3"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

/* Unicode glyphs — same as your single-player chess */
const GLYPH = {
  wK:'♔', wQ:'♕', wR:'♖', wB:'♗', wN:'♘', wP:'♙',
  bK:'♚', bQ:'♛', bR:'♜', bB:'♝', bN:'♞', bP:'♟'
};

const S = {
  user:null, username:'',
  roomId:null, roomCode:null,
  myColor:null,
  opponentId:null, opponentName:'',
  chess:null,
  flipped:false,
  gameOver:false, drawOffered:false,
  localMoveCount:0,
  selectedSq:null, legalTargets:[],
  lastFrom:null, lastTo:null,
  pendingPromo:null,
  unsubRoom:null, unsubMsgs:null, unsubSig:null,
  localStream:null, pc:null,
  isMuted:false, voiceOn:false,
  typingTimer:null,
  selectedColor:'white',
  gameStarted:false
};

const $  = id => document.getElementById(id);
const el = (tag,cls,txt) => {
  const e = document.createElement(tag);
  if(cls) e.className=cls;
  if(txt!==undefined) e.textContent=txt;
  return e;
};

function showScreen(name){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  $(name+'-screen').classList.add('active');
}

let _tt;
function toast(msg,type=''){
  const t=$('toast');
  t.textContent=msg; t.className='toast '+type;
  clearTimeout(_tt);
  _tt=setTimeout(()=>t.classList.add('hidden'),3000);
}

/* AUTH */
document.querySelectorAll('.atab').forEach(b=>{
  b.addEventListener('click',()=>{
    document.querySelectorAll('.atab').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.atab-body').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    $(b.dataset.tab+'-tab').classList.add('active');
  });
});

$('signup-btn').addEventListener('click',async()=>{
  const u=$('signup-username').value.trim();
  const e=$('signup-email').value.trim();
  const p=$('signup-password').value;
  $('signup-error').textContent='';
  if(u.length<3){$('signup-error').textContent='Username needs at least 3 chars.';return;}
  if(!e||!p){$('signup-error').textContent='Fill in all fields.';return;}
  try{
    $('signup-btn').textContent='Creating…';
    const c=await auth.createUserWithEmailAndPassword(e,p);
    await db.collection('users').doc(c.user.uid).set({username:u,email:e,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
  }catch(err){$('signup-error').textContent=err.message;$('signup-btn').textContent='Create Account';}
});

$('login-btn').addEventListener('click',async()=>{
  const e=$('login-email').value.trim();
  const p=$('login-password').value;
  $('login-error').textContent='';
  if(!e||!p){$('login-error').textContent='Enter email and password.';return;}
  try{
    $('login-btn').textContent='Signing in…';
    await auth.signInWithEmailAndPassword(e,p);
  }catch(err){$('login-error').textContent=err.message;$('login-btn').textContent='Sign In';}
});

$('logout-btn').addEventListener('click',()=>auth.signOut());

auth.onAuthStateChanged(async user=>{
  if(user){
    S.user=user;
    const snap=await db.collection('users').doc(user.uid).get();
    S.username=snap.exists?snap.data().username:user.email.split('@')[0];
    $('nav-username').textContent=S.username;
    showScreen('lobby');
  }else{
    S.user=null;
    cleanupGame();
    showScreen('auth');
  }
});

/* LOBBY COLOR PICKER */
document.querySelectorAll('.cpick').forEach(b=>{
  b.addEventListener('click',()=>{
    document.querySelectorAll('.cpick').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    S.selectedColor=b.dataset.color;
  });
});

/* CREATE ROOM */
$('create-room-btn').addEventListener('click',async()=>{
  $('create-room-btn').disabled=true;
  $('create-room-btn').textContent='Creating…';
  let color=S.selectedColor;
  if(color==='random') color=Math.random()<.5?'white':'black';
  const code=mkCode();
  const roomRef=db.collection('rooms').doc();
  await roomRef.set({
    code, createdBy:S.user.uid, creatorName:S.username, creatorColor:color,
    opponent:null, opponentName:null, status:'waiting',
    fen:'start', moves:[], moveCount:0, turn:'w',
    lastMove:null, drawOffer:null, result:null, typing:{},
    whiteOnline:true, blackOnline:false,
    createdAt:firebase.firestore.FieldValue.serverTimestamp()
  });
  S.roomId=roomRef.id; S.roomCode=code; S.myColor=color; S.localMoveCount=0;
  $('created-room-code').textContent=code;
  $('room-created-info').classList.remove('hidden');
  $('create-room-btn').textContent='Room Created';
  const unsub=db.collection('rooms').doc(roomRef.id).onSnapshot(snap=>{
    const d=snap.data();
    if(d&&d.status==='playing'){
      unsub();
      S.opponentId=d.opponent; S.opponentName=d.opponentName;
      enterGame();
    }
  });
});

$('copy-code-btn').addEventListener('click',()=>{
  navigator.clipboard.writeText($('created-room-code').textContent).catch(()=>{});
  toast('Code copied!','ok');
});

/* JOIN ROOM */
$('join-room-btn').addEventListener('click',async()=>{
  const code=$('join-code').value.trim().toUpperCase();
  $('join-error').textContent='';
  if(code.length!==6){$('join-error').textContent='Enter a 6-character code.';return;}
  $('join-room-btn').disabled=true; $('join-room-btn').textContent='Joining…';
  try{
    const snap=await db.collection('rooms').where('code','==',code).where('status','==','waiting').limit(1).get();
    if(snap.empty){$('join-error').textContent='Room not found or already started.';$('join-room-btn').disabled=false;$('join-room-btn').textContent='Join Game';return;}
    const doc=snap.docs[0]; const d=doc.data();
    if(d.createdBy===S.user.uid){$('join-error').textContent="Can't join your own room.";$('join-room-btn').disabled=false;$('join-room-btn').textContent='Join Game';return;}
    const joinerColor=d.creatorColor==='white'?'black':'white';
    S.roomId=doc.id; S.roomCode=code; S.myColor=joinerColor;
    S.opponentId=d.createdBy; S.opponentName=d.creatorName; S.localMoveCount=0;
    const jField=joinerColor==='white'?'whiteOnline':'blackOnline';
    await db.collection('rooms').doc(doc.id).update({
      opponent:S.user.uid, opponentName:S.username, [jField]:true, status:'playing'
    });
    enterGame();
  }catch(err){$('join-error').textContent=err.message;$('join-room-btn').disabled=false;$('join-room-btn').textContent='Join Game';}
});

/* ENTER GAME */
function enterGame(){
  $('chat-msgs').innerHTML=''; $('move-list').innerHTML=''; $('move-empty').style.display='';
  hideCover();
  showScreen('game');
  $('topbar-room-code').textContent=S.roomCode;
  $('my-name').textContent=S.username;
  $('opp-name').textContent=S.opponentName||'Opponent';
  $('my-dot').className='pcolor-dot '+S.myColor;
  $('opp-dot').className='pcolor-dot '+(S.myColor==='white'?'black':'white');
  S.chess=new Chess();
  S.gameOver=false; S.flipped=(S.myColor==='black');
  S.selectedSq=null; S.legalTargets=[];
  S.lastFrom=null; S.lastTo=null;
  S.gameStarted=true; S.localMoveCount=0;
  $('game-status-bar').textContent="White's turn";
  setTimeout(()=>{
    renderBoard();
    listenRoom();
    listenMsgs();
    listenTyping();
    setMyOnline(true);
    addSysMsg('Game started! '+S.username+' plays '+S.myColor+'.');
  },50);
}

/* RENDER BOARD — pure DOM, Unicode glyphs, no images */
function renderBoard(){
  const boardEl=$('chess-board');
  if(!boardEl||!S.chess) return;
  boardEl.innerHTML='';

  const pos=S.chess.board();
  const files=['a','b','c','d','e','f','g','h'];
  const ranks=[8,7,6,5,4,3,2,1];

  for(let ri=0;ri<8;ri++){
    for(let ci=0;ci<8;ci++){
      const r=S.flipped?7-ri:ri;
      const c=S.flipped?7-ci:ci;
      const sq=files[c]+ranks[r];
      const isLight=(r+c)%2===0;

      const cell=document.createElement('div');
      cell.className='cb-cell '+(isLight?'light':'dark');
      cell.dataset.sq=sq;

      if(S.selectedSq===sq) cell.classList.add('selected');
      if(S.legalTargets.includes(sq)) cell.classList.add('movable');
      if(S.lastFrom===sq) cell.classList.add('last-from');
      if(S.lastTo===sq) cell.classList.add('last-to');

      const piece=pos[r][c];
      if(piece){
        const key=(piece.color==='w'?'w':'b')+piece.type.toUpperCase();
        const p=document.createElement('div');
        p.className='cb-piece '+(piece.color==='w'?'wp':'bp');
        p.textContent=GLYPH[key]||'';
        cell.appendChild(p);
      }

      if(ci===0){
        const rank=document.createElement('div');
        rank.className='cb-coord-rank';
        rank.textContent=ranks[r];
        cell.appendChild(rank);
      }
      if(ri===7){
        const file=document.createElement('div');
        file.className='cb-coord-file';
        file.textContent=files[c];
        cell.appendChild(file);
      }

      cell.addEventListener('click',()=>onCellClick(sq));
      boardEl.appendChild(cell);
    }
  }
}

/* CELL CLICK */
function onCellClick(sq){
  if(!S.chess||S.gameOver) return;
  const turn=S.chess.turn();
  if(S.myColor==='white'&&turn!=='w') return;
  if(S.myColor==='black'&&turn!=='b') return;

  if(S.selectedSq){
    if(S.legalTargets.includes(sq)){
      doMove(S.selectedSq,sq);
    } else {
      const piece=S.chess.get(sq);
      if(piece&&piece.color===turn){
        S.selectedSq=sq;
        S.legalTargets=S.chess.moves({square:sq,verbose:true}).map(m=>m.to);
      } else {
        S.selectedSq=null; S.legalTargets=[];
      }
      renderBoard();
    }
  } else {
    const piece=S.chess.get(sq);
    if(piece&&piece.color===turn){
      S.selectedSq=sq;
      S.legalTargets=S.chess.moves({square:sq,verbose:true}).map(m=>m.to);
      renderBoard();
    }
  }
}

/* DO MOVE — handles promotion */
function doMove(from,to){
  const moves=S.chess.moves({square:from,verbose:true}).filter(m=>m.to===to);
  if(!moves.length) return;
  const needPromo=moves[0].flags.includes('p');
  if(needPromo){
    S.pendingPromo={from,to};
    showPromoModal();
    return;
  }
  const move=S.chess.move({from,to,promotion:'q'});
  if(!move) return;
  S.selectedSq=null; S.legalTargets=[];
  S.lastFrom=from; S.lastTo=to;
  S.localMoveCount=S.chess.history().length;
  pushMove();
}

function showPromoModal(){
  const row=$('promo-row');
  row.innerHTML='';
  const color=S.myColor==='white'?'w':'b';
  ['Q','R','B','N'].forEach(t=>{
    const d=document.createElement('div');
    d.className='promo-piece';
    d.textContent=GLYPH[color+t];
    d.addEventListener('click',()=>{
      $('promo-modal').classList.add('hidden');
      if(!S.pendingPromo) return;
      const {from,to}=S.pendingPromo;
      S.pendingPromo=null;
      const move=S.chess.move({from,to,promotion:t.toLowerCase()});
      if(!move) return;
      S.selectedSq=null; S.legalTargets=[];
      S.lastFrom=from; S.lastTo=to;
      S.localMoveCount=S.chess.history().length;
      pushMove();
    });
    row.appendChild(d);
  });
  $('promo-modal').classList.remove('hidden');
}

/* PUSH MOVE TO FIRESTORE */
function pushMove(){
  if(!S.roomId||!S.chess) return;
  const fen=S.chess.fen();
  const moves=S.chess.history();
  db.collection('rooms').doc(S.roomId).update({
    fen, moves, moveCount:moves.length, turn:S.chess.turn(),
    lastMove:{from:S.lastFrom,to:S.lastTo,by:S.user.uid},
    lastMoveAt:firebase.firestore.FieldValue.serverTimestamp()
  });
  afterMove(moves);
}

/* AFTER MOVE */
function afterMove(moves){
  renderBoard();
  updateMoveList(moves);
  updateCaptures();
  updateStatusBar();
  checkEnd();
}

/* FIRESTORE ROOM LISTENER */
function listenRoom(){
  if(S.unsubRoom){S.unsubRoom();S.unsubRoom=null;}
  S.unsubRoom=db.collection('rooms').doc(S.roomId).onSnapshot(snap=>{
    if(!snap.exists) return;
    const d=snap.data();

    const rc=d.moveCount||0;
    const isRemote=d.lastMove&&d.lastMove.by!==S.user.uid;
    if(isRemote&&rc>S.localMoveCount){
      // Replay moves from scratch — chess.load() wipes history and breaks turn tracking
      // Replaying via chess.move() keeps turn(), in_check(), history() all correct
      const allMoves=d.moves||[];
      const tmp=new Chess();
      let replayOk=true;
      for(const san of allMoves){
        if(!tmp.move(san)){replayOk=false;break;}
      }
      if(replayOk){
        S.chess=tmp;
        S.localMoveCount=rc;
        S.lastFrom=d.lastMove.from;
        S.lastTo=d.lastMove.to;
        S.selectedSq=null;
        S.legalTargets=[];
        afterMove(allMoves);
      }
    }

    if(!S.gameOver) updateStatusBar();

    const oppColor=S.myColor==='white'?'black':'white';
    const oppField=oppColor==='white'?'whiteOnline':'blackOnline';
    const online=d[oppField]===true;
    const connEl=$('opp-conn');
    connEl.textContent=online?'● online':'● offline';
    connEl.className='pconn'+(online?' online':'');

    if(d.drawOffer&&d.drawOffer!==S.user.uid&&!S.drawOffered){
      S.drawOffered=true;
      $('draw-msg').textContent=(S.opponentName||'Opponent')+' offers a draw.';
      $('draw-modal').classList.remove('hidden');
    }
    if(!d.drawOffer){S.drawOffered=false;$('draw-modal').classList.add('hidden');}

    if(d.status==='finished'&&!S.gameOver){
      S.gameOver=true;
      let msg='Game over.';
      if(d.result==='draw') msg='½ Draw agreed.';
      else if(d.result===S.myColor) msg='You win!';
      else if(d.result) msg='You lost.';
      showCover(msg);
      $('game-status-bar').textContent=msg;
    }
  });
}

/* MOVE LIST */
function updateMoveList(moves){
  const ml=$('move-list');
  const emp=$('move-empty');
  ml.innerHTML='';
  if(!moves||!moves.length){emp.style.display='';return;}
  emp.style.display='none';
  for(let i=0;i<moves.length;i+=2){
    const row=el('div','mrow');
    row.appendChild(el('span','mn',(i/2+1)+'.'));
    row.appendChild(el('span','mw'+(i===moves.length-1?' mcur':''),moves[i]));
    if(moves[i+1]!==undefined)
      row.appendChild(el('span','mb'+(i+1===moves.length-1?' mcur':''),moves[i+1]));
    ml.appendChild(row);
  }
  ml.scrollTop=ml.scrollHeight;
}

function updateStatusBar(){
  if(!S.chess||S.gameOver) return;
  const t=S.chess.turn();
  let msg=(t==='w'?'White':'Black')+"'s turn";
  if(S.chess.in_check()) msg='⚠ '+(t==='w'?'White':'Black')+' is in check!';
  $('game-status-bar').textContent=msg;
}

/* CAPTURED PIECES */
const PU={wp:'♙',wn:'♘',wb:'♗',wr:'♖',wq:'♕',bp:'♟',bn:'♞',bb:'♝',br:'♜',bq:'♛'};
function updateCaptures(){
  if(!S.chess) return;
  const hist=S.chess.history({verbose:true});
  const wCap=[],bCap=[];
  hist.forEach(m=>{
    if(m.captured){
      if(m.color==='w') wCap.push({c:'b',t:m.captured});
      else bCap.push({c:'w',t:m.captured});
    }
  });
  const mine=S.myColor==='white'?wCap:bCap;
  const opp =S.myColor==='white'?bCap:wCap;
  $('cap-me').innerHTML =mine.map(p=>'<span>'+(PU[p.c+p.t]||'')+'</span>').join('');
  $('cap-opp').innerHTML=opp.map(p =>'<span>'+(PU[p.c+p.t]||'')+'</span>').join('');
}

/* GAME END */
function checkEnd(){
  if(!S.chess||!S.chess.game_over()||S.gameOver) return;
  S.gameOver=true;
  let msg='½ Draw', result='draw';
  if(S.chess.in_checkmate()){
    const w=S.chess.turn()==='w'?'Black':'White';
    msg=w+' wins by checkmate!'; result=w.toLowerCase();
  } else if(S.chess.in_stalemate()) msg='½ Stalemate';
  else if(S.chess.in_threefold_repetition()) msg='½ Draw by repetition';
  else if(S.chess.insufficient_material()) msg='½ Insufficient material';
  showCover(msg);
  $('game-status-bar').textContent=msg;
  db.collection('rooms').doc(S.roomId).update({status:'finished',result});
}

function showCover(msg){
  let cover=$('board-cover');
  if(!cover){
    cover=document.createElement('div');
    cover.id='board-cover';
    cover.className='board-cover';
    const msgDiv=document.createElement('div');
    msgDiv.className='cover-msg';
    cover.appendChild(msgDiv);
    $('board-outer')&&$('board-outer').appendChild(cover);
    const bo=document.querySelector('.board-outer');
    if(bo) bo.appendChild(cover);
  }
  cover.querySelector('.cover-msg').textContent=msg;
  cover.classList.add('show');
}

function hideCover(){
  const c=$('board-cover');
  if(c) c.classList.remove('show');
}

/* GAME BUTTONS */
$('flip-btn').addEventListener('click',()=>{
  S.flipped=!S.flipped;
  renderBoard();
});

$('share-btn').addEventListener('click',()=>{
  navigator.clipboard.writeText(S.roomCode||'').catch(()=>{});
  toast('Room code '+S.roomCode+' copied!','ok');
});

$('resign-btn').addEventListener('click',async()=>{
  if(S.gameOver) return;
  if(!confirm('Really resign?')) return;
  S.gameOver=true;
  const winner=S.myColor==='white'?'black':'white';
  showCover('You resigned.');
  $('game-status-bar').textContent='You resigned.';
  addSysMsg(S.username+' resigned.');
  await db.collection('rooms').doc(S.roomId).update({status:'finished',result:winner});
});

$('draw-btn').addEventListener('click',async()=>{
  if(S.gameOver) return;
  await db.collection('rooms').doc(S.roomId).update({drawOffer:S.user.uid});
  toast('Draw offer sent.','');
});

$('accept-draw').addEventListener('click',async()=>{
  S.gameOver=true;
  $('draw-modal').classList.add('hidden');
  showCover('½ Draw by agreement.');
  addSysMsg('Players agreed to a draw.');
  await db.collection('rooms').doc(S.roomId).update({status:'finished',result:'draw',drawOffer:null});
});

$('decline-draw').addEventListener('click',async()=>{
  S.drawOffered=false;
  $('draw-modal').classList.add('hidden');
  await db.collection('rooms').doc(S.roomId).update({drawOffer:null});
  toast('Draw declined.','');
});

$('leave-game-btn').addEventListener('click',()=>{
  if(!confirm('Leave this game?')) return;
  setMyOnline(false);
  cleanupGame();
  resetLobbyUI();
  showScreen('lobby');
});

/* SIDEBAR TABS */
document.querySelectorAll('.stab').forEach(b=>{
  b.addEventListener('click',()=>{
    document.querySelectorAll('.stab').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.spanel').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    $('panel-'+b.dataset.panel).classList.add('active');
    if(b.dataset.panel==='chat') $('chat-msgs').scrollTop=$('chat-msgs').scrollHeight;
  });
});

/* CHAT */
function listenMsgs(){
  if(S.unsubMsgs){S.unsubMsgs();S.unsubMsgs=null;}
  S.unsubMsgs=db.collection('rooms').doc(S.roomId)
    .collection('messages').orderBy('createdAt','asc')
    .onSnapshot(snap=>{snap.docChanges().forEach(ch=>{if(ch.type==='added')renderMsg(ch.doc.data());});});
}

function renderMsg(d){
  const box=$('chat-msgs');
  const div=el('div','cmsg');
  if(d.type==='system'){
    div.classList.add('sys');
    div.appendChild(el('div','cbubble',d.text));
  } else {
    div.classList.add(d.uid===S.user.uid?'me':'them');
    const meta=el('div','cmeta');
    meta.appendChild(el('span','cauthor',d.username||'?'));
    meta.appendChild(el('span','ctime',fmtTime(d.createdAt)));
    div.appendChild(meta);
    div.appendChild(el('div','cbubble',sanitize(d.text)));
  }
  box.appendChild(div);
  box.scrollTop=box.scrollHeight;
}

function fmtTime(ts){
  if(!ts) return '';
  const d=ts.toDate?ts.toDate():new Date(ts);
  return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
}
function sanitize(s){const d=document.createElement('div');d.textContent=s;return d.textContent;}

const EMOJIS={':)':'😊',':(':'😢',':D':'😄',';)':'😉',':p':'😛','<3':'❤️',':o':'😮','>:(':'😠',':+1:':'👍',':-1:':'👎',':gg:':'🎉',':chess:':'♟️',':fire:':'🔥'};
function replEmoji(t){let r=t;for(const[c,e]of Object.entries(EMOJIS))r=r.split(c).join(e);return r;}

function sendMsg(){
  const inp=$('chat-input');
  let txt=inp.value.trim();
  if(!txt||!S.roomId) return;
  txt=replEmoji(txt).substring(0,200);
  inp.value=''; clearTypingStatus();
  db.collection('rooms').doc(S.roomId).collection('messages').add({
    uid:S.user.uid,username:S.username,text:txt,
    createdAt:firebase.firestore.FieldValue.serverTimestamp()
  });
}
$('send-btn').addEventListener('click',sendMsg);
$('chat-input').addEventListener('keydown',e=>{if(e.key==='Enter')sendMsg();else startTyping();});

function startTyping(){
  if(!S.roomId) return;
  clearTimeout(S.typingTimer);
  db.collection('rooms').doc(S.roomId).update({['typing.'+S.user.uid]:S.username}).catch(()=>{});
  S.typingTimer=setTimeout(clearTypingStatus,2200);
}
function clearTypingStatus(){
  if(!S.roomId) return;
  db.collection('rooms').doc(S.roomId).update({['typing.'+S.user.uid]:firebase.firestore.FieldValue.delete()}).catch(()=>{});
}

function listenTyping(){
  db.collection('rooms').doc(S.roomId).onSnapshot(snap=>{
    if(!snap.exists) return;
    const typing=(snap.data()||{}).typing||{};
    const others=Object.entries(typing).filter(([u])=>u!==S.user.uid).map(([,n])=>n);
    const ind=$('typing-ind');
    if(others.length){ind.textContent=others.join(', ')+' is typing…';ind.classList.remove('hidden');}
    else ind.classList.add('hidden');
  });
}

function addSysMsg(text){
  if(!S.roomId) return;
  db.collection('rooms').doc(S.roomId).collection('messages').add({
    type:'system',text,createdAt:firebase.firestore.FieldValue.serverTimestamp()
  }).catch(()=>{});
}

/* PRESENCE */
function setMyOnline(online){
  if(!S.roomId||!S.myColor) return;
  const f=S.myColor==='white'?'whiteOnline':'blackOnline';
  db.collection('rooms').doc(S.roomId).update({[f]:online}).catch(()=>{});
}
window.addEventListener('beforeunload',()=>setMyOnline(false));

/* WEBRTC VOICE */
const ICE={iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]};

$('mic-btn').addEventListener('click',async()=>{
  if(S.voiceOn) return;
  try{
    S.localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
    S.voiceOn=true;
    $('mic-btn').textContent='🎤 Mic On'; $('mic-btn').classList.add('on');
    $('mute-btn').classList.remove('hidden');
    $('voice-emoji').classList.add('pulse');
    $('voice-title').textContent='Mic Active';
    $('voice-sub').textContent='Your mic is live';
    updateVPeers();
    await startRTC();
  }catch(e){toast('Mic error: '+e.message,'bad');}
});

$('mute-btn').addEventListener('click',()=>{
  if(!S.localStream) return;
  S.isMuted=!S.isMuted;
  S.localStream.getAudioTracks().forEach(t=>{t.enabled=!S.isMuted;});
  $('mute-btn').textContent=S.isMuted?'🎙 Unmute':'🔇 Mute';
  $('mute-btn').classList.toggle('muted',S.isMuted);
  $('voice-emoji').classList.toggle('pulse',!S.isMuted);
  updateVPeers();
});

async function startRTC(){
  const caller=S.myColor==='white';
  const sig=db.collection('rooms').doc(S.roomId).collection('signaling');
  S.pc=new RTCPeerConnection(ICE);
  S.localStream.getTracks().forEach(t=>S.pc.addTrack(t,S.localStream));
  S.pc.ontrack=e=>{
    const a=$('remote-audio');
    if(a.srcObject!==e.streams[0]) a.srcObject=e.streams[0];
    $('voice-sub').textContent='🟢 Connected'; updateVPeers();
  };
  S.pc.onicecandidate=async e=>{
    if(e.candidate) await sig.add({from:S.myColor,type:'ice',candidate:e.candidate.toJSON(),ts:firebase.firestore.FieldValue.serverTimestamp()});
  };
  S.pc.onconnectionstatechange=()=>{
    $('voice-sub').textContent=S.pc.connectionState==='connected'?'🟢 Connected':'⬤ '+S.pc.connectionState;
    updateVPeers();
  };
  if(caller){
    const offer=await S.pc.createOffer();
    await S.pc.setLocalDescription(offer);
    await sig.add({from:'white',type:'offer',sdp:offer.sdp,ts:firebase.firestore.FieldValue.serverTimestamp()});
  }
  listenSig();
}

function listenSig(){
  if(S.unsubSig) return;
  const sig=db.collection('rooms').doc(S.roomId).collection('signaling');
  S.unsubSig=sig.orderBy('ts','asc').onSnapshot(async snap=>{
    for(const ch of snap.docChanges()){
      if(ch.type!=='added') continue;
      const d=ch.doc.data();
      if(!d.type||d.from===S.myColor||!S.pc) continue;
      try{
        if(d.type==='offer'){
          await S.pc.setRemoteDescription({type:'offer',sdp:d.sdp});
          const ans=await S.pc.createAnswer();
          await S.pc.setLocalDescription(ans);
          await db.collection('rooms').doc(S.roomId).collection('signaling').add({from:S.myColor,type:'answer',sdp:ans.sdp,ts:firebase.firestore.FieldValue.serverTimestamp()});
        } else if(d.type==='answer'&&S.pc.signalingState!=='stable'){
          await S.pc.setRemoteDescription({type:'answer',sdp:d.sdp});
        } else if(d.type==='ice'){
          await S.pc.addIceCandidate(new RTCIceCandidate(d.candidate));
        }
      }catch(e){console.warn('RTC:',e);}
    }
  });
}

function updateVPeers(){
  const p=$('voice-peers'); p.innerHTML='';
  const add=(name,cls)=>{
    const r=el('div','vpeer');
    r.appendChild(el('span','vdot '+cls));
    r.appendChild(el('span','',name));
    p.appendChild(r);
  };
  if(S.voiceOn) add(S.username+' (You)',S.isMuted?'muted':'speaking');
  if(S.opponentName){const cs=S.pc?S.pc.connectionState:'';add(S.opponentName,cs==='connected'?'speaking':'idle');}
}

/* CLEANUP */
function cleanupGame(){
  if(S.unsubRoom){S.unsubRoom();S.unsubRoom=null;}
  if(S.unsubMsgs){S.unsubMsgs();S.unsubMsgs=null;}
  if(S.unsubSig){S.unsubSig();S.unsubSig=null;}
  if(S.pc){S.pc.close();S.pc=null;}
  if(S.localStream){S.localStream.getTracks().forEach(t=>t.stop());S.localStream=null;}
  const a=$('remote-audio');if(a) a.srcObject=null;
  S.roomId=null;S.roomCode=null;S.myColor=null;
  S.opponentId=null;S.opponentName='';
  S.chess=null;S.gameOver=false;S.drawOffered=false;
  S.voiceOn=false;S.isMuted=false;S.localMoveCount=0;
  S.selectedSq=null;S.legalTargets=[];S.lastFrom=null;S.lastTo=null;
  S.gameStarted=false;
}

function resetLobbyUI(){
  $('room-created-info').classList.add('hidden');
  $('create-room-btn').disabled=false;$('create-room-btn').textContent='Create Room';
  $('join-room-btn').disabled=false;$('join-room-btn').textContent='Join Game';
  $('join-code').value='';$('join-error').textContent='';
  $('chat-msgs').innerHTML='';$('move-list').innerHTML='';$('voice-peers').innerHTML='';
  $('mic-btn').textContent='🎤 Enable Mic';$('mic-btn').classList.remove('on');
  $('mute-btn').classList.add('hidden');
  $('voice-emoji').classList.remove('pulse');
  $('move-empty').style.display='';
}

function mkCode(){
  const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let r='';for(let i=0;i<6;i++)r+=c[Math.floor(Math.random()*c.length)];return r;
}

window.addEventListener('resize',()=>renderBoard());
