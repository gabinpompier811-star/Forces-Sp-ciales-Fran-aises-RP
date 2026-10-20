import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, push, set, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// Configuration Firebase
const firebaseConfig = {
    databaseURL: "https://fsf-rp-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "fsf-rp"
};

// Initialisation
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Éléments DOM
const loginForm = document.getElementById("login-form");
const loginContainer = document.getElementById("login-container");
const appContainer = document.getElementById("app-container");
const logoutBtn = document.getElementById("logout-btn");
const tabButtons = document.querySelectorAll(".tab-btn");
const tabContents = document.querySelectorAll(".tab-content");
const logsContainer = document.getElementById("logs-container");

// GESTION DE LA CONNEXION
if (loginForm) {
    loginForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const emailInput = document.getElementById("login-email");
        const email = emailInput ? emailInput.value : "Anonyme";

        // Bascule d'affichage
        if (loginContainer && appContainer) {
            loginContainer.classList.add("hidden");
            appContainer.classList.remove("hidden");
        }

        // Enregistrer le log de connexion dans Firebase
        ajouterLog(email, "CONNEXION", "Accès au portail réussi");
    });
}

// GESTION DE LA DÉCONNEXION
if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
        if (loginContainer && appContainer) {
            appContainer.classList.add("hidden");
            loginContainer.classList.remove("hidden");
        }
    });
}

// NAVIGATION ENTRE LES ONGLETS
tabButtons.forEach(button => {
    button.addEventListener("click", () => {
        const targetTab = button.getAttribute("data-tab");

        // Désactiver tous les onglets
        tabButtons.forEach(btn => btn.classList.remove("active"));
        tabContents.forEach(content => content.classList.add("hidden"));

        // Activer l'onglet sélectionné
        button.classList.add("active");
        const selectedContent = document.getElementById(`tab-${targetTab}`);
        if (selectedContent) {
            selectedContent.classList.remove("hidden");
        }
    });
});

// FONCTION : ENREGISTRER UN LOG DANS FIREBASE
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

// ÉCOUTER LES LOGS EN TEMPS RÉEL DEPUIS FIREBASE
const logsRef = ref(db, 'logs/');
onValue(logsRef, (snapshot) => {
    const data = snapshot.val();
    if (logsContainer) {
        logsContainer.innerHTML = "";
        if (data) {
            Object.values(data).reverse().forEach(log => {
                const logDiv = document.createElement("div");
                logDiv.className = "log-entry";
                logDiv.innerHTML = `
                    <span class="log-date">[${log.date}]</span>
                    <span class="log-user">${log.utilisateur}</span>
                    <span class="log-action">${log.action}</span>
                    <span class="log-details">${log.details}</span>
                `;
                logsContainer.appendChild(logDiv);
            });
        } else {
            logsContainer.innerHTML = "<p class='empty-text'>Aucun log enregistré.</p>";
        }
    }
});
