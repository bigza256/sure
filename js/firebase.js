// ============================================================
// SURE — Firebase Configuration & Services
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
// FIREBASE CONFIGURATION
// ============================================================

export const firebaseConfig = {
  apiKey: "AIzaSyBeDrCRP_aTDcAbmc-so90SHFBVnujcwbE",
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

export const app =
  initializeApp(firebaseConfig);


// ============================================================
// FIREBASE AUTH
// ============================================================

export const auth =
  getAuth(app);


// ============================================================
// REALTIME DATABASE
// ============================================================

export const db =
  getDatabase(app);


// ============================================================
// AUTH PERSISTENCE
// ============================================================
//
// Keeps the user signed in after:
// - page refresh
// - navigating between pages
// - closing/reopening the browser
//
// Firebase supports browserLocalPersistence for this purpose.
// ============================================================

export const authPersistence =
  setPersistence(
    auth,
    browserLocalPersistence
  );


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
