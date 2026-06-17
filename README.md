# Cincinnati Fleet APM Dashboard

## Data Sources

- Fleet Preventative Maintenance and Repair Work Orders: `2a8x-bxjm`
- Fleet Inventory: `m8ba-xmjz`
- Fleet Monthly Costs: `xvtz-r8an`

The dashboard loads a local XLSX-derived preload immediately when opened, then refreshes from live Socrata data in the background. While the page remains open, the scheduled refresh runs at 11:59 PM Cincinnati time.

The local preload is stored in `fleet_apm_snapshot.js` and was generated from:

- `Fleet_Preventative_Maintenance_&_Repair_Work_Orders_20260609.xlsx`
- `Fleet_Inventory_20260611.xlsx`
- `Fleet_Monthly_Costs_20260611.xlsx`

The preload keeps all work-order rows. Monthly cost rows are included only when the asset appears in the work-order data and at least one displayed cost field is nonzero; omitted rows do not affect the dashboard totals.

## Merge Logic

- Work orders are the primary fact table.
- Fleet Inventory is merged by `eq_equip_no`.
- Fleet Monthly Costs are merged and filtered by asset-month using `eq_equip_no`, `cost_year`, and `cost_month`.
- Monthly costs are aggregated once per visible asset-month to avoid duplicating monthly cost rows across multiple work orders.

## Universal Filters

All filters are dynamic multi-select controls populated from the merged data. They default to Select All. The dropdown label says `All` only when every option is selected, and `None` when no options are selected.

- Asset class: `class_class_bench`
- Department: `dept_equip_dept_name`
- Manufacturer: `manufacturer`
- Model: `model`
- Asset ID: `eq_equip_no`
- Year: all available `work_order_yr` values

## KPI Formulas

All KPIs are calculated at the asset level first using each asset's filtered `unique_work_order_no` rows, then aggregated upward to the visible dashboard scope.

- MTBF: sum of operating hours / sum of repair work orders, for assets where `meter_1_type` is hours.
- MMBF: sum of operating miles / sum of repair work orders, for assets where `meter_1_type` is miles or hubometer.
- MTBR: sum of operating hours / sum of repair work orders, for hour-metered assets.
- MMBR: sum of operating miles / sum of repair work orders, for mile/hubometer assets.
- Operating hours or miles: `last_meter_1_reading - meter_1_at_delivery`, using Fleet Inventory.
- MTTR: sum of `labor_hours` on repair rows / count of repair work orders.
- Reliability/hr: `e^(-360 / MTBF)`.
- Reliability/mile: `e^(-3600 / MMBF)`.
- Maintenance Cost % of RAV: sum of `total_cost` for assets with valid RAV / sum of those assets' `est_replace_cost`.
- PMP: PM `total_cost` / total maintenance `total_cost`.
- Number of Repairs: count of unique repair `unique_work_order_no` values.
- R3 Repeat Repair Rate: assets with the same repair reason within 30 days / assets with at least one repair.

## Drill Down Pareto

The Pareto chart drills in this order:

1. Asset class
2. Department
3. Manufacturer
4. Model
5. Asset ID

Select a bar, then use the down arrow to drill. Use the up arrow to return one level.

## Advanced Analytics

The Advanced Analytics tab performs a Weibull reliability analysis on runtime intervals between observed repair events. It does not use `in_service_date`.

The Advanced Analytics tab includes one tab-specific setting: Interval Unit, Miles or Hours. Assets are classified from `meter_1_type`, and miles/hours are never mixed in one Weibull fit. The existing global filters for year, asset class, department, manufacturer, model, and asset ID slice the Weibull analysis just like the rest of the dashboard.

The model builds one interval row per asset repair-to-repair pair using `current meter_1_reading - previous meter_1_reading`, excluding non-repair/PM work orders, missing repair dates, missing meter readings, zero intervals, negative intervals, and assets whose meter type does not match the selected Interval unit.

The main chart shows `R(t) = exp(-((t / theta) ^ beta))`, where `t` is miles or hours between repairs. Model Details reports beta, theta, B10/B50/B90, repair interval statistics, reliability at common intervals, and hazard interpretation. Data Quality Notes are collapsed below the main model output.

## Notes

Thresholds in KPI tooltips are starter benchmark estimates and should be calibrated by asset class, operating context, and department.
