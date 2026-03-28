const DEFAULT_CHICKEN_CONFIGS = {
  filets: { label: "Filets", pulls: { Mon: 30, Tue: 28, Wed: 32, Thu: 35, Fri: 45, Sat: 50 } },
  "breakfast filets": { label: "Breakfast Filets", pulls: { Mon: 14, Tue: 14, Wed: 16, Thu: 16, Fri: 18, Sat: 20 } },
  nuggets: { label: "Nuggets", pulls: { Mon: 20, Tue: 22, Wed: 25, Thu: 27, Fri: 35, Sat: 40 } },
  strips: { label: "Strips", pulls: { Mon: 10, Tue: 12, Wed: 12, Thu: 14, Fri: 18, Sat: 20 } },
  "grilled filets": { label: "Grilled Filets", pulls: { Mon: 8, Tue: 8, Wed: 10, Thu: 10, Fri: 12, Sat: 12 } },
  "grilled nuggets": { label: "Grilled Nuggets", pulls: { Mon: 6, Tue: 6, Wed: 8, Thu: 8, Fri: 10, Sat: 10 } },
  "spicy filets": { label: "Spicy Filets", pulls: { Mon: 12, Tue: 12, Wed: 14, Thu: 15, Fri: 18, Sat: 20 } },
  "spicy breakfast filets": { label: "Spicy Breakfast Filets", pulls: { Mon: 6, Tue: 6, Wed: 8, Thu: 8, Fri: 10, Sat: 10 } }
};

const STORAGE_KEY = "chickenPullConfigs";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
let cachedConfigs = cloneDefaultConfigs();
let configsLoaded = false;
const configReadyPromise = initializeConfigStore();

function sanitizePullValue(value) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function cloneDefaultConfigs() {
  return JSON.parse(JSON.stringify(DEFAULT_CHICKEN_CONFIGS));
}

function normalizeConfigs(configs) {
  const normalized = cloneDefaultConfigs();

  Object.entries(configs || {}).forEach(([type, config]) => {
    if (!normalized[type]) {
      return;
    }

    normalized[type].label = config.label || normalized[type].label;

    WEEKDAYS.forEach((day) => {
      normalized[type].pulls[day] = sanitizePullValue(config.pulls?.[day]);
    });
  });

  return normalized;
}

function getChickenConfigs() {
  if (!configsLoaded) {
    return cloneDefaultConfigs();
  }

  return normalizeConfigs(cachedConfigs);
}

async function initializeConfigStore() {
  cachedConfigs = await loadConfigsFromAvailableStore();
  configsLoaded = true;
  return getChickenConfigs();
}

async function ready() {
  return configReadyPromise;
}

async function loadConfigsFromAvailableStore() {
  await window.FirebaseApp?.whenReady?.();

  if (window.FirebaseApp?.isAuthenticated?.()) {
    const remoteConfigs = await window.FirebaseApp.getUserChickenConfigs();
    if (remoteConfigs) {
      return normalizeConfigs(remoteConfigs);
    }
  }

  const stored = localStorage.getItem(STORAGE_KEY);

  if (!stored) {
    return cloneDefaultConfigs();
  }

  try {
    return normalizeConfigs(JSON.parse(stored));
  } catch (error) {
    return cloneDefaultConfigs();
  }
}

function saveChickenConfigs(configs) {
  const normalized = normalizeConfigs(configs);
  cachedConfigs = normalized;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));

  return Promise.resolve()
    .then(async () => {
      await window.FirebaseApp?.whenReady?.();
      if (window.FirebaseApp?.isAuthenticated?.()) {
        await window.FirebaseApp.saveUserChickenConfigs(normalized);
      }

      return normalized;
    });
}

function resetChickenConfigs() {
  cachedConfigs = cloneDefaultConfigs();
  localStorage.removeItem(STORAGE_KEY);
  return Promise.resolve()
    .then(async () => {
      await window.FirebaseApp?.whenReady?.();
      if (window.FirebaseApp?.isAuthenticated?.()) {
        await window.FirebaseApp.resetUserChickenConfigs();
      }

      return cloneDefaultConfigs();
    });
}

window.ChickenAllocations = {
  STORAGE_KEY,
  WEEKDAYS,
  ready,
  sanitizePullValue,
  getChickenConfigs,
  saveChickenConfigs,
  resetChickenConfigs
};
