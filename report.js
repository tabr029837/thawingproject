const reportApi = window.ChickenAllocations || {};
const reportDays = reportApi.WEEKDAYS || ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const readChickenConfigs = reportApi.getChickenConfigs || (() => ({}));
const TYPE_ORDER = [
  "filets",
  "breakfast filets",
  "nuggets",
  "strips",
  "grilled filets",
  "grilled nuggets",
  "spicy filets",
  "spicy breakfast filets"
];
const PULL_CABINET_TYPES = [
  "filets",
  "breakfast filets",
  "grilled filets",
  "grilled nuggets",
  "spicy filets",
  "spicy breakfast filets"
];

const reportDaySelect = document.getElementById("reportDay");
const doorCountInput = document.getElementById("doorCount");
const shelvesPerDoorInput = document.getElementById("shelvesPerDoor");
const pullDoorCountInput = document.getElementById("pullDoorCount");
const pullShelvesPerDoorInput = document.getElementById("pullShelvesPerDoor");
const refreshReportButton = document.getElementById("refreshReportButton");
const reportTotalsBody = document.getElementById("reportTotalsBody");
const pullCabinetReport = document.getElementById("pullCabinetReport");
const cabinetReport = document.getElementById("cabinetReport");
const reportMeta = document.getElementById("reportMeta");
const reportNotes = document.getElementById("reportNotes");

const TYPE_COLORS = {
  filets: "type-filets",
  "breakfast filets": "type-breakfast",
  nuggets: "type-nuggets",
  strips: "type-strips",
  "grilled filets": "type-grilled-filets",
  "grilled nuggets": "type-grilled-nuggets",
  "spicy filets": "type-spicy-filets",
  "spicy breakfast filets": "type-spicy-breakfast"
};

bootstrapReport();

async function bootstrapReport() {
  await reportApi.ready?.();
  initializeReport();
}

function initializeReport() {
  populateDayOptions();
  reportDaySelect.value = getDefaultReportDay();

  reportDaySelect.addEventListener("change", renderReport);
  doorCountInput.addEventListener("input", renderReport);
  shelvesPerDoorInput.addEventListener("input", renderReport);
  pullDoorCountInput.addEventListener("input", renderReport);
  pullShelvesPerDoorInput.addEventListener("input", renderReport);
  refreshReportButton.addEventListener("click", renderReport);

  renderReport();
}

function populateDayOptions() {
  reportDaySelect.innerHTML = "";
  reportDays.forEach((day) => {
    const option = document.createElement("option");
    option.value = day;
    option.textContent = day;
    reportDaySelect.appendChild(option);
  });
}

function renderReport() {
  const configs = readChickenConfigs();
  const selectedDay = reportDaySelect.value || "Mon";
  const doorCount = clampNumber(doorCountInput.value, 1, 6, 3);
  const shelvesPerDoor = clampNumber(shelvesPerDoorInput.value, 4, 20, 14);
  const thawingSlots = doorCount * shelvesPerDoor;
  const pullDoorCount = clampNumber(pullDoorCountInput.value, 0, 4, 1);
  const pullShelvesPerDoor = clampNumber(pullShelvesPerDoorInput.value, 0, 20, 6);
  const pullSlots = pullDoorCount * pullShelvesPerDoor;
  const totalSlots = thawingSlots + pullSlots;

  const totals = TYPE_ORDER
    .filter((type) => configs[type])
    .map((type) => {
      const config = configs[type];
      const units = sanitizeNumber(config.pulls?.[selectedDay]);
      return {
        type,
        label: config.label,
        units
      };
    })
    .filter((item) => item.units > 0)
    .map((item) => ({
      ...item,
      caseCount: Math.max(0, Math.round(item.units))
    }));

  const pullCabinetTotals = buildPullCabinetTotals(totals);
  const pullEntries = buildPullCabinetEntries(pullCabinetTotals, pullSlots);
  const thawingEntries = buildShelfEntries(totals, thawingSlots);
  const usedSlots = thawingEntries.filter((entry) => entry.type).length;
  const overflowCases = Math.max(0, totals.reduce((sum, item) => sum + item.caseCount, 0) - thawingSlots);
  const pullOverflow = Math.max(0, pullCabinetTotals.length - pullSlots);

  reportMeta.textContent = `${selectedDay} report using ${pullSlots} pull-cabinet row${pullSlots === 1 ? "" : "s"} and ${thawingSlots} thawing-cabinet shelf slot${thawingSlots === 1 ? "" : "s"}.`;
  reportNotes.textContent = overflowCases > 0
    ? `The thawing cabinet keeps the fixed chicken order with one case per row. ${overflowCases} case${overflowCases === 1 ? "" : "s"} did not fit in the thawing cabinet size you selected.`
    : "The thawing cabinet keeps the fixed chicken order with one case per row, and each chicken type stays together from top to bottom.";

  renderTotalsTable(totals, usedSlots, overflowCases, thawingSlots);
  renderPullCabinetLayout(pullEntries, pullDoorCount, pullShelvesPerDoor, pullOverflow);
  renderCabinetLayout(cabinetReport, thawingEntries, doorCount, shelvesPerDoor, "Door");
}

function buildShelfEntries(totals, totalSlots) {
  const entries = [];

  totals.forEach((item) => {
    for (let caseIndex = 0; caseIndex < item.caseCount; caseIndex += 1) {
      if (entries.length >= totalSlots) {
        return;
      }
      entries.push({
        type: item.type,
        label: item.label,
        units: 1,
        isTypeStart: caseIndex === 0,
        colorClass: TYPE_COLORS[item.type] || "type-default"
      });
    }
  });

  return entries;
}

function renderTotalsTable(totals, usedSlots, overflowCases, totalSlots) {
  if (totals.length === 0) {
    reportTotalsBody.innerHTML = `
      <tr>
        <td colspan="4" class="empty-state">No saved pull values were found for this day.</td>
      </tr>
    `;
    return;
  }

  reportTotalsBody.innerHTML = totals
    .map(
      (item) => `
        <tr>
          <td>${item.label}</td>
          <td>${formatNumber(item.units)}</td>
          <td>${item.caseCount}</td>
          <td>1 case per row</td>
        </tr>
      `
    )
    .join("") + `
      <tr>
        <td><strong>Thawing Cabinet Capacity</strong></td>
        <td>${formatNumber(totalSlots)}</td>
        <td>${formatNumber(usedSlots)}</td>
        <td>${overflowCases > 0 ? `${formatNumber(overflowCases)} overflow` : "Fits cabinet"}</td>
      </tr>
    `;
}

function renderPullCabinetLayout(entries, doorCount, shelvesPerDoor, overflowCount) {
  if (doorCount === 0 || shelvesPerDoor === 0) {
    pullCabinetReport.innerHTML = `<div class="empty-state">This pull cabinet is turned off for the current report.</div>`;
    return;
  }

  if (entries.length === 0) {
    pullCabinetReport.innerHTML = `<div class="empty-state">No filet-family or grilled nuggets pulls were found for this day.</div>`;
    return;
  }

  renderCabinetLayout(pullCabinetReport, entries, doorCount, shelvesPerDoor, "Pull Cabinet");

  if (overflowCount > 0) {
    pullCabinetReport.insertAdjacentHTML(
      "beforeend",
      `<p class="assumptions">Pull cabinet overflow: ${overflowCount} chicken type row${overflowCount === 1 ? "" : "s"} did not fit in the selected pull cabinet size.</p>`
    );
  }
}

function renderCabinetLayout(container, entries, doorCount, shelvesPerDoor, headingLabel) {
  if (doorCount === 0 || shelvesPerDoor === 0) {
    container.innerHTML = `<div class="empty-state">This cabinet is turned off for the current report.</div>`;
    return;
  }

  if (entries.length === 0) {
    container.innerHTML = `<div class="empty-state">No cabinet layout to build for this section.</div>`;
    return;
  }

  const totalShelves = doorCount * shelvesPerDoor;
  const paddedEntries = [...entries];
  while (paddedEntries.length < totalShelves) {
    paddedEntries.push({
      type: "",
      label: "Empty",
      units: 0,
      colorClass: "type-empty"
    });
  }

  container.innerHTML = Array.from({ length: doorCount }, (_, doorIndex) => {
    const start = doorIndex * shelvesPerDoor;
    const doorShelves = paddedEntries.slice(start, start + shelvesPerDoor);

    const shelvesMarkup = doorShelves
      .map((entry, shelfIndex) => {
        const shelfNumber = shelfIndex + 1;
        const description = entry.units > 0 ? entry.label : "Empty";
        const rowClass = entry.isTypeStart ? "cabinet-row type-start" : "cabinet-row";

        return `
          <div class="${rowClass}">
            <div class="cabinet-shelf-label">Shelf ${shelfNumber}</div>
            <div class="cabinet-shelf ${entry.colorClass}">${description}</div>
          </div>
        `;
      })
      .join("");

    return `
      <section class="cabinet-door">
        <h3>${headingLabel} #${doorIndex + 1}</h3>
        <div class="cabinet-grid">
          ${shelvesMarkup}
        </div>
      </section>
    `;
  }).join("");
}

function getDefaultReportDay() {
  const jsDay = new Date().getDay();
  const mapped = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][jsDay];
  return reportDays.includes(mapped) ? mapped : "Mon";
}

function buildPullCabinetTotals(totals) {
  return totals
    .filter((item) => PULL_CABINET_TYPES.includes(item.type) && item.caseCount > 0)
    .map((item) => ({
      ...item,
      pullCaseCount: Math.ceil(item.units)
    }))
    .filter((item) => item.pullCaseCount > 0);
}

function buildPullCabinetEntries(totals, totalSlots) {
  return totals.slice(0, totalSlots).map((item) => ({
    type: item.type,
    label: `${item.label} - ${formatCaseLabel(item.pullCaseCount)}`,
    units: item.pullCaseCount,
    isTypeStart: true,
    colorClass: TYPE_COLORS[item.type] || "type-default"
  }));
}

function clampNumber(value, min, max, fallback) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function sanitizeNumber(value) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function roundValue(value) {
  return Math.round(value * 10) / 10;
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatCaseLabel(value) {
  return `${formatNumber(value)} ${value === 1 ? "case" : "cases"}`;
}
