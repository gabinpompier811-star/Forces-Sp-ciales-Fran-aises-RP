// Importation des fonctions de Firebase depuis les serveurs officiels (CDN)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, get, child } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// REMPLACEZ ces valeurs par les vôtres (trouvées dans les paramètres de votre projet Firebase)
const firebaseConfig = {
  apiKey: "VOTRE_API_KEY",
  authDomain: "votre-projet.firebaseapp.com",
  databaseURL: "https://fsf-rp-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "fsf-rp",
  storageBucket: "fsf-rp.appspot.com",
  messagingSenderId: "VOTRE_MESSAGING_SENDER_ID",
  appId: "VOTRE_APP_ID"
};

// Initialisation de Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Petit test pour vérifier que la page communique bien avec Firebase
const statusElement = document.getElementById("firebase-status");

if (statusElement) {
    statusElement.textContent = "Connecté avec succès à Firebase ! (Base de données prête)";
    statusElement.style.color = "lightgreen";
}

// Exemple : Fonction pour enregistrer des données de test dans votre Realtime Database
function ecrireDonneesTest() {
    set(ref(db, 'test/'), {
        message: "Le site GitHub est bien connecté à Firebase !",
        date: new Date().toISOString()
    });
}

// Vous pouvez décommenter la ligne ci-dessous pour tester l'écriture dans votre base de données au premier chargement :
// ecrireDonneesTest();
