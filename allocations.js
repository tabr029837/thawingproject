const allocationApi = window.ChickenAllocations || {};
const allocationWeekdays = allocationApi.WEEKDAYS || ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const loadChickenConfigs = allocationApi.getChickenConfigs || (() => ({}));
const persistChickenConfigs = allocationApi.saveChickenConfigs || ((configs) => configs);
const restoreChickenConfigs = allocationApi.resetChickenConfigs || (() => ({}));
const parseAllocationValue = allocationApi.sanitizePullValue || fallbackAllocationValue;

const allocationTypeSelect = document.getElementById("allocationChickenType");
const saveButton = document.getElementById("saveAllocationsButton");
const resetButton = document.getElementById("resetAllocationsButton");
const allocationMessage = document.getElementById("allocationMessage");
const APP_THEME_CLASSES = [
  "theme-filets",
  "theme-breakfast-filets",
  "theme-nuggets",
  "theme-strips",
  "theme-grilled-filets",
  "theme-grilled-nuggets",
  "theme-spicy-filets",
  "theme-spicy-breakfast-filets"
];
const THEME_CLASS_BY_TYPE = {
  filets: "theme-filets",
  "breakfast filets": "theme-breakfast-filets",
  nuggets: "theme-nuggets",
  strips: "theme-strips",
  "grilled filets": "theme-grilled-filets",
  "grilled nuggets": "theme-grilled-nuggets",
  "spicy filets": "theme-spicy-filets",
  "spicy breakfast filets": "theme-spicy-breakfast-filets"
};

let chickenConfigs = loadChickenConfigs();

bootstrapAllocationsPage();

async function bootstrapAllocationsPage() {
  await allocationApi.ready?.();
  chickenConfigs = loadChickenConfigs();
  initializeAllocationsPage();
}

function initializeAllocationsPage() {
  populateChickenTypes();
  allocationTypeSelect.addEventListener("change", loadSelectedChickenValues);
  saveButton.addEventListener("click", saveCurrentAllocations);
  resetButton.addEventListener("click", resetAllAllocations);

  allocationTypeSelect.value = "";
  loadSelectedChickenValues();
  updateAllocationPlaceholderStyle();
  applyAppTheme("");
}

function populateChickenTypes() {
  const selectedValue = allocationTypeSelect.value;
  allocationTypeSelect.innerHTML = '<option value="">Select Chicken Type</option>';

  Object.entries(chickenConfigs).forEach(([value, config]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = config.label;
    allocationTypeSelect.appendChild(option);
  });

  allocationTypeSelect.value = chickenConfigs[selectedValue] ? selectedValue : "";
}

function loadSelectedChickenValues() {
  const type = allocationTypeSelect.value;
  const pulls = chickenConfigs[type]?.pulls || {};
  updateAllocationPlaceholderStyle();
  applyAppTheme(type);

  if (!type) {
    allocationWeekdays.forEach((day) => {
      document.getElementById(`allocation-${day}`).value = "";
    });
    allocationMessage.textContent = "";
    return;
  }

  allocationWeekdays.forEach((day) => {
    document.getElementById(`allocation-${day}`).value = pulls[day] ?? 0;
  });

  allocationMessage.textContent = "";
}

async function saveCurrentAllocations() {
  const type = allocationTypeSelect.value;

  if (!type || !chickenConfigs[type]) {
    return;
  }

  allocationWeekdays.forEach((day) => {
    chickenConfigs[type].pulls[day] = parseAllocationValue(document.getElementById(`allocation-${day}`).value);
  });

  chickenConfigs = await persistChickenConfigs(chickenConfigs);
  allocationMessage.textContent = `${chickenConfigs[type].label} defaults saved.`;
}

async function resetAllAllocations() {
  chickenConfigs = await restoreChickenConfigs();
  populateChickenTypes();
  allocationTypeSelect.value = "";
  loadSelectedChickenValues();
  allocationMessage.textContent = "All chicken defaults were reset.";
}

function updateAllocationPlaceholderStyle() {
  allocationTypeSelect.classList.toggle("placeholder-state", !allocationTypeSelect.value);
}

function fallbackAllocationValue(value) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function applyAppTheme(type) {
  document.body.classList.remove(...APP_THEME_CLASSES);

  const themeClass = THEME_CLASS_BY_TYPE[type];
  if (themeClass) {
    document.body.classList.add(themeClass);
  }
}
