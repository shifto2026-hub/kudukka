// A 4-digit PIN that locks the app on this device.
// It protects the phone screen; the data itself is protected by sign-in and the Firestore rules.
const KEY = 'kudukka.pin';
const LOCK_AFTER_MS = 2 * 60 * 1000;

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}

async function hash(pin, salt) {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const hasPin = () => !!read();

export async function setPin(pin) {
  const salt = crypto.getRandomValues(new Uint32Array(2)).join('-');
  const record = { salt, hash: await hash(pin, salt) };
  try { localStorage.setItem(KEY, JSON.stringify(record)); } catch { /* storage blocked */ }
}

export async function checkPin(pin) {
  const r = read();
  if (!r) return true;
  return (await hash(pin, r.salt)) === r.hash;
}

export function clearPin() {
  try { localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}

// Calls onLock when the app comes back after being in the background for a while.
export function watchBackground(onLock) {
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS) onLock();
  });
}
