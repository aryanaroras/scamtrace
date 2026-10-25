// ScamTrace India - the clickable India map.
// Each state is coloured by the measure picked above the map (5 shades of
// blue: darker = higher). Hover shows the value, click opens the state in
// the panel next to the map. Outlines come from india_map.js.

(function () {
  const M = window.INDIA_MAP;
  const LATEST = Math.max(...D.cases_by_year.map(r => r.year));
  const byState = (rows, key) => Object.fromEntries(rows.map(r => [r.state, r[key]]));

  // the measures you can colour the map by
  const MEASURES = [
    { id: "rate", label: `FIR rate ${LATEST}`, unit: "FIRs per lakh people", digits: 2,
      values: byState(D.state_years.filter(r => r.year === LATEST), "cases_per_100k") },
    { id: "complaints", label: "Complaints 2023", unit: "fraud complaints per lakh people", digits: 1,
      values: byState(D.quadrant, "complaints_per_100k") },
    { id: "conversion", label: "FIRs per 100 complaints", unit: "FIRs per 100 complaints (2023, upper bound)", digits: 2,
      values: byState(D.quadrant, "firs_per_100_complaints") },
    { id: "frozen", label: "Money frozen %", unit: "% of money lost that was frozen in time (2023)", digits: 1,
      values: byState(D.money_2023, "pct_amount_saved") },
  ];
  const SHADES = ["#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#0d366b"];   // light -> dark blue

  let measure = MEASURES[0];
  let selected = null;

  const svg = document.getElementById("indiaMap");
  const tip = document.getElementById("mapTip");
  const NS = "http://www.w3.org/2000/svg";

  // five equal-sized groups of states (quintiles), so every shade is used
  function breaks(values) {
    const v = Object.values(values).filter(x => x !== null).sort((a, b) => a - b);
    return [0.2, 0.4, 0.6, 0.8].map(q => v[Math.floor(q * (v.length - 1))]);
  }
  const shadeOf = (value, cuts) => SHADES[cuts.filter(c => value > c).length];

  // ---------- draw the outlines once ---------------------------------------

  svg.setAttribute("viewBox", M.viewBox);
  const paths = {};
  M.states.forEach(s => {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", s.d);
    p.setAttribute("tabindex", "0");
    p.setAttribute("role", "button");
    p.setAttribute("class", "map-state");
    p.addEventListener("mousemove", e => showTip(s.state, e));
    p.addEventListener("mouseleave", () => { tip.hidden = true; });
    p.addEventListener("click", () => window.ScamExplore.show(s.state, { scroll: false }));
    p.addEventListener("keydown", e => { if (e.key === "Enter") window.ScamExplore.show(s.state, { scroll: false }); });
    svg.appendChild(p);
    paths[s.state] = p;
  });

  function showTip(state, event) {
    const v = measure.values[state];
    tip.innerHTML = `<b>${state}</b><br>${v === undefined || v === null ? "no data" : fmt(v, measure.digits)} <span>${measure.unit}</span>`;
    const box = svg.parentElement.getBoundingClientRect();
    tip.style.left = Math.min(event.clientX - box.left + 14, box.width - 190) + "px";
    tip.style.top = (event.clientY - box.top + 14) + "px";
    tip.hidden = false;
  }

  // ---------- colour by the chosen measure -----------------------------------

  function paint() {
    const cuts = breaks(measure.values);
    Object.entries(paths).forEach(([state, p]) => {
      const v = measure.values[state];
      p.style.fill = v === undefined || v === null ? "var(--grid)" : shadeOf(v, cuts);
      p.setAttribute("aria-label", `${state}: ${v === undefined ? "no data" : fmt(v, measure.digits)} ${measure.unit}`);
      p.classList.toggle("is-selected", state === selected);
    });

    // legend: the five shades with their ranges
    const lo = Math.min(...Object.values(measure.values)), hi = Math.max(...Object.values(measure.values));
    const edges = [lo, ...cuts, hi];
    document.getElementById("mapLegend").innerHTML =
      `<span class="legend-title">${measure.unit}</span>` +
      SHADES.map((c, i) => `<span class="legend-step"><i style="background:${c}"></i>${fmt(edges[i], measure.digits)}–${fmt(edges[i + 1], measure.digits)}</span>`).join("");

    // highest five, clickable - the same information as the colours, in words
    const ranked = Object.entries(measure.values).filter(([, v]) => v !== null).sort((a, b) => b[1] - a[1]);
    document.getElementById("mapTop").innerHTML = `<span class="legend-title">Highest</span>` +
      ranked.slice(0, 5).map(([s, v], i) => `<button type="button" data-state="${s}">${i + 1}. ${s} <b>${fmt(v, measure.digits)}</b></button>`).join("");
    document.querySelectorAll("#mapTop [data-state]").forEach(b => {
      b.onclick = () => window.ScamExplore.show(b.dataset.state, { scroll: false });
    });

    // full table (for anyone who can't read colours)
    document.getElementById("mapTable").innerHTML = "<tr><th>#</th><th>State/UT</th><th>" + measure.unit + "</th></tr>" +
      ranked.map(([s, v], i) => `<tr><td>${i + 1}</td><td>${s}</td><td>${fmt(v, measure.digits)}</td></tr>`).join("");
  }

  // ---------- the measure buttons ------------------------------------------------

  const chips = document.getElementById("mapMetrics");
  MEASURES.forEach(m => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = m.label;
    b.onclick = () => {
      measure = m;
      chips.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b));
      paint();
    };
    b.setAttribute("aria-pressed", m === measure);
    chips.appendChild(b);
  });

  // the explorer tells the map which state is open, so it can be outlined
  window.ScamMap = { select(state) { selected = state; paint(); } };
  paint();
})();
