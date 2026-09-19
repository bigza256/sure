import {
  auth, db, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider,
  signOut, sendPasswordResetEmail, updateProfile,
  ref, get, set
} from "./firebase.js";
import { isAdmin } from "./database.js";

const USERS = "users";

let _profileCache = null;
let _isAdminCache = false;
let _resolveReady;
const _ready = new Promise(r => _resolveReady = r);

onAuthStateChanged(auth, async (u)=>{
  if(u){
    _profileCache = await loadUserProfile(u.uid);
    _isAdminCache = await isAdmin(u.uid);
  } else {
    _profileCache = null; _isAdminCache = false;
  }
  _resolveReady(_profileCache);
  window.dispatchEvent(new CustomEvent("sure:auth", { detail:_profileCache }));
});

export function whenAuthReady(){ return _ready; }

export async function loadUserProfile(uid){
  const snap = await get(ref(db, `${USERS}/${uid}`));
  return snap.exists() ? { uid, ...snap.val() } : null;
}
export function currentUser(){ return auth.currentUser; }
export function currentProfile(){ return _profileCache; }
export function currentIsAdmin(){ return _isAdminCache; }

export async function registerUser({ name, phone, email, password }){
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: name });

  const profile = {
    uid: cred.user.uid,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    phone: phone.trim(),
    role: "user",
    status: "active",
    verificationStatus: "unverified",
    provider: "password",
    createdAt: Date.now(),
    wallets: {
      activeAllocation: 0,
      protectedReserve: 0,
      availableEarnings: 0,
      totalContribution: 0,
      totalEarningsGenerated: 0,
      totalWithdrawn: 0,
      companyShareContributed: 0
    },
    riskState: { level: "NORMAL", reservePercent: 100, lastEvaluatedAt: Date.now() },
    currentCycleId: ""
  };
  await set(ref(db, `${USERS}/${cred.user.uid}`), profile);
  _profileCache = profile;
  return profile;
}

export async function loginUser(email, password){
  const cred = await signInWithEmailAndPassword(auth, email, password);
  _profileCache = await loadUserProfile(cred.user.uid);
  _isAdminCache = await isAdmin(cred.user.uid);
  return _profileCache;
}

export async function loginWithGoogle(){
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const cred = await signInWithPopup(auth, provider);
  const user = cred.user;
  let profile = await loadUserProfile(user.uid);
  if(!profile){
    profile = {
      uid: user.uid,
      name: user.displayName || "Google User",
      email: user.email || "",
      phone: "",
      role: "user",
      status: "active",
      verificationStatus: "unverified",
      provider: "google",
      createdAt: Date.now(),
      wallets: {
        activeAllocation: 0, protectedReserve: 0, availableEarnings: 0,
        totalContribution: 0, totalEarningsGenerated: 0,
        totalWithdrawn: 0, companyShareContributed: 0
      },
      riskState: { level: "NORMAL", reservePercent: 100, lastEvaluatedAt: Date.now() },
      currentCycleId: ""
    };
    await set(ref(db, `${USERS}/${user.uid}`), profile);
  }
  if(profile.status === "suspended"){
    await signOut(auth);
    throw new Error("This account has been suspended.");
  }
  _profileCache = profile;
  _isAdminCache = await isAdmin(user.uid);
  return profile;
}

export async function logoutUser(){
  await signOut(auth);
  location.href = "login.html";
}
export async function resetPassword(email){ await sendPasswordResetEmail(auth, email); }

export async function requireAuth(redirect="login.html"){
  const profile = await whenAuthReady();
  if(!profile){ location.href = redirect; throw new Error("Not authenticated"); }
  if(profile.status === "suspended"){
    await signOut(auth); location.href = "login.html?suspended=1";
    throw new Error("Suspended");
  }
  return profile;
}
export async function requireAdmin(){
  const profile = await requireAuth("../login.html");
  const admin = await isAdmin(profile.uid);
  if(!admin){ location.href = "../dashboard.html"; throw new Error("Not admin"); }
  return profile;
}