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

let currentCalendarDate = new Date();

// DOM Elements
const authOverlay = document.getElementById("authOverlay");
const displayUserEmail = document.getElementById("displayUserEmail");
const btnLogout = document.getElementById("btnLogout");

// Settings Modal
const settingsModal = document.getElementById("settingsModal");
const btnOpenSettings = document.getElementById("btnOpenSettings");
const closeSettingsModal = document.getElementById("closeSettingsModal");
const currentDevicePin = document.getElementById("currentDevicePin");
const pinExpiryDate = document.getElementById("pinExpiryDate");
const btnRegeneratePin = document.getElementById("btnRegeneratePin");

// Drive & Navigation
const btnDriveBack = document.getElementById("btnDriveBack");
const dropZone = document.getElementById("dropZone");

/* ======================================================
   1. GESTION DU MODAL INTUITIF
   ====================================================== */

const customModal = document.getElementById("customModal");
const modalTitle = document.getElementById("modalTitle");
const modalDescription = document.getElementById("modalDescription");
const modalInputContainer = document.getElementById("modalInputContainer");
const modalInput = document.getElementById("modalInput");
const modalBtnConfirm = document.getElementById("modalBtnConfirm");
const modalBtnCancel = document.getElementById("modalBtnCancel");
const modalCloseX = document.getElementById("modalCloseX");
let modalResolve = null;

function showModal({ title, description, showInput = false, defaultValue = "", confirmText = "Valider" }) {
  return new Promise((resolve) => {
    modalResolve = resolve;
    modalTitle.textContent = title;
    modalDescription.textContent = description;
    modalBtnConfirm.textContent = confirmText;

    if (showInput) {
      modalInputContainer.style.display = "block";
      modalInput.value = defaultValue;
      setTimeout(() => modalInput.focus(), 100);
    } else {
      modalInputContainer.style.display = "none";
    }

    customModal.classList.add("active");
  });
}

function closeModal(result = null) {
  customModal.classList.remove("active");
  if (modalResolve) {
    modalResolve(result);
    modalResolve = null;
  }
}

modalBtnConfirm.addEventListener("click", () => {
  const isInputVisible = modalInputContainer.style.display !== "none";
  closeModal(isInputVisible ? modalInput.value.trim() : true);
});
modalBtnCancel.addEventListener("click", () => closeModal(null));
modalCloseX.addEventListener("click", () => closeModal(null));

/* ======================================================
   2. AUTHENTIFICATION & NAVIGATION
   ====================================================== */

document.querySelectorAll(".nav-btn:not(.disabled)").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".app-section").forEach(s => s.classList.remove("active"));
    
    btn.classList.add("active");
    const target = btn.dataset.target;
    document.getElementById(`section-${target}`).classList.add("active");
  });
});

function formatUserEmail(input) {
  if (input.includes("@")) return input;
  return `${input.toLowerCase().replace(/\s+/g, '')}@eduspace.local`;
}

document.getElementById("formPass").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = formatUserEmail(document.getElementById("userEmailPass").value.trim());
  const pass = document.getElementById("userPassword").value.trim();

  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (error) {
    if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
      try {
        await createUserWithEmailAndPassword(auth, email, pass);
      } catch (createErr) {
        showModal({ title: "Erreur d'inscription", description: createErr.message });
      }
    } else {
      showModal({ title: "Erreur de connexion", description: error.message });
    }
  }
});

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    displayUserEmail.textContent = user.email;
    authOverlay.style.display = "none";
    
    await checkAndAutoRenewPin();
    loadDriveContent();
    renderCalendar();
  } else {
    currentUser = null;
    authOverlay.style.display = "flex";
  }
});

btnLogout.addEventListener("click", () => signOut(auth));

/* ======================================================
   3. PARAMÈTRES DANS LE MODAL
   ====================================================== */

btnOpenSettings.addEventListener("click", () => settingsModal.classList.add("active"));
closeSettingsModal.addEventListener("click", () => settingsModal.classList.remove("active"));

function generate6DigitPin() { return Math.floor(100000 + Math.random() * 900000).toString(); }

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
    if (now > expiry) await createNewDevicePin();
    else updatePinUI(data.pin, expiry);
  }
}

async function createNewDevicePin() {
  const newPin = generate6DigitPin();
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + 30);

  const emailKey = currentUser.email.toLowerCase();
  await setDoc(doc(db, "devicePins", emailKey), {
    pin: newPin, expiresAt: expiryDate, updatedAt: serverTimestamp(), masterPass: "EduSpaceMasterPass#2026"
  }, { merge: true });

  updatePinUI(newPin, expiryDate);
}

function updatePinUI(pin, expiry) {
  currentDevicePin.textContent = pin;
  pinExpiryDate.textContent = `Expire le : ${expiry.toLocaleDateString()}`;
}

btnRegeneratePin.addEventListener("click", async () => {
  const confirmed = await showModal({ title: "Nouveau Code", description: "Voulez-vous générer un nouveau code ?", confirmText: "Générer" });
  if (confirmed) {
    await createNewDevicePin();
    showModal({ title: "Succès", description: "Nouveau code créé." });
  }
});

/* ======================================================
   4. AGENDA - TABLEAU MENSUEL
   ====================================================== */

function renderCalendar() {
  const grid = document.getElementById("calendarDaysGrid");
  const monthYearLabel = document.getElementById("calendarMonthYear");
  grid.innerHTML = "";

  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();

  const monthNames = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
  monthYearLabel.textContent = `${monthNames[month]} ${year}`;

  const firstDayIndex = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Ajustement pour commencer le Lundi (0=Dimanche)
  const startingDay = firstDayIndex === 0 ? 6 : firstDayIndex - 1;

  for (let i = 0; i < startingDay; i++) {
    const emptyDiv = document.createElement("div");
    emptyDiv.className = "cal-day empty";
    grid.appendChild(emptyDiv);
  }

  const today = new Date();

  for (let day = 1; day <= daysInMonth; day++) {
    const dayDiv = document.createElement("div");
    dayDiv.className = "cal-day";
    
    if (day === today.getDate() && month === today.getMonth() && year === today.getFullYear()) {
      dayDiv.classList.add("today");
    }

    dayDiv.innerHTML = `<span class="day-number">${day}</span>`;
    grid.appendChild(dayDiv);
  }
}

document.getElementById("btnPrevMonth").addEventListener("click", () => {
  currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
  renderCalendar();
});

document.getElementById("btnNextMonth").addEventListener("click", () => {
  currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
  renderCalendar();
});

/* ======================================================
   5. EDUDRIVE - GLISSER/DÉPOSER & RETOUR
   ====================================================== */

// Gestion du bouton retour
btnDriveBack.addEventListener("click", () => {
  if (folderHistory.length > 1) {
    folderHistory.pop();
    const parentFolder = folderHistory[folderHistory.length - 1];
    currentFolderId = parentFolder.id;
    updateBreadcrumb();
    loadDriveContent();
  }
});

function loadDriveContent() {
  if (!currentUser) return;

  btnDriveBack.disabled = folderHistory.length <= 1;

  const q = query(
    collection(db, "users", currentUser.uid, "items"),
    where("parentId", "==", currentFolderId)
  );

  onSnapshot(q, (snapshot) => {
    const driveContainer = document.getElementById("driveContainer");
    driveContainer.innerHTML = "";
    
    if (snapshot.empty) {
      driveContainer.innerHTML = `<div style="grid-column: 1/-1; text-align:center; color: var(--text-muted); padding: 3rem;"><i class="fa-solid fa-folder-open" style="font-size: 2.5rem; margin-bottom: 0.5rem;"></i><p>Dossier vide. Glissez des fichiers ici pour les ajouter !</p></div>`;
      return;
    }

    snapshot.forEach((docSnap) => {
      renderDriveCard({ id: docSnap.id, ...docSnap.data() });
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
    } else if (ext === "pdf") {
      previewContent = `<i class="fa-solid fa-file-pdf" style="color: #ef4444;"></i>`;
    }
  }

  card.innerHTML = `
    <div class="card-preview">${previewContent}</div>
    <div class="card-footer">
      <i class="fa-solid ${item.type === 'folder' ? 'fa-folder' : 'fa-file'}"></i>
      <span class="card-title">${item.name}</span>
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

// GLISSER - DÉPOSER (DRAG AND DROP)
['dragenter', 'dragover'].forEach(eventName => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  }, false);
});

['dragleave', 'drop'].forEach(eventName => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
  }, false);
});

dropZone.addEventListener('drop', (e) => {
  const files = e.dataTransfer.files;
  if (files.length > 0) uploadFiles(files);
});

document.getElementById("fileUploadInput").addEventListener("change", (e) => {
  if (e.target.files.length > 0) uploadFiles(e.target.files);
});

async function uploadFiles(files) {
  for (let file of files) {
    await processFileUpload(file);
  }
}

function processFileUpload(file) {
  return new Promise((resolve) => {
    const progressContainer = document.getElementById("uploadProgressContainer");
    const progressBar = document.getElementById("uploadProgressBar");
    const progressText = document.getElementById("uploadPercent");
    const fileNameText = document.getElementById("uploadFileName");

    progressContainer.style.display = "block";
    fileNameText.textContent = `Envoi de : ${file.name}`;

    const storageRef = ref(storage, `users/${currentUser.uid}/${Date.now()}_${file.name}`);
    const uploadTask = uploadBytesResumable(storageRef, file);

    uploadTask.on("state_changed", 
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        progressBar.style.width = `${progress}%`;
        progressText.textContent = `${Math.round(progress)}%`;
      }, 
      (err) => {
        progressContainer.style.display = "none";
        showModal({ title: "Erreur d'envoi", description: err.message });
        resolve();
      },
      async () => {
        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
        await addDoc(collection(db, "users", currentUser.uid, "items"), {
          name: file.name, type: "file", url: downloadURL,
          storagePath: storageRef.fullPath, parentId: currentFolderId, createdAt: serverTimestamp()
        });
        progressContainer.style.display = "none";
        progressBar.style.width = "0%";
        resolve();
      }
    );
  });
}

// Nouveau Dossier
document.getElementById("btnOpenNewFolderModal").addEventListener("click", async () => {
  const folderName = await showModal({ title: "Nouveau Dossier", description: "Nom du dossier :", showInput: true, confirmText: "Créer" });
  if (!folderName) return;

  await addDoc(collection(db, "users", currentUser.uid, "items"), {
    name: folderName, type: "folder", parentId: currentFolderId, createdAt: serverTimestamp()
  });
});

// Menu contextuel
document.addEventListener("click", () => document.getElementById("contextMenu").style.display = "none");

document.getElementById("ctxRename").addEventListener("click", async () => {
  if (!selectedItem) return;
  const newName = await showModal({ title: "Renommer", description: "Nouveau nom :", showInput: true, defaultValue: selectedItem.name, confirmText: "Enregistrer" });
  if (!newName) return;
  await updateDoc(doc(db, "users", currentUser.uid, "items", selectedItem.id), { name: newName });
});

document.getElementById("ctxDelete").addEventListener("click", async () => {
  if (!selectedItem) return;
  const confirmed = await showModal({ title: "Supprimer", description: `Supprimer "${selectedItem.name}" ?`, confirmText: "Supprimer" });
  if (!confirmed) return;

  if (selectedItem.type === "file" && selectedItem.storagePath) {
    await deleteObject(ref(storage, selectedItem.storagePath)).catch(console.error);
  }
  await deleteDoc(doc(db, "users", currentUser.uid, "items", selectedItem.id));
});
