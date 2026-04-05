const DAY_MS = 24 * 60 * 60 * 1000;

const formatterInt = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const formatterPct = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const AUTO_WINDOW_MIN_RADIUS_DESKTOP = 1.45;
const AUTO_WINDOW_MIN_RADIUS_MOBILE = 0.92;
const AUTO_WINDOW_AREA_UTILIZATION = 0.44;
const AUTO_WINDOW_OPTIONS_DAYS = [
  1 / 24,
  3 / 24,
  6 / 24,
  12 / 24,
  1,
  2,
  7,
  14,
  30,
  60,
];

const refs = {
  headline: document.querySelector("#headline"),
  vesselSubhead: document.querySelector("#vesselSubhead"),
  slider: document.querySelector("#automationShare"),
  shareValue: document.querySelector("#shareValue"),
  scenarioCopy: document.querySelector("#scenarioCopy"),
  scenarioNote: document.querySelector("#scenarioNote"),
  scenarioTitle: document.querySelector("#scenarioTitle"),
  metricDeathsLabel: document.querySelector("#metricDeathsLabel"),
  metricSeriousLabel: document.querySelector("#metricSeriousLabel"),
  metricAvoidedCrashesLabel: document.querySelector("#metricAvoidedCrashesLabel"),
  metricAvoidedDeathsLabel: document.querySelector("#metricAvoidedDeathsLabel"),
  metricDeathsContext: document.querySelector("#metricDeathsContext"),
  metricSeriousContext: document.querySelector("#metricSeriousContext"),
  metricAvoidedCrashesContext: document.querySelector("#metricAvoidedCrashesContext"),
  metricAvoidedDeathsContext: document.querySelector("#metricAvoidedDeathsContext"),
  metricDeaths: document.querySelector("#metricDeaths"),
  metricSeriousInjuries: document.querySelector("#metricSeriousInjuries"),
  metricAvoidedCrashes: document.querySelector("#metricAvoidedCrashes"),
  metricAvoidedDeaths: document.querySelector("#metricAvoidedDeaths"),
  currentTotal: document.querySelector("#currentTotal"),
  scenarioTotal: document.querySelector("#scenarioTotal"),
  currentStatus: document.querySelector("#currentStatus"),
  scenarioStatus: document.querySelector("#scenarioStatus"),
  currentBallCount: document.querySelector("#currentBallCount"),
  scenarioBallCount: document.querySelector("#scenarioBallCount"),
  currentCanvas: document.querySelector("#currentCanvas"),
  scenarioCanvas: document.querySelector("#scenarioCanvas"),
  geographySelect: document.querySelector("#geographySelect"),
};

const state = {
  data: null,
  categoryById: null,
  geographyCode: "us",
  windowDays: 7,
  share: 0.5,
  summary: null,
  restartAt: performance.now(),
  statusMode: null,
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

function formatWindowLabel(days) {
  if (days < 1) {
    const hours = Math.round(days * 24);
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${days} ${days === 1 ? "day" : "days"}`;
}

function formatWindowPhrase(days) {
  if (days < 1) {
    const hours = Math.round(days * 24);
    return hours === 1 ? "the last hour" : `the last ${hours} hours`;
  }
  return days === 1 ? "the last day" : `the last ${days} days`;
}

function getWindowProgressParts(days, replayDays) {
  if (days < 1) {
    const totalHours = Math.round(days * 24);
    const replayHours = Math.max(
      0,
      Math.min(totalHours, Math.round(replayDays * 24))
    );
    return `${replayHours} / ${totalHours} ${totalHours === 1 ? "hour" : "hours"}`;
  }

  return `${Math.max(0, Math.min(days, Math.round(replayDays)))} / ${formatWindowLabel(days)}`;
}

function formatWindowTitle(days) {
  if (days < 1) {
    const hours = Math.round(days * 24);
    return hours === 1 ? "The Last Hour" : `The Last ${hours} Hours`;
  }

  return days === 1 ? "The Last Day" : `The Last ${days} Days`;
}

function prettyName(name) {
  if (name === "District Of Columbia") {
    return "District of Columbia";
  }
  return name;
}

function syncEqualSectionHeights(elements) {
  elements.forEach((element) => {
    element.style.minHeight = "";
  });

  const maxHeight = Math.max(
    0,
    ...elements.map((element) => Math.ceil(element.getBoundingClientRect().height))
  );

  elements.forEach((element) => {
    element.style.minHeight = `${maxHeight}px`;
  });
}

function syncPanelChromeHeights() {
  syncEqualSectionHeights([...document.querySelectorAll(".panel-header")]);
  syncEqualSectionHeights([...document.querySelectorAll(".panel-footer")]);
}

function loadData() {
  return fetch("data/us-state-ball-simulation.json").then((response) => {
    if (!response.ok) {
      throw new Error("Could not load simulation data.");
    }
    return response.json();
  });
}

function getGeography() {
  return state.data.geographies[state.geographyCode];
}

function computeSummaryForWindow(windowDays) {
  const geography = getGeography();
  const windowFactor = windowDays / state.data.daysInBaselineYear;

  const categories = state.data.categories.map((category) => {
    const annualCount = geography.annualCounts[category.id] || 0;
    const baseWindow = annualCount * windowFactor;
    const scenarioWindow = baseWindow * (1 - state.share * category.reduction);
    return {
      ...category,
      annualCount,
      baseWindow,
      scenarioWindow,
    };
  });

  const currentTotal = categories.reduce((sum, category) => sum + category.baseWindow, 0);
  const scenarioTotal = categories.reduce(
    (sum, category) => sum + category.scenarioWindow,
    0
  );
  return {
    geography,
    windowDays,
    categories,
    currentTotal,
    scenarioTotal,
    avoidedCrashes: currentTotal - scenarioTotal,
    windowDeaths: geography.annualTrafficDeaths * windowFactor,
    windowSeriousInjuries: geography.annualSeriousInjuries * windowFactor,
    avoidedDeaths:
      geography.annualTrafficDeaths *
      windowFactor *
      state.share *
      state.data.summary.injuryAndDeathReduction,
    avoidedSerious:
      geography.annualSeriousInjuries *
      windowFactor *
      state.share *
      state.data.summary.injuryAndDeathReduction,
  };
}

function getAutoWindowMinRadius() {
  return window.innerWidth <= 720
    ? AUTO_WINDOW_MIN_RADIUS_MOBILE
    : AUTO_WINDOW_MIN_RADIUS_DESKTOP;
}

function estimateReadableBaseRadius(summary, width, height) {
  const usableWidth = Math.max(1, width - 24);
  const usableHeight = Math.max(1, height - 24);
  const usableArea = usableWidth * usableHeight * AUTO_WINDOW_AREA_UTILIZATION;
  const weightedCrashUnits = summary.categories.reduce((sum, category) => {
    const multiplier = category.sizeMultiplier || 1;
    return sum + category.baseWindow * multiplier * multiplier;
  }, 0);

  if (weightedCrashUnits <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.sqrt(usableArea / (Math.PI * weightedCrashUnits));
}

function pickAutoWindowDays() {
  const sharedWidth = Math.min(
    refs.currentCanvas.clientWidth || 640,
    refs.scenarioCanvas.clientWidth || 640
  );
  const sharedHeight = Math.min(
    refs.currentCanvas.clientHeight || 560,
    refs.scenarioCanvas.clientHeight || 560
  );
  const threshold = getAutoWindowMinRadius();
  const options = [...AUTO_WINDOW_OPTIONS_DAYS].sort((left, right) => right - left);

  for (const days of options) {
    const summary = computeSummaryForWindow(days);
    if (
      summary.currentTotal <= state.data.maxDisplayBalls &&
      estimateReadableBaseRadius(summary, sharedWidth, sharedHeight) >= threshold
    ) {
      return days;
    }
  }

  return Math.min(...AUTO_WINDOW_OPTIONS_DAYS);
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

function drawDeathGlyph(ctx, x, y, size) {
  const boneStroke = Math.max(2, size * 0.12);
  const boneOffset = size * 0.28;
  const boneNub = size * 0.06;
  const skullCenterY = y - size * 0.04;
  const skullWidth = size * 0.5;
  const skullHeight = size * 0.4;
  const jawWidth = skullWidth * 0.6;
  const jawHeight = skullHeight * 0.26;

  ctx.save();
  ctx.strokeStyle = "rgba(255,248,249,0.98)";
  ctx.fillStyle = "rgba(255,248,249,0.98)";
  ctx.lineWidth = boneStroke;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
    ctx.beginPath();
    ctx.arc(x + sx * boneOffset, y + sy * boneOffset, boneNub, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.beginPath();
  ctx.moveTo(x - boneOffset, y - boneOffset);
  ctx.lineTo(x + boneOffset, y + boneOffset);
  ctx.moveTo(x + boneOffset, y - boneOffset);
  ctx.lineTo(x - boneOffset, y + boneOffset);
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(x, skullCenterY, skullWidth / 2, skullHeight / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.roundRect(
    x - jawWidth / 2,
    skullCenterY + skullHeight * 0.12,
    jawWidth,
    jawHeight,
    jawHeight * 0.24
  );
  ctx.fill();

  ctx.fillStyle = "rgba(82, 8, 20, 0.96)";
  ctx.beginPath();
  ctx.arc(
    x - skullWidth * 0.17,
    skullCenterY - skullHeight * 0.06,
    size * 0.064,
    0,
    Math.PI * 2
  );
  ctx.arc(
    x + skullWidth * 0.17,
    skullCenterY - skullHeight * 0.06,
    size * 0.064,
    0,
    Math.PI * 2
  );
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(x, skullCenterY + skullHeight * 0.02);
  ctx.lineTo(x - size * 0.05, skullCenterY + skullHeight * 0.16);
  ctx.lineTo(x + size * 0.05, skullCenterY + skullHeight * 0.16);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function createBallSprite(radius, color, options = {}) {
  const { ominous = false } = options;
  const size = Math.ceil(radius * 2.85);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const center = size / 2;

  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(center, center, radius - 0.7, 0, Math.PI * 2);
  ctx.strokeStyle = ominous ? "rgba(255,231,236,0.22)" : "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1.1;
  ctx.stroke();

  if (ominous) {
    drawDeathGlyph(ctx, center, center + radius * 0.08, radius * 0.92);
  }

  return canvas;
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
  const bias = token.categoryId === "fatal_crash" ? 0.08 : 1;
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
      index += left >= right ? -1 : 1;
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
  const radii = tokens.slice(0, count).map((token) => getTokenRadius(token, baseRadius));
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
  const settledCanvas = document.createElement("canvas");
  settledCanvas.width = canvas.width;
  settledCanvas.height = canvas.height;
  const settledCtx = settledCanvas.getContext("2d");
  settledCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const sprites = {};
  const categoryVisuals = {};
  state.data.categories.forEach((category) => {
    const radius = baseRadius * (category.sizeMultiplier || 1);
    categoryVisuals[category.id] = { radius };
    sprites[category.id] = createBallSprite(radius, category.color, {
      ominous: Boolean(category.ominous),
    });
  });

  return {
    kind,
    canvas,
    ctx,
    width,
    height,
    positions,
    baseRadius,
    settledCanvas,
    settledCtx,
    sprites,
    categoryVisuals,
    spawnRng: mulberry32(
      hashString(
        `${kind}-${state.geographyCode}-${state.windowDays}-${Math.round(state.share * 1000)}`
      )
    ),
    tokens: [],
    tokenIndex: 0,
    balls: [],
    activeIndices: [],
    fullBallCount: 0,
  };
}

function buildTimeline(kind, categories, scale) {
  const windowMs = state.windowDays * DAY_MS;
  const futureMs = state.data.futureHorizonDays * DAY_MS;
  const key = kind === "current" ? "baseWindow" : "scenarioWindow";
  const ballCounts = allocateBallCounts(categories, (category) => category[key], scale);
  const tokens = [];

  categories.forEach((category) => {
    const historicalCount = ballCounts.get(category.id) || 0;
    if (historicalCount <= 0) return;

    const rng = mulberry32(
      hashString(
        `${kind}-${state.geographyCode}-${state.windowDays}-${category.id}-${Math.round(
          state.share * 100
        )}`
      )
    );

    for (let index = 0; index < historicalCount; index += 1) {
      const time = -windowMs + ((index + rng()) / historicalCount) * windowMs;
      tokens.push({
        id: `${kind}-${category.id}-h-${index}`,
        categoryId: category.id,
        time,
      });
    }

    const interval = windowMs / historicalCount;
    const futureCount = Math.ceil(futureMs / interval) + 2;
    let nextTime = rng() * interval;
    for (let index = 0; index < futureCount; index += 1) {
      tokens.push({
        id: `${kind}-${category.id}-f-${index}`,
        categoryId: category.id,
        time: nextTime,
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
  const currentTimeline = buildTimeline(
    "current",
    state.summary.categories,
    1
  );
  const scenarioTimeline = buildTimeline(
    "scenario",
    state.summary.categories,
    1
  );
  const liveBuffer = Math.max(60, Math.round(currentTimeline.fullBallCount * 0.02));
  const currentLimit = Math.min(
    currentTimeline.tokens.length,
    currentTimeline.fullBallCount + liveBuffer
  );
  const scenarioLimit = Math.min(
    scenarioTimeline.tokens.length,
    scenarioTimeline.fullBallCount + liveBuffer
  );
  const sharedWidth = Math.min(
    refs.currentCanvas.clientWidth,
    refs.scenarioCanvas.clientWidth
  );
  const sharedHeight = Math.min(
    refs.currentCanvas.clientHeight,
    refs.scenarioCanvas.clientHeight
  );
  const baseRadius = fitBaseRadius(
    sharedWidth,
    sharedHeight,
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

function drawBallToContext(ctx, panel, ball, x, y) {
  const sprite = panel.sprites[ball.categoryId];
  ctx.drawImage(sprite, x - sprite.width / 2, y - sprite.height / 2);
}

function spawnBall(panel, token, now) {
  const slotIndex = panel.balls.length;
  const position = panel.positions[slotIndex];
  if (!position) return;

  const radius = panel.categoryVisuals[token.categoryId].radius;
  panel.balls.push({
    id: token.id,
    categoryId: token.categoryId,
    targetX: position.x,
    targetY: position.y,
    startY: -radius * 4 - panel.spawnRng() * 38,
    spawnAt: now,
    dropDuration: 760 + panel.spawnRng() * 260,
    settled: false,
  });
  panel.activeIndices.push(slotIndex);
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

  ctx.drawImage(panel.settledCanvas, 0, 0, width, height);

  const activeBalls = [];
  const nextActiveIndices = [];

  panel.activeIndices.forEach((ballIndex) => {
    const ball = panel.balls[ballIndex];
    const elapsed = Math.max(0, now - ball.spawnAt);
    const progress = Math.min(1, elapsed / ball.dropDuration);
    const y = ball.startY + bounceOut(progress) * (ball.targetY - ball.startY);

    if (progress >= 1) {
      if (!ball.settled) {
        drawBallToContext(panel.settledCtx, panel, ball, ball.targetX, ball.targetY);
        ball.settled = true;
      }
      return;
    }

    activeBalls.push({
      ...ball,
      y,
    });
    nextActiveIndices.push(ballIndex);
  });

  panel.activeIndices = nextActiveIndices;

  activeBalls
    .sort((left, right) => left.targetY - right.targetY)
    .forEach((ball) => {
      drawBallToContext(ctx, panel, ball, ball.targetX, ball.y);
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

function updateText() {
  const geography = state.summary.geography;
  const geographyName = prettyName(geography.name);
  const roadLabel = state.geographyCode === "us" ? "U.S." : geographyName;
  const windowLabel = formatWindowLabel(state.windowDays);
  const windowPhrase = formatWindowPhrase(state.windowDays);
  const shareText = formatterPct.format(state.share);

  refs.headline.textContent = `Death and Destruction on ${roadLabel} Roads: Humans vs. Robots`;
  refs.vesselSubhead.textContent = `Crashes over ${windowPhrase}`;
  refs.shareValue.textContent = shareText;
  refs.scenarioCopy.textContent = `${windowLabel} counterfactual`;
  refs.scenarioTitle.textContent = `If robots drove ${shareText} of the time`;
  refs.metricDeathsLabel.textContent = "Traffic Deaths";
  refs.metricSeriousLabel.textContent = "Serious Injuries";
  refs.metricAvoidedCrashesLabel.textContent = "Avoided Crashes";
  refs.metricAvoidedDeathsLabel.textContent = "Avoided Deaths";
  refs.metricDeathsContext.textContent = `Estimated in ${windowPhrase}`;
  refs.metricSeriousContext.textContent = `Estimated in ${windowPhrase}`;
  refs.metricAvoidedCrashesContext.textContent = `At ${shareText} robot share`;
  refs.metricAvoidedDeathsContext.textContent = `At ${shareText} robot share`;
  refs.metricDeaths.textContent = formatInt(state.summary.windowDeaths);
  refs.metricSeriousInjuries.textContent = formatInt(state.summary.windowSeriousInjuries);
  refs.metricAvoidedCrashes.textContent = formatInt(state.summary.avoidedCrashes);
  refs.metricAvoidedDeaths.textContent = formatInt(state.summary.avoidedDeaths);
  refs.currentTotal.textContent = formatInt(state.summary.currentTotal);
  refs.scenarioTotal.textContent = formatInt(state.summary.scenarioTotal);
  refs.scenarioNote.textContent =
    `At ${shareText}, automated driving averts ${formatInt(
      state.summary.avoidedCrashes
    )} crashes, ${formatInt(state.summary.avoidedDeaths)} deaths, and ${formatInt(
      state.summary.avoidedSerious
    )} serious injuries in ${windowPhrase}.`;

  document.title =
    `${formatWindowTitle(state.windowDays)} on ${roadLabel} Roads`;
  const metaDescription = document.querySelector('meta[name="description"]');
  if (metaDescription) {
    metaDescription.setAttribute(
      "content",
      `A dark animated automated-driving counterfactual for ${geographyName} over ${windowPhrase}.`
    );
  }
}

function restartSimulation() {
  state.restartAt = performance.now();
  state.statusMode = null;
  state.windowDays = pickAutoWindowDays();
  state.summary = computeSummaryForWindow(state.windowDays);
  updateText();
  syncPanelChromeHeights();
  rebuildPanels();
}

function getSimulationNow() {
  const elapsed = performance.now() - state.restartAt;
  const catchupMs = state.data.catchupSeconds * 1000;
  const windowMs = state.windowDays * DAY_MS;

  if (elapsed <= catchupMs) {
    return -windowMs + (elapsed / catchupMs) * windowMs;
  }

  return elapsed - catchupMs;
}

function updateStatuses(simulationNow) {
  const elapsed = performance.now() - state.restartAt;
  const catchupMs = state.data.catchupSeconds * 1000;
  const replayDays =
    ((simulationNow + state.windowDays * DAY_MS) / (state.windowDays * DAY_MS)) *
    state.windowDays;
  const windowLabel = formatWindowLabel(state.windowDays);

  const nextStatusMode = elapsed <= catchupMs ? "catchup" : "live";
  const modeChanged = nextStatusMode !== state.statusMode;
  state.statusMode = nextStatusMode;

  if (nextStatusMode === "catchup") {
    refs.currentStatus.textContent = `Catch-up replay: ${getWindowProgressParts(
      state.windowDays,
      replayDays
    )}`;
    refs.scenarioStatus.textContent = "Move any control to restart the drop";
  } else {
    refs.currentStatus.textContent = `Live mode: the ${windowLabel} window now advances in real time`;
    refs.scenarioStatus.textContent = "Live mode: new balls arrive at the counterfactual rate";
  }

  if (modeChanged) {
    syncPanelChromeHeights();
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

function updateUrl() {
  const url = new URL(window.location.href);
  if (state.geographyCode === state.data.defaultGeography) {
    url.searchParams.delete("geo");
  } else {
    url.searchParams.set("geo", state.geographyCode);
  }
  url.searchParams.delete("days");
  history.replaceState({}, "", url);
}

function populateControls() {
  refs.geographySelect.innerHTML = "";
  state.data.geographyOrder.forEach((code) => {
    const geography = state.data.geographies[code];
    const option = document.createElement("option");
    option.value = code;
    option.textContent = prettyName(geography.name);
    refs.geographySelect.append(option);
  });
}

function applyUrlState() {
  const url = new URL(window.location.href);
  const requestedGeo =
    (url.searchParams.get("geo") ||
      url.searchParams.get("geography") ||
      url.searchParams.get("state") ||
      state.data.defaultGeography).toLowerCase();

  state.geographyCode = state.data.geographies[requestedGeo]
    ? requestedGeo
    : state.data.defaultGeography;

  refs.geographySelect.value = state.geographyCode;
}

function wireEvents() {
  refs.slider.addEventListener("input", (event) => {
    state.share = Number(event.target.value) / 100;
    restartSimulation();
  });

  refs.geographySelect.addEventListener("change", (event) => {
    state.geographyCode = event.target.value;
    updateUrl();
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
  populateControls();
  applyUrlState();
  wireEvents();
  restartSimulation();
  updateUrl();
  state.animationFrame = requestAnimationFrame(render);
}

init().catch((error) => {
  console.error(error);
  refs.scenarioNote.textContent =
    "The simulation data could not be loaded. Serve the site over HTTP and reload.";
});
