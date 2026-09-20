// ============================================================
// SURE — Authentication
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
// PATHS
// ============================================================

const USERS = "users";
const ADMINS = "admins";


// ============================================================
// STATE
// ============================================================

let currentProfileCache = null;
let currentAdminCache = false;
let authReady = false;

let resolveAuthReady;

const authReadyPromise = new Promise((resolve) => {
  resolveAuthReady = resolve;
});


// ============================================================
// PATH HELPER
// ============================================================

function appPath(file) {

  const base = "/sure/";

  return `${base}${file}`;

}


// ============================================================
// MOBILE DETECTION
// ============================================================

function isMobile() {

  return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i
    .test(navigator.userAgent);

}


// ============================================================
// ADMIN CHECK
// ============================================================

export async function checkIsAdmin(uid) {

  if (!uid) {
    return false;
  }

  try {

    const snapshot = await get(
      ref(db, `${ADMINS}/${uid}`)
    );

    return (
      snapshot.exists() &&
      snapshot.val() === true
    );

  } catch (error) {

    console.error(
      "SURE: Admin check failed:",
      error
    );

    return false;

  }

}


// ============================================================
// CURRENT ADMIN STATUS
// ============================================================

export function currentIsAdmin() {

  return currentAdminCache;

}


// ============================================================
// CREATE PROFILE OBJECT
// ============================================================

function createProfile({
  uid,
  name,
  email,
  phone = "",
  provider = "password"
}) {

  return {

    uid: uid,

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

    provider: provider,

    createdAt: Date.now()

  };

}


// ============================================================
// LOAD PROFILE
// ============================================================

export async function loadUserProfile(uid) {

  if (!uid) {
    return null;
  }

  const snapshot = await get(
    ref(db, `${USERS}/${uid}`)
  );

  if (!snapshot.exists()) {
    return null;
  }

  return {
    uid: uid,
    ...snapshot.val()
  };

}


// ============================================================
// ENSURE PROFILE EXISTS
// ============================================================

async function ensureUserProfile(user) {

  if (!user || !user.uid) {
    return null;
  }

  let profile =
    await loadUserProfile(user.uid);


  // Profile already exists.

  if (profile) {
    return profile;
  }


  // Determine provider.

  let provider = "password";

  if (user.providerData?.length) {

    const providerId =
      user.providerData[0].providerId;

    if (providerId === "google.com") {
      provider = "google";
    }

  }


  // Create missing profile.

  profile = createProfile({

    uid: user.uid,

    name:
      user.displayName || "User",

    email:
      user.email || "",

    phone: "",

    provider: provider

  });


  await set(
    ref(db, `${USERS}/${user.uid}`),
    profile
  );


  return profile;

}


// ============================================================
// SUSPENDED ACCOUNT
// ============================================================

async function checkSuspended(profile) {

  if (!profile) {
    return false;
  }

  if (profile.status !== "suspended") {
    return false;
  }

  try {
    await signOut(auth);
  } catch (error) {
    console.error(error);
  }

  location.href =
    appPath("login.html?suspended=1");

  return true;

}


// ============================================================
// PROCESS AUTH USER
// ============================================================

async function processUser(user) {

  // User is genuinely signed out.

  if (!user) {

    currentProfileCache = null;

    currentAdminCache = false;

    return null;

  }


  console.log(
    "SURE: Firebase user:",
    user.uid
  );


  // Make sure database profile exists.

  const profile =
    await ensureUserProfile(user);


  if (!profile) {

    throw new Error(
      "Could not load your SURE profile."
    );

  }


  // Check suspension.

  if (await checkSuspended(profile)) {

    currentProfileCache = null;
    currentAdminCache = false;

    return null;

  }


  // Check admin.

  const isAdmin =
    await checkIsAdmin(user.uid);


  // Update cache.

  currentProfileCache = profile;

  currentAdminCache = isAdmin;


  return profile;

}


// ============================================================
// AUTH STATE LISTENER
// ============================================================

onAuthStateChanged(
  auth,

  async (user) => {

    try {

      const profile =
        await processUser(user);


      // Mark authentication as ready.

      if (!authReady) {

        authReady = true;

        resolveAuthReady(profile);

      }


      // Notify application.

      window.dispatchEvent(
        new CustomEvent(
          "sure:auth",
          {
            detail: {
              user: user,
              profile: profile,
              isAdmin: currentAdminCache
            }
          }
        )
      );


    } catch (error) {

      console.error(
        "SURE: Auth initialization error:",
        error
      );


      if (!authReady) {

        authReady = true;

        resolveAuthReady(null);

      }

      window.dispatchEvent(
        new CustomEvent(
          "sure:auth-error",
          {
            detail: error
          }
        )
      );

    }

  }
);


// ============================================================
// GOOGLE REDIRECT RESULT
// ============================================================

(async function handleGoogleRedirect() {

  try {

    await authPersistence;

    const result =
      await getRedirectResult(auth);


    if (result?.user) {

      console.log(
        "SURE: Google redirect completed:",
        result.user.uid
      );

    }

  } catch (error) {

    console.error(
      "SURE: Google redirect error:",
      error
    );

    showError(
      getAuthErrorMessage(error)
    );

  }

})();


// ============================================================
// WAIT FOR AUTH
// ============================================================

export function whenAuthReady() {

  return authReadyPromise;

}


// ============================================================
// CURRENT FIREBASE USER
// ============================================================

export function currentUser() {

  return auth.currentUser;

}


// ============================================================
// CURRENT PROFILE
// ============================================================

export function currentProfile() {

  return currentProfileCache;

}


// ============================================================
// REGISTER
// ============================================================

export async function registerUser({
  name,
  phone,
  email,
  password
}) {

  await authPersistence;


  const credential =
    await createUserWithEmailAndPassword(
      auth,
      String(email)
        .trim()
        .toLowerCase(),
      password
    );


  const user =
    credential.user;


  // Firebase display name.

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
    createProfile({

      uid: user.uid,

      name: name,

      email: user.email || email,

      phone: phone,

      provider: "password"

    });


  await set(
    ref(db, `${USERS}/${user.uid}`),
    profile
  );


  // Update cache.

  currentProfileCache =
    profile;

  currentAdminCache =
    false;


  return profile;

}


// ============================================================
// EMAIL LOGIN
// ============================================================

export async function loginUser(
  email,
  password
) {

  await authPersistence;


  const credential =
    await signInWithEmailAndPassword(
      auth,
      String(email)
        .trim()
        .toLowerCase(),
      password
    );


  const user =
    credential.user;


  // IMPORTANT:
  // Firebase Auth is already successful here.
  // Do not redirect simply because the database profile
  // does not exist.

  let profile =
    await ensureUserProfile(user);


  if (!profile) {

    throw new Error(
      "Your account was authenticated but your SURE profile could not be created."
    );

  }


  if (await checkSuspended(profile)) {

    throw new Error(
      "This account has been suspended."
    );

  }


  currentProfileCache =
    profile;


  currentAdminCache =
    await checkIsAdmin(user.uid);


  return profile;

}


// ============================================================
// GOOGLE LOGIN
// ============================================================

export async function loginWithGoogle() {

  await authPersistence;


  const provider =
    new GoogleAuthProvider();


  provider.setCustomParameters({
    prompt: "select_account"
  });


  // MOBILE → REDIRECT

  if (isMobile()) {

    await signInWithRedirect(
      auth,
      provider
    );

    return null;

  }


  // DESKTOP → POPUP

  const credential =
    await signInWithPopup(
      auth,
      provider
    );


  const user =
    credential.user;


  const profile =
    await ensureUserProfile(user);


  if (!profile) {

    throw new Error(
      "Google account authenticated but SURE profile could not be created."
    );

  }


  if (await checkSuspended(profile)) {

    throw new Error(
      "This account has been suspended."
    );

  }


  currentProfileCache =
    profile;


  currentAdminCache =
    await checkIsAdmin(user.uid);


  return profile;

}


// ============================================================
// LOGOUT
// ============================================================

export async function logoutUser() {

  await signOut(auth);


  currentProfileCache = null;

  currentAdminCache = false;


  location.href =
    appPath("login.html");

}


// ============================================================
// PASSWORD RESET
// ============================================================

export async function resetPassword(email) {

  await sendPasswordResetEmail(
    auth,
    String(email)
      .trim()
      .toLowerCase()
  );

}


// ============================================================
// REQUIRE AUTH
// ============================================================
//
// THIS IS THE MAIN FIX.
//
// We check Firebase Auth FIRST.
// A missing database profile does NOT mean the user is logged out.
// ============================================================

export async function requireAuth(
  redirect = "login.html"
) {

  // Wait until Firebase finishes checking the session.

  const profile =
    await whenAuthReady();


  // Firebase is the source of truth.

  const user =
    auth.currentUser;


  console.log(
    "SURE requireAuth:",
    {
      firebaseUser:
        user?.uid || null,

      profile:
        profile?.uid || null
    }
  );


  // No Firebase user = actually logged out.

  if (!user) {

    location.href =
      redirect.startsWith("/")
        ? redirect
        : appPath(redirect);

    throw new Error(
      "Not authenticated."
    );

  }


  // Firebase user exists.
  // If profile wasn't available during initialization,
  // try loading/creating it again.

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


  // Check suspension.

  if (
    await checkSuspended(finalProfile)
  ) {

    throw new Error(
      "Account suspended."
    );

  }


  // Update cache.

  currentProfileCache =
    finalProfile;


  return finalProfile;

}


// ============================================================
// REQUIRE ADMIN
// ============================================================

export async function requireAdmin() {

  const profile =
    await requireAuth();


  const isAdmin =
    await checkIsAdmin(profile.uid);


  if (!isAdmin) {

    location.href =
      appPath("dashboard.html");

    throw new Error(
      "Administrator access required."
    );

  }


  currentAdminCache =
    true;


  return profile;

}


// ============================================================
// ERROR MESSAGE
// ============================================================

function getAuthErrorMessage(error) {

  if (!error) {
    return "Authentication failed.";
  }


  const messages = {

    "auth/invalid-email":
      "Please enter a valid email address.",

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

    "auth/popup-closed-by-user":
      "Google sign-in was cancelled.",

    "auth/popup-blocked":
      "Your browser blocked the Google sign-in window.",

    "auth/unauthorized-domain":
      "This website is not authorized in Firebase.",

    "auth/operation-not-allowed":
      "This sign-in method is not enabled.",

    "auth/network-request-failed":
      "Network error. Check your internet connection.",

    "auth/too-many-requests":
      "Too many attempts. Please wait and try again."

  };


  return (
    messages[error.code] ||
    error.message ||
    "Authentication failed."
  );

}


// ============================================================
// DISPLAY ERROR
// ============================================================

function showError(message) {

  const box =
    document.getElementById("formError") ||
    document.getElementById("authError");


  if (!box) {
    return;
  }


  box.textContent =
    message;


  box.style.display =
    "flex";

}


// ============================================================
// DEBUG
// ============================================================

window.SURE_AUTH_DEBUG = {

  user: function() {
    return auth.currentUser;
  },

  profile: function() {
    return currentProfileCache;
  },

  isAdmin: function() {
    return currentAdminCache;
  },

  ready: function() {
    return authReady;
  }

};