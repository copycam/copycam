import { runPhoneTest, readLink } from './lab.js';

// copycam.app/p/lab: the phone side of the lab.
const STORE = 'copycam:lab-phone';
const $ = (id) => document.getElementById(id);
const log = (line) => {
  $('log').textContent += `${new Date().toLocaleTimeString()}  ${line}\n`;
};

let link = readLink(location.hash);
if (link) {
  try {
    localStorage.setItem(STORE, JSON.stringify({ r: link.room, k: link.k }));
  } catch {
    // this visit only
  }
  history.replaceState(null, '', location.pathname);
} else {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (s) link = readLink(`#r=${s.r}&k=${s.k}`);
  } catch {
    link = null;
  }
}
if (link) {
  $('paired').textContent = 'Paired with a lab computer. Keep the lab page (or script) open there.';
  $('run').disabled = false;
}

$('run').addEventListener('click', async () => {
  $('run').disabled = true;
  $('copy').disabled = true;
  $('result').textContent = 'Running…';
  let stream = null;
  const r = { camera: $('camera').checked };
  try {
    if (r.camera) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        $('video').srcObject = stream;
        $('video').play().catch(() => {});
        log('camera on');
      } catch (e) {
        r.camera = `refused (${e.name})`;
        log(`camera: ${e.name}`);
      }
    }
    const relayUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
    Object.assign(r, await runPhoneTest({ room: link.room, key: link.key, relayUrl, log }));
  } catch (e) {
    r.error = e.message;
    log(`stopped: ${e.message}`);
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
    $('run').disabled = false;
  }
  $('result').textContent = JSON.stringify(r, null, 1);
  $('copy').disabled = false;
});

$('copy').addEventListener('click', async () => {
  const text = $('result').textContent;
  try {
    await navigator.clipboard.writeText(text);
    $('copy').textContent = 'Copied';
  } catch {
    const range = document.createRange();
    range.selectNodeContents($('result'));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    $('copy').textContent = 'Selected: copy it';
  }
});
