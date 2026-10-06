# Document 04: Dashboard & Metric Dictionary

**Target Platform:** Drivn Commercial EV Telematics Platform  
**Repository:** `gcpdrivn/telematics-analytics-dashboard-drivn`  
**Classification:** Core Engineering Handover  
**Document Status:** Production Reference  

---

## 1. Executive Overview & Analytical Philosophy

The **Drivn Presentation & Business Logic Layer** translates raw telemetry into actionable commercial fleet intelligence.

Commercial EV fleet data is subject to unique operational dynamics: sensor blackouts, depot yard parking, multi-day scheduled maintenance, and staggered mid-month vehicle commissioning. Applying naive calendar-day averages (e.g. dividing total monthly distance by 30) distorts asset health and misleads battery sizing. 

To provide ground-truth operational intelligence, Drivn enforces three foundational analytical paradigms:
1. **Active-Day Normalization**: Distinguishing running days from idle depot days to measure true duty cycle intensity.
2. **Tenure-Adjusted Dynamic Denominators**: Accounting for fleet expansion so newly deployed vehicles do not depress historical fleet metrics.
3. **Bessel-Corrected Volatility ($ddof=1$)**: Evaluating route operational predictability using active-day sample variance.

---

## 2. Foundational Mathematical Formulations

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              CORE METRIC FORMULATION MATRIX                            │
│                                                                                        │
│  Daily Distance:           d_{i,t} = ODO_{close} - ODO_{open}                          │
│  Active Day Condition:     1(d_{i,t} > 0)                                              │
│  Active Operating Days:    A_i = \sum 1(d_{i,t} > 0)                                   │
│  Fleet Tenure:             T_{bus} = 30 (fixed)  |  T_{truck} = First-seen tenure       │
│  Utilization Rate:         U_i = (A_i / T_i) * 100%                                    │
│  Active Daily Distance:    \bar{d}_i = (\sum d_{i,t}) / A_i                            │
│  Sample Volatility (CV%):  CV_i = (s_i / \bar{d}_i) * 100%,  where ddof=1              │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 The Active Operating Day Filter: 1(Distance > 0)

* **Definition**: A vehicle $i$ is defined as **Active** on calendar date $t$ if and only if its recorded distance is strictly greater than zero:

$$
\mathbf{1}(d_{i,t} > 0) = 
\begin{cases} 
1, & \text{if } d_{i,t} > 0 \\ 
0, & \text{if } d_{i,t} = 0 \text{ or missing} 
\end{cases}
$$

* **Active Operating Days Calculation ($A_i$)**:
  The total count of active days for vehicle $i$ across observation tenure $T_i$:

$$
A_i = \sum_{t=1}^{T_i} \mathbf{1}(d_{i,t} > 0)
$$

* **Physical Rationale**: If an electric intercity bus drives 600 km/day for 20 days and spends 10 days in scheduled depot servicing, its simple calendar-day average is 400 km/day. However, **its battery and powertrain never experienced a 400 km day**—they experienced 600 km duty cycles. Diluting active shift miles over idle days masks true thermal and mechanical load.

### 2.2 Fleet Tenure Resolution (T_i)

Fleet tenure represents the number of days a vehicle was commercially commissioned and available for dispatch:

* **Bus Fleet Tenure ($T_{\text{bus}}$)**:
  * Contractual fleets (FreshBus, ZingBus) have fixed contractual fleet sizes ($N = 10$).
  * Tenure is fixed to the observation window length (default $T_{\text{bus}} = 30$ days, or the distinct calendar days within an active date filter).
* **Truck Fleet Tenure ($T_{\text{truck}}$)**:
  * Heavy-duty truck fleets (BillionE, AVG Logistics, SwitchLabs) are expanding fleets where vehicles onboard at different times.
  * Tenure is dynamic, measured from the vehicle's hardware installation date (`device_installation_date`) or its first recorded telemetry reading:

$$
T_{i,\text{truck}} = \max\left(1, \; \text{Date}_{\text{end}} - \text{Date}_{\text{onboarded}} + 1\right)
$$

  * This prevents newly onboarded trucks from artificially deflating overall fleet utilization rates.

### 2.3 Utilization Rate vs. Operational Availability

* **Individual Vehicle Utilization ($U_i$)**:

$$
U_i = \left( \frac{A_i}{T_i} \right) \times 100\%
$$

* **Fleet-Wide Aggregate Utilization ($U_{\text{fleet}}$)**:

$$
U_{\text{fleet}} = \left( \frac{\sum_{i=1}^N A_i}{\sum_{i=1}^N T_i} \right) \times 100\%
$$

* **Operational Availability Timeline ($\text{Availability}_t$)**:
  The proportion of the commissioned fleet operating on calendar date $t$:

$$
\text{Availability}_t = \left( \frac{\sum_{i=1}^{N_t} \mathbf{1}(d_{i,t} > 0)}{N_t} \right) \times 100\%
$$

  where $N_t$ is the number of vehicles eligible and in service on date $t$.

### 2.4 Active-Day Volatility & Relative Dispersion (CV %)

Measures the operational consistency of a vehicle's daily driving schedule. Evaluated strictly over active operating days using **Bessel's correction ($ddof=1$)**:

1. **Active Sample Variance ($s_i^2$)**:

$$
s_i^2 = \frac{1}{A_i - 1} \sum_{t \in \text{Active}} (d_{i,t} - \bar{d}_i)^2
$$

2. **Coefficient of Variation ($CV_i$)**:

$$
CV_i = \left( \frac{s_i}{\bar{d}_i} \right) \times 100\%
$$

* **Operational Interpretation**:
  * **$CV < 15\%$ (Predictable Corridor)**: Vehicles running fixed, scheduled routes (e.g. FreshBus operating fixed Guntur–Hyderabad timetables).
  * **$CV > 30\%$ (Volatile Hauling)**: Vehicles running on-demand freight shifts with high daily distance variation (e.g. cement or steel haulage trucks).

### 2.5 Battery Energy Benchmark (km / % SoC)

* **Metric**: Kilometers delivered per 1% consumption of battery State of Charge ($\text{km} / \%\Delta\text{SoC}$).
* **Sensor Calibration Filter**:
  A standard commercial EV delivers between 2.5 to 6.5 $\text{km} / \%\Delta\text{SoC}$. Telematics readings $\ge 10.0$ indicate BMS calibration faults or unrecorded mid-shift opportunity charging and are **strictly set to NULL**.

---

## 3. Comprehensive Metric Dictionary

| Metric Name | Display Name | Unit | Formula / Calculation | Business Definition & Usage |
|:---|:---|:---|:---|:---|
| **Fleet Distance / Day** | `Avg Daily Fleet Km` | `km/day` | $(\sum_{i,t} d_{i,t}) / \text{Observation Days}$ | Total kilometers generated by the fleet per calendar day. Used for fleet energy billing. |
| **Vehicle Average Distance** | `Avg Km / Active Day` | `km/day` | $(\sum_{t} d_{i,t}) / A_i$ | True average kilometers driven when the vehicle is running. Used for maintenance intervals. |
| **Active Operating Hours** | `Avg Hours / Day` | `hrs/day` | $(\sum_{t} h_{i,t}) / A_i$ | Average ignition-ON driving duration per active shift. Used for driver crew compliance. |
| **Fleet Availability** | `Availability %` | `%` | $(\text{Active Fleet}_t / N_t) \times 100$ | Share of available assets generating revenue on a given day. |
| **Fleet Utilization** | `Utilization %` | `%` | $(\sum A_i / \sum T_i) \times 100$ | Cumulative active days expressed as a percentage of total commissioned tenure. |
| **Below-80% Alert** | `Below 80% Utilization` | Count | Count of assets where $U_i < 80\%$ | Identifies underperforming assets suffering from chronic depot maintenance downtime. |
| **Distance Compartment** | `200 km Bands` | Count | $\sum \mathbf{1}(d_{i,t} \in \text{Band}_k)$ | Daily vehicle count segmented into mileage bins (0, 1–200, 201–400, 401–600, 600+ km). |
| **Battery SoH** | `State of Health` | `%` | BMS reported battery health | Percentage of original battery capacity remaining before warranty replacement thresholds. |
| **Live Odometer** | `Latest Odometer` | `km` | Latest validated wheel reading | Cumulative life-to-date physical mileage on the chassis. |

---

## 4. Frontend Architecture & Component System

The user interface is a responsive, dark/light themed Single Page Application built with **React 18**, **TypeScript**, and **Vite**, hosted on Netlify.

### 4.1 Routing & Navigation Structure
Configured in [`frontend/src/App.tsx`](file:///home/yogesh/Desktop/Drivn/telematics-analytics-dashboard-drivn/frontend/src/App.tsx):

* `/` or `/customers`: **Customers Overview Page** — Top customer KPI comparison, box plots, day-of-week heatmaps, SoH vs Odometer scatter chart, active timeline.
* `/buses`: **Buses Page** — Bus fleet KPIs, 200 km cross-tabulation dispersion matrix, vehicle performance roster, duty-cycle inspector.
* `/trucks`: **Trucks Page** — Heavy-duty truck KPIs, 150 km cross-tabulation matrix, vehicle roster.
* `/glossary`: **Metric Glossary Page** — Built-in interactive documentation explaining all charts and mathematical definitions to business operators.

### 4.2 State Persistence: Date Range Query Parameters
The frontend avoids losing filter state during page navigation by binding the date picker to URL search parameters (`?start=YYYY-MM-DD&end=YYYY-MM-DD`):
```tsx
<NavLink to={{ pathname: "/buses", search: location.search }} className={navClass}>
  Buses
</NavLink>
```
When an operator sets a custom 14-day window on the Customers page, switching to Buses or Trucks preserves the active window without reloading.

### 4.3 Design System & Theme Engine (`frontend/src/global.css`)
* Built with native Vanilla CSS custom properties (`var(--bg-body)`, `var(--accent-brand)`).
* Supports instant theme persistence (`light` and `dark` modes) stored in `localStorage` under key `drivn-theme`.
* Zero CSS-framework dependencies (no Tailwind, Bootstrap, or Material UI bloat).

---

## 5. Visualizations & Interactive Component Catalog

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND VISUALIZATION CATALOG                            │
│                                                                                        │
│  [KpiCards]           Top metric strip with dynamic badges, fleet size, and totals     │
│  [CrosstabMatrix]     Interactive 200 km daily dispersion grid with customer dropdown  │
│  [SohOdometerChart]   Plotly scatter plot of Battery SoH vs Chassis Odometer           │
│  [ActiveTimeline]     Multi-line Plotly chart of daily operating fleet percentages     │
│  [VehicleTable]       Sortable roster with sparkline micro-charts & under-utilization  │
│  [UptimeGrid]         Color-coded calendar grid showing ran/not-run/gap classifications │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 5.1 Plotly Bundler Shim (`frontend/src/plotly-shim.ts`)
`react-plotly.js` and `plotly.js` use CommonJS export structures that frequently fail inside Vite's modern ES module bundler. To prevent `"Element type is invalid"` runtime crashes, `plotly-shim.ts` implements a defensive unwrapper:

```typescript
function unwrapCJS<T>(mod: unknown): T {
  let m: any = mod
  for (let i = 0; i < 3 && m && typeof m !== "function" && "default" in m; i++) {
    m = m.default
  }
  return m as T
}

import * as PlotlyModule from "plotly.js/dist/plotly"
import * as FactoryModule from "react-plotly.js/factory"

const Plotly = unwrapCJS<any>(PlotlyModule)
const createPlotlyComponent = unwrapCJS<(p: any) => any>(FactoryModule)
export default createPlotlyComponent(Plotly)
```

> [!CAUTION]
> If a future `npm update` upgrades `plotly.js` or `react-plotly.js` and chart rendering breaks, check `plotly-shim.ts` first.

### 5.2 Battery SoH vs. Live Odometer Scatter Chart
Rendered on the Customers page via `SohOdometerChart.tsx`:
* **Solid Green / Blue Dots**: Valid measured State of Health readings.
* **Hollow Circular Rings**: Warning indicators for:
  * Hardware devices reporting a dummy `100.0%` default value (`is_soh_dummy = true`).
  * Vehicles experiencing an instrument cluster reset where live odometer is far below historical records (`is_odometer_fault = true`).

### 5.3 Vehicle Duty Roster & Inline Sparklines (`VehicleTable.tsx`)
* **Sortable Attributes**: License plate, customer, model, active days, utilization %, avg km/day, avg hours/day, volatility CV%.
* **Sparklines**: Pure SVG micro-visualizations rendered directly from the `daily_distance_history` numerical array without heavy charting libraries.
* **Alert Badges**: Automatically tags vehicles with `< 80% Utilization` in orange/red to highlight assets requiring depot operational review.

---

## 6. Summary & Next Steps

This document specified the mathematical formulations, statistical definitions, UI components, and frontend architecture of the Drivn platform.

To review daily operations, deployment procedures, backup restorations, and incident runbooks, continue to:  
👉 **[Document 05: Operational Runbook & Disaster Recovery](05-Operational-Runbook-and-Disaster-Recovery)**
