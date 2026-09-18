// ============================================
// SURE — auth + user profile helpers
// ============================================
import {
  auth, db, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  updateProfile, ref, get, set, update, serverTimestamp
} from "./firebase.js";

const USERS = "users";

let _profileCache = null;
let _resolveReady;
const _ready = new Promise(r => _resolveReady = r);

// Watch auth state once globally
onAuthStateChanged(auth, async (u)=>{
  if(u){
    _profileCache = await loadUserProfile(u.uid);
  } else {
    _profileCache = null;
  }
  _resolveReady(_profileCache);
  window.dispatchEvent(new CustomEvent("sure:auth", { detail:_profileCache }));
});

/** Resolve when auth profile is loaded (or null if signed out). */
export function whenAuthReady(){ return _ready; }

export async function loadUserProfile(uid){
  const snap = await get(ref(db, `${USERS}/${uid}`));
  return snap.exists() ? { uid, ...snap.val() } : null;
}

export function currentUser(){ return auth.currentUser; }
export function currentProfile(){ return _profileCache; }

export async function registerUser({ name, phone, email, password }){
  // Security: role is ALWAYS "user" at signup — never user-supplied
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: name });

  const profile = {
    uid: cred.user.uid,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    phone: phone.trim(),
    role: "user",                 // <-- hardcoded; admins must be set server-side
    status: "active",
    balance: 0,
    reserveBalance: 0,
    totalDeposited: 0,
    totalWithdrawn: 0,
    totalDistributed: 0,
    createdAt: Date.now()
  };
  await set(ref(db, `${USERS}/${cred.user.uid}`), profile);
  _profileCache = profile;
  return profile;
}

export async function loginUser(email, password){
  const cred = await signInWithEmailAndPassword(auth, email, password);
  _profileCache = await loadUserProfile(cred.user.uid);
  return _profileCache;
}

export async function logoutUser(){
  await signOut(auth);
  location.href = "login.html";
}

export async function resetPassword(email){
  await sendPasswordResetEmail(auth, email);
}

/** Require signed-in user; redirect to login if absent. */
export async function requireAuth(redirect="login.html"){
  const profile = await whenAuthReady();
  if(!profile){ location.href = redirect; throw new Error("Not authenticated"); }
  if(profile.status === "suspended"){
    await signOut(auth);
    location.href = "login.html?suspended=1";
    throw new Error("Suspended");
  }
  return profile;
}

/** Require admin role. */
export async function requireAdmin(){
  const profile = await requireAuth("../login.html");
  if(profile.role !== "admin"){
    location.href = "../dashboard.html";
    throw new Error("Not admin");
  }
  return profile;
}
