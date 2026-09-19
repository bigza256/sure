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
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  getStorage,
  ref as sRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

export const firebaseConfig = {
  apiKey: "AIzaSyDEsbK7nc1KtL02OTWQcMXVvBOSULRYLMA",
  authDomain: "rysen-61d72.firebaseapp.com",
  databaseURL: "https://rysen-61d72-default-rtdb.firebaseio.com",
  projectId: "rysen-61d72",
  storageBucket: "rysen-61d72.firebasestorage.app",
  messagingSenderId: "84370846684",
  appId: "1:84370846684:web:c11fa3cc2d064e146d9519"
};

export const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getDatabase(app);
export const storage = getStorage(app);

// Re-export Firebase helpers so app modules import from one place
export {
  onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider,
  signOut, sendPasswordResetEmail, updateProfile,
  ref, get, set, update, push, remove, query, orderByChild, equalTo, onValue,
  serverTimestamp, runTransaction,
  sRef, uploadBytes, getDownloadURL
};

// ------------------ App-wide constants ------------------
export const APP = {
  name: "SURE",
  tagline: "Track the Pool. Follow Every Bet.",
  minDeposit: 50000,
  maxDeposit: 800000,
  currency: "UGX",
  cycleDays: 30
};