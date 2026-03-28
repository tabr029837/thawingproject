(function initializeFirebaseApp() {
  const settings = window.FIREBASE_SETTINGS || {};
  const config = settings.config || {};
  const collections = settings.collections || {};
  const authState = {
    user: null,
    initialized: false
  };

  let resolveReady;
  const readyPromise = new Promise((resolve) => {
    resolveReady = resolve;
  });

  const isConfigured = Boolean(
    settings.enabled &&
    window.firebase &&
    config.apiKey &&
    !String(config.apiKey).startsWith("YOUR_") &&
    config.projectId &&
    !String(config.projectId).startsWith("YOUR_")
  );

  let app = null;
  let auth = null;
  let db = null;

  if (isConfigured) {
    app = firebase.apps.length ? firebase.app() : firebase.initializeApp(config);
    auth = firebase.auth(app);
    db = firebase.firestore(app);
  }

  const api = {
    whenReady: () => readyPromise,
    isConfigured: () => isConfigured,
    isAuthenticated: () => Boolean(authState.user),
    getCurrentUser: () => authState.user,
    signInWithIdentifier,
    registerWithUsername,
    signOutUser,
    getUserChickenConfigs,
    saveUserChickenConfigs,
    resetUserChickenConfigs
  };

  window.FirebaseApp = api;

  if (!isConfigured) {
    authState.initialized = true;
    renderAuthBar();
    resolveReady();
    return;
  }

  auth.onAuthStateChanged((user) => {
    authState.user = user || null;
    authState.initialized = true;
    renderAuthBar();

    if (!user && !isLoginPage()) {
      redirectToLogin();
    }

    resolveReady();
  });

  async function signInWithIdentifier(identifier, password) {
    const trimmedIdentifier = String(identifier || "").trim();
    const resolvedEmail = trimmedIdentifier.includes("@")
      ? trimmedIdentifier
      : await resolveUsernameToEmail(trimmedIdentifier);

    return auth.signInWithEmailAndPassword(resolvedEmail, password);
  }

  async function registerWithUsername({ username, email, password }) {
    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername) {
      throw new Error("Enter a username.");
    }

    const usernameRef = getUsernamesCollection().doc(normalizedUsername);
    const existingUsername = await usernameRef.get();
    if (existingUsername.exists) {
      throw new Error("That username is already taken.");
    }

    const credential = await auth.createUserWithEmailAndPassword(String(email || "").trim(), password);
    const user = credential.user;

    await Promise.all([
      user.updateProfile({ displayName: String(username || "").trim() }),
      getUsersCollection().doc(user.uid).set({
        username: String(username || "").trim(),
        usernameLower: normalizedUsername,
        email: String(email || "").trim(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true }),
      usernameRef.set({
        uid: user.uid,
        email: String(email || "").trim(),
        username: String(username || "").trim(),
        usernameLower: normalizedUsername,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      })
    ]);

    return credential;
  }

  async function signOutUser() {
    if (!isConfigured) {
      return;
    }

    await auth.signOut();
  }

  async function getUserChickenConfigs() {
    if (!authState.user) {
      return null;
    }

    const snapshot = await getUsersCollection()
      .doc(authState.user.uid)
      .collection("appData")
      .doc("chickenConfigs")
      .get();

    return snapshot.exists ? snapshot.data()?.configs || null : null;
  }

  async function saveUserChickenConfigs(configs) {
    if (!authState.user) {
      return configs;
    }

    await getUsersCollection()
      .doc(authState.user.uid)
      .collection("appData")
      .doc("chickenConfigs")
      .set({
        configs,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

    return configs;
  }

  async function resetUserChickenConfigs() {
    if (!authState.user) {
      return null;
    }

    await getUsersCollection()
      .doc(authState.user.uid)
      .collection("appData")
      .doc("chickenConfigs")
      .delete()
      .catch(() => null);

    return null;
  }

  async function resolveUsernameToEmail(username) {
    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername) {
      throw new Error("Enter a username or email.");
    }

    const snapshot = await getUsernamesCollection().doc(normalizedUsername).get();
    if (!snapshot.exists) {
      throw new Error("Username not found.");
    }

    const email = snapshot.data()?.email;
    if (!email) {
      throw new Error("That username is missing an email mapping.");
    }

    return email;
  }

  function getUsersCollection() {
    return db.collection(collections.users || "users");
  }

  function getUsernamesCollection() {
    return db.collection(collections.usernames || "usernames");
  }

  function normalizeUsername(username) {
    return String(username || "").trim().toLowerCase();
  }

  function isLoginPage() {
    return window.location.pathname.toLowerCase().endsWith("/login.html") || window.location.pathname.toLowerCase().endsWith("\\login.html");
  }

  function redirectToLogin() {
    const returnTo = encodeURIComponent(window.location.pathname.split(/[\\/]/).pop() || "index.html");
    window.location.href = `login.html?returnTo=${returnTo}`;
  }

  function renderAuthBar() {
    if (isLoginPage()) {
      return;
    }

    let bar = document.getElementById("authBar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "authBar";
      bar.className = "auth-bar";
      document.body.prepend(bar);
    }

    if (!isConfigured) {
      bar.innerHTML = `
        <div class="auth-bar-copy">
          <strong>Firebase is not configured yet.</strong>
          <span>Edit \`firebase-config.js\` and turn \`enabled\` on to require sign-in.</span>
        </div>
      `;
      return;
    }

    if (!authState.user) {
      bar.innerHTML = `
        <div class="auth-bar-copy">
          <strong>Checking sign-in...</strong>
        </div>
      `;
      return;
    }

    const label = authState.user.displayName || authState.user.email || "Signed In";
    bar.innerHTML = `
      <div class="auth-bar-copy">
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(authState.user.email || "")}</span>
      </div>
      <button type="button" class="secondary-button" id="authSignOutButton">Sign Out</button>
    `;

    bar.querySelector("#authSignOutButton")?.addEventListener("click", async () => {
      await signOutUser();
      redirectToLogin();
    });
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
})();
