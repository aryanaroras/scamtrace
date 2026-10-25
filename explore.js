// ScamTrace India - "Explore your state" panel.
// Pick a state (and optionally a second one) and see its numbers, its trend,
// and a short plain-English reading of them. Uses the helpers in app.js
// (css, fmt, sum, baseOptions) and the same data.js as everything else.

(function () {
  const LATEST = Math.max(...D.cases_by_year.map(r => r.year));
  const STATES = D.quadrant.map(r => r.state).sort();
  const MED_FIR = D.quadrant[0].median_firs_per_100_complaints;
  const INDIA_FROZEN = sum(D.money_2023, "amount_saved_cr") * 100 / sum(D.money_2023, "amount_reported_cr");
  const INDIA_FIRS = sum(D.quadrant, "firs") * 100 / sum(D.quadrant, "complaints");

  const pick = document.getElementById("exState");
  const compare = document.getElementById("exCompare");
  let trendChart = null;

  // one sentence per quadrant, so the numbers come with a reading
  const MEANING = {
    "High rate, weak enforcement": "Many people report fraud here, but comparatively few complaints become police cases.",
    "High rate, coping": "Many people report fraud here, and police register a relatively high share of complaints as FIRs.",
    "Low rate, weak enforcement": "Fewer complaints per person, and a low share become FIRs. Low numbers here may partly mean under-reporting.",
    "Low rate, coping": "Fewer complaints per person, and a relatively high share become FIRs.",
  };

  const latest = s => D.state_years.find(r => r.state === s && r.year === LATEST);
  const quad = s => D.quadrant.find(r => r.state === s);
  const money = s => D.money_2023.find(r => r.state === s);

  // ---------- the number cards -------------------------------------------

  function cards(a, b) {
    const rows = [
      [`Cyber crime FIRs, ${LATEST}`, s => fmt(latest(s).cyber_cases)],
      [`FIRs per lakh people, ${LATEST}`, s => fmt(latest(s).cases_per_100k, 2) + ` <small>rank ${latest(s).rank_by_rate}/36</small>`],
      ["Fraud complaints per lakh, 2023", s => fmt(quad(s).complaints_per_100k, 1)],
      ["FIRs per 100 complaints, 2023", s => "≤ " + fmt(quad(s).firs_per_100_complaints, 2) + ` <small>India ≤ ${fmt(INDIA_FIRS, 1)}</small>`],
      ["Money frozen in time, 2023", s => fmt(money(s).pct_amount_saved, 1) + `% <small>India ${fmt(INDIA_FROZEN, 1)}%</small>`],
    ];
    document.getElementById("exCards").innerHTML = rows.map(([label, value]) =>
      `<div class="ex-card"><div class="ex-label">${label}</div>` +
      `<div class="ex-value">${value(a)}</div>` +
      (b ? `<div class="ex-vs"><span>${b}</span> ${value(b).replace(/ <small>.*?<\/small>/g, "")}</div>` : "") + "</div>"
    ).join("");
  }

  // ---------- the plain-English summary ------------------------------------

  function story(s) {
    const r = latest(s), q = quad(s), m = money(s);
    const side = q.firs_per_100_complaints > MED_FIR ? "above" : "below";
    document.getElementById("exStory").innerHTML =
      `<p class="card-title">What the numbers say about ${s}</p>` +
      `<p>In ${LATEST}, police registered <b>${fmt(r.cyber_cases)}</b> cyber crime FIRs: ` +
      `${fmt(r.cases_per_100k, 2)} per lakh people, rank ${r.rank_by_rate} of 36 by rate (${r.risk_band.toLowerCase()})` +
      (r.yoy_growth_pct !== null ? `, ${r.yoy_growth_pct > 0 ? "up" : "down"} ${fmt(Math.abs(r.yoy_growth_pct), 1)}% on ${LATEST - 1}.` : ".") + "</p>" +
      `<p>In 2023 victims filed <b>${fmt(q.complaints)}</b> fraud complaints (rank ${q.complaint_rank} per person). ` +
      `At most ${fmt(q.firs_per_100_complaints, 2)} FIRs were registered per 100 complaints, ${side} the median state (${fmt(MED_FIR, 2)}).</p>` +
      `<p><span class="badge">${q.quadrant}</span> ${MEANING[q.quadrant]}</p>` +
      `<p>₹${fmt(m.amount_reported_cr, 2)} crore was reported lost in 2023, and ${fmt(m.pct_amount_saved, 1)}% of it was frozen in time.</p>`;
  }

  // ---------- the trend chart -------------------------------------------------

  function trend(a, b) {
    if (trendChart) {
      trendChart.destroy();
      if (charts.includes(trendChart)) charts.splice(charts.indexOf(trendChart), 1);
    }
    const years = D.cases_by_year.map(r => r.year);
    const series = (s, colour) => ({
      label: s,
      data: years.map(y => (D.state_years.find(r => r.state === s && r.year === y) || {}).cases_per_100k ?? null),
      borderColor: colour, backgroundColor: colour, borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: 0.2,
    });
    const options = baseOptions();
    options.plugins.legend = { display: !!b, labels: { color: css("--text-2"), usePointStyle: true } };
    options.scales.x.grid.display = false;
    options.scales.y.beginAtZero = true;
    options.scales.y.title = { display: true, text: "FIRs per lakh people", color: css("--text-2") };
    options.plugins.tooltip.callbacks = { label: i => `${i.dataset.label}: ${fmt(i.raw, 2)} per lakh` };
    trendChart = new Chart(document.getElementById("exTrend"), {
      type: "line",
      data: { labels: years, datasets: [series(a, css("--series-1"))].concat(b ? [series(b, css("--series-2"))] : []) },
      options,
    });
    charts.push(trendChart);
  }

  function render() {
    const a = pick.value, b = compare.value && compare.value !== a ? compare.value : "";
    cards(a, b);
    story(a);
    trend(a, b);
    document.getElementById("exAsk").textContent = `Ask the assistant about ${a}`;
    document.getElementById("exTitle").textContent = a;
    if (window.ScamMap) window.ScamMap.select(a);       // outline it on the map
  }

  // ---------- set up -------------------------------------------------------------

  STATES.forEach(s => {
    pick.add(new Option(s, s));
    compare.add(new Option(s, s));
  });
  pick.value = "Delhi";
  pick.onchange = compare.onchange = render;
  document.getElementById("exAsk").onclick = () => window.ScamChat && window.ScamChat.open("tell me about " + pick.value);
  document.getElementById("frozenPct").textContent = fmt(INDIA_FROZEN, 1) + "%";

  // other parts of the page (the map, the quadrant chart, the assistant) open a state here
  window.ScamExplore = {
    show(state, options = {}) {
      pick.value = state;
      render();
      if (options.scroll !== false) document.getElementById("explore").scrollIntoView();
    },
  };

  // the map is drawn after this file, so the first outline happens on load
  window.addEventListener("load", render);
  render();
  // the trend chart is destroyed when app.js redraws for a new colour theme, so redraw it too
  window.addEventListener("themechange", () => { trendChart = null; render(); });
})();
