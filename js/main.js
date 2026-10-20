import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, push, set, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// Remplacez par vos clés de configuration Firebase
const firebaseConfig = {
  databaseURL: "https://fsf-rp-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "fsf-rp"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Éléments du DOM
const loginForm = document.getElementById("login-form");
const loginContainer = document.getElementById("login-container");
const appContainer = document.getElementById("app-container");
const logoutBtn = document.getElementById("logout-btn");

// Gestion de la Connexion
loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = document.getElementById("login-email").value;
    
    // Simulation de connexion réussi
    loginContainer.classList.add("hidden");
    appContainer.classList.remove("hidden");

    // Ajouter un log de connexion dans Firebase
    ajouterLog(email, "CONNEXION", "Utilisateur connecté au portail");
});

logoutBtn.addEventListener("click", () => {
    appContainer.classList.add("hidden");
    loginContainer.classList.remove("hidden");
});

// Navigation entre Onglets
const tabButtons = document.querySelectorAll(".tab-btn");
const tabContents = document.querySelectorAll(".tab-content");

tabButtons.forEach(button => {
    button.addEventListener("click", () => {
        const targetTab = button.getAttribute("data-tab");

        tabButtons.forEach(btn => btn.classList.remove("active"));
        tabContents.forEach(content => content.classList.add("hidden"));

        button.classList.add("active");
        document.getElementById(`tab-${targetTab}`).classList.remove("hidden");
    });
});

// Fonction pour enregistrer un log dans Firebase
function ajouterLog(utilisateur, action, details) {
    const logRef = ref(db, 'logs/');
    const newLogRef = push(logRef);
    set(newLogRef, {
        date: new Date().toLocaleString("fr-FR"),
        utilisateur: utilisateur,
        action: action,
        details: details
    });
}
