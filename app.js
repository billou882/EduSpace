import { initializeApp } from "firebase/app";
import { 
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, 
  onAuthStateChanged, signOut 
} from "firebase/auth";
import { 
  getFirestore, collection, addDoc, query, where, onSnapshot, 
  doc, updateDoc, deleteDoc, serverTimestamp 
} from "firebase/firestore";
import { 
  getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject 
} from "firebase/storage";

// CONFIGURATION FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSyCl-STPFTNAmNAsCO1K-CQM3hdpioqzAXg",
  authDomain: "eduspace-4f37c.firebaseapp.com",
  projectId: "eduspace-4f37c",
  storageBucket: "eduspace-4f37c.firebasestorage.app",
  messagingSenderId: "238177087925",
  appId: "1:238177087925:web:82d7cbc764a3df90cce9fc",
  measurementId: "G-N15GDZF116"
};

// INITIALISATION
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// ÉTAT GLOBAL
let currentUser = null;
let currentFolderId = "root";
let folderHistory = [{ id: "root", name: "Racine" }];
let selectedItem = null; // Élément ciblé par le clic droit

// DOM ELEMENTS
const authOverlay = document.getElementById("authOverlay");
const authForm = document.getElementById("authForm");
const userEmailInput = document.getElementById("userEmail");
const userPinInput = document.getElementById("userPin");
const displayUserEmail = document.getElementById("displayUserEmail");
const btnLogout = document.getElementById("btnLogout");

const driveContainer = document.getElementById("driveContainer");
const driveLoader = document.getElementById("driveLoader");
const btnNewFolder = document.getElementById("btnNewFolder");
const fileUploadInput = document.getElementById("fileUploadInput");
const breadcrumb = document.getElementById("breadcrumb");

const btnViewList = document.getElementById("btnViewList");
const btnViewGrid = document.getElementById("btnViewGrid");
const contextMenu = document.getElementById("contextMenu");

/* ======================================================
   1. AUTHENTIFICATION & SAUVEGARDE SUR L'APPAREIL
   ====================================================== */

// Auto-reconnaissance de l'appareil via LocalStorage (Pas besoin de se reconnecter)
document.addEventListener("DOMContentLoaded", () => {
  const savedEmail = localStorage.getItem("eduspace_email");
  const savedPin = localStorage.getItem("eduspace_pin");

  if (savedEmail && savedPin) {
    userEmailInput.value = savedEmail;
    userPinInput.value = savedPin;
    loginUser(savedEmail, savedPin);
  }
});

authForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const email = userEmailInput.value.trim();
  const pin = userPinInput.value.trim();

  if (pin.length < 4) {
    alert("Le code PIN doit contenir au moins 4 chiffres.");
    return;
  }

  loginUser(email, pin);
});

async function loginUser(email, pin) {
  // Transforme le PIN en mot de passe sécurisé pour Firebase
  const internalPassword = `EduSpace#${pin}#2026`;

  try {
    // Essaie de se connecter
    await signInWithEmailAndPassword(auth, email, internalPassword);
    saveLocalCredentials(email, pin);
  } catch (error) {
    // Si le compte n'existe pas, il le crée automatiquement
    if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
      try {
        await createUserWithEmailAndPassword(auth, email, internalPassword);
        saveLocalCredentials(email, pin);
      } catch (createErr) {
        alert("Erreur de connexion/création: " + createErr.message);
      }
    } else {
      alert("Erreur: " + error.message);
    }
  }
}

function saveLocalCredentials(email, pin) {
  localStorage.setItem("eduspace_email", email);
  localStorage.setItem("eduspace_pin", pin);
}

// SURVEILLANCE DE L'ÉTAT DE CONNEXION
onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    displayUserEmail.textContent = user.email;
    authOverlay.style.display = "none";
    loadDriveContent();
  } else {
    currentUser = null;
    authOverlay.style.display = "flex";
  }
});

btnLogout.addEventListener("click", () => {
  localStorage.removeItem("eduspace_email");
  localStorage.removeItem("eduspace_pin");
  signOut(auth);
});

/* ======================================================
   2. GESTION DU DRIVE & SYNCHRONISATION FIRESTORE
   ====================================================== */

function loadDriveContent() {
  if (!currentUser) return;

  driveLoader.style.display = "block";
  
  // Requête synchronisée en temps réel
  const q = query(
    collection(db, "users", currentUser.uid, "items"),
    where("parentId", "==", currentFolderId)
  );

  onSnapshot(q, (snapshot) => {
    driveContainer.innerHTML = "";
    
    if (snapshot.empty) {
      driveContainer.innerHTML = `<div class="empty-msg"><p>Ce dossier est vide.</p></div>`;
      return;
    }

    snapshot.forEach((docSnap) => {
      const item = { id: docSnap.id, ...docSnap.data() };
      renderDriveCard(item);
    });
  });
}

// Rendu visuel d'une carte (Dossier ou Fichier)
function renderDriveCard(item) {
  const card = document.createElement("div");
  card.className = "drive-card";
  card.dataset.id = item.id;
  card.dataset.type = item.type;

  let previewContent = "";
  let extBadge = "";

  if (item.type === "folder") {
    previewContent = `<i class="fa-solid fa-folder"></i>`;
    extBadge = `<span class="badge-ext">Dossier</span>`;
  } else {
    const ext = item.name.split('.').pop().toLowerCase();
    extBadge = `<span class="badge-ext">${ext}</span>`;

    if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) {
      previewContent = `<img src="${item.url}" alt="${item.name}">`;
    } else if (ext === "pdf") {
      previewContent = `<i class="fa-solid fa-file-pdf" style="color: #ef4444;"></i>`;
    } else {
      previewContent = `<i class="fa-solid fa-file-lines"></i>`;
    }
  }

  card.innerHTML = `
    <div class="card-preview">${previewContent}</div>
    <div class="card-footer">
      <i class="fa-solid ${item.type === 'folder' ? 'fa-folder' : 'fa-file'}"></i>
      <span class="card-title">${item.name}</span>
      ${extBadge}
    </div>
  `;

  // Clic Gauche : Ouvrir Dossier / Fichier
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

  // Clic Droit : Menu Contextuel
  card.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    selectedItem = item;
    showContextMenu(e.clientX, e.clientY);
  });

  driveContainer.appendChild(card);
}

/* ======================================================
   3. CRÉATION DOSSIER & TRANSFEERT DE FICHIERS
   ====================================================== */

// Créer un dossier
btnNewFolder.addEventListener("click", async () => {
  const folderName = prompt("Nom du nouveau dossier :");
  if (!folderName) return;

  await addDoc(collection(db, "users", currentUser.uid, "items"), {
    name: folderName,
    type: "folder",
    parentId: currentFolderId,
    createdAt: serverTimestamp()
  });
});

// Téléverser un fichier vers Firebase Storage
fileUploadInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const storageRef = ref(storage, `users/${currentUser.uid}/${Date.now()}_${file.name}`);
  const uploadTask = uploadBytesResumable(storageRef, file);

  uploadTask.on("state_changed", 
    null, 
    (error) => alert("Erreur d'envoi: " + error.message),
    async () => {
      const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
      
      // Sauvegarder les métadonnées dans Firestore
      await addDoc(collection(db, "users", currentUser.uid, "items"), {
        name: file.name,
        type: "file",
        size: file.size,
        mimeType: file.type,
        url: downloadURL,
        storagePath: storageRef.fullPath,
        parentId: currentFolderId,
        createdAt: serverTimestamp()
      });
    }
  );
});

/* ======================================================
   4. FIL D'ARIANE (BREADCRUMB) & MODES D'AFFICHAGE
   ====================================================== */

function updateBreadcrumb() {
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

// Switcher Vue Grille (Affiches 3 Colonnes) / Vue Liste Compacte
btnViewGrid.addEventListener("click", () => {
  driveContainer.className = "drive-container view-grid";
  btnViewGrid.classList.add("active");
  btnViewList.classList.remove("active");
});

btnViewList.addEventListener("click", () => {
  driveContainer.className = "drive-container view-list";
  btnViewList.classList.add("active");
  btnViewGrid.classList.remove("active");
});

/* ======================================================
   5. MENU CONTEXTUEL (RENOMMER / SUPPRIMER)
   ====================================================== */

function showContextMenu(x, y) {
  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;
  contextMenu.style.display = "block";
}

document.addEventListener("click", () => {
  contextMenu.style.display = "none";
});

// Renommer
document.getElementById("ctxRename").addEventListener("click", async () => {
  if (!selectedItem) return;
  const newName = prompt("Nouveau nom :", selectedItem.name);
  if (!newName) return;

  const itemRef = doc(db, "users", currentUser.uid, "items", selectedItem.id);
  await updateDoc(itemRef, { name: newName });
});

// Supprimer
document.getElementById("ctxDelete").addEventListener("click", async () => {
  if (!selectedItem) return;
  if (!confirm(`Supprimer "${selectedItem.name}" ?`)) return;

  // Si c'est un fichier, supprimer aussi dans Firebase Storage
  if (selectedItem.type === "file" && selectedItem.storagePath) {
    const fileRef = ref(storage, selectedItem.storagePath);
    await deleteObject(fileRef).catch(console.error);
  }

  await deleteDoc(doc(db, "users", currentUser.uid, "items", selectedItem.id));
});
