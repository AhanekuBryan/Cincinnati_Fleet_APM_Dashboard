import assert from "node:assert/strict";
import fs from "node:fs";

function rowsToObjects(rows, fields) {
  return rows.map(row => Object.fromEntries(fields.map((field, i) => [field, row[i] ?? ""])));
}

function normalizeString(value) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeAssetId(value) {
  return String(value ?? "").trim();
}

function classifyMeterType(meterType) {
  const value = String(meterType ?? "").trim().toUpperCase();
  if (value.includes("MILE") || value.includes("ODOMETER") || value.includes("HUB") || value.includes("HUBO")) return "miles";
  if (value.includes("HOUR") || value.includes("HR") || value.includes("ENGINE")) return "hours";
  return "unknown";
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function firstValidDate(values) {
  for (const value of values) {
    const d = parseDate(value);
    if (d) return d;
  }
  return null;
}

function getWorkOrderEventDate(row) {
  return firstValidDate([
    row.datetime_finished,
    row.datetime_closed,
    row.datetime_in_service,
    row.datetime_out_service,
    row.datetime_open,
    row.create_date,
  ]);
}

function repairConfig(includePm = false) {
  return {
    repairJobTypes: new Set(["REPAIR", "R"]),
    nonRepairJobTypes: new Set(["PM", "PREVENTATIVE MAINTENANCE", "PREVENTIVE MAINTENANCE"]),
    includePm,
  };
}

function isRepairWorkOrder(row, config) {
  const value = normalizeString(row.job_type);
  if (config.repairJobTypes.has(value)) return true;
  return config.includePm && config.nonRepairJobTypes.has(value);
}

function groupBy(rows, fn) {
  const map = new Map();
  for (const row of rows) {
    const key = fn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function buildRepairIntervals(rows, includePm = false) {
  const cfg = repairConfig(includePm);
  const out = [];
  for (const [asset, assetRows] of groupBy(rows, r => normalizeAssetId(r.eq_equip_no))) {
    const events = assetRows
      .map(row => ({ row, date: getWorkOrderEventDate(row) }))
      .filter(x => x.date && isRepairWorkOrder(x.row, cfg))
      .sort((a, b) => a.date - b.date);
    for (let i = 1; i < events.length; i++) {
      const days = (events[i].date - events[i - 1].date) / 86400000;
      if (days > 0) out.push({ eq_equip_no: asset, interval_value: days, event_observed: 1 });
    }
  }
  return out;
}

function buildMeterIntervals(rows, inventory) {
  const meterTypes = [...new Set(inventory.map(r => normalizeString(r.meter_1_type)).filter(Boolean))];
  if (meterTypes.length > 1) return { blocked: true, intervals: [] };
  const out = [];
  for (const [asset, assetRows] of groupBy(rows, r => normalizeAssetId(r.eq_equip_no))) {
    const events = assetRows
      .map(row => ({ row, date: getWorkOrderEventDate(row), meter: Number(row.meter_1_reading) }))
      .filter(x => x.date && isRepairWorkOrder(x.row, repairConfig()) && Number.isFinite(x.meter))
      .sort((a, b) => a.date - b.date);
    for (let i = 1; i < events.length; i++) {
      const delta = events[i].meter - events[i - 1].meter;
      if (delta > 0) out.push({ eq_equip_no: asset, interval_value: delta, event_observed: 1 });
    }
  }
  return { blocked: false, intervals: out };
}

function quantile(sortedValues, p) {
  const sorted = [...sortedValues].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function weibullNll(intervals, logBeta, logEta) {
  const beta = Math.exp(logBeta);
  const eta = Math.exp(logEta);
  let ll = 0;
  for (const item of intervals) {
    const t = item.interval_value;
    const z = Math.pow(t / eta, beta);
    const logS = -z;
    if (item.event_observed) ll += Math.log(beta) - Math.log(eta) + (beta - 1) * (Math.log(t) - Math.log(eta)) + logS;
    else ll += logS;
  }
  return -ll;
}

function optimizeWeibull(intervals, logBeta, logEta) {
  let best = { logBeta, logEta, nll: weibullNll(intervals, logBeta, logEta) };
  let step = 1;
  for (let iter = 0; iter < 160 && step > 1e-5; iter++) {
    let improved = false;
    for (const [b, e] of [
      [best.logBeta + step, best.logEta], [best.logBeta - step, best.logEta],
      [best.logBeta, best.logEta + step], [best.logBeta, best.logEta - step],
    ]) {
      const nll = weibullNll(intervals, b, e);
      if (nll < best.nll) {
        best = { logBeta: b, logEta: e, nll };
        improved = true;
      }
    }
    if (!improved) step *= 0.55;
  }
  return best;
}

function fitWeibullMLE(intervals) {
  const observed = intervals.filter(d => d.event_observed);
  if (observed.length < 5) return { valid: false, warnings: ["Insufficient observed repair intervals."] };
  const values = intervals.map(d => d.interval_value).sort((a, b) => a - b);
  const warnings = [];
  if (observed.length < 15) warnings.push("Small observed-event sample; interpret beta and eta cautiously.");
  let best = null;
  for (const beta of [0.7, 1, 1.5, 2, 3]) {
    for (const eta of [quantile(values, 0.5), mean(values), quantile(values, 0.75)]) {
      const candidate = optimizeWeibull(intervals, Math.log(beta), Math.log(eta));
      if (!best || candidate.nll < best.nll) best = candidate;
    }
  }
  return { valid: true, beta: Math.exp(best.logBeta), eta: Math.exp(best.logEta), warnings };
}

const fields = ["eq_equip_no", "job_type"];
assert.deepEqual(rowsToObjects([["001", "REPAIR"]], fields), [{ eq_equip_no: "001", job_type: "REPAIR" }]);
assert.equal(normalizeAssetId(" 001 "), "001");
assert.equal(normalizeString(" repair "), "REPAIR");
assert.equal(classifyMeterType("Hubometer"), "miles");
assert.equal(classifyMeterType("engine hours"), "hours");
assert.equal(classifyMeterType("none"), "unknown");
assert.equal(getWorkOrderEventDate({ datetime_finished: "", datetime_closed: "2024-02-01", create_date: "2024-01-01" }).toISOString().slice(0, 10), "2024-02-01");
assert.equal(isRepairWorkOrder({ job_type: "PM" }, repairConfig()), false);

const rows = [
  { eq_equip_no: "001", job_type: "REPAIR", create_date: "2024-01-01", meter_1_reading: 100 },
  { eq_equip_no: "001", job_type: "PM", create_date: "2024-01-10", meter_1_reading: 110 },
  { eq_equip_no: "001", job_type: "REPAIR", create_date: "2024-01-21", meter_1_reading: 150 },
  { eq_equip_no: "001", job_type: "REPAIR", create_date: "2024-01-21", meter_1_reading: 140 },
];
assert.deepEqual(buildRepairIntervals(rows).map(d => d.interval_value), [20]);
assert.deepEqual(buildMeterIntervals(rows, [{ eq_equip_no: "001", meter_1_type: "MILES" }]).intervals.map(d => d.interval_value), [50]);
assert.equal(buildMeterIntervals(rows, [{ eq_equip_no: "001", meter_1_type: "MILES" }, { eq_equip_no: "002", meter_1_type: "HOURS" }]).blocked, true);

const synthetic = Array.from({ length: 80 }, (_, i) => {
  const p = (i + 0.5) / 80;
  return { interval_value: 100 * Math.pow(-Math.log(1 - p), 1 / 1.6), event_observed: 1 };
});
const fit = fitWeibullMLE(synthetic);
assert.equal(fit.valid, true);
assert.ok(fit.beta > 1.1 && fit.beta < 2.2);
assert.ok(fit.eta > 75 && fit.eta < 130);

const censoredFit = fitWeibullMLE([...synthetic.slice(0, 20), ...synthetic.slice(20, 35).map(d => ({ ...d, event_observed: 0 }))]);
assert.equal(censoredFit.valid, true);
assert.ok(fitWeibullMLE(synthetic.slice(0, 6)).warnings.length > 0);

const html = fs.readFileSync("outputs/fleet_apm_dashboard.html", "utf8");
assert.match(html, /data-tab="advanced"/);
assert.match(html, /data-tab="health"/);
assert.match(html, /data-tab="pareto"/);
assert.match(html, /data-tab="breakdown"/);
assert.match(html, /prelical-transparent\.png/);
assert.match(html, /href="https:\/\/prelical\.com\/"/);
assert.match(html, /City of Cincinnati Fleet APM Dashboard/);
assert.match(html, /Proxima Nova Wide/);
assert.match(html, /Pareto Opportunity Analysis/);
assert.match(html, /Pareto Opp\. Analysis/);
assert.match(html, /defaultExcludedFilterValues/);
assert.match(html, /assetClass: new Set\(\["Unclassified"\]\)/);
assert.match(html, /manufacturer: new Set\(\["Unknown manufacturer"\]\)/);
assert.match(html, /scheduleBackgroundLiveRefresh/);
assert.match(html, /requestIdleCallback/);
assert.match(html, /Interval Unit/);
assert.match(html, /Probability of No Repair by Runtime Interval/);
assert.match(html, /Model Details/);
assert.match(html, /Data Quality Notes/);
assert.match(html, /<summary>See more<\/summary>/);
assert.match(html, /function classifyMeterType/);
assert.match(html, /function getRepairEventDate/);
assert.match(html, /function runWeibullRuntimeAnalysis/);
assert.match(html, /All line-item costs/);
assert.match(html, /value="total_cost">/);
assert.doesNotMatch(html, /Fleet Opportunity Analysis/);
assert.doesNotMatch(html, /value="total_cost" checked/);
assert.doesNotMatch(html, /Repair Interval Distribution/);
assert.doesNotMatch(html, /<summary>Hazard Rate<\/summary>/);
assert.doesNotMatch(html, /id="weibullIntervalDistribution"/);
assert.doesNotMatch(html, /id="weibullHazardChart"/);
assert.doesNotMatch(html, /<summary>More filters<\/summary>/);
assert.doesNotMatch(html, /id="weibullYear"/);
assert.doesNotMatch(html, /<label>Analysis basis/);
assert.doesNotMatch(html, /<option value="repair">Time between repairs<\/option>/);
assert.doesNotMatch(html, /time to first failure/i);

console.log("weibull tests passed");
