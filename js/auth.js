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

const USERS_PATH = "users";
const ADMINS_PATH = "admins";


// ============================================================
// SURE BASE PATH
// ============================================================

const SURE_BASE = "/sure/";


// ============================================================
// INTERNAL AUTH STATE
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
// CHECK ADMIN
// ============================================================

export async function checkIsAdmin(uid) {

  if (!uid) {
    return false;
  }

  try {

    const snapshot = await get(
      ref(db, `${ADMINS_PATH}/${uid}`)
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
// CREATE USER PROFILE
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
// LOAD USER PROFILE
// ============================================================

export async function loadUserProfile(uid) {

  if (!uid) {
    return null;
  }

  const snapshot = await get(
    ref(db, `${USERS_PATH}/${uid}`)
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
// ENSURE USER PROFILE EXISTS
// ============================================================

async function ensureUserProfile(user) {

  if (!user?.uid) {
    return null;
  }

  const existing =
    await loadUserProfile(user.uid);

  if (existing) {
    return existing;
  }


  // Determine provider

  let provider = "password";

  if (Array.isArray(user.providerData)) {

    const googleProvider =
      user.providerData.some(
        item =>
          item?.providerId === "google.com"
      );

    if (googleProvider) {
      provider = "google";
    }
  }


  // Create profile

  const profile = createProfile({

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


  await set(
    ref(db, `${USERS_PATH}/${user.uid}`),
    profile
  );


  return profile;
}


// ============================================================
// HANDLE SUSPENDED ACCOUNT
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
    appPath("login.html?suspended=1");


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
    "SURE: Firebase user:",
    user.uid
  );


  const profile =
    await ensureUserProfile(user);


  if (!profile) {

    throw new Error(
      "Could not load or create the SURE profile."
    );
  }


  if (
    await handleSuspendedAccount(profile)
  ) {

    return null;
  }


  profileCache = profile;


  adminCache =
    await checkIsAdmin(user.uid);


  return profile;
}


// ============================================================
// AUTH STATE OBSERVER
// ============================================================

onAuthStateChanged(
  auth,
  async (user) => {

    try {

      const profile =
        await processAuthenticatedUser(user);


      if (!authInitialized) {

        authInitialized = true;

        resolveAuthReady(profile);
      }


      window.dispatchEvent(
        new CustomEvent(
          "sure:auth",
          {
            detail: {

              user:
                user || null,

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
        "SURE: Auth initialization failed:",
        error
      );


      authInitializationError =
        error;


      if (!authInitialized) {

        authInitialized = true;

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
// AUTH STATE ACCESS
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
// REGISTER USER
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


  if (name) {

    await updateProfile(
      user,
      {
        displayName:
          String(name).trim()
      }
    );
  }


  const profile =
    createProfile({

      uid:
        user.uid,

      name,

      email:
        user.email ||
        email,

      phone,

      provider:
        "password"
    });


  await set(
    ref(
      db,
      `${USERS_PATH}/${user.uid}`
    ),

    profile
  );


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


  const profile =
    await ensureUserProfile(user);


  if (!profile) {

    throw new Error(
      "Your account was authenticated, but your SURE profile could not be loaded."
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


  // Mobile browsers use redirect

  if (isMobile()) {

    await signInWithRedirect(
      auth,
      provider
    );

    return null;
  }


  // Desktop browsers use popup

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
      "Google authentication succeeded, but the SURE profile could not be created."
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
    await checkIsAdmin(user.uid);


  return profile;
}


// ============================================================
// LOGOUT
// ============================================================

export async function logoutUser() {

  await signOut(auth);


  profileCache = null;
  adminCache = false;


  location.href =
    appPath("login.html");
}


// ============================================================
// PASSWORD RESET
// ============================================================

export async function resetPassword(
  email
) {

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

  await whenAuthReady();


  // Firebase Authentication is
  // the actual authentication source.

  const user =
    auth.currentUser;


  console.log(
    "SURE requireAuth:",
    {
      firebaseUser:
        user?.uid || null,

      profile:
        profileCache?.uid || null
    }
  );


  // No Firebase user means
  // the user is genuinely signed out.

  if (!user) {

    location.href =
      redirect.startsWith("/")
        ? redirect
        : appPath(redirect);

    throw new Error(
      "Not authenticated."
    );
  }


  // Recover the profile if needed.

  let finalProfile =
    profileCache;


  if (!finalProfile) {

    finalProfile =
      await ensureUserProfile(user);
  }


  if (!finalProfile) {

    throw new Error(
      "You are signed in, but your SURE profile could not be loaded."
    );
  }


  if (
    await handleSuspendedAccount(
      finalProfile
    )
  ) {

    throw new Error(
      "Account suspended."
    );
  }


  profileCache =
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

    const profile =
      await whenAuthReady();

    const user =
      auth.currentUser;


    if (!user || !profile) {
      return;
    }


    const pathname =
      location.pathname;


    const isLoginPage =
      /\/login\.html$/i
        .test(pathname);


    const isRegisterPage =
      /\/register\.html$/i
        .test(pathname);


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


    if (adminCache) {

      location.href =
        appPath(
          "admin/index.html"
        );

    } else {

      location.href =
        appPath(
          "dashboard.html"
        );
    }


  } catch (error) {

    console.error(
      "SURE: Entry-page redirect failed:",
      error
    );
  }
}


// ============================================================
// START ENTRY PAGE CHECK
// ============================================================

authReadyPromise.then(
  () => {
    handleEntryPage();
  }
);


// ============================================================
// DEBUG TOOLS
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