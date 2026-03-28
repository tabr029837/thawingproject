const signInForm = document.getElementById("signInForm");
const registerForm = document.getElementById("registerForm");
const authMessage = document.getElementById("authMessage");
const showSignInButton = document.getElementById("showSignInButton");
const showRegisterButton = document.getElementById("showRegisterButton");

initializeLoginPage();

async function initializeLoginPage() {
  await window.FirebaseApp?.whenReady?.();

  if (!window.FirebaseApp?.isConfigured?.()) {
    authMessage.textContent = "Firebase is not configured yet. Edit firebase-config.js and set enabled to true.";
    return;
  }

  if (window.FirebaseApp.isAuthenticated()) {
    goToReturnPage();
    return;
  }

  showSignInButton.addEventListener("click", () => setAuthMode("signin"));
  showRegisterButton.addEventListener("click", () => setAuthMode("register"));

  signInForm.addEventListener("submit", handleSignIn);
  registerForm.addEventListener("submit", handleRegister);
}

async function handleSignIn(event) {
  event.preventDefault();
  authMessage.textContent = "";

  const identifier = document.getElementById("signInIdentifier").value;
  const password = document.getElementById("signInPassword").value;

  try {
    await window.FirebaseApp.signInWithIdentifier(identifier, password);
    goToReturnPage();
  } catch (error) {
    authMessage.textContent = error.message || "Unable to sign in.";
  }
}

async function handleRegister(event) {
  event.preventDefault();
  authMessage.textContent = "";

  const username = document.getElementById("registerUsername").value;
  const email = document.getElementById("registerEmail").value;
  const password = document.getElementById("registerPassword").value;

  try {
    await window.FirebaseApp.registerWithUsername({ username, email, password });
    goToReturnPage();
  } catch (error) {
    authMessage.textContent = error.message || "Unable to create account.";
  }
}

function setAuthMode(mode) {
  const isRegister = mode === "register";
  registerForm.classList.toggle("is-hidden", !isRegister);
  signInForm.classList.toggle("is-hidden", isRegister);
}

function goToReturnPage() {
  const params = new URLSearchParams(window.location.search);
  const returnTo = params.get("returnTo") || "index.html";
  window.location.href = returnTo;
}
