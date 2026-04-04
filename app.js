const DAY_MS = 24 * 60 * 60 * 1000;

const formatterInt = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const formatterOneDecimal = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
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
  pedestrianNote: document.querySelector("#pedestrianNote"),
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
  categoryById: null,
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

function bounceOut(t) {
  const n1 = 7.5625;
  const d1 = 2.75;

  if (t < 1 / d1) {
    return n1 * t * t;
  }
  if (t < 2 / d1) {
    const value = t - 1.5 / d1;
    return n1 * value * value + 0.75;
  }
  if (t < 2.5 / d1) {
    const value = t - 2.25 / d1;
    return n1 * value * value + 0.9375;
  }
  const value = t - 2.625 / d1;
  return n1 * value * value + 0.984375;
}

function formatInt(value) {
  return formatterInt.format(Math.round(value));
}

function formatDecimal(value) {
  return formatterOneDecimal.format(value);
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
  const pedestrianAnnualByCategory = data.pedestrianSubset.byCategoryAnnual;

  const avoidedDeaths =
    annualDeaths * windowFactor * share * data.summary.injuryAndDeathReduction;
  const avoidedSerious =
    annualSeriousInjuries *
    windowFactor *
    share *
    data.summary.injuryAndDeathReduction;

  const categories = data.categories.map((category) => {
    const base = category.annualCount * windowFactor;
    const scenario = base * (1 - share * category.reduction);
    const pedestrianAnnualCount = pedestrianAnnualByCategory[category.id] || 0;
    const pedestrianBaseWindow = pedestrianAnnualCount * windowFactor;
    const pedestrianScenarioWindow =
      pedestrianBaseWindow * (1 - share * category.reduction);
    return {
      ...category,
      baseWindow: base,
      scenarioWindow: scenario,
      pedestrianAnnualCount,
      pedestrianBaseWindow,
      pedestrianScenarioWindow,
    };
  });

  return {
    windowDeaths: annualDeaths * windowFactor,
    windowSeriousInjuries: annualSeriousInjuries * windowFactor,
    avoidedDeaths,
    avoidedSerious,
    currentTotal: categories.reduce((sum, category) => sum + category.baseWindow, 0),
    scenarioTotal: categories.reduce((sum, category) => sum + category.scenarioWindow, 0),
    pedestrianCurrentTotal: categories.reduce(
      (sum, category) => sum + category.pedestrianBaseWindow,
      0
    ),
    pedestrianScenarioTotal: categories.reduce(
      (sum, category) => sum + category.pedestrianScenarioWindow,
      0
    ),
    categories,
  };
}

function allocateBallCounts(items, accessor, scale) {
  const allocations = items.map((item) => {
    const raw = accessor(item) / scale;
    const count = Math.floor(raw);
    return {
      item,
      raw,
      count,
      remainder: raw - count,
    };
  });

  const target = Math.round(allocations.reduce((sum, item) => sum + item.raw, 0));
  let assigned = allocations.reduce((sum, item) => sum + item.count, 0);

  allocations
    .sort((left, right) => right.remainder - left.remainder)
    .forEach((entry) => {
      if (assigned >= target) return;
      entry.count += 1;
      assigned += 1;
    });

  return new Map(allocations.map((entry) => [entry.item.id, entry.count]));
}

function drawPedestrianGlyph(ctx, x, y, size, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.15, size * 0.12);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.arc(x, y - size * 0.33, size * 0.12, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(x, y - size * 0.18);
  ctx.lineTo(x - size * 0.02, y + size * 0.06);
  ctx.lineTo(x - size * 0.13, y + size * 0.29);
  ctx.moveTo(x - size * 0.02, y - size * 0.02);
  ctx.lineTo(x - size * 0.2, y + size * 0.07);
  ctx.moveTo(x - size * 0.01, y);
  ctx.lineTo(x + size * 0.19, y + size * 0.1);
  ctx.moveTo(x - size * 0.02, y + size * 0.06);
  ctx.lineTo(x + size * 0.15, y + size * 0.27);
  ctx.stroke();
  ctx.restore();
}

function createBallSprite(radius, color, options = {}) {
  const { icon = "", ominous = false, pedestrian = false } = options;
  const size = Math.ceil(radius * 2.85);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const center = size / 2;

  if (ominous) {
    const aura = ctx.createRadialGradient(center, center, radius * 0.2, center, center, radius * 1.45);
    aura.addColorStop(0, "rgba(200,29,61,0)");
    aura.addColorStop(0.68, "rgba(200,29,61,0.16)");
    aura.addColorStop(1, "rgba(200,29,61,0)");
    ctx.beginPath();
    ctx.arc(center, center, radius * 1.35, 0, Math.PI * 2);
    ctx.fillStyle = aura;
    ctx.fill();
  }

  const gradient = ctx.createRadialGradient(
    center - radius * 0.45,
    center - radius * 0.55,
    radius * 0.28,
    center,
    center,
    radius * 1.15
  );

  if (ominous) {
    gradient.addColorStop(0, "rgba(255,246,248,0.96)");
    gradient.addColorStop(0.09, "#ff8aa0");
    gradient.addColorStop(0.58, color);
    gradient.addColorStop(1, "#14070d");
  } else {
    gradient.addColorStop(0, "rgba(255,255,255,0.95)");
    gradient.addColorStop(0.11, "#f4f7fb");
    gradient.addColorStop(0.19, color);
    gradient.addColorStop(1, "#09111a");
  }

  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(center - radius * 0.34, center - radius * 0.44, radius * 0.21, 0, Math.PI * 2);
  ctx.fillStyle = ominous ? "rgba(255,250,251,0.44)" : "rgba(255,255,255,0.52)";
  ctx.fill();

  const streak = ctx.createLinearGradient(
    center - radius * 0.7,
    center - radius * 0.92,
    center + radius * 0.16,
    center - radius * 0.16
  );
  streak.addColorStop(0, "rgba(255,255,255,0)");
  streak.addColorStop(0.38, ominous ? "rgba(255,249,250,0.32)" : "rgba(255,255,255,0.38)");
  streak.addColorStop(1, "rgba(255,255,255,0)");
  ctx.save();
  ctx.translate(center, center);
  ctx.rotate(-0.55);
  ctx.fillStyle = streak;
  ctx.fillRect(-radius * 0.62, -radius * 0.96, radius * 1.06, radius * 0.36);
  ctx.restore();

  ctx.beginPath();
  ctx.arc(center, center, radius - 0.7, 0, Math.PI * 2);
  ctx.strokeStyle = ominous ? "rgba(255,231,236,0.28)" : "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1.1;
  ctx.stroke();

  if (pedestrian) {
    ctx.beginPath();
    ctx.arc(center, center, radius * 0.87, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(170, 255, 226, 0.88)";
    ctx.lineWidth = Math.max(1.4, radius * 0.12);
    ctx.stroke();
  }

  if (icon) {
    ctx.fillStyle = ominous ? "rgba(255,248,249,0.97)" : "rgba(255,255,255,0.94)";
    ctx.font = `${Math.round(radius * (ominous ? 0.9 : 0.98))}px Sora`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(icon, center, center + 0.4);
  } else if (pedestrian) {
    if (radius >= 4) {
      drawPedestrianGlyph(
        ctx,
        center + radius * 0.02,
        center + radius * 0.08,
        radius * 0.92,
        "rgba(238,255,249,0.92)"
      );
    } else {
      ctx.beginPath();
      ctx.arc(center, center, Math.max(0.7, radius * 0.18), 0, Math.PI * 2);
      ctx.fillStyle = "rgba(238,255,249,0.92)";
      ctx.fill();
    }
  }

  return canvas;
}

function pickMarkedIndices(total, markedCount, rng) {
  if (markedCount <= 0 || total <= 0) {
    return new Set();
  }

  const ranked = Array.from({ length: total }, (_, index) => ({
    index,
    score: rng(),
  }));
  ranked.sort((left, right) => left.score - right.score);

  return new Set(
    ranked.slice(0, Math.min(total, markedCount)).map((entry) => entry.index)
  );
}

function getTokenRadius(token, baseRadius) {
  return baseRadius * (state.categoryById[token.categoryId].sizeMultiplier || 1);
}

function getRadiusKey(radius) {
  return radius.toFixed(4);
}

function getSpawnColumnIndex(columnCount, token) {
  const rng = mulberry32(hashString(`spawn-${token.id}`));
  const center = Math.floor(columnCount / 2);
  const spread = Math.max(4, Math.round(columnCount * 0.14));
  const bias = token.categoryId === "traffic_deaths" ? 0.08 : 1;
  const offset = Math.round((rng() * 2 - 1) * spread * bias);
  return Math.max(0, Math.min(columnCount - 1, center + offset));
}

function settleOnSurface(surface, startIndex) {
  let index = startIndex;
  const tolerance = 0.001;

  for (;;) {
    const current = surface[index];
    const left = index > 0 ? surface[index - 1] : -Infinity;
    const right = index < surface.length - 1 ? surface[index + 1] : -Infinity;

    if (left > current + tolerance || right > current + tolerance) {
      if (left >= right) {
        index -= 1;
      } else {
        index += 1;
      }
      continue;
    }

    while (index > 0 && Math.abs(surface[index - 1] - surface[index]) <= tolerance) {
      index -= 1;
    }
    return index;
  }
}

function buildPlacements(width, height, tokens, baseRadius, requiredCount = tokens.length) {
  const count = Math.min(tokens.length, requiredCount);
  const paddingX = Math.max(6, width * 0.018);
  const paddingTop = Math.max(8, height * 0.02);
  const paddingBottom = Math.max(8, height * 0.018);
  const floorY = height - paddingBottom;
  const xStep = Math.max(0.5, baseRadius * 0.88);
  const xPositions = [];

  for (let x = paddingX; x <= width - paddingX; x += xStep) {
    xPositions.push(x);
  }
  if (xPositions[xPositions.length - 1] < width - paddingX) {
    xPositions.push(width - paddingX);
  }

  const placements = new Array(count);
  const radii = tokens
    .slice(0, count)
    .map((token) => getTokenRadius(token, baseRadius));
  const uniqueRadii = [...new Set(radii.map((radius) => getRadiusKey(radius)))];
  const surfaces = Object.fromEntries(
    uniqueRadii.map((key) => {
      const radius = Number.parseFloat(key);
      const minX = paddingX + radius;
      const maxX = width - paddingX - radius;
      const surface = new Float32Array(xPositions.length);
      for (let index = 0; index < xPositions.length; index += 1) {
        surface[index] =
          xPositions[index] >= minX && xPositions[index] <= maxX
            ? floorY - radius
            : Number.NEGATIVE_INFINITY;
      }
      return [key, surface];
    })
  );

  let placedCount = 0;
  for (let index = 0; index < count; index += 1) {
    const token = tokens[index];
    const radius = radii[index];
    const radiusKey = getRadiusKey(radius);
    const surface = surfaces[radiusKey];
    const spawnIndex = getSpawnColumnIndex(xPositions.length, token);
    const columnIndex = settleOnSurface(surface, spawnIndex);
    const x = xPositions[columnIndex];
    const y = surface[columnIndex];

    if (!Number.isFinite(y) || y - radius < paddingTop) {
      break;
    }

    placements[index] = { x, y };
    placedCount += 1;

    uniqueRadii.forEach((key) => {
      const targetRadius = Number.parseFloat(key);
      const targetSurface = surfaces[key];
      const sumRadius = radius + targetRadius;
      const colRange = Math.ceil(sumRadius / xStep);
      const start = Math.max(0, columnIndex - colRange);
      const end = Math.min(xPositions.length - 1, columnIndex + colRange);

      for (let col = start; col <= end; col += 1) {
        const dx = Math.abs(xPositions[col] - x);
        if (dx >= sumRadius) continue;
        const ceiling = y - Math.sqrt(sumRadius * sumRadius - dx * dx);
        if (ceiling < targetSurface[col]) {
          targetSurface[col] = ceiling;
        }
      }
    });
  }

  return { placements, placedCount, baseRadius };
}

function fitBaseRadius(width, height, tokens, requiredCount) {
  const minRadius = 0.55;
  const maxRadius = Math.max(minRadius, Math.min(width, height) * 0.07);
  let low = minRadius;
  let high = maxRadius;
  let best = minRadius;

  for (let iteration = 0; iteration < 18; iteration += 1) {
    const mid = (low + high) / 2;
    const { placedCount } = buildPlacements(width, height, tokens, mid, requiredCount);
    if (placedCount >= requiredCount) {
      best = mid;
      low = mid;
    } else {
      high = mid;
    }
  }

  return best;
}

function buildPanel(kind, baseRadius, positions) {
  const canvas = kind === "current" ? refs.currentCanvas : refs.scenarioCanvas;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const sprites = {};
  const categoryVisuals = {};
  state.data.categories.forEach((category) => {
    const radius = baseRadius * (category.sizeMultiplier || 1);
    categoryVisuals[category.id] = { radius };
    sprites[category.id] = {
      default: createBallSprite(radius, category.color, {
        icon: category.icon ? "☠" : "",
        ominous: Boolean(category.ominous),
      }),
      pedestrian: createBallSprite(radius, category.color, {
        icon: category.icon ? "☠" : "",
        ominous: Boolean(category.ominous),
        pedestrian: true,
      }),
    };
  });

  return {
    kind,
    canvas,
    ctx,
    width,
    height,
    positions,
    baseRadius,
    sprites,
    categoryVisuals,
    spawnRng: mulberry32(hashString(`${kind}-${Math.round(state.share * 1000)}`)),
    tokens: [],
    tokenIndex: 0,
    balls: [],
    fullBallCount: 0,
  };
}

function buildTimeline(kind, categories) {
  const scale = state.data.ballScale;
  const windowMs = state.data.windowDays * DAY_MS;
  const futureMs = state.data.futureHorizonDays * DAY_MS;
  const key = kind === "current" ? "baseWindow" : "scenarioWindow";
  const pedestrianKey =
    kind === "current" ? "pedestrianBaseWindow" : "pedestrianScenarioWindow";
  const ballCounts = allocateBallCounts(categories, (category) => category[key], scale);
  const pedestrianBallCounts = allocateBallCounts(
    categories,
    (category) => category[pedestrianKey],
    scale
  );
  const tokens = [];

  categories.forEach((category) => {
    const historicalCount = ballCounts.get(category.id) || 0;
    if (historicalCount <= 0) return;

    const rng = mulberry32(hashString(`${kind}-${category.id}-${Math.round(state.share * 100)}`));
    const pedestrianHistoricalCount = Math.min(
      historicalCount,
      pedestrianBallCounts.get(category.id) || 0
    );
    const pedestrianHistoricalIndices = pickMarkedIndices(
      historicalCount,
      pedestrianHistoricalCount,
      rng
    );

    for (let index = 0; index < historicalCount; index += 1) {
      const time = -windowMs + ((index + rng()) / historicalCount) * windowMs;
      tokens.push({
        id: `${kind}-${category.id}-h-${index}`,
        categoryId: category.id,
        time,
        pedestrian: pedestrianHistoricalIndices.has(index),
      });
    }

    const pedestrianRatio =
      category[key] > 0 ? Math.min(1, category[pedestrianKey] / category[key]) : 0;
    const interval = windowMs / historicalCount;
    const futureCount = Math.ceil(futureMs / interval) + 2;
    let nextTime = rng() * interval;
    for (let index = 0; index < futureCount; index += 1) {
      tokens.push({
        id: `${kind}-${category.id}-f-${index}`,
        categoryId: category.id,
        time: nextTime,
        pedestrian: pedestrianRatio > 0 && rng() < pedestrianRatio,
      });
      nextTime += interval;
    }
  });

  tokens.sort((left, right) => left.time - right.time);
  return {
    tokens,
    fullBallCount: tokens.filter(
      (token) => token.time <= 0 && token.time > -windowMs
    ).length,
  };
}

function rebuildPanels() {
  const summary = computeSummary(state.share);
  const currentTimeline = buildTimeline("current", summary.categories);
  const scenarioTimeline = buildTimeline("scenario", summary.categories);
  const liveBuffer = Math.max(180, Math.round(currentTimeline.fullBallCount * 0.02));
  const currentLimit = Math.min(
    currentTimeline.tokens.length,
    currentTimeline.fullBallCount + liveBuffer
  );
  const scenarioLimit = Math.min(
    scenarioTimeline.tokens.length,
    scenarioTimeline.fullBallCount + liveBuffer
  );
  const baseRadius = fitBaseRadius(
    refs.currentCanvas.clientWidth,
    refs.currentCanvas.clientHeight,
    currentTimeline.tokens,
    currentLimit
  );
  const currentLayout = buildPlacements(
    refs.currentCanvas.clientWidth,
    refs.currentCanvas.clientHeight,
    currentTimeline.tokens,
    baseRadius,
    currentLimit
  );
  const scenarioLayout = buildPlacements(
    refs.scenarioCanvas.clientWidth,
    refs.scenarioCanvas.clientHeight,
    scenarioTimeline.tokens,
    baseRadius,
    scenarioLimit
  );

  state.currentPanel = buildPanel("current", baseRadius, currentLayout.placements);
  state.currentPanel.tokens = currentTimeline.tokens;
  state.currentPanel.fullBallCount = currentTimeline.fullBallCount;

  state.scenarioPanel = buildPanel("scenario", baseRadius, scenarioLayout.placements);
  state.scenarioPanel.tokens = scenarioTimeline.tokens;
  state.scenarioPanel.fullBallCount = scenarioTimeline.fullBallCount;
}

function updateText() {
  const summary = computeSummary(state.share);
  const shareText = formatterPct.format(state.share);

  refs.shareValue.textContent = shareText;
  refs.scenarioCopy.textContent =
    state.share === 0 ? "status quo replay" : "robot-driving replay";
  refs.scenarioTitle.textContent = `If robots drove ${shareText} of the time`;

  refs.metricDeaths.textContent = formatDecimal(summary.windowDeaths);
  refs.metricSeriousInjuries.textContent = formatDecimal(summary.windowSeriousInjuries);
  refs.metricAvoidedDeaths.textContent = formatDecimal(summary.avoidedDeaths);
  refs.metricAvoidedSerious.textContent = formatDecimal(summary.avoidedSerious);
  refs.unknownExcluded.textContent = formatInt(state.data.summary.excludedUnknownSeverityCrashes);
  refs.currentTotal.textContent = formatDecimal(summary.currentTotal);
  refs.scenarioTotal.textContent = formatDecimal(summary.scenarioTotal);
  refs.scenarioNote.textContent =
    `At ${shareText}, robots avert ${formatDecimal(
      summary.avoidedDeaths
    )} deaths, ${formatDecimal(summary.avoidedSerious)} serious injuries, and ${formatDecimal(
      summary.pedestrianCurrentTotal - summary.pedestrianScenarioTotal
    )} pedestrian-involved crashes in ${state.data.windowDays} days.`;
  refs.pedestrianNote.textContent =
    `Pedestrian-marked balls show ${formatDecimal(
      summary.pedestrianCurrentTotal
    )} pedestrian-involved crashes in this ${state.data.windowDays}-day replay and ${formatDecimal(
      summary.pedestrianScenarioTotal
    )} if robots drove ${shareText} of the time.`;
}

function restartSimulation() {
  state.restartAt = performance.now();
  updateText();
  rebuildPanels();
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

function spawnBall(panel, token, now) {
  const slotIndex = panel.balls.length;
  const position = panel.positions[slotIndex];
  if (!position) return;

  const radius = panel.categoryVisuals[token.categoryId].radius;
  panel.balls.push({
    id: token.id,
    categoryId: token.categoryId,
    pedestrian: Boolean(token.pedestrian),
    targetX: position.x,
    targetY: position.y,
    targetIndex: slotIndex,
    startY: -radius * 4 - panel.spawnRng() * 38,
    spawnAt: now,
    dropDuration: 760 + panel.spawnRng() * 260,
  });
}

function syncPanel(panel, simulationNow, now) {
  while (
    panel.tokenIndex < panel.tokens.length &&
    panel.tokens[panel.tokenIndex].time <= simulationNow
  ) {
    spawnBall(panel, panel.tokens[panel.tokenIndex], now);
    panel.tokenIndex += 1;
  }
}

function drawVessel(panel, now) {
  const { ctx, width, height } = panel;

  ctx.clearRect(0, 0, width, height);

  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "#0c1118");
  bg.addColorStop(1, "#05080d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(12, 12, width - 24, height - 24, 22);
  ctx.clip();

  const glow = ctx.createRadialGradient(width / 2, 0, 20, width / 2, 0, width * 0.6);
  glow.addColorStop(0, "rgba(140,180,255,0.18)");
  glow.addColorStop(1, "rgba(140,180,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height * 0.36);

  ctx.fillStyle = "rgba(255,255,255,0.02)";
  ctx.fillRect(14, 14, width - 28, height - 28);

  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(width * 0.22, 18);
  ctx.lineTo(width * 0.78, 18);
  ctx.stroke();

  const drawBalls = panel.balls
    .map((ball) => {
      const elapsed = Math.max(0, now - ball.spawnAt);
      const progress = Math.min(1, elapsed / ball.dropDuration);
      return {
        ...ball,
        y: ball.startY + bounceOut(progress) * (ball.targetY - ball.startY),
      };
    })
    .sort((left, right) => left.targetY - right.targetY);

  drawBalls.forEach((ball) => {
    const sprite = panel.sprites[ball.categoryId][
      ball.pedestrian ? "pedestrian" : "default"
    ];
    ctx.drawImage(
      sprite,
      ball.targetX - sprite.width / 2,
      ball.y - sprite.height / 2
    );
  });

  ctx.restore();

  ctx.strokeStyle = "rgba(255,255,255,0.11)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(12, 12, width - 24, height - 24, 22);
  ctx.stroke();

  ctx.strokeStyle = "rgba(159,189,255,0.12)";
  ctx.beginPath();
  ctx.moveTo(width * 0.16, 32);
  ctx.lineTo(width * 0.16, height - 32);
  ctx.stroke();
}

function updateStatuses(simulationNow) {
  const elapsed = performance.now() - state.restartAt;
  const catchupMs = state.data.catchupSeconds * 1000;
  const replayDays =
    ((simulationNow + state.data.windowDays * DAY_MS) /
      (state.data.windowDays * DAY_MS)) *
    state.data.windowDays;

  if (elapsed <= catchupMs) {
    refs.currentStatus.textContent = `Catch-up replay: ${formatDecimal(
      Math.max(0, Math.min(state.data.windowDays, replayDays))
    )} / ${state.data.windowDays} days`;
    refs.scenarioStatus.textContent = "Move the slider to restart the drop";
  } else {
    refs.currentStatus.textContent = `Live mode: the ${state.data.windowDays}-day window now advances in real time`;
    refs.scenarioStatus.textContent = "Live mode: new balls arrive at the counterfactual rate";
  }

  refs.currentBallCount.textContent = `${formatInt(
    state.currentPanel.balls.length
  )} / ${formatInt(state.currentPanel.fullBallCount)} balls`;
  refs.scenarioBallCount.textContent = `${formatInt(
    state.scenarioPanel.balls.length
  )} / ${formatInt(state.scenarioPanel.fullBallCount)} balls`;
}

function render(now) {
  const simulationNow = getSimulationNow();
  syncPanel(state.currentPanel, simulationNow, now);
  syncPanel(state.scenarioPanel, simulationNow, now);
  drawVessel(state.currentPanel, now);
  drawVessel(state.scenarioPanel, now);
  updateStatuses(simulationNow);
  state.animationFrame = requestAnimationFrame(render);
}

function wireEvents() {
  refs.slider.addEventListener("input", (event) => {
    state.share = Number(event.target.value) / 100;
    restartSimulation();
  });

  window.addEventListener("resize", () => {
    window.clearTimeout(wireEvents.resizeTimer);
    wireEvents.resizeTimer = window.setTimeout(() => {
      restartSimulation();
    }, 140);
  });
}

async function init() {
  state.data = await loadData();
  state.categoryById = Object.fromEntries(
    state.data.categories.map((category) => [category.id, category])
  );
  state.share = state.data.defaultAutomationShare;
  refs.slider.value = String(Math.round(state.share * 100));
  wireEvents();
  restartSimulation();
  state.animationFrame = requestAnimationFrame(render);
}

init().catch((error) => {
  console.error(error);
  refs.scenarioNote.textContent =
    "The simulation data could not be loaded. Serve the site over HTTP and reload.";
});
