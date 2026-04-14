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
  try {
    const stored = JSON.parse(localStorage.getItem("thawData"));

    if (!stored?.data?.length) {
      frozenStockoutBody.innerHTML = `
        <tr>
          <td colspan="17" class="empty-state">No saved thaw data found. Go back and enter data first.</td>
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
    renderFrozenStockoutTable(results.dailyTable);
    renderExpirationTable(results.dailyTable);
  } catch (error) {
    console.error("Error in loadAnalysis:", error);
    frozenStockoutBody.innerHTML = `
      <tr>
        <td colspan="17" class="empty-state">Error: ${error.message}</td>
      </tr>
    `;
  }
}

function calculatePipelineUsableInventoryToday(dailyPulls, currentDayIndex) {
  let totalUsable = 0;

  for (let i = currentDayIndex - 2; i >= 0; i -= 1) {
    totalUsable = roundValue(totalUsable + dailyPulls[i]);
  }

  return roundValue(totalUsable);
}

function runInventoryFlow(data) {
  const normalizedDays = normalizeDays(data).sort((left, right) => left.dateObj - right.dateObj);
  
  // Use actual data with seed carryover batches for prior-week beginning inventory
  const extendedDays = normalizedDays;
  const carryoverCount = 0;
  
  const frozenInventoryTable = buildFrozenInventoryTable(normalizedDays);
  const seedBatches = buildCarryoverSeedBatches(normalizedDays);
  const batches = [...seedBatches];
  const dailyTable = [];
  
  const priorSaturdayDate = normalizedDays.length ? addDays(normalizedDays[0].dateObj, -2) : null;
  const priorSundayDate = normalizedDays.length ? addDays(normalizedDays[0].dateObj, -1) : null;
  const priorSaturdayPull = priorSaturdayDate
    ? (seedBatches.find((batch) => formatDateKey(batch.pullDate) === formatDateKey(priorSaturdayDate))?.casesPulled || 0)
    : 0;
  const priorSundayPull = priorSundayDate
    ? (seedBatches.find((batch) => formatDateKey(batch.pullDate) === formatDateKey(priorSundayDate))?.casesPulled || 0)
    : 0;
  
  // Pre-calculate daily pulls based on buildTo values using extended history
  const dailyPulls = [];
  let previousBuildTo = 0;
  normalizedDays.forEach((day, index) => {
    const isDayLabel = getDayLabel(day.dateObj);
    const buildTo = isDayLabel === "Sun" ? 0 : day.buildTo;
    const demand = isDayLabel === "Sun" ? 0 : day.demand;
    
    const calculatedPull = roundValue(demand + (buildTo - previousBuildTo));
    const dayPull = isDayLabel === "Sun" ? 0 : roundValue(Math.max(0, calculatedPull));
    dailyPulls.push(dayPull);
    previousBuildTo = buildTo;
  });

  let totalDemand = 0;
  let totalPulled = 0;
  let totalStockoutDays = 0;
  let totalStockoutCases = 0;
  let totalExpiredCases = 0;
  let totalExpiredEvents = 0;
  let totalAtRiskCases = 0;
  let previousEndingInventory = extendedDays.length
    ? roundValue(sumRemainingCases(getUsableBatchesBeforeDate(batches, extendedDays[0].dateObj)))
    : 0;
  
  // Track the running pool of thawed inventory
  let previousThawedInventory = 0;
  let previousActualUsage = 0;
  
  // Initialize thawed inventory from seed carryover batches available at the start of the prior day.
  // This lets the first Monday include Saturday arrivals correctly.
  if (normalizedDays.length) {
    const priorDayDate = addDays(normalizedDays[0].dateObj, -1);
    previousThawedInventory = roundValue(
      sumRemainingCases(getUsableBatches(batches, priorDayDate))
    );
  }

  extendedDays.forEach((day, extendedIndex) => {
    // CORE RULE: Thaw arrival from pull 2 days ago
    let thawArrivalToday = 0;
    if (extendedIndex >= 2) {
      thawArrivalToday = roundValue(dailyPulls[extendedIndex - 2]);
    } else if (extendedIndex === 0 && getDayLabel(day.dateObj) === "Mon") {
      thawArrivalToday = priorSaturdayPull;
    } else if (extendedIndex === 1 && getDayLabel(day.dateObj) === "Tue") {
      thawArrivalToday = priorSundayPull;
    }
    
    // Track thawed inventory pool
    const thawedInventoryToday = roundValue(
      Math.max(0, previousThawedInventory + thawArrivalToday - previousActualUsage)
    );
    
    const batch = createBatch(day);
    batches.push(batch);
    totalPulled += batch.casesPulled;

    const newlyUsableBatches = getBatchesBecomingUsableOnDate(batches, day.dateObj);
    const actualNewUsableCases = roundValue(sumRemainingCases(newlyUsableBatches));
    const expectedStartingInventory = roundValue(previousEndingInventory + actualNewUsableCases);
    const usableBatches = getUsableBatches(batches, day.dateObj);
    const actualStartingInventory = roundValue(sumRemainingCases(usableBatches));
    const calculationError = !numbersMatch(expectedStartingInventory, actualStartingInventory);
    const startingInventory = previousEndingInventory;
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

    // NEW THAW PIPELINE LOGIC
    const isDayLabel = getDayLabel(day.dateObj);
    
    // Step 4: USABLE INVENTORY - min of physical and thawed
    const usableInventory = roundValue(Math.min(startingInventory, thawedInventoryToday));
    
    // Step 5: FROZEN INVENTORY - what exists but hasn't thawed
    const frozen = roundValue(Math.max(0, startingInventory - usableInventory));
    
    // Step 6: ACTUAL USAGE - constrained by what's usable
    const actualUsage = roundValue(Math.min(day.demand, usableInventory));
    
    // Step 7: ENDING INVENTORY
    const thawEndingInventory = roundValue(startingInventory - actualUsage + dailyPulls[extendedIndex]);
    
    // Calculate future demand (next 2 operating days, excluding Sundays)
    let futureDemandCount = 0;
    let futureDemanDays = 0;
    let hasFutureDemandData = false;
    for (let i = extendedIndex + 1; i < extendedDays.length && futureDemandCount < 2; i += 1) {
      const nextDayLabel = getDayLabel(extendedDays[i].dateObj);
      if (nextDayLabel !== "Sun") {
        futureDemanDays = roundValue(futureDemanDays + extendedDays[i].demand);
        futureDemandCount += 1;
      }
    }
    
    if (futureDemandCount < 2 && (extendedIndex + 2 < extendedDays.length)) {
      hasFutureDemandData = true;
    } else if (futureDemandCount === 2) {
      hasFutureDemandData = true;
    }
    
    const coverageGap = roundValue(Math.max(0, futureDemanDays - usableInventory));
    
    // Pipeline visibility
    const thawTomorrow = extendedIndex + 1 < dailyPulls.length ? roundValue(dailyPulls[extendedIndex + 1]) : 0;
    const thawIn2Days = extendedIndex + 2 < dailyPulls.length ? roundValue(dailyPulls[extendedIndex + 2]) : 0;
    
    // Determine status based on new logic
    let thawStatus = "No Risk";
    let rootCauseDay = null;
    if (frozen > 0) {
      thawStatus = "Frozen";
      rootCauseDay = extendedIndex - 2; // Chicken needed today should have been pulled 2 days ago
    } else if (!hasFutureDemandData) {
      thawStatus = "Not Enough Data";
    } else if (coverageGap > 0) {
      thawStatus = "Underpull Risk";
    }
    
    // Explanation text
    let explanation = "";
    if (frozen > 0) {
      const rootCauseDateObj = rootCauseDay >= 0 ? normalizedDays[rootCauseDay].dateObj : null;
      const rootCauseDateStr = rootCauseDateObj ? formatStoredDate(rootCauseDateObj) : "Unknown";
      explanation = `${formatNumber(frozen)} units still thawing (pull issue on ${rootCauseDateStr})`;
    } else if (!hasFutureDemandData) {
      explanation = "Need the 3rd and 4th day usage";
    } else if (coverageGap > 0) {
      explanation = `${formatNumber(coverageGap)} unit shortfall vs future demand`;
    } else {
      explanation = "Sufficient inventory and thaw coverage";
    }

    totalDemand += day.demand;
    totalExpiredCases = roundValue(
      batches.reduce((sum, currentBatch) => sum + currentBatch.expiredCases, 0)
    );
    totalAtRiskCases = roundValue(
      batches.reduce((sum, currentBatch) => sum + currentBatch.atRiskCases, 0)
    );

    // Push all days (including carryover for now to test)
    dailyTable.push({
      date: day.date,
      dateObj: new Date(day.dateObj),
      day: isDayLabel,
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
      shortageAmount: roundValue(Math.max(0, day.demand - startingInventory)),
      // Thaw pipeline fields - core metrics
      thawArrivalToday,
      thawedInventoryToday,
      dailyPull: dailyPulls[extendedIndex],
      usableInventory,
      frozen,
      actualUsage,
      thawEndingInventory,
      // Future analysis
      futureDemand: futureDemanDays,
      coverageGap,
      thawStatus,
      rootCauseDay,
      explanation,
      thawTomorrow,
      thawIn2Days
    });

    // Update tracking variables for next iteration
    previousEndingInventory = thawEndingInventory;
    previousThawedInventory = thawedInventoryToday;
    previousActualUsage = actualUsage;
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
    demand: sanitizeNumber(entry.sold),
    casesPulled: sanitizeNumber(entry.sold)
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
  const fallbackDayByLabel = new Map();
  days.forEach((day) => {
    fallbackDayByLabel.set(getDayLabel(day.dateObj), day);
  });
  const firstDate = days[0].dateObj;
  const lastDate = days[days.length - 1].dateObj;
  const table = [];
  const thawHistoryStartDate = addDays(firstDate, -14);
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
    const dayPull = isSunday ? 0 : roundValue(storedDay?.casesPulled || 0);
    const usableInventoryToday = calculateUsableInventoryToday({
      currentDate,
      historyStartDate: thawHistoryStartDate,
      dayByDateKey,
      fallbackDayByLabel
    });
    const usableInventory = roundValue(Math.min(startingInventory, usableInventoryToday));
    const frozenAmount = roundValue(Math.max(0, startingInventory - usableInventory));
    const actualUsage = isSunday ? 0 : roundValue(Math.min(demand, usableInventory));
    const endingInventory = isSunday
      ? startingInventory
      : roundValue(Math.max(0, startingInventory - actualUsage + dayPull));
    const thawTomorrow = isSunday
      ? 0
      : getHistoricalPullAmount(addDays(currentDate, -1), dayByDateKey, fallbackDayByLabel);
    const thawInTwoDays = isSunday
      ? 0
      : getHistoricalPullAmount(currentDate, dayByDateKey, fallbackDayByLabel);

    table.push({
      date: formatStoredDate(currentDate),
      dateObj: new Date(currentDate),
      day: dayLabel,
      buildTo,
      startingInventory,
      isEstimatedStartingInventory: table.length === 0,
      demand,
      dayPull,
      usableInventoryToday,
      usableInventory,
      actualUsage,
      endingInventory,
      frozenAmount,
      thawTomorrow,
      thawInTwoDays
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
    const coverageGap = roundValue(Math.max(0, frozenWindowDemand - row.usableInventory));

    return {
      ...row,
      frozenWindowDemand,
      coverageGap,
      hasFrozenWindowData,
      ...getFrozenInventoryStatusDetails({
        ...row,
        frozenWindowDemand,
        coverageGap,
        hasFrozenWindowData
      })
    };
  });
}

function calculateUsableInventoryToday({ currentDate, historyStartDate, dayByDateKey, fallbackDayByLabel }) {
  let total = 0;
  let pointer = new Date(historyStartDate);
  const latestEligibleDate = addDays(currentDate, -2);

  while (pointer.getTime() <= latestEligibleDate.getTime()) {
    total = roundValue(total + getHistoricalPullAmount(pointer, dayByDateKey, fallbackDayByLabel));
    pointer = addDays(pointer, 1);
  }

  return total;
}

function getHistoricalPullAmount(dateObj, dayByDateKey, fallbackDayByLabel) {
  const dayLabel = getDayLabel(dateObj);
  if (dayLabel === "Sun") {
    return 0;
  }

  const directMatch = dayByDateKey.get(formatDateKey(dateObj));
  if (directMatch) {
    return roundValue(directMatch.casesPulled || 0);
  }

  return roundValue(fallbackDayByLabel.get(dayLabel)?.casesPulled || 0);
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
    const expirationExcess = roundValue(Math.max(0, row.buildTo - expirationWindowDemand));
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
      expirationStatus: determineExpirationStatus(row.buildTo, hasExpirationWindowData, expirationExcess)
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

function determineExpirationStatus(buildTo, hasExpirationWindowData, expirationExcess) {
  if (!hasExpirationWindowData) {
    return "NOT ENOUGH DATA";
  }
  if (expirationExcess > 0) {
    return "EXPIRATION RISK";
  }
  if (numbersMatch(buildTo, 0)) {
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
    { label: "Underpull Events; Cases", value: `${formatNumber(metrics.underpullEvents)}; ${formatNumber(metrics.underpullCases)}` },
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
  const evaluatedDays = results.dailyTable
    .filter((row) => row.thawStatus !== "Not Enough Data")
    .map((row) => {
      const expirationEntry = expirationByDate.get(row.date);
      if (!expirationEntry || expirationEntry.details.status === "Not Enough Data") {
        return null;
      }

      return {
        date: row.date,
        day: row.day,
        frozenRow: {
          ...row,
          statusLabel: row.thawStatus,
          frozenAmount: row.frozen
        },
        expirationRow: expirationEntry.row,
        expirationDetails: expirationEntry.details
      };
    })
    .filter(Boolean);

  const perfectDays = evaluatedDays.filter((entry) => {
    return entry.frozenRow.statusLabel === "No Risk" && entry.expirationDetails.status === "No Risk";
  });
  const badDays = evaluatedDays.filter((entry) => {
    return (
      entry.frozenRow.statusLabel === "Frozen" ||
      entry.frozenRow.statusLabel === "Underpull Risk" ||
      entry.expirationDetails.status === "Expiration"
    );
  });
  const frozenRows = evaluatedDays.filter((entry) => entry.frozenRow.statusLabel === "Frozen");
  const underpullRows = evaluatedDays.filter((entry) => entry.frozenRow.statusLabel === "Underpull Risk");
  const expirationRows = evaluatedDays.filter((entry) => entry.expirationDetails.status === "Expiration");

  return {
    evaluatedDays,
    perfectDays,
    badDays,
    frozenEvents: frozenRows.length,
    frozenCases: roundValue(frozenRows.reduce((sum, entry) => sum + entry.frozenRow.frozenAmount, 0)),
    underpullEvents: underpullRows.length,
    underpullCases: roundValue(underpullRows.reduce((sum, entry) => sum + entry.frozenRow.coverageGap, 0)),
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
        underpullEvents: 0,
        expirationEvents: 0,
        frozenCases: 0,
        underpullCases: 0,
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

    if (entry.frozenRow.statusLabel === "Underpull Risk") {
      dayMetrics.underpullEvents += 1;
      dayMetrics.underpullCases = roundValue(dayMetrics.underpullCases + entry.frozenRow.coverageGap);
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
    const issueCount = item.frozenEvents + item.underpullEvents + item.expirationEvents;
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
        `Fix pull execution 2 days earlier to reduce frozen inventory (${formatNumber(item.frozenEvents)} event${item.frozenEvents === 1 ? "" : "s"}, ${formatNumber(item.frozenCases)} case${numbersMatch(item.frozenCases, 1) ? "" : "s"})`
      );
    }
    if (item.underpullEvents > 0) {
      actions.push(
        `Raise planned pull so thawed inventory covers day 3/4 demand (${formatNumber(item.underpullEvents)} event${item.underpullEvents === 1 ? "" : "s"}, ${formatNumber(item.underpullCases)} case${numbersMatch(item.underpullCases, 1) ? "" : "s"})`
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
          <td>${formatNumber(row.startingInventory)}</td>
          <td>${formatNumber(row.thawArrivalToday)}</td>
          <td>${formatNumber(row.thawedInventoryToday)}</td>
          <td>${formatNumber(row.usableInventory)}</td>
          <td class="${row.frozen > 0 ? 'warning-text' : ''}">${formatNumber(row.frozen)}</td>
          <td>${formatUsageNumber(row.demand)}</td>
          <td>${formatNumber(row.actualUsage)}</td>
          <td>${formatNumber(row.dailyPull)}</td>
          <td>${formatNumber(row.thawEndingInventory)}</td>
          <td>${formatNumber(row.futureDemand)}</td>
          <td class="${row.coverageGap > 0 ? 'warning-text' : ''}">${formatNumber(row.coverageGap)}</td>
          <td>${buildStatusPill(row.thawStatus)}</td>
          <td>${row.explanation}</td>
          <td>${formatNumber(row.thawTomorrow)}</td>
          <td>${formatNumber(row.thawIn2Days)}</td>
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
          <td>${formatUsageNumber(row.demand)}</td>
          <td>${formatUsageNumber(row.dayPull)}</td>
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
  if (row.frozenAmount > 0) {
    const rootCauseDate = formatStoredDate(addDays(row.dateObj, -2));
    return {
      statusLabel: "Frozen",
      explanation: `${formatNumber(row.frozenAmount)} units still thawing (pull issue on ${rootCauseDate})`
    };
  }
  if (row.coverageGap > 0) {
    return {
      statusLabel: "Underpull Risk",
      explanation: `${formatNumber(row.coverageGap)} unit shortfall vs future demand`
    };
  }
  return {
    statusLabel: "No Risk",
    explanation: "Sufficient inventory and thaw coverage"
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
  if (statusLabel === "Underpull Risk") {
    return "status-warning";
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

function formatUsageNumber(value) {
  return sanitizeNumber(value).toFixed(2);
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
