import { initializeApp } from "firebase/app";
import { 
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, 
  onAuthStateChanged, signOut 
} from "firebase/auth";
import { 
  getFirestore, collection, addDoc, query, where, onSnapshot, 
  doc, updateDoc, deleteDoc, setDoc, getDoc, serverTimestamp 
} from "firebase/firestore";
import { 
  getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject 
} from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCl-STPFTNAmNAsCO1K-CQM3hdpioqzAXg",
  authDomain: "eduspace-4f37c.firebaseapp.com",
  projectId: "eduspace-4f37c",
  storageBucket: "eduspace-4f37c.firebasestorage.app",
  messagingSenderId: "238177087925",
  appId: "1:238177087925:web:82d7cbc764a3df90cce9fc",
  measurementId: "G-N15GDZF116"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

let currentUser = null;
let currentFolderId = "root";
let folderHistory = [{ id: "root", name: "Racine" }];
let selectedItem = null;

// DOM Elements
const authOverlay = document.getElementById("authOverlay");
const tabPass = document.getElementById("tabPass");
const tabPin = document.getElementById("tabPin");
const formPass = document.getElementById("formPass");
const formPin = document.getElementById("formPin");

const userEmailPass = document.getElementById("userEmailPass");
const userPassword = document.getElementById("userPassword");
const userEmailPin = document.getElementById("userEmailPin");
const devicePinInput = document.getElementById("devicePinInput");

const displayUserEmail = document.getElementById("displayUserEmail");
const btnLogout = document.getElementById("btnLogout");

const currentDevicePin = document.getElementById("currentDevicePin");
const pinExpiryDate = document.getElementById("pinExpiryDate");
const btnRegeneratePin = document.getElementById("btnRegeneratePin");

/* ======================================================
   1. NAVIGATION ENTRE ÉCRANS ET ONGLETS
   ====================================================== */

// Switcher les onglets de connexion
tabPass.addEventListener("click", () => {
  tabPass.classList.add("active");
  tabPin.classList.remove("active");
  formPass.classList.add("active");
  formPin.classList.remove("active");
});

tabPin.addEventListener("click", () => {
  tabPin.classList.add("active");
  tabPass.classList.remove("active");
  formPin.classList.add("active");
  formPass.classList.remove("active");
});

// Navigation menu latéral
document.querySelectorAll(".nav-btn:not(.disabled)").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".app-section").forEach(s => s.classList.remove("active"));
    
    btn.classList.add("active");
    const target = btn.dataset.target;
    document.getElementById(`section-${target}`).classList.add("active");
  });
});

/* ======================================================
   2. LOGIQUE D'AUTHENTIFICATION & SURNOM
   ====================================================== */

// Convertir un surnom en format email si nécessaire
function formatUserEmail(input) {
  if (input.includes("@")) return input;
  return `${input.toLowerCase().replace(/\s+/g, '')}@eduspace.local`;
}

// Option 1 : Connexion Email/Surnom + Mot de passe
formPass.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = formatUserEmail(userEmailPass.value.trim());
  const pass = userPassword.value.trim();

  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (error) {
    if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
      try {
        await createUserWithEmailAndPassword(auth, email, pass);
      } catch (createErr) {
        alert("Erreur de création: " + createErr.message);
      }
    } else {
      alert("Erreur: " + error.message);
    }
  }
});

// Option 2 : Connexion uniquement via Code Appareil
formPin.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = formatUserEmail(userEmailPin.value.trim());
  const pinEntered = devicePinInput.value.trim();

  try {
    // Vérifier dans Firestore si le PIN correspond
    const pinDocRef = doc(db, "devicePins", email.toLowerCase());
    const pinDoc = await getDoc(pinDocRef);

    if (!pinDoc.exists()) {
      alert("Aucun code appareil configuré pour cet utilisateur.");
      return;
    }

    const data = pinDoc.data();
    const now = new Date();
    const expiry = data.expiresAt ? data.expiresAt.toDate() : new Date(0);

    if (now > expiry) {
      alert("Ce code appareil a expiré (renouvellement mensuel requis dans les Paramètres).");
      return;
    }

    if (data.pin !== pinEntered) {
      alert("Code appareil incorrect.");
      return;
    }

    // Connexion avec le mot de passe maître stocké
    await signInWithEmailAndPassword(auth, email, data.masterPass);

  } catch (error) {
    alert("Erreur lors de la vérification du code : " + error.message);
  }
});

// Surveillance de l'état de connexion
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    displayUserEmail.textContent = user.email;
    authOverlay.style.display = "none";
    
    await checkAndAutoRenewPin();
    loadDriveContent();
  } else {
    currentUser = null;
    authOverlay.style.display = "flex";
  }
});

btnLogout.addEventListener("click", () => signOut(auth));

/* ======================================================
   3. GESTION DU CODE APPAREIL & RENOUVELLEMENT MENSUEL
   ====================================================== */

function generate6DigitPin() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function checkAndAutoRenewPin() {
  if (!currentUser) return;

  const emailKey = currentUser.email.toLowerCase();
  const pinDocRef = doc(db, "devicePins", emailKey);
  const pinDoc = await getDoc(pinDocRef);

  const now = new Date();

  if (!pinDoc.exists()) {
    await createNewDevicePin();
  } else {
    const data = pinDoc.data();
    const expiry = data.expiresAt ? data.expiresAt.toDate() : new Date(0);

    // Si le code a plus d'un mois, le renouveler automatiquement
    if (now > expiry) {
      await createNewDevicePin();
    } else {
      updatePinUI(data.pin, expiry);
    }
  }
}

async function createNewDevicePin() {
  const newPin = generate6DigitPin();
  
  // Expiration définie à +30 jours (Changement tous les mois)
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + 30);

  const emailKey = currentUser.email.toLowerCase();
  const pinDocRef = doc(db, "devicePins", emailKey);

  await setDoc(pinDocRef, {
    pin: newPin,
    expiresAt: expiryDate,
    updatedAt: serverTimestamp(),
    masterPass: "EduSpaceMasterPass#2026"
  }, { merge: true });

  updatePinUI(newPin, expiryDate);
}

function updatePinUI(pin, expiry) {
  currentDevicePin.textContent = pin;
  pinExpiryDate.textContent = `Expire le : ${expiry.toLocaleDateString()}`;
}

// Bouton de régénération manuelle dans le sous-menu Paramètres
btnRegeneratePin.addEventListener("click", async () => {
  if (confirm("Voulez-vous générer un nouveau code appareil dès maintenant ?")) {
    await createNewDevicePin();
    alert("Nouveau code généré avec succès !");
  }
});

/* ======================================================
   4. GESTION DRIVE & MENU CONTEXTUEL
   ====================================================== */

function loadDriveContent() {
  if (!currentUser) return;

  const q = query(
    collection(db, "users", currentUser.uid, "items"),
    where("parentId", "==", currentFolderId)
  );

  onSnapshot(q, (snapshot) => {
    const driveContainer = document.getElementById("driveContainer");
    driveContainer.innerHTML = "";
    
    if (snapshot.empty) {
      driveContainer.innerHTML = `<div style="grid-column: 1/-1; text-align:center; color: var(--text-muted); padding: 2rem;">Ce dossier est vide.</div>`;
      return;
    }

    snapshot.forEach((docSnap) => {
      const item = { id: docSnap.id, ...docSnap.data() };
      renderDriveCard(item);
    });
  });
}

function renderDriveCard(item) {
  const driveContainer = document.getElementById("driveContainer");
  const card = document.createElement("div");
  card.className = "drive-card";

  let previewContent = item.type === "folder" ? `<i class="fa-solid fa-folder"></i>` : `<i class="fa-solid fa-file-lines"></i>`;
  if (item.type === "file" && item.url) {
    const ext = item.name.split('.').pop().toLowerCase();
    if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) {
      previewContent = `<img src="${item.url}" alt="${item.name}">`;
    }
  }

  card.innerHTML = `
    <div class="card-preview">${previewContent}</div>
    <div class="card-footer">
      <i class="fa-solid ${item.type === 'folder' ? 'fa-folder' : 'fa-file'}"></i>
      <span class="card-title">${item.name}</span>
      <span class="badge-ext">${item.type === 'folder' ? 'DOSSIER' : 'FICHIER'}</span>
    </div>
  `;

  card.addEventListener("click", () => {
    if (item.type === "folder") {
      currentFolderId = item.id;
      folderHistory.push({ id: item.id, name: item.name });
      updateBreadcrumb();
      loadDriveContent();
    } else {
      window.open(item.url, "_blank");
    }
  });

  card.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    selectedItem = item;
    const contextMenu = document.getElementById("contextMenu");
    contextMenu.style.left = `${e.clientX}px`;
    contextMenu.style.top = `${e.clientY}px`;
    contextMenu.style.display = "block";
  });

  driveContainer.appendChild(card);
}

function updateBreadcrumb() {
  const breadcrumb = document.getElementById("breadcrumb");
  breadcrumb.innerHTML = "";
  folderHistory.forEach((crumb, index) => {
    const span = document.createElement("span");
    span.className = "crumb";
    span.textContent = index === 0 ? " Racine" : ` / ${crumb.name}`;
    span.addEventListener("click", () => {
      folderHistory = folderHistory.slice(0, index + 1);
      currentFolderId = crumb.id;
      updateBreadcrumb();
      loadDriveContent();
    });
    breadcrumb.appendChild(span);
  });
}

// Action de création de dossier
document.getElementById("btnNewFolder").addEventListener("click", async () => {
  const folderName = prompt("Nom du nouveau dossier :");
  if (!folderName) return;

  await addDoc(collection(db, "users", currentUser.uid, "items"), {
    name: folderName,
    type: "folder",
    parentId: currentFolderId,
    createdAt: serverTimestamp()
  });
});

// Action de téléversement de fichier
document.getElementById("fileUploadInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const storageRef = ref(storage, `users/${currentUser.uid}/${Date.now()}_${file.name}`);
  const uploadTask = uploadBytesResumable(storageRef, file);

  uploadTask.on("state_changed", null, 
    (err) => alert("Erreur d'envoi : " + err.message),
    async () => {
      const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
      await addDoc(collection(db, "users", currentUser.uid, "items"), {
        name: file.name,
        type: "file",
        url: downloadURL,
        storagePath: storageRef.fullPath,
        parentId: currentFolderId,
        createdAt: serverTimestamp()
      });
    }
  );
});

// Fermer le menu contextuel au clic ailleurs
document.addEventListener("click", () => {
  document.getElementById("contextMenu").style.display = "none";
});

// Menu contextuel : Renommer
document.getElementById("ctxRename").addEventListener("click", async () => {
  if (!selectedItem) return;
  const newName = prompt("Nouveau nom :", selectedItem.name);
  if (!newName) return;

  await updateDoc(doc(db, "users", currentUser.uid, "items", selectedItem.id), { name: newName });
});

// Menu contextuel : Supprimer
document.getElementById("ctxDelete").addEventListener("click", async () => {
  if (!selectedItem) return;
  if (!confirm(`Supprimer "${selectedItem.name}" ?`)) return;

  if (selectedItem.type === "file" && selectedItem.storagePath) {
    await deleteObject(ref(storage, selectedItem.storagePath)).catch(console.error);
  }

  await deleteDoc(doc(db, "users", currentUser.uid, "items", selectedItem.id));
});
