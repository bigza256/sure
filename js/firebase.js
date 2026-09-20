// ============================================================
// SURE — Firebase Configuration
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
// INITIALIZE
// ============================================================

export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

export const db = getDatabase(app);


// ============================================================
// AUTH PERSISTENCE
// ============================================================

export const authPersistence = setPersistence(
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
// APP CONFIG
// ============================================================

export const APP = {
  name: "SURE",
  tagline: "Track the Pool. Follow Every Bet.",
  currency: "UGX",
  minDeposit: 50000,
  maxDeposit: 800000,
  cycleDays: 30
};