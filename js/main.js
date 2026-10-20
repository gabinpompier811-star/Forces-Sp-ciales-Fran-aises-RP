import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, push, set, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
    databaseURL: "https://fsf-rp-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "fsf-rp"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// DOM & Connexion
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
        ajouterLog(email, "CONNEXION", "Accès sécurisé au portail FSF");
    });
}

if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
        appContainer.classList.add("hidden");
        loginContainer.classList.remove("hidden");
    });
}

// NAVIGATION
const tabButtons = document.querySelectorAll(".tab-btn");
const tabContents = document.querySelectorAll(".tab-content");

tabButtons.forEach(button => {
    button.addEventListener("click", () => {
        const targetTab = button.getAttribute("data-tab");
        tabButtons.forEach(btn => btn.classList.remove("active"));
        tabContents.forEach(content => content.classList.add("hidden"));

        button.classList.add("active");
        const selected = document.getElementById(`tab-${targetTab}`);
        if (selected) selected.classList.remove("hidden");
    });
});

// LOGS
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
                const logDiv = document.createElement("div");
                logDiv.className = "log-entry";
                logDiv.innerHTML = `
                    <span style="color:#64748b;">[${log.date}]</span>
                    <span style="color:#38bdf8; font-weight:bold;">${log.utilisateur}</span>
                    <span style="color:#22c55e;">${log.action}</span>
                    <span>${log.details}</span>
                `;
                logsContainer.appendChild(logDiv);
            });
        }
    }
});
