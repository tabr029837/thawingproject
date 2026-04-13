const summaryGrid = document.getElementById("summaryGrid");
const recommendationsSummary = document.getElementById("recommendationsSummary");
const frozenStockoutBody = document.getElementById("frozenStockoutBody");
const expirationBody = document.getElementById("expirationBody");
const analysisTitle = document.getElementById("analysisTitle");
const analysisSubtitle = document.getElementById("analysisSubtitle");
const assumptionsText = document.getElementById("assumptionsText");
const ANALYZER_THEME_CLASSES = [
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

loadAnalysis();

function loadAnalysis() {
  const stored = JSON.parse(localStorage.getItem("thawData"));

  if (!stored?.data?.length) {
    frozenStockoutBody.innerHTML = `
      <tr>
        <td colspan="10" class="empty-state">No saved thaw data found. Go back and enter data first.</td>
      </tr>
    `;
    expirationBody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-state">No expiration data available yet.</td>
      </tr>
    `;
    return;
  }

  applyAnalyzerTheme(stored.type);
  analysisTitle.textContent = `${stored.chickenLabel} Flow Analysis`;
  analysisSubtitle.textContent = `${stored.data.length} operating days processed in order`;
  assumptionsText.textContent = "";

  const results = runInventoryFlow(stored.data);
  renderSummary(results);
  renderRecommendationsSummary(results);
  renderFrozenStockoutTable(results.frozenInventoryTable);
  renderExpirationTable(results.dailyTable);
}

function runInventoryFlow(data) {
  const normalizedDays = normalizeDays(data).sort((left, right) => left.dateObj - right.dateObj);
  const frozenInventoryTable = buildFrozenInventoryTable(normalizedDays);
  const seedBatches = buildCarryoverSeedBatches(normalizedDays);
  const batches = [...seedBatches];
  const dailyTable = [];

  let totalDemand = 0;
  let totalPulled = 0;
  let totalStockoutDays = 0;
  let totalStockoutCases = 0;
  let totalExpiredCases = 0;
  let totalExpiredEvents = 0;
  let totalAtRiskCases = 0;
  let previousEndingInventory = normalizedDays.length
    ? roundValue(sumRemainingCases(getUsableBatchesBeforeDate(batches, normalizedDays[0].dateObj)))
    : 0;

  normalizedDays.forEach((day) => {
    const batch = createBatch(day);
    batches.push(batch);
    totalPulled += batch.casesPulled;

    const newlyUsableBatches = getBatchesBecomingUsableOnDate(batches, day.dateObj);
    const actualNewUsableCases = roundValue(sumRemainingCases(newlyUsableBatches));
    const expectedStartingInventory = roundValue(previousEndingInventory + actualNewUsableCases);
    const usableBatches = getUsableBatches(batches, day.dateObj);
    const actualStartingInventory = roundValue(sumRemainingCases(usableBatches));
    const calculationError = !numbersMatch(expectedStartingInventory, actualStartingInventory);
    const startingInventory = actualStartingInventory;
    let remainingDemand = day.demand;

    usableBatches
      .sort((left, right) => left.usableStartDate - right.usableStartDate || left.pullDate - right.pullDate)
      .forEach((usableBatch) => {
        if (remainingDemand <= 0) {
          return;
        }

        const usedCases = Math.min(usableBatch.remainingCases, remainingDemand);
        usableBatch.remainingCases = roundValue(usableBatch.remainingCases - usedCases);
        usableBatch.usedCases = roundValue(usableBatch.usedCases + usedCases);
        remainingDemand = roundValue(remainingDemand - usedCases);
      });

    const stockout = remainingDemand > 0;
    expireBatchesAtEndOfDay(batches, day.dateObj);
    updateFrozenFlags(batches, day.dateObj);
    const endingInventory = roundValue(sumRemainingCases(getUsableBatches(batches, day.dateObj)));
    const status = determineDailyStatus({
      calculationError,
      stockout,
      demand: day.demand,
      startingInventory,
      endingInventory
    });

    if (stockout) {
      totalStockoutDays += 1;
      totalStockoutCases = roundValue(totalStockoutCases + remainingDemand);
    }

    totalDemand += day.demand;
    totalExpiredCases = roundValue(
      batches.reduce((sum, currentBatch) => sum + currentBatch.expiredCases, 0)
    );
    totalAtRiskCases = roundValue(
      batches.reduce((sum, currentBatch) => sum + currentBatch.atRiskCases, 0)
    );

    dailyTable.push({
      date: day.date,
      dateObj: new Date(day.dateObj),
      day: getDayLabel(day.dateObj),
      buildTo: day.buildTo,
      adjustmentDateObj: addDays(day.dateObj, -2),
      adjustmentDay: getDayLabel(addDays(day.dateObj, -2)),
      adjustmentDate: formatStoredDate(addDays(day.dateObj, -2)),
      demand: day.demand,
      previousEndingInventory,
      expectedStartingInventory,
      newUsableCases: actualNewUsableCases,
      startingInventory,
      endingInventory,
      actualStartingInventory,
      stockout,
      status,
      calculationError,
      shortageAmount: roundValue(Math.max(0, day.demand - startingInventory))
    });

    previousEndingInventory = endingInventory;
  });

  const enrichedDailyTable = enrichDailyTable(dailyTable);

  return {
    totalDemand: roundValue(totalDemand),
    totalPulled: roundValue(totalPulled),
    totalStockoutDays,
    totalStockoutCases,
    totalExpiredEvents,
    totalExpiredCases,
    totalAtRiskCases,
    frozenInventoryTable,
    dailyTable: enrichedDailyTable,
    batchTable: batches.map((batch) => ({
      pullDate: formatStoredDate(batch.pullDate),
      pullDateObj: new Date(batch.pullDate),
      day: getDayLabel(batch.pullDate),
      casesPulled: batch.casesPulled,
      usableStartDate: formatStoredDate(batch.usableStartDate),
      expirationDate: formatStoredDate(batch.expirationDate),
      remainingCases: batch.remainingCases,
      frozenCases: batch.atRiskCases,
      expiredCases: batch.expiredCases,
      atRisk: batch.atRisk,
      isCarryover: Boolean(batch.isCarryover)
    }))
  };
}

function normalizeDays(data) {
  return data.map((entry) => ({
    date: entry.date,
    dateObj: parseStoredDate(entry.date),
    buildTo: roundDailyPull(sanitizeNumber(entry.buildTo)),
    demand: roundDailyPull(sanitizeNumber(entry.sold)),
    casesPulled: roundDailyPull(sanitizeNumber(entry.sold))
  }));
}

function buildFrozenInventoryTable(days) {
  if (!days.length) {
    return [];
  }

  let assumedStartingInventory = 0;
  let calculatedTable = [];

  // Resolve the first day's starting inventory from the prior week's final ending inventory.
  for (let iteration = 0; iteration < 25; iteration += 1) {
    calculatedTable = calculateFrozenInventoryTable(days, assumedStartingInventory);
    const resolvedStartingInventory = calculatedTable.length
      ? calculatedTable[calculatedTable.length - 1].endingInventory
      : 0;

    if (numbersMatch(assumedStartingInventory, resolvedStartingInventory)) {
      break;
    }

    assumedStartingInventory = resolvedStartingInventory;
  }

  return enrichFrozenInventoryTable(calculatedTable);
}

function calculateFrozenInventoryTable(days, initialStartingInventory) {
  const dayByDateKey = new Map(days.map((day) => [formatDateKey(day.dateObj), day]));
  const firstDate = days[0].dateObj;
  const lastDate = days[days.length - 1].dateObj;
  const table = [];
  let currentDate = new Date(firstDate);
  let previousEndingInventory = roundValue(initialStartingInventory);

  while (currentDate.getTime() <= lastDate.getTime()) {
    const dayLabel = getDayLabel(currentDate);
    const dateKey = formatDateKey(currentDate);
    const storedDay = dayByDateKey.get(dateKey);
    const isSunday = dayLabel === "Sun";
    const buildTo = isSunday ? 0 : roundValue(storedDay?.buildTo || 0);
    const demand = isSunday ? 0 : roundValue(storedDay?.demand || 0);
    const startingInventory = roundValue(previousEndingInventory);
    const calculatedPull = roundValue(demand + (buildTo - startingInventory));
    const dayPull = isSunday ? 0 : roundValue(Math.max(0, calculatedPull));
    const rawEndingInventory = roundValue(startingInventory + dayPull - demand);
    const endingInventory = isSunday
      ? startingInventory
      : roundValue(Math.max(0, rawEndingInventory));

    table.push({
      date: formatStoredDate(currentDate),
      dateObj: new Date(currentDate),
      day: dayLabel,
      buildTo,
      startingInventory,
      isEstimatedStartingInventory: table.length === 0,
      demand,
      dayPull,
      endingInventory
    });

    previousEndingInventory = endingInventory;
    currentDate = addDays(currentDate, 1);
  }

  return table;
}

function enrichFrozenInventoryTable(table) {
  const demandByDateKey = new Map(
    table.map((row) => [formatDateKey(row.dateObj), row.demand])
  );
  const lastKnownDate = table.length ? table[table.length - 1].dateObj : null;

  return table.map((row) => {
    const frozenWindowRows = buildCalendarWindow(row.dateObj, [2, 3], demandByDateKey, lastKnownDate);
    const frozenWindowDemand = roundValue(
      frozenWindowRows.reduce((sum, currentRow) => sum + currentRow.demand, 0)
    );
    const hasFrozenWindowData = frozenWindowRows.every((currentRow) => currentRow.hasDemandData);
    const frozenAmount = roundValue(Math.max(0, row.dayPull - frozenWindowDemand));

    return {
      ...row,
      frozenAmount,
      frozenWindowDemand,
      hasFrozenWindowData,
      ...getFrozenInventoryStatusDetails({
        ...row,
        frozenAmount,
        frozenWindowDemand,
        hasFrozenWindowData
      })
    };
  });
}

function createBatch(day) {
  return {
    pullDate: new Date(day.dateObj),
    casesPulled: day.casesPulled,
    usableStartDate: addDays(day.dateObj, 2),
    expirationDate: addDays(day.dateObj, 4),
    remainingCases: day.casesPulled,
    expiredCases: 0,
    usedCases: 0,
    atRisk: false,
    atRiskCases: 0
  };
}

function buildCarryoverSeedBatches(days) {
  if (!days.length) {
    return [];
  }

  const firstDate = days[0].dateObj;
  const latestFriday = findLastDay(days, "Fri");
  const latestSaturday = findLastDay(days, "Sat");
  const seedBatches = [];

  if (latestFriday) {
    seedBatches.push(
      createCarryoverBatch(
        addDays(firstDate, -daysBackToWeekday(firstDate, 5)),
        latestFriday.casesPulled
      )
    );
  }

  if (latestSaturday) {
    seedBatches.push(
      createCarryoverBatch(
        addDays(firstDate, -daysBackToWeekday(firstDate, 6)),
        latestSaturday.casesPulled
      )
    );
  }

  return seedBatches.sort((left, right) => left.pullDate - right.pullDate);
}

function createCarryoverBatch(pullDate, casesPulled) {
  const batch = {
    pullDate: new Date(pullDate),
    casesPulled,
    usableStartDate: addDays(pullDate, 2),
    expirationDate: addDays(pullDate, 4),
    remainingCases: casesPulled,
    expiredCases: 0,
    usedCases: 0,
    atRisk: false,
    atRiskCases: 0,
    isCarryover: true
  };

  return batch;
}

function findLastDay(days, dayLabel) {
  for (let index = days.length - 1; index >= 0; index -= 1) {
    if (getDayLabel(days[index].dateObj) === dayLabel) {
      return days[index];
    }
  }
  return null;
}

function daysBackToWeekday(date, targetDayNumber) {
  let difference = (date.getDay() - targetDayNumber + 7) % 7;
  if (difference === 0) {
    difference = 7;
  }
  return difference;
}

function getUsableBatches(batches, today) {
  return batches
    .filter((batch) => {
      return (
        batch.remainingCases > 0 &&
        today.getTime() >= batch.usableStartDate.getTime() &&
        today.getTime() < batch.expirationDate.getTime()
      );
    })
    .sort((left, right) => left.usableStartDate - right.usableStartDate || left.pullDate - right.pullDate);
}

function getUsableBatchesBeforeDate(batches, today) {
  return batches.filter((batch) => {
    return (
      batch.remainingCases > 0 &&
      batch.usableStartDate.getTime() < today.getTime() &&
      today.getTime() < batch.expirationDate.getTime()
    );
  });
}

function getBatchesBecomingUsableOnDate(batches, today) {
  return batches.filter((batch) => {
    return (
      batch.remainingCases > 0 &&
      batch.usableStartDate.getTime() === today.getTime() &&
      today.getTime() < batch.expirationDate.getTime()
    );
  });
}

function expireBatchesAtEndOfDay(batches, today) {
  batches.forEach((batch) => {
    if (today.getTime() >= batch.expirationDate.getTime() && batch.remainingCases > 0) {
      batch.expiredCases = roundValue(batch.remainingCases);
      batch.remainingCases = 0;
      batch.atRisk = false;
      batch.atRiskCases = 0;
    }
  });
}

function updateFrozenFlags(batches, today) {
  const endOfToday = addDays(today, 1);

  batches.forEach((batch) => {
    const hoursUntilExpiration = (batch.expirationDate.getTime() - endOfToday.getTime()) / (1000 * 60 * 60);
    const isUsable =
      batch.remainingCases > 0 &&
      today.getTime() >= batch.usableStartDate.getTime() &&
      today.getTime() < batch.expirationDate.getTime();
    const atRisk = isUsable && hoursUntilExpiration <= 24;

    batch.atRisk = atRisk;
    batch.atRiskCases = atRisk ? batch.remainingCases : 0;
  });
}

function sumRemainingCases(batches) {
  return batches.reduce((sum, batch) => sum + batch.remainingCases, 0);
}

function numbersMatch(left, right) {
  return Math.abs(roundValue(left) - roundValue(right)) < 0.000001;
}

function determineDailyStatus({ calculationError, stockout, demand, startingInventory, endingInventory }) {
  if (calculationError) {
    return "CALCULATION ERROR";
  }
  if (stockout) {
    return "STOCKOUT";
  }
  if (numbersMatch(endingInventory, 0) && numbersMatch(demand, startingInventory)) {
    return "CRITICAL LOW";
  }
  return "NO STOCKOUT";
}

function enrichDailyTable(dailyTable) {
  const demandByDateKey = new Map(
    dailyTable.map((row) => [formatDateKey(row.dateObj), row.demand])
  );
  const lastKnownDate = dailyTable.length ? dailyTable[dailyTable.length - 1].dateObj : null;

  return dailyTable.map((row, index) => {
    const previousRow = dailyTable[index - 1];
    const previousBuildTo = previousRow ? previousRow.buildTo : row.buildTo;
    const dayPull = roundValue(Math.max(0, row.buildTo - (previousBuildTo - row.demand)));
    const frozenWindowRows = buildCalendarWindow(row.dateObj, [2, 3], demandByDateKey, lastKnownDate);
    const expirationWindowRows = buildCalendarWindow(row.dateObj, [0, 1, 2, 3], demandByDateKey, lastKnownDate);
    const frozenWindowDemand = roundValue(
      frozenWindowRows.reduce((sum, currentRow) => sum + currentRow.demand, 0)
    );
    const expirationWindowDemand = roundValue(
      expirationWindowRows.reduce((sum, currentRow) => sum + currentRow.demand, 0)
    );
    const frozenExcess = roundValue(Math.max(0, dayPull - frozenWindowDemand));
    const expirationExcess = roundValue(Math.max(0, dayPull - expirationWindowDemand));
    const hasFrozenWindowData = frozenWindowRows.every((currentRow) => currentRow.hasDemandData);
    const hasExpirationWindowData = expirationWindowRows.every((currentRow) => currentRow.hasDemandData);

    return {
      ...row,
      previousBuildTo,
      dayPull,
      frozenWindowDemand,
      expirationWindowDemand,
      frozenExcess,
      expirationExcess,
      hasFrozenWindowData,
      hasExpirationWindowData,
      frozenStatus: determineFrozenStatus(row, dayPull, hasFrozenWindowData, frozenExcess),
      expirationStatus: determineExpirationStatus(dayPull, hasExpirationWindowData, expirationExcess)
    };
  });
}

function determineFrozenStatus(row, dayPull, hasFrozenWindowData, frozenExcess) {
  if (row.stockout) {
    return "STOCKOUT";
  }
  if (!hasFrozenWindowData) {
    return "NOT ENOUGH DATA";
  }
  if (frozenExcess > 0) {
    return "FROZEN RISK";
  }
  if (numbersMatch(dayPull, 0)) {
    return "NO PULL";
  }
  return "OK";
}

function determineExpirationStatus(dayPull, hasExpirationWindowData, expirationExcess) {
  if (!hasExpirationWindowData) {
    return "NOT ENOUGH DATA";
  }
  if (expirationExcess > 0) {
    return "EXPIRATION RISK";
  }
  if (numbersMatch(dayPull, 0)) {
    return "NO PULL";
  }
  return "OK";
}

function buildCalendarWindow(baseDate, dayOffsets, demandByDateKey, lastKnownDate) {
  return dayOffsets.map((offset) => {
    const dateObj = addDays(baseDate, offset);
    const day = getDayLabel(dateObj);
    const dateKey = formatDateKey(dateObj);
    const isClosedDay = day === "Sun";
    const hasRecordedDemand = demandByDateKey.has(dateKey);
    const isWithinKnownRange = Boolean(lastKnownDate) && dateObj.getTime() <= lastKnownDate.getTime();
    const hasDemandData = isClosedDay || (isWithinKnownRange && hasRecordedDemand);
    const demand = isClosedDay ? 0 : roundValue(demandByDateKey.get(dateKey) || 0);

    return {
      date: formatStoredDate(dateObj),
      dateObj,
      day,
      demand,
      isClosedDay,
      hasDemandData
    };
  });
}

function renderSummary(results) {
  const metrics = buildExperimentMetrics(results);
  const perfectDayPercent = metrics.evaluatedDays.length
    ? roundValue((metrics.perfectDays.length / metrics.evaluatedDays.length) * 100)
    : 0;

  const cards = [
    { label: "% Of Perfect Days", value: formatPercent(perfectDayPercent) },
    { label: "# Bad Days", value: formatNumber(metrics.badDays.length) },
    { label: "Frozen Events; Cases", value: `${formatNumber(metrics.frozenEvents)}; ${formatNumber(metrics.frozenCases)}` },
    { label: "Expiration Events; Cases", value: `${formatNumber(metrics.expirationEvents)}; ${formatNumber(metrics.expirationCases)}` }
  ];

  summaryGrid.innerHTML = cards
    .map(
      (card) => `
        <article class="summary-card">
          <p class="summary-label">${card.label}</p>
          <h3>${card.value}</h3>
        </article>
      `
    )
    .join("");
}

function renderRecommendationsSummary(results) {
  const recommendations = buildRecommendationSummaries(results);

  recommendationsSummary.innerHTML = `
    <div class="recommendation-list">
      ${recommendations
        .map(
          (item) => `
            <article class="recommendation-item">
              <p><strong>${item.day}</strong> <span class="status-pill ${getRecommendationRiskClass(item.riskLevel)}">${item.riskLabel}</span></p>
              <p>${item.description}</p>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function buildExperimentMetrics(results) {
  const expirationByDate = new Map(
    results.dailyTable.map((row) => [row.date, { row, details: getExpirationStatusDetails(row) }])
  );
  const evaluatedDays = results.frozenInventoryTable
    .filter((row) => row.statusLabel !== "Carryover" && row.statusLabel !== "Not Enough Data")
    .map((row) => {
      const expirationEntry = expirationByDate.get(row.date);
      if (!expirationEntry || expirationEntry.details.status === "Not Enough Data") {
        return null;
      }

      return {
        date: row.date,
        day: row.day,
        frozenRow: row,
        expirationRow: expirationEntry.row,
        expirationDetails: expirationEntry.details
      };
    })
    .filter(Boolean);

  const perfectDays = evaluatedDays.filter((entry) => {
    return entry.frozenRow.statusLabel === "No Risk" && entry.expirationDetails.status === "No Risk";
  });
  const badDays = evaluatedDays.filter((entry) => {
    return entry.frozenRow.statusLabel === "Frozen" || entry.expirationDetails.status === "Expiration";
  });
  const frozenRows = evaluatedDays.filter((entry) => entry.frozenRow.statusLabel === "Frozen");
  const expirationRows = evaluatedDays.filter((entry) => entry.expirationDetails.status === "Expiration");

  return {
    evaluatedDays,
    perfectDays,
    badDays,
    frozenEvents: frozenRows.length,
    frozenCases: roundValue(frozenRows.reduce((sum, entry) => sum + entry.frozenRow.frozenAmount, 0)),
    expirationEvents: expirationRows.length,
    expirationCases: roundValue(
      expirationRows.reduce((sum, entry) => sum + entry.expirationRow.expirationExcess, 0)
    )
  };
}

function buildRecommendationSummaries(results) {
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const metrics = buildExperimentMetrics(results);
  const grouped = Object.fromEntries(
    weekdays.map((day) => [
      day,
      {
        day,
        tracked: 0,
        frozenEvents: 0,
        expirationEvents: 0,
        frozenCases: 0,
        expirationCases: 0
      }
    ])
  );

  metrics.evaluatedDays.forEach((entry) => {
    const dayMetrics = grouped[entry.day];
    if (!dayMetrics) {
      return;
    }

    dayMetrics.tracked += 1;

    if (entry.frozenRow.statusLabel === "Frozen") {
      dayMetrics.frozenEvents += 1;
      dayMetrics.frozenCases = roundValue(dayMetrics.frozenCases + entry.frozenRow.frozenAmount);
    }

    if (entry.expirationDetails.status === "Expiration") {
      dayMetrics.expirationEvents += 1;
      dayMetrics.expirationCases = roundValue(
        dayMetrics.expirationCases + entry.expirationRow.expirationExcess
      );
    }
  });

  return weekdays.map((day) => {
    const item = grouped[day];
    const issueCount = item.frozenEvents + item.expirationEvents;
    const issueRate = item.tracked > 0 ? issueCount / item.tracked : 0;
    let riskLevel = "none";
    let riskLabel = "No Risk";

    if (item.tracked === 0) {
      return {
        day,
        riskLevel: "neutral",
        riskLabel: "Not Enough Data",
        description: "Need more fully evaluated days before this weekday can be scored."
      };
    }

    if (issueCount > 0) {
      riskLevel = "potential";
      riskLabel = "Potential Risk";
    }
    if (issueRate >= 0.5) {
      riskLevel = "urgent";
      riskLabel = "Urgent Risk";
    }

    if (riskLevel === "none") {
      return {
        day,
        riskLevel,
        riskLabel,
        description: "No action needed. Frozen and expiration results stayed clean on the evaluated days."
      };
    }

    const actions = [];
    if (item.frozenEvents > 0) {
      actions.push(
        `Lower pull / build-to to reduce frozen risk (${formatNumber(item.frozenEvents)} event${item.frozenEvents === 1 ? "" : "s"}, ${formatNumber(item.frozenCases)} case${numbersMatch(item.frozenCases, 1) ? "" : "s"})`
      );
    }
    if (item.expirationEvents > 0) {
      actions.push(
        `Lower build-to so the 96-hour demand can absorb it (${formatNumber(item.expirationEvents)} event${item.expirationEvents === 1 ? "" : "s"}, ${formatNumber(item.expirationCases)} case${numbersMatch(item.expirationCases, 1) ? "" : "s"})`
      );
    }

    return {
      day,
      riskLevel,
      riskLabel,
      description: actions.join("; ")
    };
  });
}

function getRecommendationRiskClass(riskLevel) {
  if (riskLevel === "none") {
    return "status-ok";
  }
  if (riskLevel === "potential") {
    return "status-warning";
  }
  if (riskLevel === "urgent") {
    return "status-expiration";
  }
  return "status-neutral";
}

function buildExpirationSituation(dailyTable, weekdays) {
  const demandByDateKey = new Map(
    dailyTable.map((row) => [formatDateKey(row.dateObj), row.demand])
  );
  const lastKnownDate = dailyTable.length ? dailyTable[dailyTable.length - 1].dateObj : null;

  return buildWindowSituation({
    dailyTable,
    weekdays,
    getTrackedWindow(row) {
      return buildCalendarWindow(row.dateObj, [0, 1, 2, 3], demandByDateKey, lastKnownDate);
    }
  });
}

function buildFrozenSituation(dailyTable, weekdays) {
  const demandByDateKey = new Map(
    dailyTable.map((row) => [formatDateKey(row.dateObj), row.demand])
  );
  const lastKnownDate = dailyTable.length ? dailyTable[dailyTable.length - 1].dateObj : null;

  return buildWindowSituation({
    dailyTable,
    weekdays,
    getTrackedWindow(row) {
      return buildCalendarWindow(row.dateObj, [2, 3], demandByDateKey, lastKnownDate);
    }
  });
}

function buildWindowSituation({ dailyTable, weekdays, getTrackedWindow }) {
  const byDay = Object.fromEntries(
    weekdays.map((day) => [
      day,
      {
        day,
        trackedCount: 0,
        riskCount: 0,
        totalOverbuild: 0,
        actions: []
      }
    ])
  );

  dailyTable.forEach((row, index) => {
    if (!byDay[row.day]) {
      return;
    }

    const trackedWindow = getTrackedWindow(row, index);
    const hasCompleteWindow = trackedWindow.length && trackedWindow.every((currentRow) => currentRow.hasDemandData);
    if (!trackedWindow.length) {
      return;
    }
    const dayMetrics = byDay[row.day];
    if (!hasCompleteWindow) {
      return;
    }

    const windowDemand = roundValue(
      trackedWindow.reduce((sum, currentRow) => sum + currentRow.demand, 0)
    );
    const overbuild = roundValue(Math.max(0, row.dayPull - windowDemand));

    dayMetrics.trackedCount += 1;

    if (overbuild > 0) {
      dayMetrics.riskCount += 1;
      dayMetrics.totalOverbuild = roundValue(dayMetrics.totalOverbuild + overbuild);
      dayMetrics.actions.push({
        pullDate: row.date,
        dayPull: row.dayPull,
        windowDemand,
        overbuild,
        datesCovered: trackedWindow.map((currentRow) => currentRow.date)
      });
    }
  });

  return weekdays.map((day) => {
    const metrics = byDay[day];
    const riskRate = metrics.trackedCount > 0 ? metrics.riskCount / metrics.trackedCount : 0;
    let riskLevel = "none";

    if (metrics.riskCount > 0) {
      riskLevel = "potential";
    }
    if (riskRate >= 0.5) {
      riskLevel = "urgent";
    }

    return {
      ...metrics,
      riskRate,
      riskLevel
    };
  });
}

function buildSituationSummaryLine(item, label) {
  if (item.trackedCount === 0) {
    return `${item.day} Not enough future days to score ${label.toLowerCase()}`;
  }
  if (item.riskLevel === "none") {
    return `${item.day} No Action Needed`;
  }
  return `${item.day} Lower Pull (${item.riskCount}/${item.trackedCount} windows, ${formatNumber(item.totalOverbuild)} cases over)`;
}

function buildSituationDetailLine(item, situationType) {
  if (item.trackedCount === 0) {
    return `${item.day}: Not enough future demand was available to evaluate this day yet.`;
  }
  if (item.actions.length === 0) {
    return `${item.day}: Day's Pull was covered by usage across ${item.trackedCount} tracked window${item.trackedCount === 1 ? "" : "s"}.`;
  }

  const actionText = item.actions
    .map((action) => {
      const coveredDates = action.datesCovered.map((date) => formatShortStoredDate(date)).join(", ");

      if (situationType === "expiration") {
        return `On ${formatShortStoredDate(action.pullDate)}, day's pull ${formatNumber(action.dayPull)} was ${formatNumber(action.overbuild)} over the ${coveredDates} 96-hour usage window (${formatNumber(action.windowDemand)})`;
      }

      return `On ${formatShortStoredDate(action.pullDate)}, day's pull ${formatNumber(action.dayPull)} was ${formatNumber(action.overbuild)} over the 3rd/4th day usage window of ${coveredDates} (${formatNumber(action.windowDemand)})`;
    })
    .join("; ");

  return `${item.day}: ${actionText}.`;
}

function renderSituationSummary(title, copy, items, situationType) {
  const noRiskItems = items.filter((item) => item.riskLevel === "none");
  const potentialItems = items.filter((item) => item.riskLevel === "potential");
  const urgentItems = items.filter((item) => item.riskLevel === "urgent");

  return `
    <p><span class="status-pill">${title}</span></p>
    <p>${copy}</p>
    ${renderRecommendationSection(
      "Urgent Risks",
      urgentItems.map((item) => buildSituationSummaryLine(item, title)),
      "status-danger"
    )}
    ${renderRecommendationSection(
      "Potential Risks",
      potentialItems.map((item) => buildSituationSummaryLine(item, title)),
      "status-warning"
    )}
    ${renderRecommendationSection(
      "No Risk",
      noRiskItems.map((item) => buildSituationSummaryLine(item, title)),
      "status-ok"
    )}
    ${renderRecommendationDetails(items, situationType)}
  `;
}

function renderRecommendationSection(title, summaryItems, headingClass) {
  return `
    <p><span class="status-pill ${headingClass}">${title}</span></p>
    <ul>
      ${summaryItems.length ? summaryItems.map((item) => `<li>${item}</li>`).join("") : "<li>None</li>"}
    </ul>
  `;
}

function renderRecommendationDetails(dayStatuses, situationType) {
  const detailItems = dayStatuses.map((item) => buildSituationDetailLine(item, situationType));

  return `
    <details>
      <summary>Expand Details</summary>
      <ul>
        ${detailItems.length ? detailItems.map((item) => `<li>${item}</li>`).join("") : "<li>No additional detail.</li>"}
      </ul>
    </details>
  `;
}

function renderFrozenStockoutTable(dailyTable) {
  frozenStockoutBody.innerHTML = dailyTable
    .map(
      (row) => `
        <tr>
          <td>${row.date}</td>
          <td>${row.day}</td>
          <td>${formatNumber(row.buildTo)}</td>
          <td>${formatFrozenStartingInventory(row)}</td>
          <td>${formatNumber(row.demand)}</td>
          <td>${formatNumber(row.dayPull)}</td>
          <td>${formatNumber(row.endingInventory)}</td>
          <td class="${getFrozenMetricClass(row)}">${formatNumber(row.frozenAmount)}</td>
          <td>${buildStatusPill(row.statusLabel)}</td>
          <td>${row.explanation}</td>
        </tr>
      `
    )
    .join("");
}

function renderExpirationTable(dailyTable) {
  expirationBody.innerHTML = dailyTable
    .map(
      (row) => {
        const statusDetails = getExpirationStatusDetails(row);

        return `
        <tr>
          <td>${row.date}</td>
          <td>${row.day}</td>
          <td>${formatNumber(row.buildTo)}</td>
          <td>${formatNumber(row.demand)}</td>
          <td>${formatNumber(row.dayPull)}</td>
          <td class="${getExpirationMetricClass(row)}">${formatNumber(row.expirationExcess)}</td>
          <td>${buildStatusPill(statusDetails.status)}</td>
          <td>${statusDetails.explanation}</td>
        </tr>
      `;
      }
    )
    .join("");
}

function getFrozenMetricClass(row) {
  if (row.frozenAmount > 0) {
    return "warning-text";
  }
  return "";
}

function getExpirationMetricClass(row) {
  if (row.expirationExcess > 0) {
    return "warning-text";
  }
  return "";
}

function getFrozenInventoryStatusDetails(row) {
  if (row.day === "Sun") {
    return {
      statusLabel: "Carryover",
      explanation: "Inventory carries over"
    };
  }
  if (!row.hasFrozenWindowData) {
    return {
      statusLabel: "Not Enough Data",
      explanation: "Need the 3rd and 4th day usage"
    };
  }
  if (numbersMatch(row.endingInventory, 0) && row.demand > row.startingInventory + row.dayPull) {
    return {
      statusLabel: "Frozen",
      explanation: `Short ${formatNumber(roundValue(row.demand - (row.startingInventory + row.dayPull)))} case${numbersMatch(roundValue(row.demand - (row.startingInventory + row.dayPull)), 1) ? "" : "s"}`
    };
  }
  if (row.frozenAmount > 0) {
    return {
      statusLabel: "Frozen",
      explanation: buildWindowComparisonText(row.dayPull, row.frozenWindowDemand, "Pull", "day 3/4 demand")
    };
  }
  return {
    statusLabel: "No Risk",
    explanation: buildWindowComparisonText(row.dayPull, row.frozenWindowDemand, "Pull", "day 3/4 demand")
  };
}

function formatFrozenStartingInventory(row) {
  const value = formatNumber(row.startingInventory);
  if (!row.isEstimatedStartingInventory) {
    return value;
  }

  return `${value}*<div class="cell-note">Estimation</div>`;
}

function getExpirationStatusDetails(row) {
  if (row.expirationStatus === "EXPIRATION RISK") {
    return {
      status: "Expiration",
      explanation: buildWindowComparisonText(row.buildTo, row.expirationWindowDemand, "Build to", "96 hr demand")
    };
  }
  if (row.expirationStatus === "NOT ENOUGH DATA") {
    return {
      status: "Not Enough Data",
      explanation: "Need 96 hours of usage"
    };
  }
  if (row.expirationStatus === "NO PULL") {
    return {
      status: "No Pull",
      explanation: "Build to did not create a pull"
    };
  }
  return {
    status: "No Risk",
    explanation: buildWindowComparisonText(row.buildTo, row.expirationWindowDemand, "Build to", "96 hr demand")
  };
}

function buildStatusPill(statusLabel) {
  return `<span class="status-pill ${getStatusPillClass(statusLabel)}">${statusLabel}</span>`;
}

function getStatusPillClass(statusLabel) {
  if (statusLabel === "No Risk") {
    return "status-ok";
  }
  if (statusLabel === "Frozen") {
    return "status-frozen";
  }
  if (statusLabel === "Expiration") {
    return "status-expiration";
  }
  if (statusLabel === "Carryover" || statusLabel === "Not Enough Data" || statusLabel === "No Pull") {
    return "status-neutral";
  }
  return "status-neutral";
}

function buildWindowComparisonText(leftValue, rightValue, leftLabel, rightLabel) {
  if (numbersMatch(leftValue, rightValue)) {
    return `${formatNumber(leftValue)} = ${formatNumber(rightValue)} (${leftLabel} = ${rightLabel})`;
  }

  if (leftValue > rightValue) {
    return `${formatNumber(rightValue)} < ${formatNumber(leftValue)} (${rightLabel} < ${leftLabel})`;
  }

  return `${formatNumber(leftValue)} < ${formatNumber(rightValue)} (${leftLabel} < ${rightLabel})`;
}

function parseStoredDate(value) {
  const [month, day, year] = value.split("/").map((part) => parseInt(part, 10));
  return new Date(year, month - 1, day);
}

function formatStoredDate(date) {
  return date.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric"
  });
}

function formatShortStoredDate(value) {
  const date = value instanceof Date ? value : parseStoredDate(value);
  return date.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric"
  });
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function getDayLabel(date) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
}

function addDays(date, days) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function sanitizeNumber(value) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function roundValue(value) {
  return Math.round(value * 10) / 10;
}

function roundDailyPull(value) {
  const normalized = sanitizeNumber(value);
  const whole = Math.floor(normalized);
  const fraction = normalized - whole;

  return Math.abs(fraction - 0.5) < 0.000001 ? whole + 1 : whole;
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatPercent(value) {
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`;
}

function applyAnalyzerTheme(type) {
  document.body.classList.remove(...ANALYZER_THEME_CLASSES);

  const themeClass = THEME_CLASS_BY_TYPE[type];
  if (themeClass) {
    document.body.classList.add(themeClass);
  }
}
