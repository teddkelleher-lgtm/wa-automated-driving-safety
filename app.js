const DAY_MS = 24 * 60 * 60 * 1000;

const formatterInt = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const formatterPct = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const refs = {
  slider: document.querySelector("#automationShare"),
  shareValue: document.querySelector("#shareValue"),
  scenarioCopy: document.querySelector("#scenarioCopy"),
  scenarioNote: document.querySelector("#scenarioNote"),
  scenarioTitle: document.querySelector("#scenarioTitle"),
  metricDeaths: document.querySelector("#metricDeaths"),
  metricSeriousInjuries: document.querySelector("#metricSeriousInjuries"),
  metricAvoidedDeaths: document.querySelector("#metricAvoidedDeaths"),
  metricAvoidedSerious: document.querySelector("#metricAvoidedSerious"),
  unknownExcluded: document.querySelector("#unknownExcluded"),
  currentTotal: document.querySelector("#currentTotal"),
  scenarioTotal: document.querySelector("#scenarioTotal"),
  currentStatus: document.querySelector("#currentStatus"),
  scenarioStatus: document.querySelector("#scenarioStatus"),
  currentBallCount: document.querySelector("#currentBallCount"),
  scenarioBallCount: document.querySelector("#scenarioBallCount"),
  currentCanvas: document.querySelector("#currentCanvas"),
  scenarioCanvas: document.querySelector("#scenarioCanvas"),
};

const state = {
  data: null,
  share: 0.5,
  restartAt: performance.now(),
  currentPanel: null,
  scenarioPanel: null,
  animationFrame: null,
};

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let value = Math.imul(t ^ (t >>> 15), t | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function formatInt(value) {
  return formatterInt.format(Math.round(value));
}

function allocateBallCounts(items, accessor, scale) {
  const rawItems = items.map((item) => {
    const raw = accessor(item) / scale;
    const whole = Math.floor(raw);
    return {
      item,
      raw,
      whole,
      remainder: raw - whole,
    };
  });

  const targetTotal = Math.round(
    rawItems.reduce((sum, entry) => sum + entry.raw, 0)
  );
  let assigned = rawItems.reduce((sum, entry) => sum + entry.whole, 0);

  rawItems
    .sort((left, right) => right.remainder - left.remainder)
    .forEach((entry) => {
      if (assigned >= targetTotal) return;
      entry.whole += 1;
      assigned += 1;
    });

  return new Map(rawItems.map((entry) => [entry.item.id, entry.whole]));
}

function loadData() {
  return fetch("data/wa-ball-simulation.json").then((response) => {
    if (!response.ok) {
      throw new Error("Could not load simulation data.");
    }
    return response.json();
  });
}

function computeSummary(share) {
  const { data } = state;
  const windowFactor = data.windowDays / data.daysInBaselineYear;
  const annualDeaths = data.summary.annualTrafficDeaths;
  const annualSeriousInjuries = data.summary.annualSeriousInjuries;
  const deathAvoided =
    annualDeaths * windowFactor * share * data.summary.injuryAndDeathReduction;
  const seriousAvoided =
    annualSeriousInjuries *
    windowFactor *
    share *
    data.summary.injuryAndDeathReduction;

  const categories = data.categories.map((category) => {
    const base = category.annualCount * windowFactor;
    const scenario = base * (1 - share * category.reduction);
    return {
      ...category,
      base100: base,
      scenario100: scenario,
    };
  });

  return {
    windowDeaths: annualDeaths * windowFactor,
    windowSeriousInjuries: annualSeriousInjuries * windowFactor,
    avoidedDeaths: deathAvoided,
    avoidedSerious: seriousAvoided,
    currentTotal: categories.reduce((sum, category) => sum + category.base100, 0),
    scenarioTotal: categories.reduce((sum, category) => sum + category.scenario100, 0),
    categories,
  };
}

function createBallSprite(radius, color, icon) {
  const size = Math.ceil(radius * 2.8);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const center = size / 2;

  const gradient = ctx.createRadialGradient(
    center - radius * 0.35,
    center - radius * 0.45,
    radius * 0.3,
    center,
    center,
    radius * 1.1
  );

  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.15, color);
  gradient.addColorStop(1, "#10151d");

  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(center - radius * 0.35, center - radius * 0.4, radius * 0.24, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.46)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(center, center, radius - 0.5, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1;
  ctx.stroke();

  if (icon) {
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = `${Math.round(radius * 1.05)}px Sora`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(icon, center, center + 0.2);
  }

  return canvas;
}

function buildPositions(width, height, neededCount) {
  const padding = width < 500 ? 18 : 22;
  const availableWidth = width - padding * 2;
  const availableHeight = height - padding * 2;
  let radius = Math.min(8, Math.max(4.4, Math.sqrt((availableWidth * availableHeight) / (neededCount * 15))));
  let positions = [];

  while (radius >= 3.2) {
    const stepX = radius * 2.15;
    const stepY = radius * 1.85;
    positions = [];
    let rowIndex = 0;
    for (let y = height - padding - radius; y >= padding + radius; y -= stepY) {
      const offset = rowIndex % 2 === 0 ? 0 : radius * 1.08;
      const row = [];
      for (let x = padding + radius + offset; x <= width - padding - radius; x += stepX) {
        row.push({
          x,
          y,
        });
      }
      const rng = mulberry32(hashString(`row-${rowIndex}-${width}-${height}`));
      for (let index = row.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(rng() * (index + 1));
        [row[index], row[swapIndex]] = [row[swapIndex], row[index]];
      }
      positions.push(...row);
      rowIndex += 1;
    }

    if (positions.length >= neededCount) {
      return {
        radius,
        positions,
      };
    }
    radius -= 0.25;
  }

  return {
    radius,
    positions,
  };
}

function createPanelConfig(kind, visibleSummary) {
  const width = refs.currentCanvas.clientWidth;
  const height = refs.currentCanvas.clientHeight;
  const neededCount = Math.max(
    Math.round(visibleSummary.currentTotal / state.data.ballScale) + 40,
    Math.round(visibleSummary.scenarioTotal / state.data.ballScale) + 40
  );

  const canvas = kind === "current" ? refs.currentCanvas : refs.scenarioCanvas;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const positionSet = buildPositions(width, height, neededCount);
  const sprites = {};
  state.data.categories.forEach((category) => {
    sprites[category.id] = createBallSprite(
      positionSet.radius,
      category.color,
      category.icon === "skull" ? "☠" : ""
    );
  });

  return {
    kind,
    canvas,
    ctx,
    width,
    height,
    radius: positionSet.radius,
    positions: positionSet.positions,
    sprites,
    tokens: [],
    fullBallCount: 0,
  };
}

function buildTimeline(kind, categories) {
  const scale = state.data.ballScale;
  const windowMs = state.data.windowDays * DAY_MS;
  const futureMs = state.data.futureHorizonDays * DAY_MS;
  const targetKey = kind === "current" ? "base100" : "scenario100";
  const ballMap = allocateBallCounts(categories, (category) => category[targetKey], scale);
  const tokens = [];

  categories.forEach((category) => {
    const historicalBallCount = ballMap.get(category.id) || 0;
    if (historicalBallCount <= 0) return;

    const historyRng = mulberry32(
      hashString(`${kind}-${category.id}-${Math.round(state.share * 100)}`)
    );

    for (let index = 0; index < historicalBallCount; index += 1) {
      const time =
        -windowMs + ((index + historyRng()) / historicalBallCount) * windowMs;
      tokens.push({
        time,
        categoryId: category.id,
      });
    }

    const interval = windowMs / historicalBallCount;
    const futureBallCount = Math.ceil(futureMs / interval) + 2;
    let nextTime = historyRng() * interval;

    for (let index = 0; index < futureBallCount; index += 1) {
      tokens.push({
        time: nextTime,
        categoryId: category.id,
      });
      nextTime += interval;
    }
  });

  tokens.sort((left, right) => left.time - right.time);
  return {
    tokens,
    fullBallCount: tokens.filter((token) => token.time <= 0 && token.time > -windowMs).length,
  };
}

function rebuildPanels() {
  const summary = computeSummary(state.share);
  state.currentPanel = createPanelConfig("current", summary);
  state.scenarioPanel = createPanelConfig("scenario", summary);

  const currentTimeline = buildTimeline("current", summary.categories);
  state.currentPanel.tokens = currentTimeline.tokens;
  state.currentPanel.fullBallCount = currentTimeline.fullBallCount;

  const scenarioTimeline = buildTimeline("scenario", summary.categories);
  state.scenarioPanel.tokens = scenarioTimeline.tokens;
  state.scenarioPanel.fullBallCount = scenarioTimeline.fullBallCount;
}

function updateText() {
  const summary = computeSummary(state.share);
  const shareText = formatterPct.format(state.share);

  refs.shareValue.textContent = shareText;
  refs.scenarioCopy.textContent =
    state.share === 0 ? "status quo replay" : "counterfactual replay";
  refs.scenarioTitle.textContent =
    state.share === 0
      ? "If 0% of trips were automated"
      : `If ${shareText} of trips were automated`;

  refs.metricDeaths.textContent = formatInt(summary.windowDeaths);
  refs.metricSeriousInjuries.textContent = formatInt(summary.windowSeriousInjuries);
  refs.metricAvoidedDeaths.textContent = formatInt(summary.avoidedDeaths);
  refs.metricAvoidedSerious.textContent = formatInt(summary.avoidedSerious);
  refs.unknownExcluded.textContent = formatInt(state.data.summary.excludedUnknownSeverityCrashes);
  refs.currentTotal.textContent = formatInt(summary.currentTotal);
  refs.scenarioTotal.textContent = formatInt(summary.scenarioTotal);
  refs.scenarioNote.textContent =
    `At ${shareText} automated trips, the right vessel removes an estimated ${formatInt(
      summary.avoidedDeaths
    )} deaths and ${formatInt(
      summary.avoidedSerious
    )} serious injuries over 100 days.`;
}

function getSimulationNow() {
  const elapsed = performance.now() - state.restartAt;
  const catchupMs = state.data.catchupSeconds * 1000;
  const windowMs = state.data.windowDays * DAY_MS;

  if (elapsed <= catchupMs) {
    return -windowMs + (elapsed / catchupMs) * windowMs;
  }
  return elapsed - catchupMs;
}

function getVisibleTokens(panel, simulationNow) {
  const start = simulationNow - state.data.windowDays * DAY_MS;
  return panel.tokens.filter(
    (token) => token.time <= simulationNow && token.time > start
  );
}

function drawPanel(panel, visibleTokens) {
  const { ctx, width, height } = panel;

  ctx.clearRect(0, 0, width, height);

  const background = ctx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "#0b1018");
  background.addColorStop(1, "#06080d");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  const drawCount = Math.min(visibleTokens.length, panel.positions.length);
  for (let index = 0; index < drawCount; index += 1) {
    const token = visibleTokens[index];
    const position = panel.positions[index];
    const sprite = panel.sprites[token.categoryId];
    ctx.drawImage(
      sprite,
      position.x - sprite.width / 2,
      position.y - sprite.height / 2
    );
  }

  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1.2;
  ctx.strokeRect(0.6, 0.6, width - 1.2, height - 1.2);
}

function updateStatuses(simulationNow, currentVisible, scenarioVisible) {
  const elapsed = performance.now() - state.restartAt;
  const catchupMs = state.data.catchupSeconds * 1000;
  const mode = elapsed <= catchupMs ? "catchup" : "live";

  if (mode === "catchup") {
    const progress = Math.max(
      0,
      Math.min(
        state.data.windowDays,
        ((simulationNow + state.data.windowDays * DAY_MS) /
          (state.data.windowDays * DAY_MS)) *
          state.data.windowDays
      )
    );
    refs.currentStatus.textContent = `Replaying ${formatInt(progress)} of ${state.data.windowDays} days`;
    refs.scenarioStatus.textContent = `Replay resets whenever the slider changes`;
  } else {
    refs.currentStatus.textContent = "Live mode: the 100-day window now advances in real time";
    refs.scenarioStatus.textContent = "Live mode: new markers arrive at the counterfactual rate";
  }

  refs.currentBallCount.textContent = `${formatInt(currentVisible.length)} / ${formatInt(
    state.currentPanel.fullBallCount
  )} balls`;
  refs.scenarioBallCount.textContent = `${formatInt(scenarioVisible.length)} / ${formatInt(
    state.scenarioPanel.fullBallCount
  )} balls`;
}

function render() {
  const simulationNow = getSimulationNow();
  const currentVisible = getVisibleTokens(state.currentPanel, simulationNow);
  const scenarioVisible = getVisibleTokens(state.scenarioPanel, simulationNow);

  drawPanel(state.currentPanel, currentVisible);
  drawPanel(state.scenarioPanel, scenarioVisible);
  updateStatuses(simulationNow, currentVisible, scenarioVisible);

  state.animationFrame = requestAnimationFrame(render);
}

function restartSimulation() {
  state.restartAt = performance.now();
  updateText();
  rebuildPanels();
}

function handleResize() {
  rebuildPanels();
}

function wireEvents() {
  refs.slider.addEventListener("input", (event) => {
    state.share = Number(event.target.value) / 100;
    restartSimulation();
  });

  window.addEventListener("resize", () => {
    window.clearTimeout(handleResize.timer);
    handleResize.timer = window.setTimeout(handleResize, 120);
  });
}

async function init() {
  state.data = await loadData();
  state.share = state.data.defaultAutomationShare;
  refs.slider.value = String(Math.round(state.share * 100));

  wireEvents();
  restartSimulation();
  render();
}

init().catch((error) => {
  console.error(error);
  refs.scenarioNote.textContent =
    "The simulation data could not be loaded. Serve the site over HTTP and reload.";
});
