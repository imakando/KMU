// firebase-config.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyDrjo_HDQ1RRkjA-zXgZtuFovI7zg2yma0",
  authDomain: "kmu-digita-rsc-mnt-system.firebaseapp.com",
  databaseURL: "https://kmu-digita-rsc-mnt-system-default-rtdb.firebaseio.com",
  projectId: "kmu-digita-rsc-mnt-system",
  storageBucket: "kmu-digita-rsc-mnt-system.firebasestorage.app",
  messagingSenderId: "908284620214",
  appId: "1:908284620214:web:e76e9a4757c162eea1a517",
  measurementId: "G-JEPQ1YMVNE"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };