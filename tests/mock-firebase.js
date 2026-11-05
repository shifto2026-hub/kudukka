// In-memory stand-in for the Firebase SDK, used only by the browser smoke test.
const store = new Map(); // path -> data
const listeners = new Set();
let user = null;
const authCbs = new Set();
let counter = 0;
const notify = () => setTimeout(() => listeners.forEach((l) => l()), 0);

export const initializeApp = () => ({});
export const getAuth = () => ({});
export class GoogleAuthProvider { setCustomParameters() {} }
export async function signInWithPopup() { user = { uid: 'u1', email: 'sha@example.com', displayName: 'Sha' }; authCbs.forEach((c) => c(user)); }
export const signInWithRedirect = signInWithPopup;
export const getRedirectResult = async () => null;
export function onAuthStateChanged(_a, cb) { authCbs.add(cb); setTimeout(() => cb(user), 30); return () => authCbs.delete(cb); }
export async function signOut() { user = null; authCbs.forEach((c) => c(null)); }

export const initializeFirestore = () => ({});
export const persistentLocalCache = () => ({});
export const persistentMultipleTabManager = () => ({});
export const serverTimestamp = () => { const ts = Date.now(); return { toMillis: () => ts }; };
export function collection(_db, ...segs) { return { kind: 'col', path: segs.join('/') }; }
export function doc(base, ...segs) {
  if (base && base.kind === 'col') return { kind: 'doc', path: `${base.path}/${segs[0] || `id${++counter}${Math.random().toString(36).slice(2, 6)}`}`, get id() { return this.path.split('/').pop(); } };
  const path = segs.join('/');
  return { kind: 'doc', path, get id() { return path.split('/').pop(); } };
}
export function onSnapshot(ref, cb) {
  const fire = () => {
    if (ref.kind === 'doc') {
      const d = store.get(ref.path);
      cb({ exists: () => !!d, data: () => d });
    } else {
      const docs = [...store.entries()]
        .filter(([p]) => p.startsWith(`${ref.path}/`) && p.split('/').length === ref.path.split('/').length + 1)
        .map(([p, d]) => ({ id: p.split('/').pop(), data: () => d }));
      cb({ docs, metadata: { fromCache: false } });
    }
  };
  listeners.add(fire);
  setTimeout(fire, 10);
  return () => listeners.delete(fire);
}
export async function getDoc(ref) { const d = store.get(ref.path); return { exists: () => !!d, data: () => d }; }
export async function setDoc(ref, data, opts) { store.set(ref.path, opts && opts.merge ? { ...(store.get(ref.path) || {}), ...data } : { ...data }); notify(); }
export async function updateDoc(ref, data) { store.set(ref.path, { ...(store.get(ref.path) || {}), ...data }); notify(); }
export async function deleteDoc(ref) { store.delete(ref.path); notify(); }
