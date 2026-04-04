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
    aura.addColorStop(0.68, "rgba(200,29,61,0.12)");
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
    gradient.addColorStop(0, "rgba(255,245,247,0.72)");
    gradient.addColorStop(0.12, "#db3d5d");
    gradient.addColorStop(0.58, color);
    gradient.addColorStop(1, "#14070d");
  } else {
    gradient.addColorStop(0, "rgba(255,255,255,0.66)");
    gradient.addColorStop(0.12, color);
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
  ctx.arc(center - radius * 0.28, center - radius * 0.34, radius * 0.14, 0, Math.PI * 2);
  ctx.fillStyle = ominous ? "rgba(255,244,246,0.18)" : "rgba(255,255,255,0.16)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(center, center, radius - 0.7, 0, Math.PI * 2);
  ctx.strokeStyle = ominous ? "rgba(255,231,236,0.22)" : "rgba(255,255,255,0.12)";
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
    drawPedestrianGlyph(ctx, center + radius * 0.02, center + radius * 0.08, radius * 0.92, "rgba(238,255,249,0.92)");
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

function buildSlots(width, height, requiredSlots, maxMultiplier) {
  const paddingX = 18;
  const paddingTop = 18;
  const paddingBottom = 18;
  const centerX = width / 2;
  const leftBound = paddingX;
  const rightBound = width - paddingX;
  let fallback = null;

  for (let baseRadius = 24; baseRadius >= 8; baseRadius -= 0.25) {
    const maxRadius = baseRadius * maxMultiplier;
    const stepX = maxRadius * 2.02;
    const stepY = maxRadius * 1.74;
    const slots = [];
    let rowIndex = 0;

    for (let y = height - paddingBottom - maxRadius; y >= paddingTop + maxRadius; y -= stepY) {
      const rowSlots = [];
      if (rowIndex % 2 === 0) {
        for (let step = 0; ; step += 1) {
          let added = false;
          if (step === 0) {
            if (centerX - maxRadius >= leftBound && centerX + maxRadius <= rightBound) {
              rowSlots.push({ x: centerX, y });
              added = true;
            }
          } else {
            const leftX = centerX - step * stepX;
            const rightX = centerX + step * stepX;
            if (leftX - maxRadius >= leftBound) {
              rowSlots.push({ x: leftX, y });
              added = true;
            }
            if (rightX + maxRadius <= rightBound) {
              rowSlots.push({ x: rightX, y });
              added = true;
            }
          }
          if (!added) break;
        }
      } else {
        for (let step = 0; ; step += 1) {
          const offset = (step + 0.5) * stepX;
          const leftX = centerX - offset;
          const rightX = centerX + offset;
          let added = false;
          if (leftX - maxRadius >= leftBound) {
            rowSlots.push({ x: leftX, y });
            added = true;
          }
          if (rightX + maxRadius <= rightBound) {
            rowSlots.push({ x: rightX, y });
            added = true;
          }
          if (!added) break;
        }
      }

      slots.push(...rowSlots);
      rowIndex += 1;
    }

    const plan = { baseRadius, maxRadius, slots };
    if (!fallback) {
      fallback = plan;
    }
    if (slots.length >= requiredSlots) {
      return plan;
    }
  }

  return fallback;
}

function buildPanel(kind, slotPlan) {
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
    const radius = slotPlan.baseRadius * (category.sizeMultiplier || 1);
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
    slots: slotPlan.slots,
    slotPlan,
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
  const currentBallTarget = Math.round(summary.currentTotal / state.data.ballScale);
  const maxMultiplier = Math.max(...state.data.categories.map((category) => category.sizeMultiplier || 1));
  const slotPlan = buildSlots(
    refs.currentCanvas.clientWidth,
    refs.currentCanvas.clientHeight,
    currentBallTarget + 12,
    maxMultiplier
  );

  state.currentPanel = buildPanel("current", slotPlan);
  state.scenarioPanel = buildPanel("scenario", slotPlan);

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
  const slot = panel.slots[slotIndex];
  if (!slot) return;

  const radius = panel.categoryVisuals[token.categoryId].radius;
  panel.balls.push({
    id: token.id,
    categoryId: token.categoryId,
    pedestrian: Boolean(token.pedestrian),
    targetX: slot.x,
    targetY: slot.y,
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
