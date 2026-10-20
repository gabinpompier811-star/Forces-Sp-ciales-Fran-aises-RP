import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, push, set, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
    databaseURL: "https://fsf-rp-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "fsf-rp"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Connexion DOM
const loginForm = document.getElementById("login-form");
const loginContainer = document.getElementById("login-container");
const appContainer = document.getElementById("app-container");
const logoutBtn = document.getElementById("logout-btn");

if (loginForm) {
    loginForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const email = document.getElementById("login-email").value;
        loginContainer.classList.add("hidden");
        appContainer.classList.remove("hidden");
        ajouterLog(email, "CONNEXION", "Utilisateur connecté au portail ENA / FSF");
    });
}

if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
        appContainer.classList.add("hidden");
        loginContainer.classList.remove("hidden");
    });
}

// Navigation multi-onglets
const navTabButtons = document.querySelectorAll(".nav-tab-btn");
const tabContents = document.querySelectorAll(".tab-content");

navTabButtons.forEach(button => {
    button.addEventListener("click", () => {
        const targetTab = button.getAttribute("data-tab");
        navTabButtons.forEach(btn => btn.classList.remove("active"));
        tabContents.forEach(content => content.classList.add("hidden"));

        button.classList.add("active");
        const selected = document.getElementById(`tab-${targetTab}`);
        if (selected) selected.classList.remove("hidden");
    });
});

// Logs Firebase
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

const logsRef = ref(db, 'logs/');
onValue(logsRef, (snapshot) => {
    const data = snapshot.val();
    const logsContainer = document.getElementById("logs-container");
    if (logsContainer) {
        logsContainer.innerHTML = "";
        if (data) {
            Object.values(data).reverse().forEach(log => {
                const row = document.createElement("div");
                row.className = "log-row";
                row.innerHTML = `
                    <span class="log-time">${log.date}</span>
                    <span class="log-mail">${log.utilisateur}</span>
                    <span class="log-act">${log.action}</span>
                    <span>${log.details}</span>
                `;
                logsContainer.appendChild(row);
            });
        }
    }
});
