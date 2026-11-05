// Firebase setup for Kudukka.
// The web config is not a secret: access to data is controlled by the Firestore security rules.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, getDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBnJpP9EsfEWho1pmvaSE_I7bgXDMR5HoQ',
  authDomain: 'kudukka-6fcb4.firebaseapp.com',
  projectId: 'kudukka-6fcb4',
  storageBucket: 'kudukka-6fcb4.firebasestorage.app',
  messagingSenderId: '1094530030594',
  appId: '1:1094530030594:web:f6439b79824dea03dddb1b',
};

// Everything lives under one household document.
export const HOUSEHOLD_ID = 'home';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch (e) {
  // Private browsing or unsupported storage: fall back to memory cache.
  db = initializeFirestore(app, {});
}

const householdRef = () => doc(db, 'households', HOUSEHOLD_ID);
const col = (name) => collection(db, 'households', HOUSEHOLD_ID, name);

export const newId = (name) => doc(col(name)).id;

export async function signIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    const fallback = ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'];
    if (fallback.includes(e.code)) return signInWithRedirect(auth, provider);
    throw e;
  }
}

export function finishRedirect() {
  return getRedirectResult(auth).catch(() => null);
}

export const watchAuth = (cb) => onAuthStateChanged(auth, cb);
export const logOut = () => signOut(auth);

export const watchHousehold = (cb, onErr) => onSnapshot(householdRef(), (s) => cb(s.exists() ? s.data() : null), onErr);
export const watchCollection = (name, cb, onErr) =>
  onSnapshot(col(name), (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() })), { fromCache: !!(s.metadata && s.metadata.fromCache) }), onErr);

export async function claimRole(user, role) {
  const snap = await getDoc(householdRef());
  const members = (snap.exists() && snap.data().members) || {};
  members[user.uid] = { role, email: user.email || '', name: user.displayName || '' };
  await setDoc(householdRef(), { members, updatedAt: serverTimestamp() }, { merge: true });
}

export function saveDoc(name, id, data, isNew) {
  const ref = doc(col(name), id);
  const stamp = isNew ? { createdAt: serverTimestamp(), updatedAt: serverTimestamp() } : { updatedAt: serverTimestamp() };
  return isNew ? setDoc(ref, { ...data, ...stamp }) : updateDoc(ref, { ...data, ...stamp });
}

export const restoreDoc = (name, id, data) => setDoc(doc(col(name), id), data);
// Create-or-update in one go (used for categories, whose defaults may not exist in Firestore yet).
export const mergeDoc = (name, id, data) => setDoc(doc(col(name), id), { ...data, updatedAt: serverTimestamp() }, { merge: true });
export const removeDoc = (name, id) => deleteDoc(doc(col(name), id));
