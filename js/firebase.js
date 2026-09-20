// ============================================================
// SURE — Firebase Configuration & Shared Firebase Services
// ============================================================

import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signOut,
  sendPasswordResetEmail,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  getDatabase,
  ref,
  get,
  set,
  update,
  push,
  remove,
  query,
  orderByChild,
  equalTo,
  onValue,
  serverTimestamp,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";


// ============================================================
// FIREBASE CONFIG
// ============================================================

export const firebaseConfig = {
  apiKey: "AIzaSyBeDrCR_pTDcAbmc-so90SHFBVnujcwbE",
  authDomain: "sure-ug.firebaseapp.com",
  databaseURL: "https://sure-ug-default-rtdb.firebaseio.com",
  projectId: "sure-ug",
  storageBucket: "sure-ug.firebasestorage.app",
  messagingSenderId: "622151353971",
  appId: "1:622151353971:web:966031ef24ea135ee7cc06",
  measurementId: "G-QC5E861BQH"
};


// ============================================================
// INITIALIZE FIREBASE
// ============================================================

export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

export const db = getDatabase(app);


// ============================================================
// AUTH PERSISTENCE
// ============================================================
// Keeps users signed in when they reload or reopen the site.
// Firebase's browser default is local persistence, but we set
// it explicitly so the behavior is clear and predictable.
// ============================================================

export const authPersistence = setPersistence(
  auth,
  browserLocalPersistence
).catch((error) => {
  console.error("SURE: Failed to set auth persistence:", error);
});


// ============================================================
// AUTH EXPORTS
// ============================================================

export {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signOut,
  sendPasswordResetEmail,
  updateProfile
};


// ============================================================
// DATABASE EXPORTS
// ============================================================

export {
  ref,
  get,
  set,
  update,
  push,
  remove,
  query,
  orderByChild,
  equalTo,
  onValue,
  serverTimestamp,
  runTransaction
};


// ============================================================
// SURE APP SETTINGS
// ============================================================

export const APP = {
  name: "SURE",

  tagline: "Track the Pool. Follow Every Bet.",

  currency: "UGX",

  minDeposit: 50000,

  maxDeposit: 800000,

  cycleDays: 30
};

2. Replace your entire "auth.js"

This is the important one. It fixes the situation where Firebase says "this person is signed in", but SURE checks the database profile too early and concludes that the person is logged out.

:::writing{variant="standard" id="74106" title="SURE — auth.js"}

// ============================================================
// SURE — Authentication & User Profile System
// ============================================================

import {
  auth,
  db,

  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,

  signOut,
  sendPasswordResetEmail,
  updateProfile,

  ref,
  get,
  set,

  authPersistence
} from "./firebase.js";


// ============================================================
// DATABASE PATHS
// ============================================================

const USERS = "users";
const ADMINS = "admins";


// ============================================================
// APP BASE PATH
// ============================================================
// Your current site is:
// https://bigza256.github.io/sure/
//
// This prevents "../login.html" / "login.html" path problems
// when authentication is used from pages inside /admin/.
// ============================================================

const APP_BASE = (() => {

  const path = location.pathname;

  if (path.includes("/sure/")) {
    return "/sure/";
  }

  return "/";

})();


// ============================================================
// INTERNAL STATE
// ============================================================

let _profileCache = null;

let _isAdminCache = false;

let _authInitialized = false;

let _authInitializationError = null;


// Promise that resolves ONLY after Firebase has finished
// determining the user's authentication state AND SURE has
// finished loading/creating the user's profile.

let _resolveReady;

let _rejectReady;

const _ready = new Promise((resolve, reject) => {
  _resolveReady = resolve;
  _rejectReady = reject;
});


// ============================================================
// PAGE HELPERS
// ============================================================

function goTo(page) {

  location.href = `${APP_BASE}${page}`;

}


function isMobile() {

  return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i
    .test(navigator.userAgent);

}


// ============================================================
// ERROR DISPLAY
// ============================================================

function showAuthError(message) {

  console.error("SURE AUTH:", message);

  const errorBox =
    document.getElementById("formError") ||
    document.getElementById("authError") ||
    document.querySelector(".form-error");

  if (!errorBox) return;

  errorBox.textContent = message;

  errorBox.style.display = "flex";

}


// ============================================================
// FIREBASE ERROR TRANSLATOR
// ============================================================

function authErrorMessage(error) {

  if (!error) {
    return "Authentication failed.";
  }

  const code = error.code || "";

  const messages = {

    "auth/invalid-email":
      "Please enter a valid email address.",

    "auth/user-disabled":
      "This account has been disabled.",

    "auth/user-not-found":
      "No account was found with this email.",

    "auth/wrong-password":
      "Incorrect password.",

    "auth/invalid-credential":
      "The email or password is incorrect.",

    "auth/email-already-in-use":
      "An account with this email already exists.",

    "auth/weak-password":
      "Your password is too weak.",

    "auth/password-does-not-meet-requirements":
      "Your password does not meet the required security requirements.",

    "auth/popup-closed-by-user":
      "The Google sign-in window was closed.",

    "auth/popup-blocked":
      "Your browser blocked the Google sign-in window.",

    "auth/unauthorized-domain":
      "This website is not authorized in Firebase Authentication.",

    "auth/operation-not-allowed":
      "This sign-in method is not enabled in Firebase.",

    "auth/account-exists-with-different-credential":
      "An account already exists using a different sign-in method.",

    "auth/network-request-failed":
      "Network error. Please check your internet connection.",

    "auth/too-many-requests":
      "Too many attempts. Please wait a moment and try again."

  };

  return messages[code] ||
    error.message ||
    "Authentication failed. Please try again.";

}


// ============================================================
// ADMIN CHECK
// ============================================================

export async function checkIsAdmin(uid) {

  if (!uid) return false;

  try {

    const snap = await get(
      ref(db, `${ADMINS}/${uid}`)
    );

    return snap.exists() && snap.val() === true;

  } catch (error) {

    console.error(
      "SURE: Could not check admin status:",
      error
    );

    return false;
  }

}


// ============================================================
// PUBLIC ADMIN STATUS
// ============================================================

export function currentIsAdmin() {

  return _isAdminCache;

}


// ============================================================
// CREATE STANDARD PROFILE
// ============================================================

function newProfile({
  uid,
  name,
  email,
  phone = "",
  provider = "password"
}) {

  return {

    uid,

    name:
      String(name || "User")
        .trim()
        .slice(0, 100),

    email:
      String(email || "")
        .trim()
        .toLowerCase(),

    phone:
      String(phone || "")
        .trim(),

    role: "user",

    status: "active",

    provider,

    createdAt: Date.now()

  };

}


// ============================================================
// LOAD USER PROFILE
// ============================================================

export async function loadUserProfile(uid) {

  if (!uid) return null;

  try {

    const snap = await get(
      ref(db, `${USERS}/${uid}`)
    );

    if (!snap.exists()) {
      return null;
    }

    return {
      uid,
      ...snap.val()
    };

  } catch (error) {

    console.error(
      "SURE: Failed to load user profile:",
      error
    );

    throw error;

  }

}


// ============================================================
// CREATE PROFILE IF MISSING
// ============================================================
//
// This is the major fix.
//
// Firebase Authentication can successfully authenticate a user
// while the separate RTDB users/{uid} profile does not yet exist.
//
// Instead of treating that situation as "logged out", we create
// the missing profile.
// ============================================================

async function ensureUserProfile(user) {

  if (!user || !user.uid) {
    return null;
  }

  let profile = await loadUserProfile(user.uid);

  if (profile) {
    return profile;
  }


  // Determine provider

  let provider = "password";

  if (user.providerData && user.providerData.length) {

    const providerId =
      user.providerData[0]?.providerId;

    if (providerId === "google.com") {
      provider = "google";
    }

  }


  profile = newProfile({

    uid: user.uid,

    name:
      user.displayName ||
      "User",

    email:
      user.email ||
      "",

    phone: "",

    provider

  });


  // IMPORTANT:
  // Create the profile using the authenticated user's UID.

  await set(
    ref(db, `${USERS}/${user.uid}`),
    profile
  );


  console.log(
    "SURE: Created missing user profile:",
    user.uid
  );


  return profile;

}


// ============================================================
// SUSPENDED USER HANDLER
// ============================================================

async function handleSuspendedProfile(profile) {

  if (!profile) return false;

  if (profile.status !== "suspended") {
    return false;
  }

  console.warn(
    "SURE: Suspended account attempted access:",
    profile.uid
  );

  try {
    await signOut(auth);
  } catch (error) {
    console.error(
      "SURE: Could not sign out suspended user:",
      error
    );
  }

  goTo("login.html?suspended=1");

  return true;

}


// ============================================================
// PROCESS AUTHENTICATED USER
// ============================================================
//
// This function is the central point of the authentication system.
//
// Firebase Auth → user
//       ↓
// RTDB → users/{uid}
//       ↓
// admin check
//       ↓
// cache everything
// ============================================================

async function processAuthenticatedUser(user) {

  if (!user) {

    _profileCache = null;

    _isAdminCache = false;

    return null;

  }


  console.log(
    "SURE: Firebase user authenticated:",
    user.uid
  );


  // Make sure a SURE profile exists.

  const profile =
    await ensureUserProfile(user);


  if (!profile) {

    throw new Error(
      "Unable to create or load your SURE profile."
    );

  }


  // Suspended accounts are signed out.

  if (await handleSuspendedProfile(profile)) {

    _profileCache = null;

    _isAdminCache = false;

    return null;

  }


  // Check administrator status.

  const admin =
    await checkIsAdmin(user.uid);


  // Update cache.

  _profileCache = profile;

  _isAdminCache = admin;


  console.log(
    "SURE AUTH READY:",
    {
      uid: user.uid,
      email: user.email,
      admin,
      profile
    }
  );


  return profile;

}


// ============================================================
// AUTH STATE INITIALIZATION
// ============================================================
//
// Firebase recommends onAuthStateChanged() as the reliable
// source for the user's current authentication state.
// ============================================================

const authStatePromise = new Promise((resolve) => {

  let observerFinished = false;


  onAuthStateChanged(
    auth,

    async (user) => {

      if (observerFinished) return;

      try {

        const profile =
          await processAuthenticatedUser(user);


        observerFinished = true;

        _authInitialized = true;


        _resolveReady(profile);

        resolve(profile);


        // Notify the rest of SURE.

        window.dispatchEvent(
          new CustomEvent(
            "sure:auth",
            {
              detail: {

                user: user || null,

                profile: profile || null,

                isAdmin: _isAdminCache

              }
            }
          )
        );


      } catch (error) {

        console.error(
          "SURE: Authentication initialization failed:",
          error
        );


        _authInitializationError = error;

        observerFinished = true;

        _authInitialized = true;


        _resolveReady(null);

        resolve(null);


        window.dispatchEvent(
          new CustomEvent(
            "sure:auth-error",
            {
              detail: error
            }
          )
        );

      }

    },

    (error) => {

      console.error(
        "SURE: Firebase auth observer error:",
        error
      );

      _authInitializationError = error;

      _authInitialized = true;

      _resolveReady(null);

      resolve(null);

    }

  );

});


// ============================================================
// REDIRECT RESULT
// ============================================================
//
// This catches errors from Google redirect authentication.
//
// The actual authentication state is still handled by
// onAuthStateChanged() above.
// ============================================================

(async () => {

  try {

    // Make sure Firebase persistence is ready first.

    await authPersistence;


    const result =
      await getRedirectResult(auth);


    if (result && result.user) {

      console.log(
        "SURE: Google redirect completed:",
        result.user.uid
      );

    }

  } catch (error) {

    console.error(
      "SURE: Google redirect failed:",
      error
    );


    showAuthError(
      authErrorMessage(error)
    );

  }

})();


// ============================================================
// WAIT FOR AUTH
// ============================================================

export async function whenAuthReady() {

  return _ready;

}


// ============================================================
// CURRENT FIREBASE USER
// ============================================================

export function currentUser() {

  return auth.currentUser;

}


// ============================================================
// CURRENT SURE PROFILE
// ============================================================

export function currentProfile() {

  return _profileCache;

}


// ============================================================
// IS AUTH INITIALIZED?
// ============================================================

export function isAuthReady() {

  return _authInitialized;

}


// ============================================================
// REGISTER WITH EMAIL + PASSWORD
// ============================================================

export async function registerUser({
  name,
  phone,
  email,
  password
}) {

  try {

    // Wait for persistence.

    await authPersistence;


    // Create Firebase Auth account.

    const credential =
      await createUserWithEmailAndPassword(
        auth,
        String(email).trim().toLowerCase(),
        password
      );


    const user = credential.user;


    // Set Firebase display name.

    if (name) {

      await updateProfile(
        user,
        {
          displayName:
            String(name).trim()
        }
      );

    }


    // Create SURE profile.

    const profile =
      newProfile({

        uid: user.uid,

        name,

        email: user.email || email,

        phone,

        provider: "password"

      });


    await set(
      ref(db, `${USERS}/${user.uid}`),
      profile
    );


    // Update local state immediately.

    _profileCache = profile;

    _isAdminCache = false;


    console.log(
      "SURE: Registration successful:",
      user.uid
    );


    return profile;

  } catch (error) {

    console.error(
      "SURE: Registration failed:",
      error
    );

    throw error;

  }

}


// ============================================================
// LOGIN WITH EMAIL + PASSWORD
// ============================================================

export async function loginUser(
  email,
  password
) {

  try {

    await authPersistence;


    const credential =
      await signInWithEmailAndPassword(
        auth,
        String(email).trim().toLowerCase(),
        password
      );


    const user =
      credential.user;


    // IMPORTANT:
    // Do not assume the RTDB profile exists.
    // Recover it if necessary.

    const profile =
      await ensureUserProfile(user);


    if (
      await handleSuspendedProfile(profile)
    ) {

      throw new Error(
        "This account has been suspended."
      );

    }


    _profileCache = profile;


    _isAdminCache =
      await checkIsAdmin(user.uid);


    console.log(
      "SURE: Login successful:",
      user.uid
    );


    return profile;

  } catch (error) {

    console.error(
      "SURE: Login failed:",
      error
    );

    throw error;

  }

}


// ============================================================
// GOOGLE LOGIN
// ============================================================

export async function loginWithGoogle() {

  try {

    await authPersistence;


    const provider =
      new GoogleAuthProvider();


    provider.setCustomParameters({
      prompt: "select_account"
    });


    // --------------------------------------------------------
    // MOBILE
    // --------------------------------------------------------
    //
    // Redirect is used on mobile.
    //
    // signInWithRedirect() navigates away from the page.
    // Firebase restores the authentication state when the user
    // returns.
    // --------------------------------------------------------

    if (isMobile()) {

      console.log(
        "SURE: Starting Google redirect login..."
      );


      await signInWithRedirect(
        auth,
        provider
      );


      // This page will be left.
      return null;

    }


    // --------------------------------------------------------
    // DESKTOP
    // --------------------------------------------------------

    const credential =
      await signInWithPopup(
        auth,
        provider
      );


    const user =
      credential.user;


    const profile =
      await ensureUserProfile(user);


    if (
      await handleSuspendedProfile(profile)
    ) {

      throw new Error(
        "This account has been suspended."
      );

    }


    _profileCache = profile;


    _isAdminCache =
      await checkIsAdmin(user.uid);


    console.log(
      "SURE: Google login successful:",
      user.uid
    );


    return profile;

  } catch (error) {

    console.error(
      "SURE: Google login failed:",
      error
    );

    throw error;

  }

}


// ============================================================
// LOGOUT
// ============================================================

export async function logoutUser() {

  try {

    await signOut(auth);

    _profileCache = null;

    _isAdminCache = false;

    console.log(
      "SURE: User signed out."
    );


    goTo("login.html");

  } catch (error) {

    console.error(
      "SURE: Logout failed:",
      error
    );

    throw error;

  }

}


// ============================================================
// PASSWORD RESET
// ============================================================

export async function resetPassword(email) {

  await sendPasswordResetEmail(
    auth,
    String(email).trim().toLowerCase()
  );

}


// ============================================================
// REQUIRE AUTHENTICATED USER
// ============================================================
//
// THIS IS THE IMPORTANT FIX.
//
// We check:
//      Firebase Auth user
//
// BEFORE deciding that the user is logged out.
//
// We do NOT simply check _profileCache.
// ============================================================

export async function requireAuth(
  redirect = "login.html"
) {

  // Wait until Firebase has completely initialized.

  const profile =
    await whenAuthReady();


  // Firebase is the source of truth.

  const user =
    auth.currentUser;


  console.log(
    "SURE requireAuth:",
    {
      firebaseUser: user?.uid || null,
      profile: profile?.uid || null
    }
  );


  // No Firebase user = genuinely signed out.

  if (!user) {

    const target =
      redirect.startsWith("/")
        ? redirect
        : `${APP_BASE}${redirect}`;

    location.href = target;

    throw new Error(
      "Not authenticated."
    );

  }


  // Firebase user exists but profile wasn't loaded.
  // Try one more time before treating it as an error.

  let finalProfile =
    profile;


  if (!finalProfile) {

    finalProfile =
      await ensureUserProfile(user);

  }


  if (!finalProfile) {

    throw new Error(
      "Your account is signed in, but your SURE profile could not be loaded."
    );

  }


  // Suspended account.

  if (
    await handleSuspendedProfile(finalProfile)
  ) {

    throw new Error(
      "Account suspended."
    );

  }


  // Update cache.

  _profileCache =
    finalProfile;


  return finalProfile;

}


// ============================================================
// REQUIRE ADMIN
// ============================================================

export async function requireAdmin() {

  const profile =
    await requireAuth(
      "login.html"
    );


  const admin =
    await checkIsAdmin(profile.uid);


  if (!admin) {

    console.warn(
      "SURE: Non-admin attempted to access admin area:",
      profile.uid
    );


    goTo("dashboard.html");


    throw new Error(
      "Administrator access required."
    );

  }


  _isAdminCache = true;


  return profile;

}


// ============================================================
// AUTOMATIC LOGIN-PAGE REDIRECTION
// ============================================================
//
// If a signed-in user visits login.html/register.html again,
// send them to the correct destination.
//
// This does NOT run on dashboard/admin pages.
// ============================================================

async function redirectAuthenticatedEntryPage() {

  try {

    const profile =
      await whenAuthReady();


    const user =
      auth.currentUser;


    if (!user || !profile) {
      return;
    }


    const path =
      location.pathname;


    const isLoginPage =
      /\/login\.html$/i.test(path);


    const isRegisterPage =
      /\/register\.html$/i.test(path);


    const isRootPage =
      path.endsWith("/sure/") ||
      path.endsWith("/sure/index.html");


    if (
      !isLoginPage &&
      !isRegisterPage &&
      !isRootPage
    ) {

      return;

    }


    if (_isAdminCache) {

      goTo("admin/index.html");

    } else {

      goTo("dashboard.html");

    }

  } catch (error) {

    console.error(
      "SURE: Entry-page redirect failed:",
      error
    );

  }

}


// Wait until Firebase authentication is initialized,
// then handle login/register pages.

authStatePromise.then(() => {

  redirectAuthenticatedEntryPage();

});


// ============================================================
// DEBUG INFORMATION
// ============================================================
//
// You can see this in Chrome DevTools / Eruda console.
// ============================================================

window.SURE_AUTH_DEBUG = {

  getUser: () =>
    auth.currentUser,

  getProfile: () =>
    _profileCache,

  isAdmin: () =>
    _isAdminCache,

  isReady: () =>
    _authInitialized,

  getInitializationError: () =>
    _authInitializationError

};


console.log(
  "SURE authentication system loaded."
);

What this version changes

The key change is this:

const user = auth.currentUser;

if (!user) {
    // NOW we know the person is actually signed out
}

Instead of doing:

if (!profile) {
    // assume logged out
}

That distinction is important because Firebase Auth and your RTDB "users/{uid}" profile are two separate things.

It also automatically creates "users/{uid}" if Firebase has authenticated the user but the SURE profile doesn't exist yet.

So the flow is now:

                 FIREBASE AUTH
                      │
                      ▼
             Is there a Firebase user?
                 /            \
               NO              YES
               │                │
               ▼                ▼
            LOGIN        Load users/{uid}
                                │
                         ┌──────┴──────┐
                         │             │
                       exists       missing
                         │             │
                         │             ▼
                         │       Create profile
                         │             │
                         └──────┬──────┘
                                ▼
                         Check account status
                                │
                       ┌────────┴────────┐
                       │                 │
                    active            suspended
                       │                 │
                       ▼                 ▼
                   Dashboard          Sign out

Firebase's documentation specifically recommends the auth-state observer for this purpose, and notes that with redirect sign-in the observer waits for the redirect result before firing.

One important thing: after replacing these files, make sure your Firebase Realtime Database rules are actually published. The earlier "newData.isObject()" error means those rules were not valid, so your old rules may still be active. Also, if Google redirect on your phone behaves strangely, Firebase has additional requirements for redirect authentication on browsers that block third-party storage.

After uploading these two files, clear the old cached JavaScript/reload the site and test a completely new login.