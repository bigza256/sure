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

const USERS_PATH = "users";
const ADMINS_PATH = "admins";


// ============================================================
// SITE PATH
// ============================================================

const SURE_BASE = "/sure/";


// ============================================================
// INTERNAL STATE
// ============================================================

let profileCache = null;
let adminCache = false;

let authInitialized = false;
let authInitializationError = null;

let resolveAuthReady;

const authReadyPromise = new Promise((resolve) => {
  resolveAuthReady = resolve;
});


// ============================================================
// PROFILE OPERATION LOCKS
//
// Prevents multiple parts of the application from trying
// to create the same user profile simultaneously.
//
// Example:
//
// Google login
//       ↓
// Firebase auth state
//       ↓
// loginWithGoogle()
//       ↓
// onAuthStateChanged()
//       ↓
// requireAuth()
//
// All of them can request the same profile.
//
// They must share ONE operation.
// ============================================================

const profileCreationPromises = new Map();


// ============================================================
// HELPERS
// ============================================================

function isMobile() {

  return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i
    .test(navigator.userAgent);

}


function appPath(file) {

  return `${SURE_BASE}${file}`;

}


function showAuthError(message) {

  const box =
    document.getElementById("formError") ||
    document.getElementById("authError");

  if (!box) return;

  box.textContent = message;
  box.style.display = "flex";

}


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
      "This website is not authorized in Firebase Authentication.",

    "auth/operation-not-allowed":
      "This sign-in method is not enabled in Firebase.",

    "auth/network-request-failed":
      "Network error. Check your internet connection.",

    "auth/too-many-requests":
      "Too many attempts. Please wait and try again.",

    "auth/api-key-not-valid.-please-pass-a-valid-api-key.":
      "The Firebase API key is invalid."

  };

  return (
    messages[error.code] ||
    error.message ||
    "Authentication failed."
  );

}


// ============================================================
// ADMIN CHECK
// ============================================================

export async function checkIsAdmin(uid) {

  if (!uid) {
    return false;
  }

  try {

    const snapshot =
      await get(
        ref(
          db,
          `${ADMINS_PATH}/${uid}`
        )
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


export function currentIsAdmin() {

  return adminCache;

}


// ============================================================
// CREATE PROFILE
// ============================================================

function createProfile({
  uid,
  name,
  email,
  phone = "",
  provider = "password"
}) {

  return {

    uid,

    name: String(
      name || "User"
    )
      .trim()
      .slice(0, 100),

    email: String(
      email || ""
    )
      .trim()
      .toLowerCase(),

    phone: String(
      phone || ""
    ).trim(),

    role: "user",

    status: "active",

    provider,

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

  const snapshot =
    await get(
      ref(
        db,
        `${USERS_PATH}/${uid}`
      )
    );

  if (!snapshot.exists()) {
    return null;
  }

  return {

    uid,
    ...snapshot.val()

  };

}


// ============================================================
// ENSURE PROFILE EXISTS
//
// IMPORTANT:
//
// This function is now concurrency-safe.
//
// If multiple parts of the application call this function
// for the same UID at the same time, only ONE profile
// creation request is performed.
//
// Everyone else waits for the same Promise.
// ============================================================

async function ensureUserProfile(user) {

  if (!user?.uid) {
    return null;
  }

  const uid =
    user.uid;


  // ----------------------------------------------------------
  // Check whether a profile already exists.
  // ----------------------------------------------------------

  const existing =
    await loadUserProfile(uid);

  if (existing) {

    console.log(
      "SURE: Existing profile found:",
      uid
    );

    return existing;

  }


  // ----------------------------------------------------------
  // If another part of the application is already creating
  // this exact profile, wait for that operation.
  // ----------------------------------------------------------

  if (
    profileCreationPromises.has(uid)
  ) {

    console.log(
      "SURE: Profile creation already in progress:",
      uid
    );

    return await profileCreationPromises.get(uid);

  }


  // ----------------------------------------------------------
  // Create ONE shared creation operation.
  // ----------------------------------------------------------

  const creationPromise =
    (async () => {

      try {

        // Re-check inside the lock.
        //
        // This protects against another operation having
        // completed between the first check and this point.

        const latest =
          await loadUserProfile(uid);

        if (latest) {

          console.log(
            "SURE: Profile appeared during creation:",
            uid
          );

          return latest;

        }


        // ----------------------------------------------------
        // Determine provider.
        // ----------------------------------------------------

        let provider =
          "password";

        if (
          Array.isArray(
            user.providerData
          )
        ) {

          const googleProvider =
            user.providerData.some(
              item =>
                item?.providerId === "google.com"
            );

          if (googleProvider) {

            provider =
              "google";

          }

        }


        // ----------------------------------------------------
        // Build profile.
        // ----------------------------------------------------

        const profile =
          createProfile({

            uid,

            name:
              user.displayName ||
              "User",

            email:
              user.email ||
              "",

            phone:
              "",

            provider

          });


        console.log(
          "SURE: Creating profile:",
          profile
        );


        // ----------------------------------------------------
        // Write profile.
        // ----------------------------------------------------

        await set(
          ref(
            db,
            `${USERS_PATH}/${uid}`
          ),
          profile
        );


        console.log(
          "SURE: Profile created successfully:",
          uid
        );


        return profile;

      } catch (error) {

        console.error(
          "SURE: Profile creation failed:",
          error
        );

        throw error;

      }

    })();


  // ----------------------------------------------------------
  // Store the shared operation.
  // ----------------------------------------------------------

  profileCreationPromises.set(
    uid,
    creationPromise
  );


  try {

    return await creationPromise;

  } finally {

    // Remove the lock after completion.
    profileCreationPromises.delete(uid);

  }

}


// ============================================================
// SUSPENDED ACCOUNT
// ============================================================

async function handleSuspendedAccount(profile) {

  if (
    !profile ||
    profile.status !== "suspended"
  ) {
    return false;
  }

  try {

    await signOut(auth);

  } catch (error) {

    console.error(
      "SURE: Sign-out failed:",
      error
    );

  }

  profileCache = null;
  adminCache = false;

  location.href =
    appPath(
      "login.html?suspended=1"
    );

  return true;

}


// ============================================================
// PROCESS AUTHENTICATED USER
// ============================================================

async function processAuthenticatedUser(user) {

  if (!user) {

    profileCache = null;
    adminCache = false;

    return null;

  }

  console.log(
    "SURE: Firebase authenticated:",
    user.uid
  );

  try {

    const profile =
      await ensureUserProfile(user);

    if (!profile) {

      throw new Error(
        "Could not load or create SURE user profile."
      );

    }

    if (
      await handleSuspendedAccount(profile)
    ) {

      return null;

    }

    profileCache =
      profile;

    adminCache =
      await checkIsAdmin(
        user.uid
      );

    return profile;

  } catch (error) {

    console.error(
      "SURE: Profile loading failed:",
      error
    );

    profileCache = null;
    adminCache = false;

    throw error;

  }

}


// ============================================================
// AUTH STATE INITIALIZATION
//
// Firebase Auth determines whether the user is logged in.
//
// Profile creation/loading happens AFTER authentication.
//
// ============================================================

onAuthStateChanged(
  auth,
  async (user) => {

    console.log(
      "SURE: Auth state:",
      user?.uid || "SIGNED OUT"
    );


    // --------------------------------------------------------
    // Resolve authentication promise immediately on the
    // FIRST Firebase auth event.
    //
    // We do NOT wait for RTDB profile loading here.
    // --------------------------------------------------------

    if (!authInitialized) {

      authInitialized = true;

      resolveAuthReady(
        user || null
      );

    }


    // --------------------------------------------------------
    // No authenticated user.
    // --------------------------------------------------------

    if (!user) {

      profileCache = null;
      adminCache = false;

      window.dispatchEvent(
        new CustomEvent(
          "sure:auth",
          {
            detail: {
              user: null,
              profile: null,
              isAdmin: false
            }
          }
        )
      );

      return;

    }


    // --------------------------------------------------------
    // Authenticated user.
    //
    // Profile creation/loading is centralized here.
    // --------------------------------------------------------

    try {

      const profile =
        await processAuthenticatedUser(
          user
        );

      window.dispatchEvent(
        new CustomEvent(
          "sure:auth",
          {
            detail: {
              user,

              profile:
                profile || null,

              isAdmin:
                adminCache

            }
          }
        )
      );

    } catch (error) {

      console.error(
        "SURE: Profile loading failed:",
        error
      );

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
//
// Kept for compatibility with an existing redirect session.
//
// Normal Google login below uses POPUP.
// ============================================================

(async () => {

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
      "SURE: Google redirect failed:",
      error
    );

    showAuthError(
      getAuthErrorMessage(error)
    );

  }

})();


// ============================================================
// AUTH ACCESS
// ============================================================

export function whenAuthReady() {

  return authReadyPromise;

}


export function currentUser() {

  return auth.currentUser;

}


export function currentProfile() {

  return profileCache;

}


export function isAuthReady() {

  return authInitialized;

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


  // ----------------------------------------------------------
  // Update Firebase Auth profile first.
  // ----------------------------------------------------------

  if (name) {

    await updateProfile(
      user,
      {
        displayName:
          String(name).trim()
      }
    );

  }


  // ----------------------------------------------------------
  // Use the same concurrency-safe profile function.
  //
  // We no longer perform a separate raw set() here.
  // ----------------------------------------------------------

  const profile =
    await ensureUserProfile(user);


  if (!profile) {

    throw new Error(
      "Account was created, but the SURE profile could not be created."
    );

  }


  profileCache =
    profile;

  adminCache =
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

  console.log(
    "SURE: LOGIN SUCCESS:",
    user.uid
  );


  // ----------------------------------------------------------
  // Use the concurrency-safe profile function.
  //
  // If onAuthStateChanged is already doing this, both calls
  // share the same profile creation Promise.
  // ----------------------------------------------------------

  try {

    const profile =
      await ensureUserProfile(user);

    if (!profile) {

      throw new Error(
        "Authentication succeeded, but the SURE profile could not be loaded."
      );

    }

    if (
      await handleSuspendedAccount(profile)
    ) {

      throw new Error(
        "This account has been suspended."
      );

    }

    profileCache =
      profile;

    adminCache =
      await checkIsAdmin(
        user.uid
      );

    return profile;

  } catch (error) {

    console.error(
      "SURE: Login succeeded but profile processing failed:",
      error
    );

    /*
     * We intentionally DO NOT sign out.
     */

    throw error;

  }

}


// ============================================================
// GOOGLE LOGIN
//
// POPUP is used on ALL devices.
//
// ============================================================

export async function loginWithGoogle() {

  await authPersistence;

  const provider =
    new GoogleAuthProvider();

  provider.setCustomParameters({
    prompt: "select_account"
  });


  console.log(
    "SURE: Starting Google popup login..."
  );

  console.log(
    "SURE: Browser:",
    navigator.userAgent
  );

  console.log(
    "SURE: Mobile detected:",
    isMobile()
  );


  try {

    const credential =
      await signInWithPopup(
        auth,
        provider
      );

    const user =
      credential.user;


    console.log(
      "SURE: Google popup authenticated:",
      user.uid
    );

    console.log(
      "SURE: Google account:",
      user.email
    );


    // --------------------------------------------------------
    // IMPORTANT:
    //
    // This uses the concurrency-safe profile function.
    //
    // onAuthStateChanged() may also be calling it.
    //
    // Both calls will share ONE profile creation operation.
    // --------------------------------------------------------

    const profile =
      await ensureUserProfile(user);


    if (!profile) {

      throw new Error(
        "Google authentication succeeded, but the SURE profile could not be created."
      );

    }


    console.log(
      "SURE: Google profile ready:",
      profile.uid
    );


    if (
      await handleSuspendedAccount(profile)
    ) {

      throw new Error(
        "This account has been suspended."
      );

    }


    profileCache =
      profile;

    adminCache =
      await checkIsAdmin(
        user.uid
      );


    console.log(
      "SURE: Google login completed successfully."
    );


    return profile;

  } catch (error) {

    console.error(
      "SURE: Google popup login failed:",
      error
    );

    console.error(
      "SURE: Google error code:",
      error?.code || "NO_CODE"
    );

    console.error(
      "SURE: Google error message:",
      error?.message || "NO_MESSAGE"
    );


    showAuthError(
      getAuthErrorMessage(error)
    );


    throw error;

  }

}


// ============================================================
// LOGOUT
// ============================================================

export async function logoutUser() {

  await signOut(auth);

  profileCache = null;
  adminCache = false;

  location.href =
    appPath(
      "login.html"
    );

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

export async function requireAuth(
  redirect = "login.html"
) {

  /*
   * Wait ONLY for Firebase Auth.
   */

  const user =
    await whenAuthReady();


  console.log(
    "SURE requireAuth:",
    user?.uid || "NO USER"
  );


  /*
   * This is the ONLY initial login check.
   */

  if (!user || !auth.currentUser) {

    console.warn(
      "SURE: No Firebase session."
    );

    location.href =
      redirect.startsWith("/")
        ? redirect
        : appPath(redirect);

    throw new Error(
      "Not authenticated."
    );

  }


  /*
   * Firebase says the user is authenticated.
   *
   * Now obtain their SURE profile.
   */

  let profile =
    profileCache;


  if (
    !profile ||
    profile.uid !== user.uid
  ) {

    profile =
      await ensureUserProfile(
        user
      );

  }


  if (!profile) {

    throw new Error(
      "You are authenticated, but your SURE profile could not be loaded."
    );

  }


  if (
    await handleSuspendedAccount(profile)
  ) {

    throw new Error(
      "Account suspended."
    );

  }


  profileCache =
    profile;

  adminCache =
    await checkIsAdmin(
      user.uid
    );


  return profile;

}


// ============================================================
// REQUIRE ADMIN
// ============================================================

export async function requireAdmin() {

  const profile =
    await requireAuth(
      "login.html"
    );

  const isAdmin =
    await checkIsAdmin(
      profile.uid
    );


  if (!isAdmin) {

    location.href =
      appPath(
        "dashboard.html"
      );

    throw new Error(
      "Administrator access required."
    );

  }


  adminCache =
    true;


  return profile;

}


// ============================================================
// AUTO REDIRECT FROM LOGIN / REGISTER
// ============================================================

async function handleEntryPage() {

  try {

    const user =
      await whenAuthReady();


    if (!user) {
      return;
    }


    const pathname =
      location.pathname;


    const isLoginPage =
      /\/login\.html$/i.test(
        pathname
      );


    const isRegisterPage =
      /\/register\.html$/i.test(
        pathname
      );


    const isRootPage =
      pathname === "/sure/" ||
      pathname.endsWith(
        "/sure/index.html"
      );


    if (
      !isLoginPage &&
      !isRegisterPage &&
      !isRootPage
    ) {

      return;

    }


    let profile =
      profileCache;


    if (!profile) {

      profile =
        await ensureUserProfile(
          user
        );

      profileCache =
        profile;

    }


    if (!profile) {
      return;
    }


    adminCache =
      await checkIsAdmin(
        user.uid
      );


    console.log(
      "SURE: Entry redirect:",
      adminCache
        ? "ADMIN"
        : "USER"
    );


    location.href =
      adminCache
        ? appPath(
            "admin/index.html"
          )
        : appPath(
            "dashboard.html"
          );


  } catch (error) {

    console.error(
      "SURE: Entry redirect failed:",
      error
    );


    /*
     * Do NOT redirect to login here.
     */

  }

}


// ============================================================
// START ENTRY PAGE CHECK
// ============================================================

handleEntryPage();


// ============================================================
// DEBUG
// ============================================================

window.SURE_AUTH_DEBUG = {

  user() {

    return auth.currentUser;

  },


  profile() {

    return profileCache;

  },


  isAdmin() {

    return adminCache;

  },


  ready() {

    return authInitialized;

  },


  error() {

    return authInitializationError;

  }

};


// ============================================================
// COMPLETE
// ============================================================

console.log(
  "SURE authentication system loaded."
);