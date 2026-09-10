// Wayne Gang — Firebase initialization
// Uses the Firebase v10 modular SDK loaded directly from CDN — no build step needed.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCKSjih2vOylIPWsilgwtnqyVkmoIKiEFQ",
  authDomain: "cabo-de506.firebaseapp.com",
  projectId: "cabo-de506",
  storageBucket: "cabo-de506.firebasestorage.app",
  messagingSenderId: "100710290804",
  appId: "1:100710290804:web:8a7bd34ec50fc427734821",
  measurementId: "G-YZPXQR1NE0",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

export {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
};
