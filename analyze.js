const summaryGrid = document.getElementById("summaryGrid");
const analysisBody = document.getElementById("analysisBody");
const recommendationBody = document.getElementById("recommendationBody");
const recommendationTitle = document.getElementById("recommendationTitle");
const recommendationSubtitle = document.getElementById("recommendationSubtitle");
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
    analysisBody.innerHTML = `
      <tr>
        <td colspan="11" class="empty-state">No saved thaw data found. Go back and enter data first.</td>
      </tr>
    `;
    return;
  }

  applyAnalyzerTheme(stored.type);
  analysisTitle.textContent = `${stored.chickenLabel} Analysis`;
  analysisSubtitle.textContent = `${stored.data.length} operating days analyzed`;
  recommendationTitle.textContent = `Pull Recommendations for ${stored.chickenLabel}`;
  recommendationSubtitle.textContent = "Recommendations are grouped by the day the pull was made.";
  assumptionsText.textContent =
    "Rule used: pulled chicken cannot be used on the pull day or the next day, first becomes usable on pull day + 2 days, and expires on pull day + 4 days (96 hours). Sundays count in timing, but there are no Sunday sales or pulls. Build To is the thawing allocation for the day, Chicken Pull is the amount replaced that day to return inventory to that target after sales and expirations, and Usable Start is the usable inventory available from prior chicken pulls before that day's usage sold. To avoid a cold start, the analyzer seeds a short pre-range history using weekday trend averages from the entered data, with the saved weekly plan as fallback. Rows without a full ending range still use weekday-based estimate values marked with an asterisk.";

  const results = analyzeInventoryWindows(stored.data, stored.weeklyPlan || {}, stored.averageDailySales || 0);
  renderSummary(results);
  renderDailyResults(results.dailyRows);
  renderRecommendations(results.pullRecommendations, stored.weeklyPlan || {});
}

function analyzeInventoryWindows(data, weeklyPlan = {}, averageDailySales = 0) {
  const warmupEntries = buildWarmupEntries(data, weeklyPlan, averageDailySales);
  const normalizedData = [...warmupEntries, ...data].map((entry) => {
    const pullDate = parseStoredDate(entry.date);
    const resolvedBuildTo = sanitizeNumber(entry.buildTo ?? entry.plannedBuildTo ?? entry.actualPull);
    return {
      ...entry,
      pullDate,
      buildTo: resolvedBuildTo,
      sold: sanitizeNumber(entry.sold),
      derivedPull: 0,
      firstUsableDate: addDays(pullDate, 2),
      expirationDate: addDays(pullDate, 4)
    };
  });

  const firstActualDate = normalizedData.find((entry) => !entry.isWarmup)?.pullDate || null;
  const lastActualDate = [...normalizedData].reverse().find((entry) => !entry.isWarmup)?.pullDate || null;
  const hasWarmupHistory = warmupEntries.length > 0;
  const dailyIssueMap = {};
  const pullRecommendations = {};
  const batches = [];

  let totalPulled = 0;
  let totalUsage = 0;
  let totalStockout = 0;
  let totalExpired = 0;

  normalizedData.forEach((entry) => {
    if (entry.isWarmup) {
      return;
    }

    const dateKey = formatDateKey(entry.pullDate);
    dailyIssueMap[dateKey] = { stockout: 0, expired: 0 };
    ensureRecommendationDay(pullRecommendations, entry.day);

    totalUsage += entry.sold;

    const hasFullRange = Boolean(lastActualDate) && lastActualDate.getTime() >= entry.expirationDate.getTime();
    if (hasFullRange) {
      pullRecommendations[entry.day].completeKeys.add(dateKey);
    } else {
      pullRecommendations[entry.day].incompleteKeys.add(dateKey);
    }
  });

  normalizedData.forEach((entry) => {
    const currentDate = entry.pullDate;
    const hasEnoughHistory = entry.isWarmup
      ? true
      : hasWarmupHistory || (Boolean(firstActualDate) && currentDate.getTime() >= addDays(firstActualDate, 4).getTime());
    let expiredToday = 0;
    const expiredFormulaParts = [];

    batches.forEach((batch) => {
      if (sameDay(batch.expirationDate, currentDate) && batch.remaining > 0) {
        const remainingBeforeExpire = roundValue(batch.remaining);
        const used = roundValue(batch.amount - batch.remaining);
        expiredToday += batch.remaining;
        expiredFormulaParts.push(`${formatNumber(batch.amount)}-${formatNumber(used)}=${formatNumber(remainingBeforeExpire)}`);

        const expiredDay = batch.pullDay;
        const expiredKey = formatDateKey(batch.pullDate);
        ensureRecommendationDay(pullRecommendations, expiredDay);
        pullRecommendations[expiredDay].expired += batch.remaining;
        if (pullRecommendations[expiredDay].completeKeys.has(expiredKey)) {
          pullRecommendations[expiredDay].problemKeys.add(expiredKey);
        }

        batch.remaining = 0;
      }
    });

    expiredToday = roundValue(expiredToday);
    let remainingDemand = entry.sold;

    const usableBatches = batches
      .filter((batch) => {
        return (
          batch.remaining > 0 &&
          currentDate.getTime() >= batch.firstUsableDate.getTime() &&
          currentDate.getTime() < batch.expirationDate.getTime()
        );
      })
      .sort((left, right) => left.expirationDate - right.expirationDate || left.pullDate - right.pullDate);

    const usableStart = roundValue(usableBatches.reduce((sum, batch) => sum + batch.remaining, 0));
    const usableBreakdown = usableBatches
      .map((batch) => formatNumber(roundValue(batch.remaining)))
      .join("+");

    usableBatches.forEach((batch) => {
      if (remainingDemand <= 0) {
        return;
      }

      const used = Math.min(batch.remaining, remainingDemand);
      batch.remaining -= used;
      remainingDemand -= used;
    });

    const stockout = roundValue(Math.max(0, remainingDemand));
    if (stockout > 0 && hasEnoughHistory && !entry.isWarmup) {
      totalStockout += stockout;
      const stockoutPullDate = getSupplyingPullDate(currentDate);
      const stockoutPullDay = getDayLabel(stockoutPullDate);
      const stockoutKey = formatDateKey(stockoutPullDate);

      ensureRecommendationDay(pullRecommendations, stockoutPullDay);
      pullRecommendations[stockoutPullDay].stockout += stockout;
      if (pullRecommendations[stockoutPullDay].completeKeys.has(stockoutKey)) {
        pullRecommendations[stockoutPullDay].problemKeys.add(stockoutKey);
      }

      const dateKey = formatDateKey(currentDate);
      dailyIssueMap[dateKey].stockout += stockout;
    }

    if (hasEnoughHistory && !entry.isWarmup) {
      totalExpired += expiredToday;
      dailyIssueMap[formatDateKey(currentDate)].expired += expiredToday;
    }

    const remainingThawInventory = roundValue(
      batches.reduce((sum, batch) => {
        if (batch.remaining <= 0) {
          return sum;
        }

        return currentDate.getTime() < batch.expirationDate.getTime() ? sum + batch.remaining : sum;
      }, 0)
    );
    const derivedPull = roundValue(Math.max(0, entry.buildTo - remainingThawInventory));

    if (derivedPull > 0) {
      batches.push({
        pullDate: entry.pullDate,
        pullDay: entry.day,
        amount: derivedPull,
        remaining: derivedPull,
        firstUsableDate: addDays(entry.pullDate, 2),
        expirationDate: addDays(entry.pullDate, 4)
      });
    }

    if (!entry.isWarmup) {
      totalPulled += derivedPull;
    }

    entry.usableStart = hasEnoughHistory ? usableStart : null;
    entry.derivedPull = derivedPull;
    entry.stockout = hasEnoughHistory ? stockout : null;
    entry.expiredToday = hasEnoughHistory ? expiredToday : null;
    entry.stockoutFormula = hasEnoughHistory
      ? `${usableBreakdown || "0"} ${stockout > 0 ? "<" : ">="} ${formatNumber(entry.sold)}`
      : "";
    entry.expiredFormula = hasEnoughHistory
      ? expiredFormulaParts.join(" | ") || "No batches expire today"
      : "";
  });

  const rawDailyRows = normalizedData
    .filter((entry) => !entry.isWarmup)
    .map((entry) => {
    const hasEnoughHistory = hasWarmupHistory || (Boolean(firstActualDate) && entry.pullDate.getTime() >= addDays(firstActualDate, 4).getTime());
    const hasFullRange = Boolean(lastActualDate) && lastActualDate.getTime() >= entry.expirationDate.getTime();
    const issues = dailyIssueMap[formatDateKey(entry.pullDate)] || { stockout: 0, expired: 0 };
    const hasEnoughData = hasEnoughHistory && hasFullRange;
    return {
      date: entry.date,
      day: entry.day,
      chickenPull: entry.derivedPull,
      buildTo: entry.buildTo,
      sold: entry.sold,
      firstUsableDay: formatShortDate(entry.firstUsableDate),
      expirationDay: formatShortDate(entry.expirationDate),
      usableStart: entry.usableStart,
      stockout: hasEnoughHistory ? roundValue(issues.stockout) : null,
      expiredToday: hasEnoughHistory ? roundValue(issues.expired) : null,
      stockoutFormula: hasEnoughHistory ? entry.stockoutFormula : "",
      expiredFormula: hasEnoughHistory ? entry.expiredFormula : "",
      hasEnoughData,
      status: buildStatus(
        hasEnoughHistory ? roundValue(issues.stockout) : 0,
        hasEnoughHistory ? roundValue(issues.expired) : 0,
        hasEnoughData
      )
    };
  });

  const dailyRows = applyWeekdayEstimates(rawDailyRows);

  return {
    totalPulled: roundValue(totalPulled),
    totalUsage: roundValue(totalUsage),
    totalStockout: roundValue(totalStockout),
    totalExpired: roundValue(totalExpired),
    dailyRows,
    pullRecommendations
  };
}

function renderSummary(results) {
  const cards = [
    { label: "Total Pulled", value: results.totalPulled },
    { label: "Total Usage", value: results.totalUsage },
    { label: "Stockouts", value: results.totalStockout },
    { label: "Expired Value", value: results.totalExpired }
  ];

  summaryGrid.innerHTML = cards
    .map(
      (card) => `
        <article class="summary-card">
          <p class="summary-label">${card.label}</p>
          <h3>${formatNumber(card.value)}</h3>
        </article>
      `
    )
    .join("");
}

function renderDailyResults(dailyRows) {
  analysisBody.innerHTML = dailyRows
    .map(
      (row) => `
        <tr>
          <td>${row.date}</td>
          <td>${row.day}</td>
          <td>${formatNumber(row.buildTo || 0)}</td>
          <td>${formatNumber(row.chickenPull || 0)}</td>
          <td>${row.firstUsableDay}</td>
          <td>${row.expirationDay}</td>
          <td class="${getAnalysisCellClass(row.usableStart, row.isEstimated)}">${formatAnalysisValue(row.usableStart, row.isEstimated)}</td>
          <td>${formatNumber(row.sold)}</td>
          <td class="${getIssueCellClass(row.stockout, row.isEstimated, "danger-text")}">
            ${formatAnalysisValue(row.stockout, row.isEstimated)}
            ${row.stockoutFormula ? `<div class="formula-note">${row.stockoutFormula}</div>` : ""}
          </td>
          <td class="${getIssueCellClass(row.expiredToday, row.isEstimated, "warning-text")}">
            ${formatAnalysisValue(row.expiredToday, row.isEstimated)}
            ${row.expiredFormula ? `<div class="formula-note">${row.expiredFormula}</div>` : ""}
          </td>
          <td><span class="status-pill ${row.status.className}">${row.status.label}</span></td>
        </tr>
      `
    )
    .join("");
}

function renderRecommendations(pullRecommendations, weeklyPlan) {
  recommendationBody.innerHTML = Object.keys(weeklyPlan)
    .map((day) => {
      const metrics = pullRecommendations[day] || createRecommendationMetrics();
      const complete = metrics.completeKeys.size;
      const incomplete = metrics.incompleteKeys.size;
      const problemWeeks = metrics.problemKeys.size;
      const problemRate = complete > 0 ? roundValue((problemWeeks / complete) * 100) : 0;
      const hasOnlyIncompleteData = complete === 0 && incomplete > 0;
      const recommendation = hasOnlyIncompleteData ? "Not Enough Data" : buildRecommendation(metrics);
      const problemWeeksText = hasOnlyIncompleteData
        ? "Not Enough Data"
        : incomplete > 0
          ? `${problemWeeks}/${complete} (+${incomplete} incomplete)`
          : `${problemWeeks}/${complete}`;
      const problemPercentText = hasOnlyIncompleteData
        ? "Not Enough Data"
        : incomplete > 0
          ? `${formatPercent(problemRate)}*`
          : formatPercent(problemRate);
      const stockoutText = hasOnlyIncompleteData ? "Not Enough Data" : formatNumber(metrics.stockout);
      const expiredText = hasOnlyIncompleteData ? "Not Enough Data" : formatNumber(metrics.expired);

      return `
        <tr>
          <td>${day}</td>
          <td>${formatNumber(weeklyPlan[day] || 0)}</td>
          <td class="${hasOnlyIncompleteData ? "muted-text" : ""}">${problemWeeksText}</td>
          <td class="${hasOnlyIncompleteData ? "muted-text" : incomplete > 0 ? "muted-text" : ""}">${problemPercentText}</td>
          <td class="${hasOnlyIncompleteData ? "muted-text" : metrics.stockout > 0 ? "danger-text" : ""}">${stockoutText}</td>
          <td class="${hasOnlyIncompleteData ? "muted-text" : metrics.expired > 0 ? "warning-text" : ""}">${expiredText}</td>
          <td>${recommendation}</td>
        </tr>
      `;
    })
    .join("");
}

function buildStatus(stockout, expiredToday, hasFullRange) {
  if (stockout > 0 && expiredToday > 0) {
    return { label: "Mixed Signal", className: "status-mixed" };
  }
  if (stockout > 0) {
    return { label: "Stockout", className: "status-danger" };
  }
  if (expiredToday > 0) {
    return { label: "Expired", className: "status-warning" };
  }
  if (!hasFullRange) {
    return { label: "Not Enough Data", className: "status-muted" };
  }
  return { label: "On Track", className: "status-ok" };
}

function buildRecommendation(metrics) {
  if (metrics.stockout > metrics.expired && metrics.stockout > 0) {
    return "Raise this pull day";
  }
  if (metrics.expired > metrics.stockout && metrics.expired > 0) {
    return "Lower this pull day";
  }
  if (metrics.expired > 0 && metrics.stockout > 0) {
    return "Review this pull day";
  }
  return "Keep current plan";
}

function ensureRecommendationDay(pullRecommendations, day) {
  if (!pullRecommendations[day]) {
    pullRecommendations[day] = createRecommendationMetrics();
  }
}

function createRecommendationMetrics() {
  return {
    stockout: 0,
    expired: 0,
    completeKeys: new Set(),
    incompleteKeys: new Set(),
    problemKeys: new Set()
  };
}

function getSupplyingPullDate(date) {
  const target = addDays(date, -2);
  while (target.getDay() === 0) {
    target.setDate(target.getDate() - 1);
  }
  return target;
}

function parseStoredDate(value) {
  const [month, day, year] = value.split("/").map((part) => parseInt(part, 10));
  return new Date(year, month - 1, day);
}

function addDays(date, days) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function sameDay(left, right) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function getDayLabel(date) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function formatShortDate(date) {
  return date.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric"
  });
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

function formatPercent(value) {
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`;
}

function formatAnalysisValue(value, isEstimated = false) {
  if (value === null) {
    return "Not Enough Data";
  }

  const formatted = formatNumber(value);
  return isEstimated ? `${formatted}*` : formatted;
}

function applyWeekdayEstimates(dailyRows) {
  const weekdayAverages = buildWeekdayAverages(dailyRows);

  return dailyRows.map((row) => {
    if (row.hasEnoughData) {
      return {
        ...row,
        isEstimated: false
      };
    }

    const average = weekdayAverages[row.day];
    if (!average) {
      return {
        ...row,
        isEstimated: false
      };
    }

    return {
      ...row,
      usableStart: average.usableStart,
      stockout: roundValue(Math.max(0, row.sold - average.usableStart)),
      expiredToday: 0,
      stockoutFormula: `Avg ${row.day}: ${formatNumber(average.usableStart)} ${row.sold > average.usableStart ? "<" : ">="} ${formatNumber(row.sold)}`,
      expiredFormula: "Estimated row: expiration not scored",
      status: buildEstimatedStatus(
        roundValue(Math.max(0, row.sold - average.usableStart)),
        0
      ),
      isEstimated: true
    };
  });
}

function buildWeekdayAverages(dailyRows) {
  const grouped = {};

  dailyRows.forEach((row) => {
    if (!row.hasEnoughData || row.usableStart === null || row.stockout === null || row.expiredToday === null) {
      return;
    }

    if (!grouped[row.day]) {
      grouped[row.day] = {
        usableStart: []
      };
    }

    grouped[row.day].usableStart.push(row.usableStart);
  });

  return Object.fromEntries(
    Object.entries(grouped).map(([day, values]) => [
      day,
      {
        usableStart: roundValue(average(values.usableStart))
      }
    ])
  );
}

function buildEstimatedStatus(stockout, expiredToday) {
  if (stockout > 0 && expiredToday > 0) {
    return { label: "Estimated Mixed*", className: "status-muted" };
  }
  if (stockout > 0) {
    return { label: "Estimated Stockout*", className: "status-muted" };
  }
  if (expiredToday > 0) {
    return { label: "Estimated Expired*", className: "status-muted" };
  }
  return { label: "Estimated On Track*", className: "status-muted" };
}

function getAnalysisCellClass(value, isEstimated) {
  if (value === null || isEstimated) {
    return "muted-text";
  }
  return "";
}

function getIssueCellClass(value, isEstimated, issueClassName) {
  if (value === null || isEstimated) {
    return "muted-text";
  }
  return value > 0 ? issueClassName : "";
}

function average(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildWarmupEntries(data, weeklyPlan, averageDailySales) {
  if (!data.length || !weeklyPlan || Object.keys(weeklyPlan).length === 0) {
    return [];
  }

  const firstDate = parseStoredDate(data[0].date);
  const warmupEntries = [];
  const warmupStart = addDays(firstDate, -14);
  const trendAverages = buildWarmupTrendAverages(data, weeklyPlan, averageDailySales);

  for (let currentDate = new Date(warmupStart); currentDate < firstDate; currentDate = addDays(currentDate, 1)) {
    const day = getDayLabel(currentDate);
    if (day === "Sun") {
      continue;
    }

    const plannedAmount = sanitizeNumber(weeklyPlan[day]);
    const trend = trendAverages[day] || { sold: plannedAmount, buildTo: plannedAmount };
    warmupEntries.push({
      date: formatStoredDate(currentDate),
      day,
      buildTo: roundValue(Math.max(plannedAmount, trend.buildTo)),
      sold: roundValue(Math.min(plannedAmount, trend.sold)),
      isWarmup: true
    });
  }

  return warmupEntries;
}

function formatStoredDate(date) {
  return date.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric"
  });
}

function buildWarmupTrendAverages(data, weeklyPlan, averageDailySales) {
  const grouped = {};

  data.forEach((entry) => {
    const day = entry.day;
    if (!day || day === "Sun") {
      return;
    }

    if (!grouped[day]) {
      grouped[day] = {
        sold: [],
        buildTo: []
      };
    }

    grouped[day].sold.push(sanitizeNumber(entry.sold));
    grouped[day].buildTo.push(sanitizeNumber(entry.buildTo ?? entry.plannedBuildTo ?? weeklyPlan[day]));
  });

  const allSoldValues = Object.values(grouped).flatMap((values) => values.sold);
  const allBuildToValues = Object.values(grouped).flatMap((values) => values.buildTo);
  const overallSoldAverage = roundValue(average(allSoldValues)) || sanitizeNumber(averageDailySales);
  const overallBuildToAverage = roundValue(average(allBuildToValues));

  return Object.fromEntries(
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => {
      const dayValues = grouped[day];
      const fallbackPlan = sanitizeNumber(weeklyPlan[day]);
      const soldAverage = dayValues?.sold?.length
        ? roundValue(average(dayValues.sold))
        : overallSoldAverage || sanitizeNumber(averageDailySales) || fallbackPlan;
      const buildToAverage = dayValues?.buildTo?.length
        ? roundValue(average(dayValues.buildTo))
        : overallBuildToAverage || fallbackPlan;

      return [
        day,
        {
          sold: soldAverage,
          buildTo: buildToAverage
        }
      ];
    })
  );
}

function applyAnalyzerTheme(type) {
  document.body.classList.remove(...ANALYZER_THEME_CLASSES);

  const themeClass = THEME_CLASS_BY_TYPE[type];
  if (themeClass) {
    document.body.classList.add(themeClass);
  }
}
