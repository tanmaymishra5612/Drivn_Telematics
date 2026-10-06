# Document 03: Backend Service & API Technical Reference

**Target Platform:** Drivn Commercial EV Telematics Platform  
**Repository:** `gcpdrivn/telematics-analytics-dashboard-drivn`  
**Classification:** Core Engineering Handover  
**Document Status:** Production Reference  

---

## 1. Executive Overview & Application Architecture

The **Drivn Telematics Backend Service** is a high-performance REST API built with **FastAPI** (Python 3.11) and **pandas**. It serves as the application and presentation gateway, querying Google BigQuery analytical tables, computing fleet metrics and statistical volatility in memory, and delivering cached JSON responses to the React frontend.

The service is containerized via Docker and deployed on **Google Cloud Run** in `asia-south1` (Mumbai) under the service name `drivn-backend`.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 FASTAPI APPLICATION (main.py)                          │
│                                                                                        │
│  • CORS Middleware (Configured via BACKEND_CORS_ORIGINS)                               │
│  • Health & Admin Routing (/api/health, /api/admin/refresh-cache)                       │
│  • Domain Routers: kpi, customers, crosstab, vehicles, trajectories, meta, uptime      │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                DATA ACCESS LAYER (data_loader.py)                      │
│                                                                                        │
│  • Parallel Query Execution: ThreadPoolExecutor(max_workers=5)                         │
│  • Lightweight DataFrame Hydration: Direct dictionary mapping (avoids PyArrow bloat)    │
│  • Multi-Tier In-Process Cache (_TTLCache, default 300s TTL):                          │
│    ├── _cache: Raw BigQuery table loads                                                │
│    ├── _derived_cache: Cleaned, joined & per-vehicle aggregated DataFrames              │
│    ├── _crosstab_cache: Pre-aggregated distance compartment matrices                   │
│    └── _soh_cache: Battery SoH vs Live Odometer snapshot                               │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              COMPUTATION ENGINES                                       │
│                                                                                        │
│  • metrics.py: Active days, tenure, sample volatility (ddof=1), customer profiles      │
│  • uptime.py: Per-vehicle day-by-day status inference (RAN / NOT RUN / NOT SURE)        │
│  • excel_export.py: Dynamic openpyxl streaming generator for vehicle uptime workbooks   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Codebase Layout & Module Responsibilities

The backend codebase is organized under `backend/`:

| Module Path | Primary Responsibility | Key Functions / Classes |
|:---|:---|:---|
| [`backend/main.py`](file:///home/yogesh/Desktop/Drivn/telematics-analytics-dashboard-drivn/backend/main.py) | Application entrypoint; CORS setup; route registration; health checks. | `app`, `health()`, `refresh_cache()` |
| [`backend/data_loader.py`](file:///home/yogesh/Desktop/Drivn/telematics-analytics-dashboard-drivn/backend/data_loader.py) | BigQuery client interface; multi-tier thread-safe caching; schema renaming. | `_TTLCache`, `get_clean_context()`, `get_tables()`, `refresh()` |
| [`backend/metrics.py`](file:///home/yogesh/Desktop/Drivn/telematics-analytics-dashboard-drivn/backend/metrics.py) | Mathematical formulas; fleet statistics; customer profiles; crosstab logic. | `clean_and_join()`, `build_active_stats()`, `build_kpi_scopes()` |
| [`backend/uptime.py`](file:///home/yogesh/Desktop/Drivn/telematics-analytics-dashboard-drivn/backend/uptime.py) | Day-by-day vehicle uptime classification engine; gap-boundary lookups. | `build_vehicle_uptime()`, `STATUS_INFO` |
| [`backend/excel_export.py`](file:///home/yogesh/Desktop/Drivn/telematics-analytics-dashboard-drivn/backend/excel_export.py) | In-memory Openpyxl spreadsheet generation for uptime exports. | `build_uptime_workbook()` |
| [`backend/routers/kpi.py`](file:///home/yogesh/Desktop/Drivn/telematics-analytics-dashboard-drivn/backend/routers/kpi.py) | Fleet-level KPI strip summaries. | `GET /api/kpi-summary` |
| [`backend/routers/customers.py`](file:///home/yogesh/Desktop/Drivn/telematics-analytics-dashboard-drivn/backend/routers/customers.py) | Customer accounts analytics; SoH vs live odometer scatter data. | `GET /api/customers/analytics`, `GET /api/customers/soh-odometer` |
| [`backend/routers/crosstab.py`](file:///home/yogesh/Desktop/Drivn/telematics-analytics-dashboard-drivn/backend/routers/crosstab.py) | 200 km distance compartment distribution matrix. | `GET /api/crosstab-matrix` |
| [`backend/routers/vehicles.py`](file:///home/yogesh/Desktop/Drivn/telematics-analytics-dashboard-drivn/backend/routers/vehicles.py) | Master vehicle rosters; category filtering; under-utilization alerts. | `GET /api/vehicles` |
| [`backend/routers/trajectories.py`](file:///home/yogesh/Desktop/Drivn/telematics-analytics-dashboard-drivn/backend/routers/trajectories.py) | Dynamic vehicle sampling for battery SoC consumption trajectories. | `GET /api/vehicle-trajectories` |
| [`backend/routers/uptime.py`](file:///home/yogesh/Desktop/Drivn/telematics-analytics-dashboard-drivn/backend/routers/uptime.py) | Fleet uptime grids and binary streaming Excel export. | `GET /api/uptime`, `GET /api/uptime/export` |
| [`backend/routers/meta.py`](file:///home/yogesh/Desktop/Drivn/telematics-analytics-dashboard-drivn/backend/routers/meta.py) | Filter boundaries; cumulative fleet odometer sum. | `GET /api/date-range`, `GET /api/fleet-odometer-total` |

---

## 3. Data Access & Parallel Caching Layer (`data_loader.py`)

### 3.1 Parallel BigQuery Thread Pooling
Running BigQuery queries sequentially on cold starts resulted in ~5 seconds of network wait time. `backend/data_loader.py` optimizes this by executing independent queries concurrently using a `ThreadPoolExecutor`:

```python
with ThreadPoolExecutor(max_workers=5) as pool:
    raw_future = pool.submit(_query_df, client, utilization_sql)
    dim_vehicle_future = pool.submit(_query_df, client, f"SELECT * FROM `{settings.dim_vehicle_table_ref}`")
    dim_customer_future = pool.submit(_query_df, client, f"SELECT * FROM `{settings.dim_customer_table_ref}`")
    mileage_future = pool.submit(_query_df, client, f"SELECT * FROM `{settings.mileage_soc_table_ref}`")
    odometer_future = (
        pool.submit(_query_df, client, odometer_sql)
        if DISTANCE_SOURCE == "odometer"
        else None
    )
```
This concurrency collapses network latency to that of the single slowest query (~1.1s).

### 3.2 Memory Optimization: Why PyArrow Was Omitted
BigQuery's standard `QueryJob.to_dataframe()` requires `db-dtypes` and `pyarrow` (a 152MB uncompressed package). To keep Docker container sizes small and ensure portability, `_query_df()` constructs DataFrames directly from the row iterator:
```python
def _query_df(client: bigquery.Client, sql: str) -> pd.DataFrame:
    rows = client.query(sql).result()
    return pd.DataFrame([dict(row) for row in rows])
```
Because the BigQuery REST client returns Python-native types (`float`, `str`, `datetime.date`), pandas handles typing seamlessly without external native C-extensions.

### 3.3 The Four In-Process TTL Caches
To avoid querying BigQuery on every frontend tab click, `data_loader.py` implements a thread-safe `_TTLCache` with a default TTL of 300 seconds (`BACKEND_CACHE_TTL_SECONDS`):

1. `_cache`: Stores raw DataFrames loaded directly from BigQuery (`raw_utilization`, `dim_vehicle`, `dim_customer`, `mileage`, `odometer_resolved`).
2. `_derived_cache`: Stores the joined and aggregated dataset (`df_clean`, `active_stats`, `observation_days`). Caching this avoids running heavy pandas `groupby().apply()` passes repeatedly.
3. `_crosstab_cache`: Stores the precomputed 200 km daily distance distribution matrix for all customer breakdowns.
4. `_soh_cache`: Stores the latest battery State of Health and live odometer records.

### 3.4 Cache Invalidation Protocols
The cache is cleared in three scenarios:
1. **TTL Expiry**: Automatically refreshes after 300 seconds.
2. **Container Lifecycle**: Any deployment or container restart clears in-memory state.
3. **Explicit API Invalidation**: Calling `POST /api/admin/refresh-cache` immediately purges all four caches. This endpoint is called automatically by `seed-dimensions` and `backfill-vehicles`.

---

## 4. Runtime Configuration & Environment Toggles

The backend behavior is governed by environment variables loaded at startup:

| Environment Variable | Allowed Values | Production Value | Purpose & Impact |
|:---|:---|:---|:---|
| `UTILIZATION_SOURCE` | `api`, `excel` | `api` | Determines whether the backend reads from `utilization_daily_api_v2` (active live data) or `utilization_daily` (frozen legacy Excel data). |
| `DISTANCE_SOURCE` | `reported`, `odometer` | `reported` | Determines whether daily distances derive from raw GPS telemetry (`Distance`) or reconciled physical odometers (`distance_by_odometer`). |
| `BACKEND_CACHE_TTL_SECONDS` | Float (e.g. `300.0`) | `300` | In-memory cache validity duration in seconds. |
| `BACKEND_CORS_ORIGINS` | Comma-separated URLs | `http://localhost:5173,https://drivn-fleet-intelligence.netlify.app` | Allowed browser origins for Cross-Origin Resource Sharing. |
| `BQ_UTILIZATION_API_TABLE` | BigQuery Table Name | `utilization_daily_api_v2` | Overrides the target API utilization table (defaults to `_v2`). |
| `BQ_ODOMETER_RESOLVED_TABLE`| BigQuery Table Name | `odometer_daily_resolved_v2` | Overrides the target odometer resolution table (defaults to `_v2`). |

---

## 5. Complete REST API Specification

### 5.1 System & Administrative Endpoints

#### `GET /api/health`
Returns system status, active source flags, and the BigQuery tables currently queried by the running container.
* **Query Parameters**: None.
* **Sample Response (200 OK)**:
```json
{
  "status": "ok",
  "utilization_source": "api",
  "distance_source": "reported",
  "utilization_api_table": "utilization_daily_api_v2",
  "odometer_resolved_table": "odometer_daily_resolved_v2"
}
```

#### `POST /api/admin/refresh-cache`
Invalidates all four in-memory TTL caches immediately, forcing subsequent requests to re-query BigQuery.
* **Query Parameters**: None.
* **Sample Response (200 OK)**:
```json
{
  "status": "cache invalidated"
}
```

---

### 5.2 Key Performance Indicators (KPIs)

#### `GET /api/kpi-summary`
Returns top-level metric cards for the specified fleet scope.
* **Query Parameters**:
  * `scope` (`string`, **Required**): One of `all`, `Bus`, `Truck`, `customers`.
  * `start_date` (`YYYY-MM-DD`, Optional): Date filter start.
  * `end_date` (`YYYY-MM-DD`, Optional): Date filter end.
* **Sample Response (200 OK)**:
```json
{
  "scope": "all",
  "fleet_size": 40,
  "avg_daily_km": 198.4,
  "utilization_rate_pct": 74.2,
  "availability_rate_pct": 82.5,
  "total_km_driven": 238050.0,
  "active_days_total": 890,
  "tenure_days_total": 1200,
  "fleet_breakdown": "20 Buses (2 Accounts) • 20 Trucks (3 Accounts)"
}
```

---

### 5.3 Customer Analytics

#### `GET /api/customers/analytics`
Delivers comparative metrics across all enterprise accounts, box plot dispersion statistics, day-of-week profiles, and active availability timelines.
* **Query Parameters**:
  * `start_date` (`YYYY-MM-DD`, Optional).
  * `end_date` (`YYYY-MM-DD`, Optional).
* **Sample Response (200 OK)**:
```json
{
  "customers_all": [
    {
      "customer_name": "FreshBus",
      "category": "Bus",
      "fleet_size": 10,
      "avg_daily_km": 284.5,
      "utilization_rate_pct": 88.2,
      "volatility_cv_pct": 14.1,
      "routes_description": "Guntur - Hyderabad, Guntur - Vizag"
    }
  ],
  "customers_top3": [...],
  "customer_box_data": {
    "FreshBus": [180.2, 240.5, 290.0, 310.4, 380.0],
    "ZingBus": [140.0, 195.0, 220.1, 260.0, 310.2]
  },
  "dow_labels": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  "dow_profiles": {
    "FreshBus": [270.1, 280.4, 285.0, 290.2, 295.0, 280.0, 260.5]
  },
  "active_timeline": {
    "dates": ["2026-08-09", "2026-08-10"],
    "customers": {
      "FreshBus": [1.0, 0.9]
    }
  }
}
```

#### `GET /api/customers/soh-odometer`
Returns latest battery State of Health and live odometer readings per vehicle for scatter visualization.
* **Query Parameters**: None (values represent latest live snapshot).
* **Sample Response (200 OK)**:
```json
[
  {
    "base_license_plate": "AP39WN7281",
    "customer": "FreshBus",
    "vehicle_type": "Bus",
    "soh_pct": 97.4,
    "odometer_km": 114520.0,
    "is_soh_dummy": false,
    "is_odometer_fault": false,
    "last_updated": "2026-10-06T03:00:00Z"
  }
]
```

---

### 5.4 Distance Cross-Tabulation Matrix

#### `GET /api/crosstab-matrix`
Generates the 200 km distance compartment distribution matrix showing the count of vehicles operating in each mileage band per calendar day.
* **Query Parameters**:
  * `customer` (`string`, Default: `"All"`): `"All"` or a customer name (`FreshBus`, `ZingBus`, `BillionE`, etc.).
  * `start_date` (`YYYY-MM-DD`, Optional).
  * `end_date` (`YYYY-MM-DD`, Optional).
* **Sample Response (200 OK)**:
```json
{
  "customer": "All",
  "dates": ["2026-08-09", "2026-08-10"],
  "bands": [
    {"name": "0 km (Idle)", "counts": [8, 6]},
    {"name": "1–200 km", "counts": [12, 14]},
    {"name": "201–400 km", "counts": [15, 16]},
    {"name": "401–600 km", "counts": [5, 4]},
    {"name": "600+ km", "counts": [0, 0]}
  ]
}
```

---

### 5.5 Vehicle Registry & Inspector

#### `GET /api/vehicles`
Returns the master roster of vehicles with individual performance metrics, active rates, and sparkline distance arrays.
* **Query Parameters**:
  * `category` (`string`, Default: `"all"`): `"all"`, `"Bus"`, or `"Truck"`.
  * `start_date` (`YYYY-MM-DD`, Optional).
  * `end_date` (`YYYY-MM-DD`, Optional).
* **Sample Response (200 OK)**:
```json
{
  "total_count": 40,
  "category": "all",
  "below_80_count": 9,
  "benchmark_mean_km_day": 215.3,
  "benchmark_mean_hrs_day": 7.4,
  "vehicles": [
    {
      "base_license_plate": "AP39WN7281",
      "customer": "FreshBus",
      "vehicle_type": "Bus",
      "vehicle_model": "A12.5C",
      "active_days": 28,
      "tenure_days": 30,
      "utilization_pct": 93.3,
      "avg_km_per_day": 341.2,
      "avg_hours_per_day": 9.8,
      "volatility_cv_pct": 12.4,
      "is_below_80": false,
      "daily_distance_history": [320.0, 345.5, 310.2]
    }
  ]
}
```

---

### 5.6 Vehicle Uptime & Export

#### `GET /api/uptime`
Returns day-by-day operational uptime classification for every vehicle across the fleet.
* **Query Parameters**:
  * `customer` (`string`, Optional): Filter by customer name.
  * `start_date` (`YYYY-MM-DD`, Optional).
  * `end_date` (`YYYY-MM-DD`, Optional).
* **Sample Response (200 OK)**:
```json
{
  "dates": ["2026-08-10", "2026-08-09"],
  "vehicles": [
    {
      "base_license_plate": "AP39WN7281",
      "customer": "FreshBus",
      "onboarding_date": "2026-06-01",
      "statuses": ["RAN_CONFIRMED", "RAN_CONFIRMED"]
    }
  ],
  "legend_general": {"RAN": "#2f9e44", "NOT_RUN": "#e03131", "NOT_SURE": "#f1c40f"},
  "legend_detailed": {...}
}
```

#### `GET /api/uptime/export`
Generates and streams an Openpyxl Excel workbook containing the full color-coded uptime matrix.
* **Query Parameters**: Same as `/api/uptime`.
* **Response Header**: `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.

---

## 6. Local Development & Operational Gotchas

### 6.1 Running the Backend Locally
```bash
# Terminal 1: Launch FastAPI with auto-reload
uv run uvicorn backend.main:app --reload --port 8000
```

### 6.2 Critical Developer Gotchas
1. **The `--reload` Trap**:
   Always launch uvicorn with the `--reload` flag during development. If started without `--reload`, editing files in `backend/` will **not** update the running process, causing phantom debugging cycles where code updates appear ignored.
2. **Date Truncation in Queries**:
   `backend/data_loader.py` deliberately filters `report_date < CURRENT_DATE('Asia/Kolkata')`. Today's date is always excluded because the vehicle's operating day is still ongoing. Including today results in artificial utilization dips on the dashboard.
3. **Cloud Run Container Memory**:
   The Cloud Run backend service is provisioned with 1GB of RAM. The in-memory cache holds ~15MB of DataFrame data, leaving ample headroom for concurrent pandas aggregations.

---

## 7. Summary & Next Steps

This document established the FastAPI backend architecture, caching mechanisms, runtime toggles, and exhaustive REST API endpoint contracts.

To inspect how mathematical metrics (utilization %, active days, volatility CV%) and React visualizations are implemented, continue to:  
👉 **[Document 04: Dashboard & Metric Dictionary](04-Dashboard-and-Metric-Dictionary)**
