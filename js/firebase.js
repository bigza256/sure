// ============================================
// SURE — Firebase bootstrap (single source)
// ============================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
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
  runTransaction,
  enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

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

export const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getDatabase(app);

// Offline cache — repeat visits load instantly
enableIndexedDbPersistence(db).catch(() => {
  // Ignored — fails harmlessly if another tab already holds the lock
});

// Re-export Firebase helpers so app modules import from one place
export {
  onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider,
  signOut, sendPasswordResetEmail, updateProfile,
  ref, get, set, update, push, remove, query, orderByChild, equalTo, onValue,
  serverTimestamp, runTransaction
};

export const APP = {
  name: "SURE",
  tagline: "Track the Pool. Follow Every Bet.",
  minDeposit: 50000,
  maxDeposit: 800000,
  currency: "UGX",
  cycleDays: 30
};
