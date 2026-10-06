# Document 01: System Architecture & Data Lineage Overview

**Target Platform:** Drivn Commercial EV Telematics Platform  
**Repository:** `gcpdrivn/telematics-analytics-dashboard-drivn`  
**Classification:** Core Engineering Handover  
**Document Status:** Production Reference  

---

## 1. Executive Summary & System Mission

The **Drivn Telematics Analytics Platform** is a full-stack, automated telematics analytics, fleet intelligence, and financial billing engine designed specifically for commercial Electric Vehicles (EV buses and heavy-duty trucks).

The platform continuously processes IoT telematics feeds from vehicle trackers (via Fleetx APIs), cleans and deduplicates multi-device telemetry, resolves physical odometer discrepancies, calculates asset utilization and battery health (State of Health / SoH), and computes monthly contractual **Excess KM billing** across enterprise customer fleets (including FreshBus, ZingBus, BillionE, and other major operators).

### Core Capabilities
1. **Automated Daily Ingestion**: Ingests vehicle trips and odometer telemetry directly from the Fleetx REST API on daily schedules.
2. **Deterministic Cleansing & Odometer Resolution**: Filters duplicate dashcam units, normalizes registration plates, rejects sensor anomalies, and reconciles odometer rollbacks and gap days.
3. **High-Performance Analytics Backend**: Serves computed fleet utilization, availability, distance compartment distributions, and battery degradation profiles via FastAPI and an in-memory thread-safe caching engine.
4. **Interactive Dashboard**: Provides operations teams and management with interactive Plotly visualisations, customer comparative metrics, and fleet duty inspectors.
5. **Contractual Excess-KM Billing**: Automatically calculates monthly billable kilometers against contractual customer allowances and generates audit-ready financial Excel statements.

---

## 2. End-to-End Architectural Topology

The system uses a decoupled cloud architecture designed to optimize operational costs, maintain zero-maintenance serverless scalability, and guarantee sub-second dashboard query latencies.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       INGESTION & DATA SOURCES                                   │
│  ┌─────────────────────────────┐  ┌─────────────────────────────┐  ┌──────────────────────────┐  │
│  │   Fleetx Trips API          │  │   Fleetx Realtime API       │  │   Master Metadata Sheets │  │
│  │   (/trips/ - daily summary) │  │   (/analytics/live - SoH)   │  │   (Dimensions & Terms)   │  │
│  └──────────────┬──────────────┘  └──────────────┬──────────────┘  └────────────┬─────────────┘  │
└─────────────────┼────────────────────────────────┼──────────────────────────────┼────────────────┘
                  │                                │                              │
                  ▼                                ▼                              ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   SCHEDULED COMPUTE LAYER (GCP)                                  │
│  ┌──────────────────────────────┐ ┌─────────────────────────────┐ ┌───────────────────────────┐  │
│  │ Cloud Run Job:               │ │ Cloud Run Job:              │ │ Cloud Run Job:            │  │
│  │ drivn-ingest-daily           │ │ drivn-soh-daily             │ │ drivn-resolve-odometer    │  │
│  │ (Runs 08:30 IST)             │ │ (Runs 08:30 IST)            │ │ (Runs 09:00 IST)          │  │
│  └──────────────┬───────────────┘ └──────────────┬──────────────┘ └─────────────┬─────────────┘  │
│                 │                                │                              │                │
│                 │ Triggered via Cloud Scheduler  │                              │                │
└─────────────────┼────────────────────────────────┼──────────────────────────────┼────────────────┘
                  │                                │                              │
                  ▼                                ▼                              ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               DATA WAREHOUSE LAYER (BigQuery asia-south1)                        │
│                                                                                                  │
│  • Raw Utilization:      telematics.utilization_daily_api_v2                                    │
│  • Resolved Odometer:    telematics.odometer_daily_resolved_v2                                  │
│  • Battery Health:       telematics.vehicle_soh_latest                                           │
│  • Dimensions:           telematics.dim_vehicle, telematics.dim_customer, vehicle_mileage_soc   │
│  • Billing Views:        telematics.excess_km_monthly, telematics.excess_km_monthly_customer     │
│  • Backup Snapshots:     telematics.*_backup_<timestamp> (30-day retention)                      │
└──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                   │
                                                   ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                APPLICATION & SERVING LAYER (Cloud Run)                           │
│                                                                                                  │
│  Cloud Run Service: drivn-backend (FastAPI / Python 3.11 / pandas)                              │
│                                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │ In-Process Multi-Tier Cache (_TTLCache, default 300s TTL):                                 │  │
│  │ • Raw BigQuery Table Cache (Parallel ThreadPoolExecutor fetch)                             │  │
│  │ • Derived Metric Bundle (Joined DataFrames, cleanings, categorizations)                     │  │
│  │ • Precomputed Crosstab & Uptime Distributions                                              │  │
│  │ • Admin cache invalidation: POST /api/admin/refresh-cache                                  │  │
│  └────────────────────────────────────────────────────────────────────────────────────────────┘  │
│  REST API Endpoints: /api/kpi/*, /api/customers/*, /api/crosstab/*, /api/vehicles/*, /api/uptime  │
└──────────────────────────────────────────────────▲───────────────────────────────────────────────┘
                                                   │
                                   HTTPS Proxy (/api/* redirect)
                                                   │
┌──────────────────────────────────────────────────┴───────────────────────────────────────────────┐
│                                       PRESENTATION LAYER                                         │
│                                                                                                  │
│  Netlify Edge CDN: drivn-fleet-intelligence.netlify.app                                          │
│  • Single Page App: React 18, Vite, TypeScript, Vanilla CSS Design System                        │
│  • Visualizations: Plotly.js (wrapped via custom bundle shim), Sparklines, Custom Matrix Cards   │
│  • Routing: Overview (/), Buses (/buses), Trucks (/trucks), Customers (/customers), Glossary     │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Technology Stack & Hosting Rationale

| Layer | Technology | Hosting / Environment | Technical Rationale |
|:---|:---|:---|:---|
| **Frontend** | React 18, TypeScript, Vite, Vanilla CSS | Netlify (`drivn-fleet-intelligence.netlify.app`) | Global CDN delivery, instant asset caching, and automatic continuous deployment on every git push to `main`. |
| **API Gateway / Backend** | FastAPI, Python 3.11, pandas | Google Cloud Run (`drivn-backend`, `asia-south1`) | Runs full Linux container; container persistence keeps the in-process cache warm across user requests; zero base cost with automatic scaling to 0 when idle. |
| **Data Warehouse** | Google BigQuery | GCP Project `drivn-project-1`, Dataset `telematics` | Serverless analytical warehouse with partitioned storage; natively supports atomic `MERGE` statements and instantaneous table cloning for backups. |
| **Scheduled Jobs** | Cloud Run Jobs + Cloud Scheduler | GCP `asia-south1` (`drivn-ingest-daily`, etc.) | Isolates long-running ingestion and heavy odometer reconciliation logic from the user-facing web server. |
| **Secrets & Credentials** | GCP Secret Manager | Secret Manager (`drivn-project-1`) | Avoids hardcoded credentials. Fleetx username and password are dynamically injected into ingestion jobs at runtime. |

### Architectural Decision Record (ADR): Why Split Netlify and Cloud Run?
Early in development, hosting the backend as Netlify Functions was evaluated. It was **rejected** for three architectural reasons:
1. **Python Support**: Netlify Functions run primarily on Node.js/Go; Python support is non-standard and poorly optimized for large dependencies.
2. **Dependency Footprint**: The analytical stack (`pandas`, `google-cloud-bigquery`, `pyarrow`, `grpc`) exceeds the serverless package and unzipped memory budget (250MB limit).
3. **Loss of In-Process Caching**: Netlify Functions cold-start per request, destroying in-memory caches. Cloud Run keeps container instances warm, allowing `backend/data_loader.py` to maintain a 300-second in-memory cache that drops dashboard response times from ~4,500ms down to ~35ms.

---

## 4. End-to-End Data Lineage & Lifecycle

The lifecycle of data through the platform spans seven deterministic stages:

```
[Raw Sources: Fleetx API & Manual Sheets]
                   │
                   ▼  (Stage 1: Daily Scheduled Pull @ 08:30 IST)
[BigQuery Raw: utilization_daily_api_v2]
                   │
                   ▼  (Stage 2: Cleansing & CAM Filter)
[Cleaned Fact Stream: composite key dedup]
                   │
                   ▼  (Stage 3: Reconciliation Engine @ 09:00 IST)
[BigQuery Derived: odometer_daily_resolved_v2]
                   │
                   ▼  (Stage 4: Dimension & Terms Join)
[Dimension Tables: dim_vehicle, dim_customer]
                   │
                   ├──────────────────────────────────┐
                   ▼ (Stage 6: Billing Materialization)▼ (Stage 7: Backend Serving)
[BigQuery Views: excess_km_monthly]         [FastAPI Multi-Tier In-Memory Cache]
                   │                                  │
                   ▼                                  ▼
[Excel Financial Audits]                    [Netlify Frontend Client Dashboard]
```

### Stage 1: Daily Telematics Ingestion (Cloud Run Job: `drivn-ingest-daily`)
* **Schedule**: Daily at `08:30 IST` (via Cloud Scheduler `drivn-ingest-daily-trigger`).
* **Source**: Fleetx `/trips/` API.
* **Window Formulation**: Ingests trips for the preceding calendar day (`yesterday`).
* **Critical Timezone Handling (The IST Window Fix)**:
  Fleetx accepts epoch millisecond timestamps. The query window must strictly represent **00:00:00 to 23:59:59 IST** (`Asia/Kolkata`). 
  > **Crucial Post-Mortem Context**: In the initial `v1` implementation, `_to_epoch_ms` used the host system clock. When deployed to Cloud Run (which runs on UTC), the query window shifted to `05:30–05:30 IST`, dropping all overnight trips ending before 05:30 IST. This was resolved by forcing IST timezone localization in `ingestion/api_pipeline.py`. The resulting corrected dataset was permanently promoted to `utilization_daily_api_v2`.

### Stage 2: Hardware Deduplication & Cleansing
Commercial fleets often have auxiliary hardware installed alongside primary telematics devices:
1. **DashCam Exclusion**: Auxiliary dashcam units transmit duplicate records appending `-CAM` or `CAM` to the registration number. The pipeline identifies whether a non-CAM record exists for that same base license plate and date. If present, the CAM record is discarded. If the CAM device is the only unit that reported, its records are preserved.
2. **Plate Normalization**: Strips spaces, hyphens, and hardware suffixes to generate the canonical `base_license_plate` (e.g. `MH02GS4332-CAM` → `MH02GS4332`).
3. **Vehicle Classification Clubbing**: Normalizes inconsistent vendor asset classes (e.g. mapping `Heavy Puller` directly into `Truck`).

### Stage 3: Daily Odometer Resolution (Cloud Run Job: `drivn-resolve-odometer`)
* **Schedule**: Daily at `09:00 IST` (runs 30 minutes after the daily ingest completes).
* **Target Table**: `odometer_daily_resolved_v2`.
* **The Business Problem**: Raw GPS distance counters frequently drift or fail due to antenna disconnections, cellular dead-zones, or firmware bugs. Conversely, hardware odometer counters may experience instrument cluster resets, battery disconnect jumps, or corrupt spikes.
* **The Algorithmic Solution**:
  `ingestion/odometer_resolver.py` scans each vehicle's full chronological telemetry and assigns one of four states to each calendar day:
  1. `RAW_VALID`: Daily odometer difference matches within acceptable bounds.
  2. `INTERPOLATED`: Bridge odometer gaps when a vehicle operates between silent days.
  3. `GAP_CLOSED`: Reconciles device swap boundaries.
  4. `MANUAL_OVERRIDE`: Administrative override for confirmed hardware replacements.
* **Safety Bounds**:
  * Any single-day distance exceeding **1,500 km/day** is flagged and rejected as physically impossible for a commercial EV.
  * Any absolute odometer reading exceeding **1,500,000 km (15 Lakh km)** is classified as hardware corruption.
  * Any backward odometer step exceeding **1%** retains the prior valid historical reading.

### Stage 4: Morning Battery State-of-Health Snapshot (Cloud Run Job: `drivn-soh-daily`)
* **Schedule**: Daily at `08:30 IST`.
* **Source**: Fleetx Realtime API (`GET /api/v1/analytics/live`).
* **Target Table**: `vehicle_soh_latest`.
* **Behavior**: Extracts live battery State-of-Health (SoH %) and live odometer readings. If a vehicle reports a flat default `100%` (a known dummy value from certain truck telematics units) or an odometer reading lower than its historical maximum, it is tagged with visual warning flags for the dashboard.

### Stage 5: Dimension Resolution & Master Data Sync (`seed-dimensions`)
* **Target Tables**: `dim_vehicle`, `dim_customer`.
* **Upstream Sources**: Fleetx vehicle export (`Vehicle_Update_uploader.xlsx`) combined with manual master metadata (`dim_vehicle_master.xlsx`).
* **Zero-Delete Principle**: A vehicle missing from a fresh export is **never deleted**. It is updated to `is_active = FALSE`. Inactive vehicles retain full historical telemetry, but are excluded from active daily API pulls.
* **Automated Backfill**: Newly added or reactivated vehicles automatically trigger an instant historical telemetry backfill (`vehicle_backfill.py`), run odometer resolution, and trigger an automated cache refresh on Cloud Run.

### Stage 6: Excess-KM Billing Materialization
* **Target Views**: `telematics.excess_km_monthly`, `telematics.excess_km_monthly_customer`.
* **Upstream Sources**: Contractual terms loaded from `data/raw/Excess KM & Battery Replacement.xlsx` via `uv run sync-excess-km`.
* **Calculation Rules**:
  * Billable KM represents trusted odometer days (`RAW_VALID`, `INTERPOLATED`, `MANUAL_OVERRIDE`).
  * Silent-device travel is billed only if the multi-day average is under 1,500 km/day.
  * **Excess KM**: $\text{Excess KM} = \max\left(0, \; \text{Billable KM} - \text{Contractual Allowance}\right)$.
  * **Excess Cost**: $\text{Excess Cost (INR)} = \text{Excess KM} \times \text{Contractual Excess Rate}$.
* **Audit Flags**: A month is flagged as `needs_review` if less than **90%** of in-service days possess trusted readings or if cumulative odometer kilometers diverge from GPS distance by more than **15%**.

### Stage 7: In-Memory Backend Serving & Cache Hydration
* **Mechanism**: When a request reaches FastAPI, `backend/data_loader.py` checks its in-memory TTL cache (default 300 seconds).
* **Cold Start Concurrency**: If the cache is empty, a Python `ThreadPoolExecutor` dispatches concurrent queries to BigQuery for raw utilization, dimensions, benchmarks, and resolved odometers, reducing cold load times from 5 seconds to ~1.2 seconds.
* **Metric Engine**: `backend/metrics.py` applies Pandas transformations in memory (active-day filtering, tenure calculations, active-day volatility with Bessel's correction $ddof=1$, distance compartment bucketing) and returns JSON payloads.

---

## 5. Security Architecture, Identity & Boundaries

### Service Accounts & IAM Permissions Matrix

| Identity / Service Account | Associated Resource | GCP IAM Roles Assigned | Operational Scope |
|:---|:---|:---|:---|
| `fleet-intelligence-backend@drivn-project-1.iam.gserviceaccount.com` | Cloud Run Service (`drivn-backend`) | • `roles/bigquery.dataViewer`<br>• `roles/bigquery.jobUser` | Read-only access to query BigQuery tables and views; submit query jobs. No write or delete permissions. |
| `drivn-ingestion-job@drivn-project-1.iam.gserviceaccount.com` | Cloud Run Jobs (`drivn-ingest-daily`, `drivn-soh-daily`, `drivn-resolve-odometer`) | • `roles/bigquery.dataEditor`<br>• `roles/bigquery.jobUser`<br>• `roles/run.invoker`<br>• `roles/secretmanager.secretAccessor` | Read/write access to insert/update BigQuery tables; permission to run jobs and read Fleetx credentials from Secret Manager. |

### Network & Routing Configuration

1. **Netlify Reverse Proxy**:
   Netlify handles TLS termination and acts as the public entrypoint. The `netlify.toml` file contains a server-side redirect:
   ```toml
   [[redirects]]
     from = "/api/*"
     to = "https://drivn-backend-304868514241.asia-south1.run.app/api/:splat"
     status = 200
     force = true
   ```
2. **CORS Boundary**:
   The backend restricts Cross-Origin Resource Sharing to authorized origins via `BACKEND_CORS_ORIGINS`:
   `http://localhost:5173,https://drivn-fleet-intelligence.netlify.app`.
3. **Public Unauthenticated Endpoint Status**:
   `drivn-backend` is currently deployed with `--allow-unauthenticated`. This was an intentional Phase 1 architectural decision to allow seamless server-side routing from Netlify without maintaining signed JWT proxy infrastructure. Direct backend access is read-only, but should be secured with API Gateway or pre-shared headers if sensitive proprietary data expands.

---

## 6. BigQuery Warehouse Catalog & Table Directory

All tables reside within dataset `telematics` in GCP project `drivn-project-1` (`asia-south1`).

| Table / View Name | Object Type | Refresh Frequency | Primary / Composite Key | Upstream Source | Primary Consumers |
|:---|:---|:---|:---|:---|:---|
| `utilization_daily_api_v2` | Native Table | Daily (08:30 IST) | `(base_license_plate, report_date)` | Fleetx `/trips/` API | Backend, Odometer Resolver |
| `odometer_daily_resolved_v2` | Native Table | Daily (09:00 IST) | `(base_license_plate, report_date)` | `utilization_daily_api_v2` | Backend, Billing Views |
| `vehicle_soh_latest` | Native Table | Daily (08:30 IST) | `base_license_plate` | Fleetx Realtime API | Customers Page SoH Chart |
| `dim_vehicle` | Native Table | On demand (admin) | `base_license_plate` | Fleetx uploader + Master xlsx | Backend joins, Billing |
| `dim_customer` | Native Table | On demand (admin) | `customer_id` | `CUSTOMER_TAGS` mapping | Backend joins, Billing |
| `vehicle_mileage_soc` | Native Table | On demand (admin) | `license_plate` | `vehicle_mileage_soc.xlsx` | Benchmark KPI cards |
| `excess_km_monthly` | SQL View | Live computation | `(base_license_plate, month)` | `odometer_daily_resolved_v2` + terms | Financial export CLI |
| `excess_km_monthly_customer` | SQL View | Live computation | `(customer, month)` | `excess_km_monthly` | Billing rollups |
| `utilization_daily` *(Legacy)* | Native Table | Frozen (30 Sep 2026) | `(base_license_plate, report_date)` | Daily Excel imports | Historical audit reference |

---

## 7. Global System Configuration & Runtime Flags

The system behavior is controlled dynamically via environment variables configured in `.env` (locally) and in Cloud Run service configurations:

* `UTILIZATION_SOURCE`: 
  * `api` (**Active Production**): Reads from `utilization_daily_api_v2`.
  * `excel` (Legacy): Reads from the historical `utilization_daily` Excel ingest table.
* `DISTANCE_SOURCE`:
  * `reported` (Default): Uses raw GPS `Distance` as reported by devices.
  * `odometer`: Uses calibrated `distance_by_odometer` from `odometer_daily_resolved_v2`.
* `BACKEND_CACHE_TTL_SECONDS`:
  * Default: `300` (5 minutes). Determines how long BigQuery query results and derived calculations are cached in Cloud Run memory before re-querying.
* `BACKEND_URL`:
  * When populated (e.g. pointing to Cloud Run), local administration scripts automatically trigger `POST /api/admin/refresh-cache` immediately following vehicle onboarding or backfill operations.

---

## 8. Summary & Next Steps

This document established the macro architecture, cloud topology, security boundaries, and seven-stage data lineage of the Drivn telematics platform.

To inspect the deep-dive implementation of schemas, deduplication code, odometer reconciliation algorithms, and billing rules, continue to:
👉 **[Document 02: Data Pipeline & Warehouse Specification](02-Data-Pipeline-and-Warehouse-Specification)**
