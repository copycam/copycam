// Helpers for keeping CopyCam on the phone's Home Screen (HomeScreen.jsx).

const TIP_DONE = 'copycam:home-tip';

export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return Boolean(window.navigator.standalone) || Boolean(window.matchMedia?.('(display-mode: standalone)').matches);
}

export const isIOS = () =>
  typeof navigator !== 'undefined' &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

// Chrome offers its own install prompt; keep it for the tip's button.
let installPrompt = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
  });
}

export async function promptInstall() {
  const p = installPrompt;
  installPrompt = null;
  if (!p) return;
  try {
    p.prompt();
    await p.userChoice;
  } catch {
    // dismissed
  }
}

export const canPromptInstall = () => Boolean(installPrompt);

export function shouldShowHomeTip() {
  if (isStandalone()) return false;
  try {
    return !localStorage.getItem(TIP_DONE);
  } catch {
    return false;
  }
}

export function markHomeTipDone() {
  try {
    localStorage.setItem(TIP_DONE, '1');
  } catch {
    // private mode: it may show again next time
  }
}

// The pairing link this page accepts, as the fragment to load it with:
// <origin>/p/#r=...&k=...
export function pairingHash(text, origin = typeof location !== 'undefined' ? location.origin : '') {
  try {
    const url = new URL(text);
    if (url.origin !== origin || url.pathname !== '/p/') return null;
    return /[#&]r=[A-Za-z0-9_-]+/.test(url.hash) && /[#&]k=[A-Za-z0-9_-]+/.test(url.hash) ? url.hash : null;
  } catch {
    return null;
  }
}
