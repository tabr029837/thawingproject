const allocationApi = window.ChickenAllocations || {};
const allocationWeekdays = allocationApi.WEEKDAYS || ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const loadChickenConfigs = allocationApi.getChickenConfigs || (() => ({}));
const persistChickenConfigs = allocationApi.saveChickenConfigs || ((configs) => configs);
const parseAllocationValue = allocationApi.sanitizePullValue || fallbackAllocationValue;

const allocationTypeSelect = document.getElementById("allocationChickenType");
const saveButton = document.getElementById("saveAllocationsButton");
const nextAllocationButton = document.getElementById("nextAllocationButton");
const allocationMessage = document.getElementById("allocationMessage");
const allocationDefaultsPanel = document.getElementById("allocationDefaultsPanel");
const allocationAverageSalesInput = document.getElementById("allocationAverageSales");
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
  nextAllocationButton.addEventListener("click", goToNextChickenType);

  allocationAverageSalesInput.value = getSharedAverageDailySales(chickenConfigs);
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
  updateAllocationPanelState(type);
  updateNextAllocationButton();

  if (!type) {
    allocationAverageSalesInput.value = "";
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

  const sharedAverageSales = parseAllocationValue(allocationAverageSalesInput.value);

  Object.keys(chickenConfigs).forEach((configType) => {
    chickenConfigs[configType].averageDailySales = sharedAverageSales;
  });

  allocationWeekdays.forEach((day) => {
    chickenConfigs[type].pulls[day] = parseAllocationValue(document.getElementById(`allocation-${day}`).value);
  });

  chickenConfigs = await persistChickenConfigs(chickenConfigs);
  const nextType = getNextChickenType(type);
  const nextLabel = nextType ? chickenConfigs[nextType]?.label || nextType : "";
  allocationMessage.textContent = nextType
    ? `${chickenConfigs[type].label} defaults and average daily sales saved. Next up: ${nextLabel}.`
    : `${chickenConfigs[type].label} defaults and average daily sales saved.`;
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

function updateAllocationPanelState(type) {
  allocationDefaultsPanel.classList.toggle("is-hidden", !type);
  allocationDefaultsPanel.classList.toggle("is-open", Boolean(type));
}

function getOrderedChickenTypes() {
  return Array.from(allocationTypeSelect.options)
    .map((option) => option.value)
    .filter(Boolean);
}

function getNextChickenType(currentType) {
  const orderedTypes = getOrderedChickenTypes();
  const currentIndex = orderedTypes.indexOf(currentType);

  if (currentIndex === -1 || currentIndex >= orderedTypes.length - 1) {
    return "";
  }

  return orderedTypes[currentIndex + 1];
}

function updateNextAllocationButton() {
  const currentType = allocationTypeSelect.value;
  const nextType = getNextChickenType(currentType);

  nextAllocationButton.disabled = !nextType;
  nextAllocationButton.textContent = nextType
    ? `Go To ${chickenConfigs[nextType]?.label || nextType}`
    : "All Chicken Types Complete";
}

function goToNextChickenType() {
  const nextType = getNextChickenType(allocationTypeSelect.value);
  if (!nextType) {
    return;
  }

  allocationTypeSelect.value = nextType;
  loadSelectedChickenValues();
}

function getSharedAverageDailySales(configs) {
  const firstType = Object.keys(configs || {})[0];
  return firstType ? configs[firstType]?.averageDailySales ?? 0 : 0;
}
