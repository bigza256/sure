// ============================================
// SURE — auth + user profile helpers
// ============================================
import {
  auth, db, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signInWithPopup, signInWithRedirect,
  getRedirectResult, GoogleAuthProvider,
  signOut, sendPasswordResetEmail, updateProfile,
  ref, get, set
} from "./firebase.js";

const USERS = "users";
const ADMINS = "admins";

let _profileCache = null;
let _isAdminCache = false;
let _resolveReady;
const _ready = new Promise(r => _resolveReady = r);

// ---------------------------------------------------------
// Helpers
// ---------------------------------------------------------
function isMobile(){
  return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i
    .test(navigator.userAgent);
}

/** Read admins/{uid} — matches the security rules. */
async function checkIsAdmin(uid){
  if(!uid) return false;
  try{
    const snap = await get(ref(db, `${ADMINS}/${uid}`));
    return snap.exists() && snap.val() === true;
  }catch(_){
    return false;
  }
}

/** Public export — what pages use to decide redirect targets. */
export function currentIsAdmin(){
  return _isAdminCache;
}

// ---------------------------------------------------------
// Handle Google redirect result (mobile flow)
// Runs once per page load. If the user just came back from
// a redirect sign-in, this resolves the credential, creates
// the profile if needed, and redirects to the right home.
// ---------------------------------------------------------
(async () => {
  try{
    const result = await getRedirectResult(auth);
    if(!result || !result.user) return;

    const uid = result.user.uid;
    let profile = await loadUserProfile(uid);

    if(!profile){
      profile = {
        uid,
        name: result.user.displayName || "Google User",
        email: result.user.email || "",
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
      await set(ref(db, `${USERS}/${uid}`), profile);
    }

    if(profile.status === "suspended"){
      await signOut(auth);
      location.href = "login.html?suspended=1";
      return;
    }

    const admin = await checkIsAdmin(uid);
    // Only redirect if we're still on the login or register page.
    const page = location.pathname.split("/").pop();
    if(page === "login.html" || page === "register.html" || page === ""){
      location.href = admin ? "admin/index.html" : "dashboard.html";
    }
  }catch(err){
    console.error("Redirect sign-in failed:", err);
    const errBox = document.getElementById("formError");
    if(errBox){
      const map = {
        "auth/unauthorized-domain": "This domain is not authorized in Firebase.",
        "auth/operation-not-allowed": "Google sign-in is not enabled.",
        "auth/account-exists-with-different-credential": "An account with this email already exists."
      };
      errBox.textContent = map[err.code] || err.message || "Google sign-in failed.";
      errBox.style.display = "flex";
    }
  }
})();

// ---------------------------------------------------------
// Auth state watcher
// ---------------------------------------------------------
onAuthStateChanged(auth, async (u) => {
  if(u){
    _profileCache = await loadUserProfile(u.uid);
    _isAdminCache = await checkIsAdmin(u.uid);
  } else {
    _profileCache = null;
    _isAdminCache = false;
  }
  _resolveReady(_profileCache);
  window.dispatchEvent(new CustomEvent("sure:auth", { detail: _profileCache }));
});

export function whenAuthReady(){ return _ready; }

export async function loadUserProfile(uid){
  const snap = await get(ref(db, `${USERS}/${uid}`));
  return snap.exists() ? { uid, ...snap.val() } : null;
}

export function currentUser(){ return auth.currentUser; }
export function currentProfile(){ return _profileCache; }

// ---------------------------------------------------------
// Email + password registration
// ---------------------------------------------------------
export async function registerUser({ name, phone, email, password }){
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: name });

  const profile = {
    uid: cred.user.uid,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    phone: phone.trim(),
    role: "user",                 // hardcoded; admins must be set in Firebase
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
  _isAdminCache = false;
  return profile;
}

// ---------------------------------------------------------
// Email + password login
// ---------------------------------------------------------
export async function loginUser(email, password){
  const cred = await signInWithEmailAndPassword(auth, email, password);
  _profileCache = await loadUserProfile(cred.user.uid);
  _isAdminCache = await checkIsAdmin(cred.user.uid);
  return _profileCache;
}

// ---------------------------------------------------------
// Google sign-in — popup on desktop, redirect on mobile
// ---------------------------------------------------------
export async function loginWithGoogle(){
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  if(isMobile()){
    // Redirect flow — the getRedirectResult handler at the top
    // of this module finishes the sign-in when the user returns.
    // The page navigates away here; this function returns null.
    await signInWithRedirect(auth, provider);
    return null;
  }

  // Desktop popup flow
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
  _isAdminCache = await checkIsAdmin(user.uid);
  return profile;
}

// ---------------------------------------------------------
// Sign out / reset
// ---------------------------------------------------------
export async function logoutUser(){
  await signOut(auth);
  location.href = "login.html";
}

export async function resetPassword(email){
  await sendPasswordResetEmail(auth, email);
}

// ---------------------------------------------------------
// Guards
// ---------------------------------------------------------
export async function requireAuth(redirect="login.html"){
  const profile = await whenAuthReady();
  if(!profile){
    location.href = redirect;
    throw new Error("Not authenticated");
  }
  if(profile.status === "suspended"){
    await signOut(auth);
    location.href = "login.html?suspended=1";
    throw new Error("Suspended");
  }
  return profile;
}

export async function requireAdmin(){
  const profile = await requireAuth("../login.html");
  const admin = await checkIsAdmin(profile.uid);
  if(!admin){
    location.href = "../dashboard.html";
    throw new Error("Not admin");
  }
  return profile;
}