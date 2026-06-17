# Fleet APM Dashboard Data Model Notes

## Datasets

- Fleet Preventative Maintenance and Repair Work Orders: `2a8x-bxjm`
- Fleet Inventory: `m8ba-xmjz`
- Fleet Monthly Costs: `xvtz-r8an`

## Joins

- Inventory joins to work orders by `eq_equip_no`.
- Monthly costs are related by `eq_equip_no` and `cost_year = work_order_yr`.
- Monthly costs are aggregated once per `eq_equip_no + cost_year + cost_month` in cost charts and drill-downs to avoid multiplying a monthly row by multiple work orders.

## Added Inventory Variables

- `asset_type`
- `class_class_bench`
- `est_replace_cost`
- `manufacturer`
- `model`
- `description`

## Added Monthly Cost Variables

- `fuel_cost`
- `cng_cost`
- `oil_cost`
- `misc_cost`
- `repair_labor_cost`
- `repair_parts_cost`
- `pm_labor_cost`
- `pm_parts_cost`
- `cost_year`
- `cost_month`

## KPI Formulas

- MTBF: visible asset-days / failure events. Failure events are repair work orders with downtime or out-of-service evidence, falling back to all repair events if downtime is absent.
- MTBR: visible asset-days / repair events.
- Mean Miles Between Repairs: meter delta across repair records / repair intervals.
- Reliability: `e^(-lambda * t)`, where `lambda = 1 / MTBF` and `t = 365 days`.
- Failure Rate: failures / asset-days * 365.
- Number of Repairs: count of non-PM work orders after filters.
- Maintenance Cost % of RAV: visible work-order maintenance cost / unique visible assets' `est_replace_cost`.
- PMP: PM work-order cost / total visible work-order maintenance cost.

## Dashboard Filters

Universal filters apply to all tabs:

- Time range: last 2 days, 10 days, 1 month, 4 months, 1 year, and MAX.
- Asset class text filter.
- Department text filter.
- Manufacturer text filter.
- Model text filter.
- Asset ID text filter.

## Threshold Assumptions

The RCA book recommends defining Target, Stretch, Critical, Best, and Worst values for each KPI before judging performance. The dashboard uses estimated starting thresholds based on common maintenance reliability practice:

- MTBF: target 365 days, stretch 730 days, critical under 90 days.
- MTBR: target 180 days, stretch 365 days, critical under 45 days.
- Mean miles between repairs: target 7,500 miles, stretch 10,000 miles, critical under 2,500 miles.
- Reliability: target 70%, stretch 85%, critical under 50%.
- Failure rate: target at or below 0.50 failures per asset-year, stretch 0.25, critical above 1.50.
- Number of repairs: judged against repair rate per asset-year, target at or below 0.50, stretch 0.25, critical above 1.50.
- Maintenance cost % of RAV: target at or below 3%, stretch 2%, critical above 5%.
- PMP: target 70%, stretch 80%, critical under 50%.

These are intentionally editable assumptions. For production use, calibrate them by asset class and department because police SUVs, refuse trucks, and sweepers should not share the same reliability target.
