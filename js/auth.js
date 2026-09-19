// ============================================
// SURE — auth + user profile helpers
// ============================================
import {
  auth, db, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider,
  signOut, sendPasswordResetEmail, updateProfile,
  ref, get, set, update
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

// ------------------------------------------------------------
// Email + password registration
// ------------------------------------------------------------
export async function registerUser({ name, phone, email, password }){
  // Security: role is ALWAYS "user" at signup — never user-supplied
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: name });

  const profile = {
    uid: cred.user.uid,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    phone: phone.trim(),
    role: "user",                 // hardcoded; admins must be set server-side
    status: "active",
    provider: "password",
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

// ------------------------------------------------------------
// Email + password login
// ------------------------------------------------------------
export async function loginUser(email, password){
  const cred = await signInWithEmailAndPassword(auth, email, password);
  _profileCache = await loadUserProfile(cred.user.uid);
  return _profileCache;
}

// ------------------------------------------------------------
// Google sign-in (creates a profile on first use)
// ------------------------------------------------------------
export async function loginWithGoogle(){
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  const cred = await signInWithPopup(auth, provider);
  const user = cred.user;

  // Load existing profile or create one
  let profile = await loadUserProfile(user.uid);

  if(!profile){
    profile = {
      uid: user.uid,
      name: user.displayName || "Google User",
      email: user.email || "",
      phone: "",                       // user can add this later in settings
      role: "user",                    // never admin from client
      status: "active",
      provider: "google",
      balance: 0,
      reserveBalance: 0,
      totalDeposited: 0,
      totalWithdrawn: 0,
      totalDistributed: 0,
      createdAt: Date.now()
    };
    await set(ref(db, `${USERS}/${user.uid}`), profile);
  }

  if(profile.status === "suspended"){
    await signOut(auth);
    throw new Error("This account has been suspended.");
  }

  _profileCache = profile;
  return profile;
}

// ------------------------------------------------------------
// Sign out / reset
// ------------------------------------------------------------
export async function logoutUser(){
  await signOut(auth);
  location.href = "login.html";
}

export async function resetPassword(email){
  await sendPasswordResetEmail(auth, email);
}

// ------------------------------------------------------------
// Guards
// ------------------------------------------------------------
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

export async function requireAdmin(){
  const profile = await requireAuth("../login.html");
  if(profile.role !== "admin"){
    location.href = "../dashboard.html";
    throw new Error("Not admin");
  }
  return profile;
}