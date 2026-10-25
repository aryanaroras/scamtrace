// ScamTrace Assistant - the chat bubble on the website.
//
// Rule-based: no AI model, no API, no internet. It works like this:
//   1. find state names and a year in what the person typed
//   2. count keyword hits for each topic it knows; the best topic wins
//   3. build the answer from data.js (the same data the charts use)
//   4. if nothing matches, say so and suggest questions - it never guesses
//
// It answers about this site's data, explains the terms used on the page,
// and tells a victim where to report. It does not chat about anything else.

(function () {
  const D = window.SCAMTRACE;
  const LATEST = Math.max(...D.cases_by_year.map(r => r.year));   // newest NCRB year
  const DATA_YEAR = D.quadrant[0] ? 2023 : null;                   // complaints + money year

  // ---------- small helpers ---------------------------------------------

  const fmt = (n, d = 0) => n === null || n === undefined ? "–"
    : Number(n).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const sum = (rows, k) => rows.reduce((t, r) => t + (r[k] || 0), 0);
  const signed = n => (n > 0 ? "+" : "") + fmt(n, 1) + "%";

  function table(headers, rows) {
    return "<table><tr>" + headers.map(h => `<th>${h}</th>`).join("") + "</tr>" +
      rows.map(r => "<tr>" + r.map(c => `<td>${c}</td>`).join("") + "</tr>").join("") + "</table>";
  }
  const note = text => `<p class="chat-note">${text}</p>`;

  // ---------- 1. states and years in the question ------------------------

  const STATES = D.quadrant.map(r => r.state);
  const ALIASES = {                      // other names people type
    "bengal": "West Bengal", "kashmir": "Jammu and Kashmir", "j&k": "Jammu and Kashmir",
    "andaman": "Andaman and Nicobar Islands", "orissa": "Odisha", "pondicherry": "Puducherry",
    "new delhi": "Delhi", "dadra": "Dadra and Nagar Haveli and Daman and Diu",
    "daman": "Dadra and Nagar Haveli and Daman and Diu", "telengana": "Telangana",
  };
  // the data is by state, so a city is answered with its state (and the answer says so)
  const CITIES = {
    "bangalore": "Karnataka", "bengaluru": "Karnataka", "mumbai": "Maharashtra", "pune": "Maharashtra",
    "hyderabad": "Telangana", "chennai": "Tamil Nadu", "kolkata": "West Bengal",
    "lucknow": "Uttar Pradesh", "jaipur": "Rajasthan", "ahmedabad": "Gujarat", "patna": "Bihar",
    "noida": "Uttar Pradesh", "gurgaon": "Haryana", "gurugram": "Haryana", "kochi": "Kerala",
  };
  let cityAsked = null;                  // set by findStates when a city name was typed
  // two-letter codes only count in CAPITALS, or "gone up" would mean Uttar Pradesh
  const CODES = { UP: "Uttar Pradesh", MP: "Madhya Pradesh", TN: "Tamil Nadu", AP: "Andhra Pradesh",
                  WB: "West Bengal", HP: "Himachal Pradesh", JK: "Jammu and Kashmir" };

  // how many single-letter edits turn word a into word b (for typos like "karnatka")
  function editDistance(a, b) {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0]; row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const cur = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
      }
    }
    return row[b.length];
  }

  function findStates(question) {
    let q = " " + question.toLowerCase().replace(/[^a-z& ]/g, " ").replace(/\s+/g, " ") + " ";
    const names = {};
    STATES.forEach(s => { names[s.toLowerCase()] = s; });
    Object.assign(names, ALIASES, CITIES);
    cityAsked = null;
    const found = [];
    const add = (pos, state) => { if (!found.some(f => f.state === state)) found.push({ pos, state }); };

    // exact names, longest first so "west bengal" wins over "bengal"
    Object.keys(names).sort((a, b) => b.length - a.length).forEach(name => {
      const pos = q.indexOf(" " + name + " ");
      if (pos >= 0) {
        add(pos, names[name]);
        if (CITIES[name]) cityAsked = name;
        q = q.replace(" " + name + " ", " " + "_".repeat(name.length) + " ");
      }
    });
    // codes in capitals
    Object.keys(CODES).forEach(code => {
      const m = question.match(new RegExp("(^|[^A-Za-z])" + code + "(?![A-Za-z])"));
      if (m) add(m.index, CODES[code]);
    });
    // typos in one-word state names: 1 wrong letter, or 2 in a long name
    const oneWord = STATES.filter(s => !s.includes(" "));
    q.trim().split(" ").forEach((word, i) => {
      if (word.length < 5 || word.includes("_")) return;
      oneWord.forEach(s => {
        const d = editDistance(word, s.toLowerCase());
        if (d > 0 && d <= (s.length >= 9 ? 2 : 1)) add(1000 + i, s);
      });
    });
    return found.sort((a, b) => a.pos - b.pos).map(f => f.state);
  }

  const findYear = q => { const m = q.match(/\b(20\d\d)\b/); return m ? Number(m[1]) : null; };

  // use the asked-for year if the data has it, otherwise say what is covered
  function pickYear(year, first, last, fallback) {
    if (year === null) return { year: fallback, warn: "" };
    if (year >= first && year <= last) return { year, warn: "" };
    return { year: fallback, warn: note(`There is no official data for ${year}; this covers ${first}–${last}. Showing ${fallback}.`) };
  }

  // ---------- 2. explaining the terms used on the page -------------------

  const GLOSSARY = [
    [["fir", "firs", "first information report"], "FIR",
      "A <b>First Information Report</b>: the document police write when they formally register a criminal case. NCRB's figures count FIRs. A complaint that is not turned into an FIR never appears in NCRB's numbers."],
    [["charge sheet", "chargesheet", "charge sheeted", "chargesheeted"], "Charge sheet",
      "The report police file in court after investigating, saying there is enough evidence to put someone on trial. 'Charge sheeted' counts cases that reached this stage."],
    [["conviction rate"], "Conviction rate",
      "Convicted cases ÷ trials <i>completed</i> that year (NCRB's definition). It only describes cases that reached a verdict, so it swings a lot when few trials finish."],
    [["conviction", "convicted"], "Conviction",
      "A court finding the accused guilty. In 2023 there were " + fmt(D.funnel_by_year.find(r => r.year === 2023).convicted) + " cyber fraud convictions in India."],
    [["ncrb"], "NCRB",
      "The <b>National Crime Records Bureau</b>. It publishes <i>Crime in India</i> every year: cases registered by police (FIRs), by state. The newest edition covers " + LATEST + "."],
    [["i4c"], "I4C",
      "The <b>Indian Cyber Crime Coordination Centre</b>, under the Home Ministry. It runs the national cyber crime portal and the 1930 helpline, and counts complaints and money frozen."],
    [["cfcfrms"], "CFCFRMS",
      "The <b>Citizen Financial Cyber Fraud Reporting and Management System</b>: I4C's system behind the 1930 helpline. When a victim reports quickly, banks can freeze the money before the fraudster moves it."],
    [["mha"], "MHA", "The <b>Ministry of Home Affairs</b>. Its written answers to MPs' questions in Parliament reprint NCRB and I4C tables state by state; this site's data is read from those."],
    [["per lakh", "per 100k", "per capita", "lakh people"], "Per lakh",
      "Per 1,00,000 people. Dividing by population lets a small state be compared fairly with a big one. NCRB publishes this rate itself."],
    [["quadrant"], "Quadrant",
      "Each state is split twice at the median: complaint rate (high or low) and FIRs per 100 complaints (weak or coping). That gives four groups. It is two threshold rules, nothing more."],
    [["weak enforcement", "coping"], "Weak enforcement / coping",
      "'Weak enforcement' here means a state registers fewer FIRs per 100 complaints than the median state (" + fmt(D.quadrant[0].median_firs_per_100_complaints, 2) + "). 'Coping' means more. It is about registration, the first step, not convictions."],
    [["median"], "Median", "The middle value when states are lined up in order: half are above it, half below. It is used here instead of the average because two states (Telangana, Karnataka) are far above the rest and would drag an average up."],
    [["upper bound", "at most"], "Upper bound",
      "FIRs per 100 complaints divides <i>all</i> cyber crime FIRs by <i>fraud</i> complaints only. So the true share of fraud complaints that became an FIR is lower than the number shown. That is why the site says 'at most'."],
    [["high risk", "risk band", "above median", "below median"], "Risk band",
      "A threshold rule on the FIR rate: <b>High risk</b> = more than 2× the median state's rate that year; otherwise Above or Below median."],
    [["surge", "small base"], "Surge",
      "A state is flagged <b>Surge</b> if its cases are more than 1.5× the year before. States with under 100 cases the year before are marked 'Small base' instead, because going from 2 cases to 5 means little."],
    [["frozen", "lien", "saved"], "Frozen (lien)",
      "Money that banks blocked in the fraudster's account after a complaint, before it could be moved. It is not the same as money already returned to the victim."],
    [["otp fraud", "otp"], "OTP fraud", "Tricking a victim into sharing a one-time password so the fraudster can approve a payment. It more than doubled between 2021 and 2023 in NCRB's figures."],
    [["cyber fraud", "cyber crime", "cybercrime", "difference between"], "Cyber crime vs cyber fraud",
      "<b>Cyber crime</b> is every offence using a computer or phone (fraud, stalking, obscene content, hacking…). <b>Cyber fraud</b> is the part done to steal money. The map and yearly totals count all cyber crime; the funnel and fraud types count fraud only."],
    [["rgi", "projection", "projected population"], "Population projection",
      "India has had no census since 2011, so population comes from the Registrar General's official projections. They are the only estimates on this site, and the same ones NCRB uses."],
  ];

  function glossary(q) {
    const text = " " + q.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ") + " ";
    const asksMeaning = /\b(what is|what are|what does|whats|meaning|mean|means|define|definition|explain|full form|stand for)\b/.test(text);
    const words = text.trim().split(" ");
    for (const [terms, title, body] of GLOSSARY) {
      for (const t of terms) {
        const present = text.includes(" " + t + " ");
        const whole = text.trim() === t;                       // typed just the term
        if (present && (asksMeaning || whole || words.length <= 2)) {
          return { html: `<p><b>${title}</b></p><p>${body}</p>` };
        }
      }
    }
    return null;
  }

  // ---------- 3. the topics ------------------------------------------------

  // Order matters: when two topics tie on keyword hits, the one listed first
  // wins - so the specific topics come before the general ones.
  const TOPICS = {
    scam:       ["scammed", "scam", "cheated", "victim", "report", "helpline", "1930", "happened", "stolen",
                 "lost my", "what should i do", "what to do", "complain", "file a complaint", "help me", "fraud happened"],
    conviction: ["conviction", "convictions", "convicted", "funnel", "court", "trial", "trials", "charge",
                 "chargesheet", "justice", "punished", "jail", "caught"],
    money:      ["money", "lost", "loss", "rupees", "crore", "frozen", "saved", "recovered", "recovery",
                 "amount", "refund", "paisa"],
    quadrant:   ["weak", "enforcement", "quadrant", "coping", "police", "register", "registered"],
    fir:        ["fir", "firs", "complaints", "complaint", "convert", "conversion", "become", "turned"],
    growth:     ["grew", "growth", "growing", "fastest", "surge", "increase", "increased", "rising", "rise"],
    types:      ["type", "types", "kind", "kinds", "otp", "atm", "card", "banking", "common", "upi", "method"],
    sources:    ["source", "sources", "ncrb", "i4c", "official", "real", "fake", "trust", "reliable", "from where", "where does"],
    limits:     ["limitation", "limitations", "limits", "caveat", "caveats", "missing", "wrong", "accurate", "problem"],
    updated:    ["updated", "update", "latest", "recent", "current", "fresh", "newest", "old", "coverage",
                 "covers", "cover", "when", "last updated", "which years", "how old", "up to date"],
    rate:       ["rate", "per", "lakh", "capita", "highest", "worst", "dangerous", "risk", "risky", "safest",
                 "safe", "lowest", "unsafe"],
    count:      ["most", "cases", "count", "biggest"],
    trend:      ["trend", "years", "yearly", "changed", "change", "over", "time", "history", "year"],
    site:       ["site", "website", "page", "about", "who made", "purpose", "what can you", "you do"],
    help:       ["help", "hi", "hello", "hey", "examples", "example", "questions", "start"],
  };

  function pickTopic(q, states) {
    const text = " " + q.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ") + " ";
    const scores = {};
    Object.keys(TOPICS).forEach(t => {
      scores[t] = TOPICS[t].filter(k => text.includes(" " + k + " ")).length;
    });
    if (states.length >= 2) return "compare";
    const best = Object.keys(scores).reduce((a, b) => (scores[b] > scores[a] ? b : a));
    if (scores[best] === 0) return states.length ? "state" : null;
    // "cases in kerala", "is delhi safe": a question about that one state
    if (states.length && ["count", "rate", "trend", "site", "help", "fir", "money", "quadrant", "growth"].includes(best)) return "state";
    return best;
  }

  // ---------- 4. the answers ----------------------------------------------

  const stateRow = (rows, s) => rows.find(r => r.state === s);

  const ANSWERS = {

    help() {
      return {
        html: "<p>Hi! I answer questions about the data on this page. I am rule-based: I look things up, I do not guess.</p>" +
              "<p>Try one of these, or type a state name:</p>",
        chips: ["Tell me about Delhi", "Which states have weak enforcement?", "How many complaints become FIRs?",
                "How much money was lost?", "What is an FIR?", "I was scammed, what should I do?"],
      };
    },

    scam() {
      return {
        html: "<p><b>If you have been scammed, act fast:</b></p><ol>" +
              "<li>Call the national cyber crime helpline: <b>1930</b></li>" +
              "<li>Or report online at <b>cybercrime.gov.in</b> (the National Cyber Crime Reporting Portal)</li>" +
              "<li>Tell your bank immediately so they can try to block the transaction</li>" +
              "<li>Keep the evidence: screenshots, transaction IDs, phone numbers</li></ol>" +
              "<p>Speed matters. In " + DATA_YEAR + " only " +
              fmt(sum(D.money_2023, "amount_saved_cr") * 100 / sum(D.money_2023, "amount_reported_cr"), 1) +
              "% of the money reported lost was frozen in time.</p>" +
              note("This is general guidance based on the Government's published helpline, not something from the dataset. I am not a legal adviser."),
        section: "s4",
      };
    },

    quadrant() {
      const groups = {};
      D.quadrant.forEach(r => { (groups[r.quadrant] = groups[r.quadrant] || []).push(r); });
      const order = ["High rate, weak enforcement", "High rate, coping", "Low rate, weak enforcement", "Low rate, coping"];
      return {
        html: "<p>States split at two medians (2023): complaint rate " + fmt(D.quadrant[0].median_complaints_per_100k, 1) +
              " per lakh, and " + fmt(D.quadrant[0].median_firs_per_100_complaints, 2) + " FIRs per 100 complaints.</p>" +
              order.map(g => `<p><b>${g} (${groups[g].length})</b><br>` +
                groups[g].sort((a, b) => b.complaints_per_100k - a.complaints_per_100k).map(r => r.state).join(", ") + "</p>").join("") +
              note("'Weak enforcement' = few complaints become police FIRs. It is about registration, not convictions."),
        section: "s1",
      };
    },

    fir() {
      const big = D.quadrant.filter(r => r.complaints >= 10000);          // already sorted low to high
      const rows = big.slice(0, 4).concat(big.slice(-3));
      return {
        html: "<p>All India 2023: at most <b>" + fmt(sum(D.quadrant, "firs") * 100 / sum(D.quadrant, "complaints"), 1) +
              " FIRs for every 100</b> fraud complaints on the portal.</p>" +
              "<p>Lowest and highest among states with 10,000+ complaints:</p>" +
              table(["State", "Complaints", "FIRs", "per 100"],
                rows.map(r => [r.state, fmt(r.complaints), fmt(r.firs), fmt(r.firs_per_100_complaints, 2)])) +
              note("Upper bound: all cyber FIRs divided by fraud complaints only."),
        section: "s1",
      };
    },

    rate(q, states, year) {
      const y = pickYear(year, 2019, LATEST, LATEST);
      const lowest = /\b(safest|safe|lowest|least)\b/i.test(q);
      const rows = D.state_years.filter(r => r.year === y.year && r.cyber_cases >= 100)
        .sort((a, b) => lowest ? a.cases_per_100k - b.cases_per_100k : b.cases_per_100k - a.cases_per_100k).slice(0, 5);
      let warn = y.warn;
      if (lowest) {
        const low = stateRow(D.quadrant, rows[0].state);
        warn += note(`Careful: a low FIR rate does not mean a state is safe. ${rows[0].state}, lowest here, registered only ` +
          `${fmt(low.firs_per_100_complaints, 2)} FIRs per 100 fraud complaints in 2023.`);
      }
      return {
        html: warn + `<p>${lowest ? "Lowest" : "Highest"} cyber crime FIR rates, ${y.year} (states with 100+ cases):</p>` +
              table(["State", "FIRs", "per lakh", "Band"],
                rows.map(r => [r.state, fmt(r.cyber_cases), fmt(r.cases_per_100k, 2), r.risk_band])) +
              note("This is the rate of cases police registered. It also depends on how many complaints police register."),
        section: "s2",
      };
    },

    count(q, states, year) {
      const y = pickYear(year, 2019, LATEST, LATEST);
      const rows = D.state_years.filter(r => r.year === y.year).sort((a, b) => b.cyber_cases - a.cyber_cases).slice(0, 5);
      return {
        html: y.warn + `<p>All India ${y.year}: <b>${fmt(D.cases_by_year.find(r => r.year === y.year).cases)}</b> cyber crime FIRs registered. The most were in:</p>` +
              table(["State", "FIRs", "Rank by rate"], rows.map(r => [r.state, fmt(r.cyber_cases), r.rank_by_rate])),
        section: "s2",
      };
    },

    conviction(q, states, year) {
      const y = pickYear(year, 2019, 2023, 2023);
      const f = D.funnel_by_year.find(r => r.year === y.year);
      const rows = [];
      if (f.portal_complaints) rows.push(["Complaints on the portal", fmt(f.portal_complaints)]);
      rows.push(["Fraud FIRs registered", fmt(f.registered)], ["Charge sheeted", fmt(f.charge_sheeted)],
                ["Trials completed", fmt(f.trials_completed)], ["Convicted", "<b>" + fmt(f.convicted) + "</b>"]);
      return {
        html: y.warn + `<p>Cyber fraud funnel, all India ${y.year}:</p>` + table(["Stage", "Cases"], rows) +
              `<p>Conviction rate (convicted ÷ trials completed): ${fmt(f.convicted * 100 / f.trials_completed, 1)}%</p>` +
              note("Trials that finish in a year are mostly for cases registered in earlier years."),
        section: "s3",
      };
    },

    money(q, states, year) {
      const lost = sum(D.money_2023, "amount_reported_cr"), saved = sum(D.money_2023, "amount_saved_cr");
      const warn = year && year !== DATA_YEAR ? note(`State-wise money is only published for ${DATA_YEAR}, so this is ${DATA_YEAR}.`) : "";
      return {
        html: warn + `<p>All India ${DATA_YEAR}: <b>₹${fmt(lost, 2)} crore</b> reported lost, <b>₹${fmt(saved, 2)} crore</b> frozen in time ` +
              `= <b>${fmt(saved * 100 / lost, 1)}%</b>.</p><p>Top 5 states by amount lost:</p>` +
              table(["State", "Lost (₹ cr)", "Frozen (₹ cr)", "Frozen %"],
                D.money_2023.slice(0, 5).map(r => [r.state, fmt(r.amount_reported_cr, 2), fmt(r.amount_saved_cr, 2), fmt(r.pct_amount_saved, 1)])) +
              note("'Frozen' = blocked in a bank account, not necessarily returned to the victim."),
        section: "s4",
      };
    },

    growth() {
      const rows = D.growth_2024.slice(0, 5);
      return {
        html: `<p>Fastest growing, ${LATEST - 1} to ${LATEST} (Surge = more than 1.5×; states under 100 cases left out):</p>` +
              table(["State", LATEST - 1, LATEST, "Growth", "Flag"],
                rows.map(r => [r.state, fmt(r.cases_2023), fmt(r.cases_2024), signed(r.yoy_growth_pct), r.trend_flag])),
        section: "s5",
      };
    },

    types(q, states, year) {
      const y = pickYear(year, 2021, 2023, 2023);
      const rows = D.fraud_types.filter(r => r.year === y.year);
      return {
        html: y.warn + `<p>Cyber fraud cases by type, all India ${y.year}:</p>` +
              table(["Type", "Cases", "Share"], rows.map(r => [r.fraud_type, fmt(r.cases), fmt(r.pct_of_fraud_cases, 1) + "%"])) +
              note("NCRB publishes this split for the whole country only, not by state."),
        section: "s6",
      };
    },

    trend() {
      const rows = D.cases_by_year, first = rows[0], last = rows[rows.length - 1];
      return {
        html: "<p>Cyber crime FIRs, all India:</p>" +
              table(["Year", "FIRs", "per lakh"], rows.map(r => [r.year, fmt(r.cases), fmt(r.per_100k, 2)])) +
              `<p>Up ${fmt((last.cases / first.cases - 1) * 100, 0)}% from ${first.year} to ${last.year}.</p>` +
              note("Part of the rise may be more complaints being registered, not only more crime."),
        section: "s5",
      };
    },

    state(q, states, year) {
      const s = states[0];
      const y = pickYear(year, 2019, LATEST, LATEST);
      const r = D.state_years.find(x => x.state === s && x.year === y.year);
      const c = stateRow(D.quadrant, s), m = stateRow(D.money_2023, s);
      if (!r) return { html: y.warn + `<p>${esc(s)} has no figure for ${y.year}.</p>` };
      const city = cityAsked ? note(`The data is by state, not by city, so this is ${s} (for "${esc(cityAsked)}").`) : "";
      return {
        html: y.warn + city + `<p><b>${s}</b></p>` +
              `<p><b>${y.year}:</b> ${fmt(r.cyber_cases)} cyber crime FIRs, ${fmt(r.cases_per_100k, 2)} per lakh. ` +
              `Rank ${r.rank_by_count} by count, ${r.rank_by_rate} by rate (${r.risk_band})` +
              (r.yoy_growth_pct !== null ? `; ${signed(r.yoy_growth_pct)} on the year before.` : ".") + "</p>" +
              `<p><b>2023 complaints:</b> ${fmt(c.complaints)} fraud complaints (${fmt(c.complaints_per_100k, 1)} per lakh, rank ${c.complaint_rank}). ` +
              `At most ${fmt(c.firs_per_100_complaints, 2)} FIRs per 100 complaints.<br>Group: <b>${c.quadrant}</b></p>` +
              `<p><b>2023 money:</b> ₹${fmt(m.amount_reported_cr, 2)} crore reported lost, ${fmt(m.pct_amount_saved, 1)}% frozen in time.</p>` +
              note("The FIR rate shows cases police registered, so it cannot tell you by itself how safe a state is. Compare it with the complaints figure."),
        section: "s1",
        state: s,
        chips: [`Compare ${s} and ${s === "Karnataka" ? "Rajasthan" : "Karnataka"}`, "Which states have weak enforcement?"],
      };
    },

    compare(q, states) {
      const pair = states.slice(0, 2);
      const cell = (s, f) => f(stateRow(D.quadrant, s), D.state_years.find(x => x.state === s && x.year === LATEST), stateRow(D.money_2023, s));
      const rows = [
        ["Complaints per lakh (2023)", (c) => fmt(c.complaints_per_100k, 1)],
        ["FIRs per 100 complaints", (c) => fmt(c.firs_per_100_complaints, 2)],
        [`FIR rate per lakh (${LATEST})`, (c, r) => fmt(r.cases_per_100k, 2)],
        ["Money frozen %", (c, r, m) => fmt(m.pct_amount_saved, 1)],
        ["Group", (c) => c.quadrant],
      ];
      return {
        html: table(["", pair[0], pair[1]], rows.map(([label, f]) => [label, cell(pair[0], f), cell(pair[1], f)])),
        section: "s1",
      };
    },

    sources() {
      return {
        html: "<p>All figures are <b>official</b>, read from Government documents:</p><ul>" +
              "<li>NCRB <i>Crime in India</i> 2019–" + LATEST + " (cases, fraud funnel), as tabled by the Home Ministry in Parliament</li>" +
              "<li>I4C CFCFRMS 2023 (portal complaints, money lost and frozen)</li>" +
              "<li>RGI population projections: the only estimates used</li></ul>" +
              "<p>The links to each document are in the Sources section.</p>",
        section: "sources",
      };
    },

    limits() {
      return {
        html: "<p>Things to keep in mind when reading this page:</p><ul>" +
              "<li>NCRB publishes late: " + LATEST + " is the newest year</li>" +
              "<li>Complaints and FIRs show reporting and registration, not how many people were really hit</li>" +
              "<li>Convictions are mostly for older cases, because trials take years</li>" +
              "<li>Yearly data only, so there is nothing about months or seasons</li>" +
              "<li>State-wise money figures exist for 2023 only</li></ul>",
        section: "limitations",
      };
    },

    updated() {
      const c = D.coverage;
      const span = ([a, b]) => (a === b ? `${a}` : `${a}–${b}`);
      const when = new Date(D.generated + "T00:00:00")
        .toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
      return {
        html: `<p>This page was last updated on <b>${when}</b>.</p>` +
              table(["Data", "Years"], [
                ["Police FIRs by state (NCRB)", span(c.fir_years)],
                ["Fraud funnel: FIR → conviction (NCRB)", span(c.funnel_years)],
                ["Complaints and money (I4C)", c.complaint_year],
                ["Fraud by type, all India (NCRB)", span(c.type_years)],
              ]) +
              `<p>Newest source: ${c.newest_source}.</p>` +
              note(`Official crime figures come out 1–2 years late, so ${c.fir_years[1]} is the newest year that exists, not a gap in this site.`),
      };
    },

    site() {
      return {
        html: "<p><b>ScamTrace India</b> puts three official sources side by side: NCRB (police FIRs), I4C (victim complaints and money) and population.</p>" +
              "<p>The main point: only a small share of fraud complaints become police FIRs, and that share differs hugely between states. So FIR counts partly show how police register cases, not just how much crime there is.</p>" +
              "<p>I can look up any state, explain the terms, and point you to the right chart.</p>",
        chips: ["Tell me about Delhi", "How many complaints become FIRs?", "What is an FIR?"],
      };
    },
  };

  // the one function everything goes through
  function ask(question) {
    const q = question.trim();
    if (!q) return ANSWERS.help();
    const states = findStates(q);
    const term = states.length ? null : glossary(q);
    if (term) return term;
    const topic = pickTopic(q, states);
    if (!topic) {
      return {
        html: "<p>Sorry, I could not match that to anything on this page. I only answer from this site's data, so I will not guess.</p><p>You could ask:</p>",
        chips: ["Tell me about Delhi", "Which state has the highest rate?", "How many convictions in 2023?", "What types of fraud are common?"],
      };
    }
    return ANSWERS[topic](q, states, findYear(q));
  }

  // ---------- 5. the chat windows -------------------------------------------
  // The same assistant appears twice: the floating bubble (any page position)
  // and, if the page has one, the inline "Ask ScamTrace" section.

  const SECTION_NAMES = { s1: "complaints vs FIRs", s2: "the rate chart", s3: "the funnel", s4: "the money chart",
                          s5: "the growth charts", s6: "fraud types", limitations: "Limitations", sources: "Sources" };

  // one conversation = a message log plus how to add to it
  function conversation(log) {
    function say(who, html) {
      const div = document.createElement("div");
      div.className = "chat-msg chat-" + who;
      div.innerHTML = html;
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
      return div;
    }

    function button(text, cls, onclick) {
      const b = document.createElement("button");
      b.type = "button"; b.className = cls; b.textContent = text; b.onclick = onclick;
      return b;
    }

    function reply(answer) {
      const div = say("bot", answer.html);
      if (answer.chips) {
        const box = document.createElement("div");
        box.className = "chat-chips";
        answer.chips.forEach(text => box.appendChild(button(text, "", () => send(text))));
        div.appendChild(box);
      }
      // a state answer can open that state on the map
      if (answer.state && window.ScamExplore) {
        div.appendChild(button(`Open ${answer.state} on the map ↗`, "chat-jump", () => window.ScamExplore.show(answer.state)));
      } else if (answer.section && document.getElementById(answer.section)) {
        div.appendChild(button("Show " + SECTION_NAMES[answer.section] + " on the page ↗", "chat-jump",
          () => document.getElementById(answer.section).scrollIntoView()));
      }
      log.scrollTop = log.scrollHeight;
    }

    function send(text) {
      say("user", esc(text));            // escaped: what the person typed is shown as text, never as HTML
      reply(ask(text));
    }

    return { reply, send };
  }

  function wireForm(form, input, chat) {
    form.onsubmit = e => {
      e.preventDefault();
      const text = input.value.trim();
      if (text) { chat.send(text); input.value = ""; }
    };
  }

  function build() {
    // --- the floating bubble
    const root = document.createElement("div");
    root.innerHTML =
      '<button id="chat-open" aria-label="Open the ScamTrace assistant">Ask about the data</button>' +
      '<section id="chat-panel" hidden aria-label="ScamTrace assistant">' +
      '  <header><div><b>ScamTrace Assistant</b><span>Rule-based. Answers only from this page\'s data.</span></div>' +
      '  <button id="chat-close" aria-label="Close">×</button></header>' +
      '  <div id="chat-log" aria-live="polite"></div>' +
      '  <form id="chat-form"><input id="chat-input" type="text" autocomplete="off" maxlength="200" ' +
      '    placeholder="Type a state or a question…" aria-label="Your question"><button type="submit">Send</button></form>' +
      '</section>';
    document.body.appendChild(root);

    const panel = document.getElementById("chat-panel"), log = document.getElementById("chat-log");
    const input = document.getElementById("chat-input"), openBtn = document.getElementById("chat-open");
    const bubble = conversation(log);
    wireForm(document.getElementById("chat-form"), input, bubble);

    // open the window, optionally asking a question straight away
    function open(question) {
      panel.hidden = false; openBtn.hidden = true;
      if (!log.children.length) bubble.reply(ANSWERS.help());
      if (question) bubble.send(question);
      input.focus();
    }
    openBtn.onclick = () => open();
    document.getElementById("chat-close").onclick = () => { panel.hidden = true; openBtn.hidden = false; openBtn.focus(); };

    // --- the inline section, if the page has one
    const inline = document.getElementById("askLog");
    if (inline) {
      const chat = conversation(inline);
      wireForm(document.getElementById("askForm"), document.getElementById("askInput"), chat);
      chat.reply(ANSWERS.help());
      document.querySelectorAll("[data-ask-inline]").forEach(b => { b.onclick = () => chat.send(b.dataset.askInline); });
    }

    // any button on the page with data-ask="..." opens the bubble (with that question)
    document.querySelectorAll("[data-ask]").forEach(b => { b.onclick = () => open(b.dataset.ask); });

    // a link like  index.html#ask=tell me about delhi  opens it with that question,
    // both when the page loads and when the link is clicked on the page itself
    function openFromLink() {
      const asked = decodeURIComponent(location.hash).match(/^#ask=(.+)/);
      if (asked) open(asked[1]);
    }
    openFromLink();
    window.addEventListener("hashchange", openFromLink);

    window.ScamChat = { open };
  }

  window.ScamBot = { ask };              // so the answers can be tested without clicking
  build();
})();
