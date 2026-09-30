/* JustUs — sirf hum dono ke liye 💞 */
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10);

/* ───────── helpers ───────── */
function show(id) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  $('#' + id).classList.add('active');
}
async function sha256(t) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

/* ───────── PIN lock ───────── */
const PIN_KEY = 'justus_pin_hash';
let pinBuf = '', pinMode = 'check', firstPin = '';
function paintPin() {
  $$('#pin-dots span').forEach((d, i) => d.classList.toggle('fill', i < pinBuf.length));
}
async function pinSubmit() {
  if (pinBuf.length !== 4) return;
  const h = await sha256('justus$' + pinBuf);
  const saved = localStorage.getItem(PIN_KEY);
  if (pinMode === 'set') {
    if (!firstPin) { firstPin = pinBuf; pinBuf = ''; paintPin();
      $('#lock-sub').textContent = 'dobara likho (confirm)'; return; }
    if (pinBuf === firstPin) {
      localStorage.setItem(PIN_KEY, h); enterApp();
    } else {
      firstPin = ''; pinBuf = ''; paintPin();
      $('#lock-sub').textContent = 'match nahi hua — dobara banao';
      $('#pin-dots').classList.add('shake');
      setTimeout(() => $('#pin-dots').classList.remove('shake'), 400);
    }
  } else {
    if (h === saved) enterApp();
    else {
      pinBuf = ''; paintPin();
      $('#pin-dots').classList.add('shake');
      setTimeout(() => $('#pin-dots').classList.remove('shake'), 400);
    }
  }
}
$('#pin-pad').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.fn === 'clear') pinBuf = pinBuf.slice(0, -1);
  else if (b.dataset.fn === 'ok') { pinSubmit(); return; }
  else if (pinBuf.length < 4) { pinBuf += b.textContent.trim(); if (pinBuf.length === 4) setTimeout(pinSubmit, 150); }
  paintPin();
});
function enterApp() { pinBuf = ''; paintPin(); show('screen-pair'); }
function lockNow() { pinMode = 'check'; $('#lock-sub').textContent = 'PIN likho'; show('screen-lock'); }
$('#btn-locknow').addEventListener('click', lockNow);
if (!localStorage.getItem(PIN_KEY)) { pinMode = 'set'; $('#lock-sub').textContent = 'apna secret PIN banao'; }

/* privacy veil — app chhupne par blur */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) $('#veil').classList.remove('hidden');
});
$('#veil').addEventListener('click', () => $('#veil').classList.add('hidden'));

/* ───────── PeerJS pairing ───────── */
let peer = null, conn = null, myCode = null, isHost = false, partnerPeerId = null;
let burnMs = 0, callObj = null, localStream = null, incomingCall = null, incomingVideo = true;

function peerError(msg) {
  const e = $('#pair-error'); e.textContent = msg; e.classList.remove('hidden');
  setTimeout(() => e.classList.add('hidden'), 4000);
}
function makePeer(id) {
  peer = new Peer(id, { debug: 0 });
  peer.on('open', () => {
    if (isHost) {
      $('#my-code-box').classList.remove('hidden');
      $('#my-code').textContent = myCode;
    }
  });
  peer.on('connection', c => attachConn(c));
  peer.on('call', onIncomingCall);
  peer.on('error', err => {
    if (err.type === 'peer-unavailable') peerError('partner online nahi — usne code banaya hai na? 🥺');
    else if (err.type === 'unavailable-id') peerError('ye code abhi use ho raha hai');
    else peerError('connection masla: ' + err.type);
  });
  peer.on('disconnected', () => peer.reconnect());
}
function attachConn(c) {
  conn = c;
  conn.on('open', () => {
    partnerPeerId = c.peer;
    setOnline(true);
    send({ t: 'hello' });
    show('screen-chat');
  });
  conn.on('data', onData);
  conn.on('close', () => setOnline(false));
  conn.on('error', () => setOnline(false));
}
function setOnline(on) {
  $('#online-dot').className = 'dot ' + (on ? 'online' : 'offline');
  $('#peer-status').textContent = on ? 'online 💚' : 'offline';
}
$('#btn-create').addEventListener('click', () => {
  myCode = Array.from({ length: 6 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('');
  isHost = true;
  makePeer('justus-' + myCode);
});
$('#btn-join').addEventListener('click', () => {
  const code = $('#join-code').value.trim().toUpperCase();
  if (code.length !== 6) return peerError('6 harf ka code likho');
  isHost = false; myCode = code;
  makePeer('justus-' + code + '-j' + uid().slice(0, 4));
  peer.on('open', () => {
    const c = peer.connect('justus-' + code, { reliable: true });
    attachConn(c);
  });
});

/* ───────── chat ───────── */
const imgBuffers = {}; // mid -> {chunks:[], n}
function send(o) { if (conn && conn.open) conn.send(o); }
function onData(d) {
  switch (d.t) {
    case 'hello': setOnline(true); break;
    case 'msg': addMsg('them', 'text', d.text, d.exp); break;
    case 'typing': $('#typing').classList.toggle('hidden', !d.on); break;
    case 'imgmeta': imgBuffers[d.mid] = { chunks: [], n: d.n }; break;
    case 'imgc': {
      const b = imgBuffers[d.mid]; if (!b) break;
      b.chunks[d.i] = d.chunk;
      if (b.chunks.filter(Boolean).length === b.n) {
        addMsg('them', 'img', b.chunks.join(''), 0);
        delete imgBuffers[d.mid];
      }
      break;
    }
    case 'burned': markBurned(d.mid); break;
  }
}
function addMsg(from, kind, content, expMs) {
  const box = $('#messages');
  const el = document.createElement('div');
  el.className = 'msg ' + (from === 'me' ? 'me' : 'them');
  const mid = uid();
  el.dataset.mid = mid;
  if (kind === 'text') {
    el.innerHTML = '';
    el.append(document.createTextNode(content));
    if (expMs > 0) {
      const tag = document.createElement('span');
      tag.className = 'burn-tag';
      tag.textContent = '🔥 ' + Math.round(expMs / 1000) + 's mein gayab';
      el.append(tag);
      el.dataset.exp = Date.now() + expMs;
    }
  } else {
    el.classList.add('msg-img');
    el.dataset.mid = mid;
    el.innerHTML = `<div class="viewonce-lock" data-act="view"><span class="big">📷</span><span>tap — ek dafa dekho 👀</span></div>`;
    el.dataset.full = content;
    el.querySelector('[data-act]').addEventListener('click', () => viewOnce(el, mid, from));
  }
  box.append(el);
  box.scrollTop = box.scrollHeight;
  return mid;
}
/* view-once photo */
function viewOnce(el, mid, from) {
  const lock = el.querySelector('.viewonce-lock'); if (!lock) return;
  const img = document.createElement('img');
  img.src = el.dataset.full;
  el.innerHTML = ''; el.append(img);
  setTimeout(() => {
    el.classList.add('burning');
    setTimeout(() => {
      el.innerHTML = '<span class="burned-note">🔥 photo jal gayi</span>';
      el.classList.remove('msg-img', 'burning');
    }, 500);
    if (from === 'them') send({ t: 'burned', mid: el.dataset.mid });
  }, 5000);
}
function markBurned() { /* sender-side note; receiver already burned */ }
/* disappearing sweep */
setInterval(() => {
  const now = Date.now();
  $$('#messages .msg[data-exp]').forEach(el => {
    if (+el.dataset.exp < now && !el.classList.contains('burning')) {
      el.classList.add('burning');
      setTimeout(() => el.remove(), 500);
      el.removeAttribute('data-exp');
    }
  });
}, 1000);
/* send text */
function sendText() {
  const inp = $('#msg-input');
  const v = inp.value.trim(); if (!v) return;
  addMsg('me', 'text', v, burnMs);
  send({ t: 'msg', text: v, exp: burnMs });
  inp.value = '';
  send({ t: 'typing', on: false });
}
$('#btn-send').addEventListener('click', sendText);
$('#msg-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendText(); });
let typingT = null;
$('#msg-input').addEventListener('input', () => {
  send({ t: 'typing', on: true });
  clearTimeout(typingT);
  typingT = setTimeout(() => send({ t: 'typing', on: false }), 1500);
});
/* burn timer */
$$('#burn-bar .burn-opts button').forEach(b => b.addEventListener('click', () => {
  $$('#burn-bar .burn-opts button').forEach(x => x.classList.remove('on'));
  b.classList.add('on');
  burnMs = +b.dataset.ms;
}));
/* send photo (compressed + chunked) */
$('#btn-img').addEventListener('click', () => $('#img-input').click());
$('#img-input').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const img = new Image();
  img.onload = () => {
    const max = 1280, sc = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = img.width * sc; c.height = img.height * sc;
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', 0.72);
    const mid = addMsg('me', 'img', url, 0);
    const CH = 16000, n = Math.ceil(url.length / CH);
    send({ t: 'imgmeta', mid, n });
    for (let i = 0; i < n; i++) send({ t: 'imgc', mid, i, n, chunk: url.slice(i * CH, (i + 1) * CH) });
    URL.revokeObjectURL(img.src);
  };
  img.src = URL.createObjectURL(f);
  e.target.value = '';
});

/* ───────── calls (WebRTC) ───────── */
function showCall(video) {
  show('screen-call');
  $('#remote-video').style.display = video ? 'block' : 'none';
  $('#voice-avatar').classList.toggle('hidden', video);
  $('#local-video').style.display = video ? 'block' : 'none';
  $('#call-status').textContent = 'connecting...';
}
async function startCall(video) {
  if (!partnerPeerId) return peerError('pehle partner connect karo');
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: video ? { facingMode: 'user' } : false, audio: true });
  } catch { return peerError('camera/mic ki ijazat do 🎥'); }
  showCall(video);
  $('#local-video').srcObject = localStream;
  callObj = peer.call(partnerPeerId, localStream, { metadata: { video } });
  wireCall(callObj, video);
}
function wireCall(call, video) {
  call.on('stream', rs => {
    // hidden video element bhi audio play karta hai (voice calls ke liye)
    $('#remote-video').srcObject = rs;
    $('#call-status').textContent = video ? '' : 'baat karo 💞';
    if (!video) $('#voice-label').textContent = 'connected 💞';
  });
  call.on('close', endCallUI);
  call.on('error', endCallUI);
}
function onIncomingCall(call) {
  incomingCall = call;
  incomingVideo = !(call.metadata && call.metadata.video === false);
  $('#inc-title').textContent = incomingVideo ? '🎥 video call aa rahi hai...' : '📞 voice call aa rahi hai...';
  $('#incoming').classList.remove('hidden');
}
$('#btn-accept').addEventListener('click', async () => {
  $('#incoming').classList.add('hidden');
  const video = incomingVideo;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: video ? { facingMode: 'user' } : false, audio: true });
  } catch { return; }
  showCall(video);
  $('#local-video').srcObject = localStream;
  incomingCall.answer(localStream);
  callObj = incomingCall;
  wireCall(callObj, video);
});
$('#btn-decline').addEventListener('click', () => {
  $('#incoming').classList.add('hidden');
  if (incomingCall) incomingCall.close();
  incomingCall = null;
});
function endCallUI() {
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  localStream = null; callObj = null;
  $('#remote-video').srcObject = null;
  show('screen-chat');
}
$('#btn-end').addEventListener('click', () => { if (callObj) callObj.close(); endCallUI(); });
let muted = false;
$('#btn-mute').addEventListener('click', function () {
  muted = !muted;
  if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = !muted);
  this.textContent = muted ? '🔇' : '🎤';
});
$('#btn-flip').addEventListener('click', async () => {
  if (!localStream) return;
  const vt = localStream.getVideoTracks()[0]; if (!vt) return;
  const cur = vt.getSettings().facingMode;
  vt.stop();
  try {
    const ns = await navigator.mediaDevices.getUserMedia({ video: { facingMode: cur === 'user' ? 'environment' : 'user' }, audio: false });
    const nv = ns.getVideoTracks()[0];
    localStream.removeTrack(vt); localStream.addTrack(nv);
    $('#local-video').srcObject = localStream;
    if (callObj && callObj.peerConnection) {
      const sender = callObj.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(nv);
    }
  } catch { /* ignore */ }
});
$('#btn-voice').addEventListener('click', () => startCall(false));
$('#btn-video').addEventListener('click', () => startCall(true));

/* service worker (PWA install) */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
