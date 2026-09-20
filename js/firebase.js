// ============================================
// SURE — Firebase bootstrap (single source)
// Track the Pool. Follow Every Bet.
// ============================================

import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getAuth,
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


// ============================================
// Firebase configuration
// Project: sure-ug
// ============================================

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


// ============================================
// Initialise Firebase
// ============================================

export const app = initializeApp(
  firebaseConfig
);


// ============================================
// Firebase Authentication
// ============================================

export const auth = getAuth(
  app
);


// ============================================
// Firebase Realtime Database
// ============================================

export const db = getDatabase(
  app
);


// ============================================
// Re-export Authentication helpers
// ============================================

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


// ============================================
// Re-export Realtime Database helpers
// ============================================

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


// ============================================
// App-wide constants
// ============================================

export const APP = {

  name: "SURE",

  tagline: "Track the Pool. Follow Every Bet.",

  minDeposit: 50000,

  maxDeposit: 800000,

  currency: "UGX",

  cycleDays: 30

};