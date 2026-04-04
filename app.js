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
  lastFrameAt: performance.now(),
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
    return {
      ...category,
      baseWindow: base,
      scenarioWindow: scenario,
    };
  });

  return {
    windowDeaths: annualDeaths * windowFactor,
    windowSeriousInjuries: annualSeriousInjuries * windowFactor,
    avoidedDeaths,
    avoidedSerious,
    currentTotal: categories.reduce((sum, category) => sum + category.baseWindow, 0),
    scenarioTotal: categories.reduce((sum, category) => sum + category.scenarioWindow, 0),
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

function createBallSprite(radius, color, options = {}) {
  const { icon = "", ominous = false } = options;
  const size = Math.ceil(radius * 2.8);
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

  const outer = ctx.createRadialGradient(
    center - radius * 0.45,
    center - radius * 0.55,
    radius * 0.28,
    center,
    center,
    radius * 1.15
  );
  if (ominous) {
    outer.addColorStop(0, "rgba(255,245,247,0.96)");
    outer.addColorStop(0.12, "#f04f71");
    outer.addColorStop(0.58, color);
    outer.addColorStop(1, "#14070d");
  } else {
    outer.addColorStop(0, "rgba(255,255,255,0.95)");
    outer.addColorStop(0.12, color);
    outer.addColorStop(1, "#09111a");
  }

  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fillStyle = outer;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(center - radius * 0.34, center - radius * 0.44, radius * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.44)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(center, center, radius - 0.7, 0, Math.PI * 2);
  ctx.strokeStyle = ominous ? "rgba(255,231,236,0.35)" : "rgba(255,255,255,0.2)";
  ctx.lineWidth = 1.1;
  ctx.stroke();

  if (icon) {
    ctx.fillStyle = ominous ? "rgba(255,248,249,0.97)" : "rgba(255,255,255,0.94)";
    ctx.font = `${Math.round(radius * (ominous ? 0.9 : 0.98))}px Sora`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(icon, center, center + 0.2);
  }

  return canvas;
}

function buildPanel(kind, summary) {
  const canvas = kind === "current" ? refs.currentCanvas : refs.scenarioCanvas;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const expectedBalls = Math.round(summary.currentTotal / state.data.ballScale);
  const innerWidth = width - 48;
  const innerHeight = height - 44;
  const radius = Math.max(
    11,
    Math.min(18, Math.sqrt((innerWidth * innerHeight) / (Math.max(expectedBalls, 1) * 3.15)))
  );

  const sprites = {};
  const categoryVisuals = {};
  let maxRadius = radius;
  state.data.categories.forEach((category) => {
    const categoryRadius = radius * (category.sizeMultiplier || 1);
    maxRadius = Math.max(maxRadius, categoryRadius);
    categoryVisuals[category.id] = {
      radius: categoryRadius,
    };
    sprites[category.id] = createBallSprite(categoryRadius, category.color, {
      icon: category.icon ? "☠" : "",
      ominous: Boolean(category.ominous),
    });
  });

  return {
    kind,
    canvas,
    ctx,
    width,
    height,
    radius,
    padding: 18,
    floorY: height - 18,
    leftWall: 18,
    rightWall: width - 18,
    maxRadius,
    balls: [],
    activeQueue: [],
    tokenIndex: 0,
    tokens: [],
    fullBallCount: 0,
    sprites,
    categoryVisuals,
    spawnRng: mulberry32(hashString(`${kind}-${Math.round(state.share * 1000)}`)),
  };
}

function buildTimeline(kind, categories) {
  const scale = state.data.ballScale;
  const windowMs = state.data.windowDays * DAY_MS;
  const futureMs = state.data.futureHorizonDays * DAY_MS;
  const key = kind === "current" ? "baseWindow" : "scenarioWindow";
  const ballCounts = allocateBallCounts(categories, (category) => category[key], scale);
  const tokens = [];

  categories.forEach((category) => {
    const historicalCount = ballCounts.get(category.id) || 0;
    if (historicalCount <= 0) return;

    const rng = mulberry32(hashString(`${kind}-${category.id}-${Math.round(state.share * 100)}`));
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
  const summary = computeSummary(state.share);
  state.currentPanel = buildPanel("current", summary);
  state.scenarioPanel = buildPanel("scenario", summary);

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

  refs.metricDeaths.textContent = formatDecimal(summary.windowDeaths);
  refs.metricSeriousInjuries.textContent = formatDecimal(summary.windowSeriousInjuries);
  refs.metricAvoidedDeaths.textContent = formatDecimal(summary.avoidedDeaths);
  refs.metricAvoidedSerious.textContent = formatDecimal(summary.avoidedSerious);
  refs.unknownExcluded.textContent = formatInt(state.data.summary.excludedUnknownSeverityCrashes);
  refs.currentTotal.textContent = formatDecimal(summary.currentTotal);
  refs.scenarioTotal.textContent = formatDecimal(summary.scenarioTotal);
  refs.scenarioNote.textContent =
    `At ${shareText} automated trips, the right vessel removes an estimated ${formatDecimal(
      summary.avoidedDeaths
    )} deaths and ${formatDecimal(
      summary.avoidedSerious
    )} serious injuries over ${state.data.windowDays} days.`;
}

function restartSimulation() {
  state.restartAt = performance.now();
  state.lastFrameAt = state.restartAt;
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

function spawnBall(panel, token) {
  const rng = panel.spawnRng;
  const spread = (panel.rightWall - panel.leftWall) * 0.32;
  const radius = panel.categoryVisuals[token.categoryId].radius;
  const x = (panel.leftWall + panel.rightWall) / 2 + (rng() - 0.5) * spread;
  const y = -radius - rng() * 28;
  panel.balls.push({
    id: token.id,
    tokenTime: token.time,
    categoryId: token.categoryId,
    x: Math.max(panel.leftWall + radius, Math.min(panel.rightWall - radius, x)),
    y,
    vx: (rng() - 0.5) * 80,
    vy: rng() * 30,
    r: radius,
    dead: false,
    sleeping: false,
    restFrames: 0,
    supported: false,
  });
  panel.activeQueue.push(token.id);
}

function pruneExpired(panel, startTime) {
  let pruned = false;
  while (panel.activeQueue.length > 0) {
    const id = panel.activeQueue[0];
    const body = panel.balls.find((ball) => ball.id === id);
    if (!body || body.tokenTime <= startTime) {
      panel.activeQueue.shift();
      if (body) {
        body.dead = true;
        pruned = true;
      }
      continue;
    }
    break;
  }

  if (pruned) {
    panel.balls = panel.balls.filter((ball) => !ball.dead);
  }
}

function syncPanel(panel, simulationNow) {
  const windowStart = simulationNow - state.data.windowDays * DAY_MS;
  while (
    panel.tokenIndex < panel.tokens.length &&
    panel.tokens[panel.tokenIndex].time <= simulationNow
  ) {
    const token = panel.tokens[panel.tokenIndex];
    if (token.time > windowStart) {
      spawnBall(panel, token);
    }
    panel.tokenIndex += 1;
  }
  pruneExpired(panel, windowStart);
}

function resolveWallCollisions(panel, body) {
  const wallBounce = 0.58;
  const floorBounce = 0.48;

  if (body.sleeping) {
    if (body.x - body.r < panel.leftWall) {
      body.x = panel.leftWall + body.r;
    } else if (body.x + body.r > panel.rightWall) {
      body.x = panel.rightWall - body.r;
    }
    if (body.y + body.r > panel.floorY) {
      body.y = panel.floorY - body.r;
    }
    return;
  }

  if (body.x - body.r < panel.leftWall) {
    body.x = panel.leftWall + body.r;
    body.vx = Math.abs(body.vx) * wallBounce;
  } else if (body.x + body.r > panel.rightWall) {
    body.x = panel.rightWall - body.r;
    body.vx = -Math.abs(body.vx) * wallBounce;
  }

  if (body.y + body.r > panel.floorY) {
    body.y = panel.floorY - body.r;
    body.vy = -Math.abs(body.vy) * floorBounce;
    body.vx *= 0.94;
    body.supported = true;
    if (Math.abs(body.vy) < 16) {
      body.vy = 0;
    }
    if (Math.abs(body.vx) < 4) {
      body.vx = 0;
    }
  }
}

function resolveBodyCollisions(panel) {
  const cellSize = panel.maxRadius * 2.5;
  const grid = new Map();

  panel.balls.forEach((body, index) => {
    const cellX = Math.floor(body.x / cellSize);
    const cellY = Math.floor(body.y / cellSize);
    const key = `${cellX},${cellY}`;
    if (!grid.has(key)) {
      grid.set(key, []);
    }
    grid.get(key).push(index);
  });

  const restitution = 0.32;
  const friction = 0.05;

  panel.balls.forEach((body, index) => {
    const cellX = Math.floor(body.x / cellSize);
    const cellY = Math.floor(body.y / cellSize);

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = grid.get(`${cellX + dx},${cellY + dy}`);
        if (!bucket) continue;

        bucket.forEach((otherIndex) => {
          if (otherIndex <= index) return;

          const other = panel.balls[otherIndex];
          if (body.sleeping && other.sleeping) return;
          const diffX = other.x - body.x;
          const diffY = other.y - body.y;
          const minDist = body.r + other.r;
          const distSq = diffX * diffX + diffY * diffY;

          if (distSq === 0 || distSq >= minDist * minDist) return;

          const distance = Math.sqrt(distSq);
          const nx = diffX / distance;
          const ny = diffY / distance;
          const overlap = minDist - distance;
          const bodyShareBase = body.sleeping ? 0.03 : 0.5;
          const otherShareBase = other.sleeping ? 0.03 : 0.5;
          const shareTotal = bodyShareBase + otherShareBase;
          const bodyShare = bodyShareBase / shareTotal;
          const otherShare = otherShareBase / shareTotal;

          body.x -= nx * overlap * bodyShare;
          body.y -= ny * overlap * bodyShare;
          other.x += nx * overlap * otherShare;
          other.y += ny * overlap * otherShare;

          if (ny > 0.32) {
            body.supported = true;
          } else if (ny < -0.32) {
            other.supported = true;
          }

          const relVx = other.vx - body.vx;
          const relVy = other.vy - body.vy;
          const normalVelocity = relVx * nx + relVy * ny;

          if (Math.abs(normalVelocity) > 54) {
            body.sleeping = false;
            other.sleeping = false;
            body.restFrames = 0;
            other.restFrames = 0;
          }

          if (normalVelocity < 0) {
            const collisionRestitution =
              body.sleeping || other.sleeping ? 0.22 : restitution;
            const impulse = (-(1 + collisionRestitution) * normalVelocity) / 2;
            if (!body.sleeping) {
              body.vx -= impulse * nx;
              body.vy -= impulse * ny;
            }
            if (!other.sleeping) {
              other.vx += impulse * nx;
              other.vy += impulse * ny;
            }

            const tx = -ny;
            const ty = nx;
            const tangentVelocity = relVx * tx + relVy * ty;
            const tangentImpulse = tangentVelocity * friction;
            if (!body.sleeping) {
              body.vx += tangentImpulse * tx;
              body.vy += tangentImpulse * ty;
            }
            if (!other.sleeping) {
              other.vx -= tangentImpulse * tx;
              other.vy -= tangentImpulse * ty;
            }
          }

          if (body.sleeping) {
            body.vx = 0;
            body.vy = 0;
          }
          if (other.sleeping) {
            other.vx = 0;
            other.vy = 0;
          }
        });
      }
    }
  });
}

function stepPhysics(panel, dt) {
  const steps = Math.max(1, Math.ceil(dt / 0.008));
  const step = dt / steps;

  for (let iteration = 0; iteration < steps; iteration += 1) {
    panel.balls.forEach((body) => {
      body.supported = body.y + body.r >= panel.floorY - 0.8;
      if (body.sleeping) {
        body.vx = 0;
        body.vy = 0;
        return;
      }
      body.vy += 2400 * step;
      body.x += body.vx * step;
      body.y += body.vy * step;
      body.vx *= Math.pow(0.989, step * 60);
      body.vy *= Math.pow(0.995, step * 60);
      resolveWallCollisions(panel, body);
    });

    resolveBodyCollisions(panel);
    panel.balls.forEach((body) => {
      resolveWallCollisions(panel, body);
      if (body.sleeping) return;
      const nearlyStill = Math.abs(body.vx) < 7 && Math.abs(body.vy) < 9;
      if (body.supported && nearlyStill) {
        body.restFrames += 1;
      } else {
        body.restFrames = 0;
      }
      if (body.restFrames > 18) {
        body.sleeping = true;
        body.vx = 0;
        body.vy = 0;
      }
    });
  }
}

function drawVessel(panel) {
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
  ctx.fillRect(0, 0, width, height * 0.4);

  ctx.fillStyle = "rgba(255,255,255,0.02)";
  ctx.fillRect(14, 14, width - 28, height - 28);

  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(width * 0.22, 18);
  ctx.lineTo(width * 0.78, 18);
  ctx.stroke();

  panel.balls
    .slice()
    .sort((left, right) => left.y - right.y)
    .forEach((body) => {
      const sprite = panel.sprites[body.categoryId];
      ctx.drawImage(
        sprite,
        body.x - sprite.width / 2,
        body.y - sprite.height / 2
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
    refs.currentStatus.textContent = "Live mode: the 30-day window now advances in real time";
    refs.scenarioStatus.textContent = "Live mode: new balls now arrive at the counterfactual rate";
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
  const dt = Math.min(0.03, (now - state.lastFrameAt) / 1000);
  state.lastFrameAt = now;

  syncPanel(state.currentPanel, simulationNow);
  syncPanel(state.scenarioPanel, simulationNow);
  stepPhysics(state.currentPanel, dt);
  stepPhysics(state.scenarioPanel, dt);
  drawVessel(state.currentPanel);
  drawVessel(state.scenarioPanel);
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
