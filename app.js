const formatterInt = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const formatterOneDecimal = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const formatterPercent = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const elements = {
  slider: document.querySelector("#automationShare"),
  shareValue: document.querySelector("#shareValue"),
  shareCaption: document.querySelector("#shareCaption"),
  metricDeaths: document.querySelector("#metricDeaths"),
  metricSeriousInjuries: document.querySelector("#metricSeriousInjuries"),
  metricAvoidedDeaths: document.querySelector("#metricAvoidedDeaths"),
  metricAvoidedDeathsNote: document.querySelector("#metricAvoidedDeathsNote"),
  metricAvoidedCombined: document.querySelector("#metricAvoidedCombined"),
  metricAvoidedCombinedNote: document.querySelector("#metricAvoidedCombinedNote"),
  mapCopy: document.querySelector("#mapCopy"),
  legendBar: document.querySelector("#legendBar"),
  legendMin: document.querySelector("#legendMin"),
  legendMax: document.querySelector("#legendMax"),
  countyName: document.querySelector("#countyName"),
  countyDeaths: document.querySelector("#countyDeaths"),
  countyAvoidable: document.querySelector("#countyAvoidable"),
  countyShare: document.querySelector("#countyShare"),
  leaderboard: document.querySelector("#leaderboard"),
  leaderboardTitle: document.querySelector("#leaderboardTitle"),
  auditTableBody: document.querySelector("#auditTableBody"),
  tooltip: document.querySelector("#mapTooltip"),
  mapSvg: d3.select("#waMap"),
  modeButtons: [...document.querySelectorAll(".mode-button")],
  quickPicks: [...document.querySelectorAll(".quick-pick")],
};

const state = {
  share: 0.05,
  mapMode: "avoidable",
  selectedFips: "53033",
  data: null,
  counties: [],
  featureByFips: new Map(),
  countyPathSelection: null,
};

const actualInterpolator = d3.interpolateRgbBasis([
  "#eef4e9",
  "#7ca36b",
  "#f1b24a",
  "#943316",
]);

const avoidableInterpolator = d3.interpolateRgbBasis([
  "#edf8ec",
  "#8ecf9d",
  "#f6c15e",
  "#c95d2b",
  "#7a1e14",
]);

function computeAvoidableDeaths(deaths) {
  return deaths * state.share * state.data.statewide.safetyEffect;
}

function formatShareLabel(share) {
  return `${Math.round(share * 100)}%`;
}

function updateQuickPickState() {
  const sliderValue = Number(elements.slider.value);
  elements.quickPicks.forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.share) === sliderValue);
  });
}

function updateModeButtonState() {
  elements.modeButtons.forEach((button) => {
    const isActive = button.dataset.mode === state.mapMode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function updateHeadlineMetrics() {
  const statewide = state.data.statewide;
  const avoidedDeaths = statewide.countyAttributedDeaths * state.share * statewide.safetyEffect;
  const avoidedCombined =
    statewide.fatalOrSeriousVictims * state.share * statewide.safetyEffect;

  elements.shareValue.textContent = formatShareLabel(state.share);
  elements.shareCaption.textContent =
    state.share === 0
      ? "human-driving status quo"
      : state.share <= 0.05
        ? "baseline scenario"
        : "counterfactual scenario";

  elements.metricDeaths.textContent = formatterInt.format(statewide.countyAttributedDeaths);
  elements.metricSeriousInjuries.textContent = formatterInt.format(statewide.seriousInjuries);
  elements.metricAvoidedDeaths.textContent = formatterInt.format(avoidableDeaths);
  elements.metricAvoidedDeathsNote.textContent =
    `${formatShareLabel(state.share)} automated miles, ${Math.round(
      statewide.safetyEffect * 100
    )}% safety effect`;
  elements.metricAvoidedCombined.textContent = formatterInt.format(avoidableCombined);
  elements.metricAvoidedCombinedNote.textContent =
    "Deaths plus serious injuries, statewide";

  elements.mapCopy.textContent =
    state.mapMode === "avoidable"
      ? `Map shows the estimated deaths that could be avoided each year if ${formatShareLabel(
          state.share
        )} of Washington vehicle miles were automated and achieved an ${Math.round(
          statewide.safetyEffect * 100
        )}% lower injury-crash rate than the human baseline.`
      : "Map shows the raw county death burden in 2024. Use the slider to see how much of that burden could plausibly disappear under faster automated-driving adoption.";
}

function updateCountyDetail() {
  const county = state.data.counties.find((item) => item.countyFips === state.selectedFips);
  if (!county) return;

  elements.countyName.textContent = `${county.county} County`;
  elements.countyDeaths.textContent = formatterInt.format(county.trafficDeaths2024);
  elements.countyAvoidable.textContent = formatterOneDecimal.format(
    computeAvoidableDeaths(county.trafficDeaths2024)
  );
  elements.countyShare.textContent = formatterPercent.format(county.shareOfStateDeaths);
}

function renderLeaderboard() {
  const sorted = [...state.data.counties].sort((a, b) => {
    const left =
      state.mapMode === "avoidable"
        ? computeAvoidableDeaths(a.trafficDeaths2024)
        : a.trafficDeaths2024;
    const right =
      state.mapMode === "avoidable"
        ? computeAvoidableDeaths(b.trafficDeaths2024)
        : b.trafficDeaths2024;
    return right - left;
  });

  elements.leaderboardTitle.textContent =
    state.mapMode === "avoidable"
      ? "Largest avoidable losses at current slider"
      : "Highest 2024 death totals";

  elements.leaderboard.innerHTML = "";

  sorted.slice(0, 8).forEach((county, index) => {
    const item = document.createElement("li");
    item.className = "leaderboard-item";

    const value =
      state.mapMode === "avoidable"
        ? formatterOneDecimal.format(computeAvoidableDeaths(county.trafficDeaths2024))
        : formatterInt.format(county.trafficDeaths2024);

    const valueLabel =
      state.mapMode === "avoidable" ? "avoidable deaths" : "deaths in 2024";

    item.innerHTML = `
      <span class="leaderboard-rank">${index + 1}</span>
      <div>
        <strong>${county.county}</strong>
        <div class="leaderboard-meta">${formatterPercent.format(
          county.shareOfStateDeaths
        )} of Washington deaths</div>
      </div>
      <div class="leaderboard-value">
        ${value}
        <div class="leaderboard-meta">${valueLabel}</div>
      </div>
    `;

    item.addEventListener("click", () => {
      state.selectedFips = county.countyFips;
      updateCountyDetail();
      updateMapSelection();
    });

    elements.leaderboard.appendChild(item);
  });
}

function renderAuditTable() {
  const sorted = [...state.data.counties].sort((a, b) => b.trafficDeaths2024 - a.trafficDeaths2024);
  elements.auditTableBody.innerHTML = "";

  sorted.forEach((county) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${county.county}</td>
      <td>${formatterInt.format(county.trafficDeaths2024)}</td>
      <td>${formatterOneDecimal.format(computeAvoidableDeaths(county.trafficDeaths2024))}</td>
      <td>${formatterPercent.format(county.shareOfStateDeaths)}</td>
    `;

    row.addEventListener("mouseenter", () => {
      state.selectedFips = county.countyFips;
      updateCountyDetail();
      updateMapSelection();
    });

    elements.auditTableBody.appendChild(row);
  });
}

function getCountyFill(county) {
  if (state.mapMode === "actual") {
    const actualScale = d3.scaleSequential(actualInterpolator).domain([
      0,
      d3.max(state.data.counties, (item) => item.trafficDeaths2024) || 1,
    ]);
    return county.trafficDeaths2024 === 0 ? "#f4f2eb" : actualScale(county.trafficDeaths2024);
  }

  const maxAvoidable =
    d3.max(state.data.counties, (item) => computeAvoidableDeaths(item.trafficDeaths2024)) || 1;
  const avoidableScale = d3.scaleSequential(avoidableInterpolator).domain([0, maxAvoidable]);
  const avoidableDeaths = computeAvoidableDeaths(county.trafficDeaths2024);
  return avoidableDeaths === 0 ? "#f4f2eb" : avoidableScale(avoidableDeaths);
}

function updateLegend() {
  if (state.mapMode === "actual") {
    elements.legendBar.style.background =
      "linear-gradient(90deg, #eef4e9, #7ca36b, #f1b24a, #943316)";
    elements.legendMin.textContent = "0";
    elements.legendMax.textContent = `${formatterInt.format(
      d3.max(state.data.counties, (item) => item.trafficDeaths2024) || 0
    )} deaths`;
    return;
  }

  elements.legendBar.style.background =
    "linear-gradient(90deg, #edf8ec, #8ecf9d, #f6c15e, #c95d2b, #7a1e14)";
  elements.legendMin.textContent = "0";
  elements.legendMax.textContent = `${formatterOneDecimal.format(
    d3.max(state.data.counties, (item) => computeAvoidableDeaths(item.trafficDeaths2024)) || 0
  )} avoidable deaths`;
}

function tooltipMarkup(county) {
  return `
    <strong>${county.county} County</strong>
    <span>${formatterInt.format(county.trafficDeaths2024)} deaths in 2024</span>
    <span>${formatterOneDecimal.format(
      computeAvoidableDeaths(county.trafficDeaths2024)
    )} avoidable at ${formatShareLabel(state.share)} automated miles</span>
    <span>${formatterPercent.format(county.shareOfStateDeaths)} of Washington deaths</span>
  `;
}

function updateMapSelection() {
  if (!state.countyPathSelection) return;
  state.countyPathSelection.classed("is-selected", (feature) => {
    const fips = String(feature.id).padStart(5, "0");
    return fips === state.selectedFips;
  });
}

function updateMapColors() {
  if (!state.countyPathSelection) return;
  state.countyPathSelection.attr("fill", (feature) => {
    const fips = String(feature.id).padStart(5, "0");
    const county = state.data.counties.find((item) => item.countyFips === fips);
    return county ? getCountyFill(county) : "#f4f2eb";
  });
  updateMapSelection();
  updateLegend();
}

function renderMap(topology) {
  const countiesObject = topology.objects.counties;
  const waFeatures = topojson
    .feature(topology, countiesObject)
    .features.filter((feature) => String(feature.id).padStart(5, "0").startsWith("53"));

  waFeatures.forEach((feature) => {
    state.featureByFips.set(String(feature.id).padStart(5, "0"), feature);
  });

  const width = 760;
  const height = 640;
  const projection = d3
    .geoMercator()
    .fitExtent(
      [
        [28, 20],
        [width - 28, height - 20],
      ],
      { type: "FeatureCollection", features: waFeatures }
    );
  const path = d3.geoPath(projection);

  elements.mapSvg.selectAll("*").remove();

  const glow = elements.mapSvg
    .append("defs")
    .append("filter")
    .attr("id", "county-shadow")
    .attr("x", "-20%")
    .attr("y", "-20%")
    .attr("width", "140%")
    .attr("height", "140%");

  glow.append("feDropShadow").attr("dx", 0).attr("dy", 8).attr("stdDeviation", 10).attr(
    "flood-color",
    "rgba(20, 43, 34, 0.15)"
  );

  elements.mapSvg
    .append("rect")
    .attr("width", width)
    .attr("height", height)
    .attr("fill", "transparent");

  state.countyPathSelection = elements.mapSvg
    .append("g")
    .selectAll("path")
    .data(waFeatures)
    .join("path")
    .attr("class", "county-path")
    .attr("d", path)
    .attr("fill", (feature) => {
      const fips = String(feature.id).padStart(5, "0");
      const county = state.data.counties.find((item) => item.countyFips === fips);
      return county ? getCountyFill(county) : "#f4f2eb";
    })
    .attr("filter", "url(#county-shadow)")
    .on("mouseenter", (event, feature) => {
      const fips = String(feature.id).padStart(5, "0");
      const county = state.data.counties.find((item) => item.countyFips === fips);
      if (!county) return;
      elements.tooltip.hidden = false;
      elements.tooltip.innerHTML = tooltipMarkup(county);
      state.selectedFips = county.countyFips;
      updateCountyDetail();
      updateMapSelection();
      const [x, y] = d3.pointer(event, elements.mapSvg.node());
      elements.tooltip.style.left = `${x}px`;
      elements.tooltip.style.top = `${y}px`;
    })
    .on("mousemove", (event, feature) => {
      const [x, y] = d3.pointer(event, elements.mapSvg.node());
      elements.tooltip.style.left = `${x}px`;
      elements.tooltip.style.top = `${y}px`;
      const fips = String(feature.id).padStart(5, "0");
      const county = state.data.counties.find((item) => item.countyFips === fips);
      if (county) {
        elements.tooltip.innerHTML = tooltipMarkup(county);
      }
    })
    .on("mouseleave", () => {
      elements.tooltip.hidden = true;
    })
    .on("click", (_, feature) => {
      const fips = String(feature.id).padStart(5, "0");
      state.selectedFips = fips;
      updateCountyDetail();
      updateMapSelection();
    });

  elements.mapSvg
    .append("path")
    .datum(
      topojson.mesh(topology, countiesObject, (a, b) => {
        const left = String(a.id).padStart(5, "0");
        const right = String(b.id).padStart(5, "0");
        return a !== b && left.startsWith("53") && right.startsWith("53");
      })
    )
    .attr("fill", "none")
    .attr("stroke", "rgba(255,255,255,0.7)")
    .attr("stroke-width", 1)
    .attr("d", path);

  updateMapSelection();
  updateLegend();
}

function refresh() {
  updateQuickPickState();
  updateModeButtonState();
  updateHeadlineMetrics();
  updateCountyDetail();
  renderLeaderboard();
  renderAuditTable();
  updateMapColors();
}

function wireControls() {
  elements.slider.addEventListener("input", (event) => {
    state.share = Number(event.target.value) / 100;
    refresh();
  });

  elements.quickPicks.forEach((button) => {
    button.addEventListener("click", () => {
      elements.slider.value = button.dataset.share;
      state.share = Number(button.dataset.share) / 100;
      refresh();
    });
  });

  elements.modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.mapMode = button.dataset.mode;
      refresh();
    });
  });
}

async function init() {
  const [dataResponse, topoResponse] = await Promise.all([
    fetch("data/wa-traffic-data.json"),
    fetch("data/counties-10m.json"),
  ]);

  if (!dataResponse.ok || !topoResponse.ok) {
    throw new Error("Failed to load required data files.");
  }

  state.data = await dataResponse.json();
  state.counties = state.data.counties;
  state.selectedFips =
    state.counties.find((item) => item.county === "King")?.countyFips || state.counties[0].countyFips;
  renderMap(await topoResponse.json());
  wireControls();
  refresh();
}

init().catch((error) => {
  console.error(error);
  elements.mapCopy.textContent =
    "The page could not load its data files. Check that the site is being served over HTTP rather than opened directly from the filesystem.";
});
