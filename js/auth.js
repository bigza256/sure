// ============================================
// SURE — auth + user profile helpers
// Track the Pool. Follow Every Bet.
// ============================================

import {
  auth, db, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signInWithPopup, signInWithRedirect,
  getRedirectResult, GoogleAuthProvider,
  signOut, sendPasswordResetEmail, updateProfile,
  ref, get, set
} from "./firebase.js";

const USERS  = "users";
const ADMINS = "admins";

let _profileCache = null;
let _isAdminCache = false;

let _resolveReady;
let _readyResolved = false;

const _ready = new Promise(resolve => {
  _resolveReady = resolve;
});

// ---------------------------------------------------------
// Helpers
// ---------------------------------------------------------

function isMobile(){
  return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i
    .test(navigator.userAgent);
}


// ---------------------------------------------------------
// Admin check
// ---------------------------------------------------------

/**
 * Reads admins/{uid}.
 *
 * Returns true only when the database value is exactly true.
 *
 * The database rules allow the user to read their own admin
 * record, so this works with the current rules.
 */
async function checkIsAdmin(uid){
  if(!uid) return false;

  try{
    const snap = await get(ref(db, `${ADMINS}/${uid}`));

    return snap.exists() && snap.val() === true;

  }catch(err){
    console.warn("Admin check failed:", err);
    return false;
  }
}


// ---------------------------------------------------------
// Public admin state
// ---------------------------------------------------------

export function currentIsAdmin(){
  return _isAdminCache;
}


// ---------------------------------------------------------
// Minimal user profile
//
// Normal users can create their own initial profile.
//
// Admin-only fields are NOT created here:
//
//   wallets
//   riskState
//   currentCycleId
//   verificationStatus
//   canComment
//
// Those are controlled by the database rules and are created/
// updated by the appropriate admin workflows.
// ---------------------------------------------------------

function newProfile({
  uid,
  name,
  email,
  phone,
  provider
}){

  return {
    uid,

    name: (name || "User").trim(),

    email: (email || "")
      .trim()
      .toLowerCase(),

    phone: (phone || "").trim(),

    role: "user",

    status: "active",

    provider,

    createdAt: Date.now()
  };
}


// ---------------------------------------------------------
// Load user profile
// ---------------------------------------------------------

export async function loadUserProfile(uid){

  if(!uid) return null;

  try{

    const snap = await get(
      ref(db, `${USERS}/${uid}`)
    );

    if(!snap.exists()){
      return null;
    }

    return {
      uid,
      ...snap.val()
    };

  }catch(err){

    console.error(
      "Failed to load user profile:",
      err
    );

    throw err;
  }
}


// ---------------------------------------------------------
// Create missing Google profile
// ---------------------------------------------------------

async function ensureGoogleProfile(user){

  if(!user) return null;

  const uid = user.uid;

  let profile = await loadUserProfile(uid);

  // Existing profile
  if(profile){
    return profile;
  }

  // New Google user
  profile = newProfile({
    uid,
    name: user.displayName || "Google User",
    email: user.email || "",
    phone: "",
    provider: "google"
  });

  /*
   * This matches the database rule:
   *
   * !data.exists() && auth.uid === $uid
   *
   * Therefore a normal authenticated Google user can create
   * their own initial profile.
   */
  await set(
    ref(db, `${USERS}/${uid}`),
    profile
  );

  return profile;
}


// ---------------------------------------------------------
// Handle suspended account
// ---------------------------------------------------------

async function handleSuspendedProfile(profile){

  if(
    profile &&
    profile.status === "suspended"
  ){

    await signOut(auth);

    location.href =
      "login.html?suspended=1";

    throw new Error("Account suspended");
  }

  return profile;
}


// ---------------------------------------------------------
// Redirect result handler
//
// Used mainly for mobile Google authentication.
// ---------------------------------------------------------

(async () => {

  try{

    const result = await getRedirectResult(auth);

    if(!result || !result.user){
      return;
    }

    const user = result.user;

    const profile =
      await ensureGoogleProfile(user);

    await handleSuspendedProfile(profile);

    _profileCache = profile;

    _isAdminCache =
      await checkIsAdmin(user.uid);

    /*
     * Redirect only when the user is currently on an
     * authentication page.
     */
    const page =
      location.pathname
        .split("/")
        .pop();

    if(
      page === "login.html" ||
      page === "register.html" ||
      page === ""
    ){

      location.href =
        _isAdminCache
          ? "admin/index.html"
          : "dashboard.html";
    }

  }catch(err){

    console.error(
      "Google redirect sign-in failed:",
      err
    );

    const errBox =
      document.getElementById("formError");

    if(errBox){

      const map = {

        "auth/unauthorized-domain":
          "This domain is not authorized in Firebase.",

        "auth/operation-not-allowed":
          "Google sign-in is not enabled.",

        "auth/account-exists-with-different-credential":
          "An account with this email already exists.",

        "auth/popup-closed-by-user":
          "Google sign-in was cancelled.",

        "auth/network-request-failed":
          "Network error. Please check your internet connection."
      };

      errBox.textContent =
        map[err.code] ||
        err.message ||
        "Google sign-in failed.";

      errBox.style.display = "flex";
    }
  }

})();


// ---------------------------------------------------------
// Auth state watcher
// ---------------------------------------------------------

onAuthStateChanged(auth, async (user) => {

  try{

    if(user){

      let profile =
        await loadUserProfile(user.uid);

      /*
       * If Firebase Auth says the user is signed in but the
       * profile doesn't exist, don't immediately treat the
       * user as fully authenticated at the application level.
       *
       * Google redirect flow creates the profile separately.
       */
      if(profile){

        _profileCache = profile;

        _isAdminCache =
          await checkIsAdmin(user.uid);

      }else{

        _profileCache = null;
        _isAdminCache = false;
      }

    }else{

      _profileCache = null;
      _isAdminCache = false;
    }

  }catch(err){

    console.error(
      "Auth state/profile loading failed:",
      err
    );

    _profileCache = null;
    _isAdminCache = false;
  }

  /*
   * Resolve only once.
   */
  if(!_readyResolved){

    _readyResolved = true;

    _resolveReady(
      _profileCache
    );
  }

  window.dispatchEvent(
    new CustomEvent("sure:auth", {
      detail: _profileCache
    })
  );

});


// ---------------------------------------------------------
// Auth ready
// ---------------------------------------------------------

export function whenAuthReady(){
  return _ready;
}


// ---------------------------------------------------------
// Current Firebase user
// ---------------------------------------------------------

export function currentUser(){
  return auth.currentUser;
}


// ---------------------------------------------------------
// Current application profile
// ---------------------------------------------------------

export function currentProfile(){
  return _profileCache;
}


// ---------------------------------------------------------
// Email + password registration
// ---------------------------------------------------------

export async function registerUser({
  name,
  phone,
  email,
  password
}){

  /*
   * Step 1:
   * Create Firebase Authentication account.
   */
  const cred =
    await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );

  /*
   * Step 2:
   * Set Firebase Auth display name.
   */
  await updateProfile(
    cred.user,
    {
      displayName: name
    }
  );

  /*
   * Step 3:
   * Create the minimal database profile.
   *
   * The database rules allow this because:
   *
   * auth.uid === $uid
   * AND
   * users/$uid does not exist yet.
   */
  const profile =
    newProfile({
      uid: cred.user.uid,
      name,
      email,
      phone,
      provider: "password"
    });

  await set(
    ref(db, `${USERS}/${cred.user.uid}`),
    profile
  );

  /*
   * Update local application state immediately.
   */
  _profileCache = profile;

  _isAdminCache = false;

  return profile;
}


// ---------------------------------------------------------
// Email + password login
// ---------------------------------------------------------

export async function loginUser(
  email,
  password
){

  const cred =
    await signInWithEmailAndPassword(
      auth,
      email,
      password
    );

  const profile =
    await loadUserProfile(
      cred.user.uid
    );

  /*
   * Authentication can succeed while the database profile
   * is missing, for example after an interrupted registration.
   */
  if(!profile){

    throw new Error(
      "Your account exists, but your SURE profile could not be found. Please contact support."
    );
  }

  await handleSuspendedProfile(profile);

  _profileCache = profile;

  _isAdminCache =
    await checkIsAdmin(
      cred.user.uid
    );

  return profile;
}


// ---------------------------------------------------------
// Google sign-in
//
// Desktop → popup
// Mobile  → redirect
// ---------------------------------------------------------

export async function loginWithGoogle(){

  const provider =
    new GoogleAuthProvider();

  provider.setCustomParameters({
    prompt: "select_account"
  });


  // -------------------------------------------------------
  // Mobile
  // -------------------------------------------------------

  if(isMobile()){

    /*
     * The browser leaves the current page.
     *
     * getRedirectResult() at the top of this module handles
     * the returned Google credential.
     */
    await signInWithRedirect(
      auth,
      provider
    );

    return null;
  }


  // -------------------------------------------------------
  // Desktop
  // -------------------------------------------------------

  const cred =
    await signInWithPopup(
      auth,
      provider
    );

  const user = cred.user;

  /*
   * Create profile if this is the user's first Google login.
   */
  const profile =
    await ensureGoogleProfile(user);

  await handleSuspendedProfile(profile);

  _profileCache = profile;

  _isAdminCache =
    await checkIsAdmin(user.uid);

  return profile;
}


// ---------------------------------------------------------
// Sign out
// ---------------------------------------------------------

export async function logoutUser(){

  await signOut(auth);

  _profileCache = null;
  _isAdminCache = false;

  location.href =
    "login.html";
}


// ---------------------------------------------------------
// Password reset
// ---------------------------------------------------------

export async function resetPassword(email){

  await sendPasswordResetEmail(
    auth,
    email
  );
}


// ---------------------------------------------------------
// Authentication guard
// ---------------------------------------------------------

export async function requireAuth(
  redirect = "login.html"
){

  const profile =
    await whenAuthReady();

  if(!profile){

    location.href =
      redirect;

    throw new Error(
      "Not authenticated"
    );
  }

  if(profile.status === "suspended"){

    await signOut(auth);

    location.href =
      "login.html?suspended=1";

    throw new Error(
      "Suspended"
    );
  }

  return profile;
}


// ---------------------------------------------------------
// Admin guard
// ---------------------------------------------------------

export async function requireAdmin(){

  const profile =
    await requireAuth(
      "../login.html"
    );

  const admin =
    await checkIsAdmin(
      profile.uid
    );

  if(!admin){

    location.href =
      "../dashboard.html";

    throw new Error(
      "Not admin"
    );
  }

  return profile;
}