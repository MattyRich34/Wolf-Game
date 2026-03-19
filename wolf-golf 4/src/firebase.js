import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyBpR2rAC4mgnXwTF1bUUU_pf77NHMd6b3Y",
  authDomain: "wolf-game-55aad.firebaseapp.com",
  databaseURL: "https://wolf-game-55aad-default-rtdb.firebaseio.com",
  projectId: "wolf-game-55aad",
  storageBucket: "wolf-game-55aad.firebasestorage.app",
  messagingSenderId: "701464271788",
  appId: "1:701464271788:web:f62af3f189ec3125073809"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
