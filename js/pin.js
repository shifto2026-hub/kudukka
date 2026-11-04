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

// ---------- Face ID / Touch ID ----------
// Uses a device passkey (WebAuthn) purely as a screen lock: if the phone confirms the face,
// Kudukka unlocks. The PIN stays as the backup.
const BIO_KEY = 'kudukka.bio';
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const random = (n) => crypto.getRandomValues(new Uint8Array(n));

function readBio() {
  try { return JSON.parse(localStorage.getItem(BIO_KEY) || 'null'); } catch { return null; }
}

export const hasBio = () => !!readBio();

export function bioName() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'Face ID';
  if (/Macintosh/.test(ua)) return navigator.maxTouchPoints > 1 ? 'Face ID' : 'Touch ID';
  return 'face or fingerprint';
}

export async function bioAvailable() {
  try {
    return !!(window.PublicKeyCredential
      && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

export async function enableBio(label) {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: random(32),
      rp: { name: 'Kudukka', id: location.hostname },
      user: { id: random(16), name: label, displayName: label },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      attestation: 'none',
      timeout: 60000,
    },
  });
  if (!cred) throw new Error('no credential');
  try { localStorage.setItem(BIO_KEY, JSON.stringify({ id: b64(cred.rawId) })); } catch { /* storage blocked */ }
}

export async function unlockWithBio() {
  const r = readBio();
  if (!r) return false;
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: random(32),
      rpId: location.hostname,
      allowCredentials: [{ type: 'public-key', id: unb64(r.id), transports: ['internal', 'hybrid'] }],
      userVerification: 'required',
      timeout: 60000,
    },
  });
  return !!cred && b64(cred.rawId) === r.id;
}

export function disableBio() {
  try { localStorage.removeItem(BIO_KEY); } catch { /* storage blocked */ }
}

// Calls onLock when the app comes back after being in the background for a while.
export function watchBackground(onLock) {
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS) onLock();
  });
}
