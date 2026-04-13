const allocationsApi = window.ChickenAllocations || {};
const appWeekdays = allocationsApi.WEEKDAYS || ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const readPullValue = allocationsApi.sanitizePullValue || fallbackSanitizePullValue;
const readChickenConfigs = allocationsApi.getChickenConfigs || fallbackGetChickenConfigs;

const FALLBACK_CHICKEN_CONFIGS = {
  filets: { label: "Filets", averageDailySales: 0, pulls: { Mon: 30, Tue: 28, Wed: 32, Thu: 35, Fri: 45, Sat: 50 } },
  "breakfast filets": { label: "Breakfast Filets", averageDailySales: 0, pulls: { Mon: 14, Tue: 14, Wed: 16, Thu: 16, Fri: 18, Sat: 20 } },
  nuggets: { label: "Nuggets", averageDailySales: 0, pulls: { Mon: 20, Tue: 22, Wed: 25, Thu: 27, Fri: 35, Sat: 40 } },
  strips: { label: "Strips", averageDailySales: 0, pulls: { Mon: 10, Tue: 12, Wed: 12, Thu: 14, Fri: 18, Sat: 20 } },
  "grilled filets": { label: "Grilled Filets", averageDailySales: 0, pulls: { Mon: 8, Tue: 8, Wed: 10, Thu: 10, Fri: 12, Sat: 12 } },
  "grilled nuggets": { label: "Grilled Nuggets", averageDailySales: 0, pulls: { Mon: 6, Tue: 6, Wed: 8, Thu: 8, Fri: 10, Sat: 10 } },
  "spicy filets": { label: "Spicy Filets", averageDailySales: 0, pulls: { Mon: 12, Tue: 12, Wed: 14, Thu: 15, Fri: 18, Sat: 20 } },
  "spicy breakfast filets": { label: "Spicy Breakfast Filets", averageDailySales: 0, pulls: { Mon: 6, Tue: 6, Wed: 8, Thu: 8, Fri: 10, Sat: 10 } }
};

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const chickenTypeSelect = document.getElementById("chickenType");
const startDateInput = document.getElementById("startDate");
const weeksToBuildInput = document.getElementById("weeksToBuild");
const pullModeInputs = document.querySelectorAll('input[name="pullMode"]');
const tableBody = document.getElementById("tableBody");
const loadDefaultsButton = document.getElementById("loadDefaultsButton");
const analyzeButton = document.getElementById("analyzeButton");
const step1Panel = document.getElementById("step1Panel");
const step2Panel = document.getElementById("step2Panel");
const step3Panel = document.getElementById("step3Panel");
const step1NextButton = document.getElementById("step1NextButton");
const step2NextButton = document.getElementById("step2NextButton");
const step1Hint = document.getElementById("step1Hint");
const step2Hint = document.getElementById("step2Hint");
const step2Title = document.getElementById("step2Title");
const step2Copy = document.getElementById("step2Copy");
const step3Number = document.getElementById("step3Number");
const step3Title = document.getElementById("step3Title");
const step3Copy = document.getElementById("step3Copy");
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

let chickenConfigs = safeGetConfigs();
let step2Unlocked = false;
let step3Unlocked = false;
let tableGenerated = false;

bootstrapApp();

async function bootstrapApp() {
  await allocationsApi.ready?.();
  chickenConfigs = safeGetConfigs();
  initialize();
}

function initialize() {
  populateChickenTypes();

  chickenTypeSelect.addEventListener("change", handleChickenTypeChange);
  startDateInput.addEventListener("input", handleSetupDetailsChange);
  weeksToBuildInput.addEventListener("input", handleSetupDetailsChange);
  loadDefaultsButton.addEventListener("click", handleLoadDefaults);
  analyzeButton.addEventListener("click", saveAndGo);
  step1NextButton.addEventListener("click", handleStep1Next);
  step2NextButton.addEventListener("click", unlockStep3);

  pullModeInputs.forEach((input) => {
    input.addEventListener("change", handlePullModeChange);
  });

  appWeekdays.forEach((day) => {
    document.getElementById(`pull-${day}`).addEventListener("input", handlePullPlanChange);
  });

  chickenTypeSelect.value = "";
  clearPullInputs();
  updateChickenTypePlaceholderStyle();
  applyAppTheme("");
  updateStepState();
}

function safeGetConfigs() {
  const configs = readChickenConfigs();
  return Object.keys(configs || {}).length > 0 ? configs : fallbackGetChickenConfigs();
}

function getSelectedPullMode() {
  const checked = Array.from(pullModeInputs).find((input) => input.checked);
  return checked?.value || "";
}

function handleChickenTypeChange() {
  loadDefaultsForSelectedType();
  resetDownstreamProgress();
  updateChickenTypePlaceholderStyle();
  applyAppTheme(chickenTypeSelect.value);
  updateStepState();
}

function handleSetupDetailsChange() {
  resetDownstreamProgress();
  updateStepState();
}

function handlePullModeChange() {
  resetDownstreamProgress();
  updateStepState();
}

function handleLoadDefaults() {
  chickenConfigs = safeGetConfigs();
  const selectedBeforeRefresh = chickenTypeSelect.value;

  populateChickenTypes();
  chickenTypeSelect.value = chickenConfigs[selectedBeforeRefresh] ? selectedBeforeRefresh : "";
  loadDefaultsForSelectedType();
  resetDownstreamProgress();
  updateChickenTypePlaceholderStyle();
  applyAppTheme(chickenTypeSelect.value);
  updateStepState();
}

function handlePullPlanChange() {
  tableGenerated = false;
  analyzeButton.disabled = true;
  resetGeneratedTable();
  updateStepState();
}

function populateChickenTypes() {
  const selectedValue = chickenTypeSelect.value;
  chickenTypeSelect.innerHTML = '<option value="">Select Chicken Type</option>';

  Object.entries(chickenConfigs).forEach(([value, config]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = config.label;
    chickenTypeSelect.appendChild(option);
  });

  const nextValue = chickenConfigs[selectedValue] ? selectedValue : "";
  chickenTypeSelect.value = nextValue;
}

function getFirstChickenType() {
  return Object.keys(chickenConfigs)[0] || "filets";
}

function handleStep1Next() {
  if (!isStep1Complete()) {
    return;
  }

  if (getSelectedPullMode() === "modify") {
    step2Unlocked = true;
    step3Unlocked = false;
    updateStepState();
    step2Panel.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  step2Unlocked = false;
  step3Unlocked = true;
  generateTable();
  updateStepState();
  step3Panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function unlockStep3() {
  if (!isStep2Complete()) {
    return;
  }

  step3Unlocked = true;
  generateTable();
  updateStepState();
  step3Panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateStepState() {
  const step1Complete = isStep1Complete();
  const usingModifyMode = getSelectedPullMode() === "modify";
  const step2Complete = isStep2Complete();

  step1NextButton.disabled = !step1Complete;
  step1NextButton.textContent = usingModifyMode ? "Next: Modify Build To Numbers" : "Next: Analyzer Chart";

  if (!step1Complete) {
    step2Unlocked = false;
    step3Unlocked = false;
  }

  if (!usingModifyMode) {
    step2Unlocked = false;
  }

  step2NextButton.disabled = !step2Complete;
  if (!step2Unlocked) {
    step3Unlocked = step3Unlocked && !usingModifyMode;
  } else {
    step3Unlocked = step3Unlocked && step2Complete;
  }

  step2Panel.classList.toggle("is-hidden", !usingModifyMode);
  step2Panel.classList.toggle("is-locked", usingModifyMode && !step2Unlocked);
  step2Panel.classList.toggle("is-open", usingModifyMode && step2Unlocked);

  step3Panel.classList.toggle("is-locked", !step3Unlocked);
  step3Panel.classList.toggle("is-open", step3Unlocked);

  step1Panel.classList.toggle("is-complete", step1Complete);
  step2Panel.classList.toggle("is-complete", usingModifyMode && step2Complete && step2Unlocked);

  step1Hint.textContent = step1Complete
    ? usingModifyMode
      ? "Setup complete. Continue to modify the build-to numbers."
      : "Setup complete. Continue straight to the analyzer chart."
    : "Choose a chicken type, start date, weeks, and build-to option to continue.";

  step2Hint.textContent = step2Complete
    ? "Build-to plan complete. You can move to daily input."
    : "Fill in the build-to plan for Monday through Saturday.";

  step2Title.textContent = "Modify Build To Numbers";
  step2Copy.textContent = "Adjust the Monday through Saturday build-to plan before you build the analyzer chart.";
  step3Number.textContent = usingModifyMode ? "Step 3" : "Step 2";
  step3Title.textContent = "Analyzer Chart";
  step3Copy.textContent = "Generate the chart, then enter build-to and usage sold for each day.";

  analyzeButton.disabled = !step3Unlocked || !tableGenerated;
}

function isStep1Complete() {
  const type = chickenTypeSelect.value;
  const startDateValue = startDateInput.value;
  const weeksToBuild = readPullValue(weeksToBuildInput.value);
  const pullMode = getSelectedPullMode();

  return Boolean(type) && Boolean(startDateValue) && weeksToBuild >= 1 && weeksToBuild <= 8 && Boolean(pullMode);
}

function isStep2Complete() {
  return appWeekdays.every((day) => document.getElementById(`pull-${day}`).value !== "");
}

function loadDefaultsForSelectedType() {
  const type = chickenTypeSelect.value;
  const defaults = chickenConfigs[type]?.pulls || {};

  if (!type) {
    clearPullInputs();
    return;
  }

  appWeekdays.forEach((day) => {
    document.getElementById(`pull-${day}`).value = defaults[day] ?? "";
  });
}

function clearPullInputs() {
  appWeekdays.forEach((day) => {
    document.getElementById(`pull-${day}`).value = "";
  });
}

function updateChickenTypePlaceholderStyle() {
  chickenTypeSelect.classList.toggle("placeholder-state", !chickenTypeSelect.value);
}

function readWeeklyPlan() {
  const weeklyPlan = {};

  appWeekdays.forEach((day) => {
    const rawValue = document.getElementById(`pull-${day}`).value;
    weeklyPlan[day] = readPullValue(rawValue);
  });

  return weeklyPlan;
}

function generateTable() {
  const type = chickenTypeSelect.value;
  const startDateValue = startDateInput.value;
  const weeksToBuild = Math.max(1, Math.min(8, readPullValue(weeksToBuildInput.value) || 4));

  if (!step3Unlocked || !type || !startDateValue) {
    alert("Complete the earlier steps first.");
    return;
  }

  const weeklyPlan = readWeeklyPlan();
  const startDate = new Date(`${startDateValue}T12:00:00`);
  const targetRows = weeksToBuild * 6;

  tableBody.innerHTML = "";

  let currentDate = new Date(startDate);
  let builtRows = 0;

  while (builtRows < targetRows) {
    const dayName = dayNames[currentDate.getDay()];

    if (dayName !== "Sun") {
      const plannedBuildTo = weeklyPlan[dayName] ?? 0;
      const row = document.createElement("tr");

      row.innerHTML = `
        <td>${formatDate(currentDate)}</td>
        <td>${dayName}</td>
        <td class="entry-cell actual-column"><input type="number" class="build-to" min="0" step="0.1" value="${plannedBuildTo}" aria-label="${dayName} build to"></td>
        <td class="entry-cell usage-column"><input type="number" class="usage-sold" min="0" step="0.1" value="" aria-label="${dayName} usage sold"></td>
        <td class="daily-pull" aria-label="${dayName} daily pull">0</td>
      `;

      tableBody.appendChild(row);
      builtRows += 1;
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  tableGenerated = true;
  setupDerivedPulls();
  setupColumnTabbing();
  focusFirstUsageInput();
}

function saveAndGo() {
  const type = chickenTypeSelect.value;
  const rows = document.querySelectorAll("#tableBody tr");

  if (!type || rows.length === 0 || tableBody.querySelector(".empty-state")) {
    alert("Generate a daily table first.");
    return;
  }

  const payload = {
    type,
    chickenLabel: chickenConfigs[type]?.label || type,
    averageDailySales: readPullValue(chickenConfigs[type]?.averageDailySales),
    weeklyPlan: readWeeklyPlan(),
    assumptions: {
      thawLeadDays: 2,
      expireAfterPullDays: 4
    },
    data: Array.from(rows).map((row) => {
      const cells = row.querySelectorAll("td");
      return {
        date: cells[0].textContent,
        day: cells[1].textContent,
        buildTo: readPullValue(row.querySelector(".build-to")?.value),
        sold: readPullValue(row.querySelector(".usage-sold")?.value)
      };
    })
  };

  localStorage.setItem("thawData", JSON.stringify(payload));
  window.location.href = "analyzer.html";
}

function resetGeneratedTable() {
  tableBody.innerHTML = `
    <tr>
      <td colspan="5" class="empty-state">Generate a table to start entering data.</td>
    </tr>
  `;
}

function setupColumnTabbing() {
  const usageInputs = Array.from(document.querySelectorAll(".usage-sold"));

  usageInputs.forEach((input, index) => {
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") {
        return;
      }

      const nextIndex = event.shiftKey ? index - 1 : index + 1;
      const targetInput = usageInputs[nextIndex];

      if (!targetInput) {
        return;
      }

      event.preventDefault();
      targetInput.focus();
      targetInput.select();
    });
  });
}

function setupDerivedPulls() {
  const rows = Array.from(document.querySelectorAll("#tableBody tr"));

  rows.forEach((row) => {
    const buildToInput = row.querySelector(".build-to");
    const usageInput = row.querySelector(".usage-sold");

    [buildToInput, usageInput].forEach((input) => {
      if (!input) {
        return;
      }

      input.addEventListener("input", () => updateDerivedPullForRow(row));
    });

    updateDerivedPullForRow(row);
  });
}

function updateDerivedPullForRow(row) {
  const usageValue = readPullValue(row.querySelector(".usage-sold")?.value);
  const dailyPull = roundDailyPull(usageValue);
  const dailyPullCell = row.querySelector(".daily-pull");

  if (dailyPullCell) {
    dailyPullCell.textContent = formatDisplayNumber(dailyPull);
  }
}

function focusFirstUsageInput() {
  const firstUsageInput = document.querySelector(".usage-sold");
  if (!firstUsageInput) {
    return;
  }

  firstUsageInput.focus();
  firstUsageInput.select();
}

function resetDownstreamProgress() {
  step2Unlocked = false;
  step3Unlocked = false;
  tableGenerated = false;
  analyzeButton.disabled = true;
  resetGeneratedTable();
}

function fallbackGetChickenConfigs() {
  return JSON.parse(JSON.stringify(FALLBACK_CHICKEN_CONFIGS));
}

function fallbackSanitizePullValue(value) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function formatDate(date) {
  return date.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric"
  });
}

function formatDisplayNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function roundDailyPull(value) {
  const normalized = readPullValue(value);
  const whole = Math.floor(normalized);
  const fraction = normalized - whole;

  return Math.abs(fraction - 0.5) < 0.000001 ? whole + 1 : whole;
}

function applyAppTheme(type) {
  document.body.classList.remove(...APP_THEME_CLASSES);

  const themeClass = THEME_CLASS_BY_TYPE[type];
  if (themeClass) {
    document.body.classList.add(themeClass);
  }
}
