# Document 02: Data Pipeline & Warehouse Specification

**Target Platform:** Drivn Commercial EV Telematics Platform  
**Repository:** `gcpdrivn/telematics-analytics-dashboard-drivn`  
**Classification:** Core Engineering Handover  
**Document Status:** Production Reference  

---

## 1. Executive Overview & Pipeline Architecture

The **Drivn Data Pipeline & Warehouse Layer** is responsible for transforming raw, heterogeneous, and often noisy IoT telematics feeds into clean, reconciled, audit-ready data models in Google BigQuery. 

Originally developed as an offline batch Excel processor, the platform has evolved into an **automated API-driven ELT pipeline** scheduled through Google Cloud Run Jobs and Cloud Scheduler in `asia-south1` (Mumbai).

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   DATA INGESTION SOURCES                               │
│  • Fleetx REST API: /trips/ (Daily historical trips summary)                           │
│  • Fleetx Realtime API: /api/v1/analytics/live (State-of-Health & live odometer)       │
│  • Excel Workbooks: Vehicle Update Uploader, Master Dimensions, Excess KM Terms        │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              TRANSFORMATION & CLEANSING                                │
│  • Timestamp Localization: Strict IST (00:00:00 to 23:59:59 IST) epoch conversion      │
│  • Hardware De-duplication: Multi-unit CAM resolution (drop auxiliary DashCam)         │
│  • Composite Key Uniqueness: Deduplication on (base_license_plate, report_date)        │
│  • Asset Clubbing: Map raw 'Heavy Puller' to 'Truck'                                   │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                           ODOMETER RECONCILIATION ENGINE                               │
│  • Row Sanitization: Null overflow sentinels (2,097,151.88 km) and garbage (>1.5M km)   │
│  • Frozen Counter Detection: Recognize frozen odometers and catch-up jumps             │
│  • Boundary Gap Computation: Attribute inter-day and silent-day driven kilometers       │
│  • Waterfall Interpolation: Distance-weighted bracket distribution                     │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                         ANALYTICAL STORAGE (BigQuery asia-south1)                      │
│  • Fact Tables:    utilization_daily_api_v2, odometer_daily_resolved_v2                │
│  • Snapshot:       vehicle_soh_latest                                                  │
│  • Dimensions:     dim_vehicle, dim_customer, vehicle_mileage_soc                      │
│  • Billing Views:  excess_km_monthly, excess_km_monthly_customer                       │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. BigQuery Warehouse Schema Specifications

All tables reside in GCP project `drivn-project-1` under the dataset `telematics` located in region `asia-south1`.

### 2.1 Table: `utilization_daily_api_v2` (Primary Fact Table)
Stores daily aggregated telemetry per vehicle. Partitioned by `report_date`.

| Field Name | Type | Mode | Description |
|:---|:---|:---|:---|
| `base_license_plate` | `STRING` | `REQUIRED` | Cleaned registration plate with hardware suffixes stripped. Primary Join Key. |
| `report_date` | `DATE` | `REQUIRED` | Calendar date of telemetry window (IST). **Partitioning Column**. |
| `distance_km` | `FLOAT64` | `NULLABLE` | Total GPS distance driven on that date in kilometers. |
| `running_time_hours` | `FLOAT64` | `NULLABLE` | Total duration vehicle was ignition ON and moving. |
| `opening_odometer` | `FLOAT64` | `NULLABLE` | Start-of-day cumulative vehicle odometer reading in km. |
| `closing_odometer` | `FLOAT64` | `NULLABLE` | End-of-day cumulative vehicle odometer reading in km. |
| `max_speed` | `FLOAT64` | `NULLABLE` | Maximum instantaneous speed recorded in km/h. |
| `average_speed` | `FLOAT64` | `NULLABLE` | Harmonic/arithmetic mean speed while moving in km/h. |
| `stoppages_count` | `INT64` | `NULLABLE` | Count of discrete stop events during the day. |
| `gps_disconnection_count`| `INT64` | `NULLABLE` | Count of GPS hardware disconnection alarms. |
| `avg_daily_operating_hours`| `FLOAT64`| `NULLABLE` | Running operating hours reported by vendor. |
| `start_location` | `STRING` | `NULLABLE` | Address of first movement event. |
| `end_location` | `STRING` | `NULLABLE` | Address of final trip completion event. |
| `start_date` | `TIMESTAMP` | `NULLABLE` | Start timestamp of first trip (UTC). |
| `end_date` | `TIMESTAMP` | `NULLABLE` | End timestamp of final trip (UTC). |
| `vehicle_name` | `STRING` | `NULLABLE` | Short fleet internal code (e.g. `'7281'`). |
| `vehicle_type` | `STRING` | `NULLABLE` | Normalized asset type (`'Bus'` or `'Truck'`). |
| `vehicle_maker` | `STRING` | `NULLABLE` | Vehicle OEM / body manufacturer. |
| `vehicle_model` | `STRING` | `NULLABLE` | Chassis model identifier. |
| `group_name` | `STRING` | `NULLABLE` | Hardware device group from Fleetx. |
| `license_plate_raw` | `STRING` | `NULLABLE` | Raw identifier as reported (e.g. `'AP39WN7281_CAM'`). |
| `source_file_name` | `STRING` | `REQUIRED` | Origin identifier (e.g. `'fleetx_api'`). |
| `source_file_hash` | `STRING` | `REQUIRED` | Execution hash or SHA-256 for dedup tracking. |
| `ingested_at` | `TIMESTAMP` | `REQUIRED` | UTC ingestion timestamp. |

---

### 2.2 Table: `odometer_daily_resolved_v2` (Derived Reconciliation Fact)
One row per `(base_license_plate, report_date)`. Contains sanitized and backfilled odometer readings generated by `ingestion/odometer_resolver.py`.

| Field Name | Type | Mode | Description |
|:---|:---|:---|:---|
| `base_license_plate` | `STRING` | `REQUIRED` | Foreign key to `dim_vehicle`. |
| `report_date` | `DATE` | `REQUIRED` | Calendar date (IST). |
| `distance_by_odometer` | `FLOAT64` | `NULLABLE` | Reconciled distance driven (`closing_clean - opening_clean`, or fallback). |
| `distance_reported` | `FLOAT64` | `NULLABLE` | Original `distance_km` from raw telemetry for comparison. |
| `opening_odometer_clean`| `FLOAT64` | `NULLABLE` | Calibrated start-of-day odometer reading. |
| `closing_odometer_clean`| `FLOAT64` | `NULLABLE` | Calibrated end-of-day odometer reading. |
| `opening_odometer_raw` | `FLOAT64` | `NULLABLE` | Unmodified start-of-day odometer reading before nulling. |
| `closing_odometer_raw` | `FLOAT64` | `NULLABLE` | Unmodified end-of-day odometer reading before nulling. |
| `boundary_gap_distance`| `FLOAT64` | `NULLABLE` | Odometer kilometers accumulated between this day's opening and prior day's closing. |
| `fill_method` | `STRING` | `REQUIRED` | Resolution category: `RAW_VALID`, `INTERPOLATED`, `DISTANCE_FALLBACK`, `MANUAL_OVERRIDE`, `UNRESOLVED`. |
| `confidence` | `STRING` | `REQUIRED` | Audit tier: `High`, `Medium`, `Low`, `Unresolved`. |
| `anomaly_flags` | `REPEATED STRING` | `REPEATED` | Flags detected: `overflow_sentinel`, `missing_reading`, `non_monotonic`, `physically_implausible`, `frozen_odometer`. |
| `notes` | `STRING` | `NULLABLE` | Explanatory derivation note (e.g. anchors used). |
| `source_table` | `STRING` | `REQUIRED` | Upstream table (e.g. `'utilization_daily_api_v2'`). |
| `resolver_version` | `STRING` | `REQUIRED` | Code version (`2.1.0`). |
| `resolved_at` | `TIMESTAMP` | `REQUIRED` | Resolution run timestamp. |

---

### 2.3 Table: `dim_vehicle` (Vehicle Master Dimension)
Maintained via `ingestion/seed_dimensions.py`. Uses atomic BigQuery `MERGE` statements and retains 30-day backup table snapshots before every update.

| Field Name | Type | Mode | Description |
|:---|:---|:---|:---|
| `base_license_plate` | `STRING` | `REQUIRED` | Primary key registration number. |
| `customer_name` | `STRING` | `REQUIRED` | Operating customer (FreshBus, ZingBus, BillionE, etc.). |
| `oem` | `STRING` | `NULLABLE` | Manufacturer (Azad, JBM, Tata). |
| `vehicle_type` | `STRING` | `NULLABLE` | Canonical asset class (`Bus` or `Truck`). |
| `vehicle_model` | `STRING` | `NULLABLE` | Chassis designation (e.g. `A12.5C`). |
| `device_installation_date`| `DATE` | `NULLABLE` | Physical telematics hardware installation date. |
| `fleetx_id` | `INT64` | `NULLABLE` | Internal Fleetx numerical vehicle ID. |
| `starting_odometer` | `FLOAT64` | `NULLABLE` | First valid historical odometer reading prior to Drivn telemetry. |
| `is_active` | `BOOL` | `NULLABLE` | Soft delete flag (`FALSE` if dropped from vendor export). |
| `first_seen_at` | `TIMESTAMP` | `NULLABLE` | Timestamp vehicle was onboarded. |
| `deactivated_at` | `TIMESTAMP` | `NULLABLE` | Timestamp vehicle was marked inactive. |
| `monthly_available_km` | `FLOAT64` | `NULLABLE` | Contractual monthly distance allowance (km). |
| `excess_km_rate` | `FLOAT64` | `NULLABLE` | Contractual excess rate in INR/km. |

---

### 2.4 Table: `vehicle_soh_latest` (Morning Battery Health Snapshot)
Single row per vehicle storing the latest live State of Health and live odometer reading from Fleetx.

| Field Name | Type | Mode | Description |
|:---|:---|:---|:---|
| `base_license_plate` | `STRING` | `REQUIRED` | Primary key. |
| `soh_pct` | `FLOAT64` | `NULLABLE` | Battery State of Health percentage (e.g. `98.4`). |
| `soh_field` | `STRING` | `NULLABLE` | Telematics attribute name (`evSOH`, `batterySoh`, `soh`). |
| `soh_reported_at` | `TIMESTAMP` | `NULLABLE` | Vendor telemetry timestamp for the SoH reading. |
| `odometer_km` | `FLOAT64` | `NULLABLE` | Accepted live odometer reading. |
| `odometer_raw_km` | `FLOAT64` | `NULLABLE` | Raw reading as transmitted (including rejected values). |
| `odometer_flag` | `STRING` | `NULLABLE` | Reason latest reading was rejected (if applicable). |
| `odometer_reported_at` | `TIMESTAMP` | `NULLABLE` | Vendor timestamp for odometer reading. |
| `fleetx_device` | `STRING` | `NULLABLE` | Reporting hardware identifier (e.g. `'DL1PD8509OBD'`). |
| `fleetx_vehicle_id` | `INT64` | `NULLABLE` | Numerical Fleetx ID. |
| `first_seen_at` | `TIMESTAMP` | `REQUIRED` | Initial discovery timestamp. |
| `last_pinged_at` | `TIMESTAMP` | `REQUIRED` | Latest successful ping timestamp. |

---

## 3. The Daily API Ingestion Pipeline (`ingestion/api_pipeline.py`)

### 3.1 Execution Schedule & Triggers
The production pipeline executes daily via **Google Cloud Scheduler** and **Cloud Run Jobs**:
* **Job Name**: `drivn-ingest-daily`
* **Trigger**: `drivn-ingest-daily-trigger`
* **Cron Schedule**: `30 3 * * *` (UTC) = **08:30 AM IST**
* **Container Entrypoint**: `uv run ingest-utilization-api`

### 3.2 Timezone Formulation: The IST Window Rule
Fleetx APIs accept millisecond epoch timestamps for query parameters `from` and `to`. 
Because Drivn reports are defined strictly on Indian Standard Time calendar days, the query window is constructed via:

```python
IST = ZoneInfo("Asia/Kolkata")

def _to_epoch_ms(d: dt.date) -> int:
    return int(dt.datetime.combine(d, dt.time.min, tzinfo=IST).timestamp() * 1000)
```

> [!IMPORTANT]
> **Post-Mortem Note (v1 to v2 Bug Fix)**:
> In v1, python's default local time was used. When executed inside Cloud Run containers (which run in UTC), `dt.datetime.combine(d, dt.time.min).timestamp()` produced a window spanning `05:30 IST to 05:30 IST`. Any trip ending between midnight and 05:30 AM IST was dropped. The v2 pipeline explicitly binds `ZoneInfo("Asia/Kolkata")`.

### 3.3 Token Lifecycle & Auto-Refresh
When ingesting large fleets across extended timeframes, Fleetx bearer tokens may expire mid-execution (HTTP 401). `ingestion/api_pipeline.py` implements transparent re-authentication:
```python
def _fetch_trips_relogin_once(token: str, fleetx_id: int, from_ms: int, to_ms: int):
    try:
        return fleetx_client.get_trips(token, fleetx_id, from_ms, to_ms), token
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 401:
            token = fleetx_client.login()
            return fleetx_client.get_trips(token, fleetx_id, from_ms, to_ms), token
        raise
```

### 3.4 Scoped Idempotent Upsert
To avoid duplicate rows and enable safe partial reruns, `bq_client.load_utilization_api_rows()` enforces a scoped delete-and-replace:
1. Deletes existing rows in BigQuery matching `base_license_plate IN (...)` and `report_date BETWEEN start_date AND (end_date + 1 day)`.
2. Inserts newly aggregated rows in a single batch load job.
3. If an individual vehicle fetch fails, its existing BigQuery rows are **preserved**, preventing partial network drops from wiping out historical data.

---

## 4. Odometer Resolution & Backfill Engine (`ingestion/odometer_resolver.py`)

Raw IoT odometers suffer from several real-world telemetry failures:
* Firmware 21-bit counter rollover (`2,097,151.88 km`).
* Multi-million kilometer garbage magnitudes (e.g. `100,000,514 km`).
* Instrument cluster replacements causing counters to drop to near zero.
* Frozen odometers where the counter repeats the exact same opening reading for days before taking a massive catch-up jump.

### 4.1 Global Physical Constants
```python
RESOLVER_VERSION = "2.1.0"
OVERFLOW_SENTINEL_KM = 2097151.88      # 2**21 - 1 firmware bug
GARBAGE_ABS_THRESHOLD_KM = 1_500_000.0  # 15 Lakh km absolute cap
MAX_KM_PER_DAY = 1500.0                # Physical daily EV distance ceiling
FROZEN_TOLERANCE_KM = 1.0              # Identity threshold for frozen counters
```

### 4.2 The Resolution Waterfall

```
┌────────────────────────────────────────────────────────┐
│ Raw Odometer Telemetry (Opening & Closing)             │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ 1. Row Sanitization & Sentinel Rejection               │
│    • Null if value == OVERFLOW_SENTINEL_KM             │
│    • Null if value > 1,500,000 km or value < 0         │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ 2. Frozen Counter Detection (_mark_frozen_stretches)   │
│    • Detect 2+ days repeating same Opening Odometer    │
│    • Flag as 'frozen_odometer' and mark non-raw-valid  │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ 3. Row Classification                                  │
│    Is delta >= 0 AND delta < 1,500 km/day?             │
│         ├── YES ──▶ fill_method = 'RAW_VALID' (High)   │
│         └── NO  ──▶ Proceed to Waterfall Backfill      │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ 4. Waterfall Backfill Engine                           │
│    • Bracketed between two RAW_VALID anchors?          │
│      ├── Single bad day: INTERPOLATED (High)           │
│      └── Multi bad days: Weighted INTERPOLATED (Medium)│
│    • Anchor on only ONE side?                          │
│      └── Walk backward/forward using reported Distance │
│          fill_method = 'DISTANCE_FALLBACK' (Low)       │
│    • No anchors exist?                                 │
│      └── Use reported Distance directly (Low)          │
└────────────────────────────────────────────────────────┘
```

### 4.3 Classification States & Confidence Matrix

| `fill_method` | `confidence` | When Applied | Downstream Treatment |
|:---|:---|:---|:---|
| `RAW_VALID` | `High` | Clean telemetry passing all monotonicity and boundary checks. | Billed at 100% in excess-km; fully trusted. |
| `INTERPOLATED` | `High` / `Medium` | Bad reading bracketed by clean anchors before and after (distributed via reported distance weights). | Billed at 100% in excess-km; fully trusted. |
| `MANUAL_OVERRIDE`| `High` | Administrator-supplied ground truth values. | Billed at 100%; never overwritten by automated runs. |
| `DISTANCE_FALLBACK`| `Low` | Unanchored bad day; uses GPS `Distance` as last-resort substitute. | **Excluded from billable odometer**; triggers `needs_review` flag if coverage $<90\%$. |
| `UNRESOLVED` | `Unresolved` | Both odometer reading and GPS distance are missing. | Zero kilometers credited; counts as silent downtime. |

---

## 5. Morning Battery Health Snapshot (`ingestion/soh_snapshot.py`)

* **Execution**: Daily at **08:30 AM IST** (`drivn-soh-daily`).
* **Source**: `GET https://api.fleetx.io/api/v1/analytics/live`.
* **Hardware Arbitration**: If a vehicle has multiple devices reporting in Fleetx:
  1. Devices with `-CAM` or `DashCam` are filtered out.
  2. Of the remaining units, the device reporting an active battery SoH takes precedence.
  3. Both SoH and live odometer are read from this primary device.
* **Fault Handling**:
  * **Flat 100% Default**: Certain truck hardware units transmit a hardcoded `100.0%` default. The pipeline records `soh_field = 'soh'`, allowing frontend charts to render these points as hollow warning nodes.
  * **Odometer Rollback**: If the live odometer drops by $>1\%$ relative to the vehicle's historical maximum, the new reading is rejected, and the previous valid odometer is preserved (`odometer_flag = 'backward_by_...'`).

---

## 6. Dimension Management & Master Data Sync (`seed-dimensions`)

Dimensions are managed in `ingestion/dimension_sync.py` and `ingestion/seed_dimensions.py`.

### 6.1 Customer Tag Mapping (`CUSTOMER_TAGS`)
Vehicles are attributed to customers via Fleetx device tags:
```python
CUSTOMER_TAGS = {
    "FRESHBUS": "FreshBus",
    "ZINGBUS": "ZingBus",
    "BILLION ELECTRIC MOBILITY": "BillionE",
    "BILLIONE": "BillionE",
    "AVG LOGISTICS": "AVG LOGISTICS",
    "SWITCHLABS": "SWITCHLABS",
}
```

### 6.2 Precedence Hierarchy
When populating metadata (`oem`, `vehicle_type`, `vehicle_model`, `device_installation_date`), values resolve in strict order:

> **Resolution Priority:**  
> **1. Manual Master Sheet** (`dim_vehicle_master.xlsx`) → **2. Existing BigQuery Value** → **3. Derived Telemetry Value**

A filled-in value is **never replaced by a blank or a guess**.

### 6.3 Safe Execution Workflow
1. **Preview Plan**: Generates an interactive diff showing all additions, updates, deactivations, and customer reassignments.
2. **Interactive Confirmation**: Requires an explicit `yes` confirmation before executing BigQuery writes (can bypass with `--yes` in scripts).
3. **Table Snapshot Backup**: Creates 30-day BigQuery clones (`dim_vehicle_backup_<timestamp>`).
4. **Atomic MERGE**: Updates and inserts rows in a single atomic SQL transaction.
5. **Auto-Backfill & Cache Refresh**: For every newly added vehicle, pulls full historical trips from Fleetx, resolves odometers, and clears Cloud Run's in-process cache via `POST /api/admin/refresh-cache`.

---

## 7. Excess-KM Billing Pipeline & SQL Views (`ingestion/excess_km.py`)

Excess KM calculations compute whether a vehicle exceeded its contracted monthly allowance and assess penalties.

### 7.1 Contractual Parameters
Loaded from `data/raw/Excess KM & Battery Replacement.xlsx`:
* `monthly_available_km`: Monthly distance threshold per vehicle (e.g. 10,000 km).
* `excess_km_rate`: Overage penalty rate in INR per km (e.g. ₹28.5/km).

### 7.2 BigQuery View: `excess_km_monthly`
Computes monthly billable mileage per vehicle for completed calendar months:

$$
\text{Billable KM} = \sum \text{Odometer KM (Trusted Days)} + \sum \text{Gap KM (Trusted Silent Gaps)}
$$

$$
\text{Excess KM} = \max\left(0, \; \text{Billable KM} - \text{Contractual Monthly Allowance}\right)
$$

$$
\text{Excess Cost (INR)} = \text{Excess KM} \times \text{Excess Rate (INR/km)}
$$

### 7.3 Financial Audit Flags (`needs_review`)
A vehicle's monthly bill is automatically flagged with `needs_review = TRUE` in two scenarios:
1. **Low Coverage**: Less than **90%** of its in-service days are supported by trusted readings (`reliable_coverage < 0.90`).
2. **Odometer Divergence**: The total odometer kilometers differ from reported GPS distance by more than **15%** over the same period ($|\text{ratio} - 1.0| > 0.15$).

---

## 8. Pipeline Command-Line (CLI) Reference

All pipeline tasks are executable via the `uv` virtual environment runner.

### 8.1 Daily & Ingestion Commands

```bash
# Ingest yesterday's trips from Fleetx API (Daily Production Job)
uv run ingest-utilization-api

# Ad-hoc backfill for a custom date range
uv run ingest-utilization-api --from 2026-08-01 --to 2026-08-31

# Ad-hoc pull for a single vehicle plate
uv run ingest-utilization-api --plate AP39WN7281 --from 2026-09-01 --to 2026-09-10

# Test run without writing to BigQuery
uv run ingest-utilization-api --dry-run -v

# Run the morning battery SoH & live odometer snapshot
uv run ingest-soh

# Legacy: Ingest daily Excel reports dropped into data/raw/utilization/
uv run ingest-utilization
```

### 8.2 Reconciliation & Dimensions

```bash
# Rebuild full-history odometer resolution table (Daily Production Job)
uv run resolve-odometer

# Preview odometer resolution statistics without writing
uv run resolve-odometer --dry-run

# Preview and sync vehicle & customer dimensions from Fleetx uploader
uv run seed-dimensions --dry-run

# Execute dimension sync (prompts for confirmation, takes backup, runs backfill)
uv run seed-dimensions

# Pull full history for specific newly onboarded vehicles
uv run backfill-vehicles HR55BE2131 DL01PD9317
```

### 8.3 Excess KM Billing

```bash
# Preview contract term updates from Excel into dim_vehicle
uv run sync-excess-km --dry-run

# Apply contract terms and recreate BigQuery billing views
uv run sync-excess-km

# Export last completed month's billing workbook to data/exports/
uv run export-excess-km

# Export a specific historical month
uv run export-excess-km --month 2026-08
```

---

## 9. Summary & Next Steps

This document specified the BigQuery schemas, ingestion mechanics, odometer reconciliation algorithms, dimension sync procedures, and excess-km billing logic.

To inspect how the FastAPI backend queries, caches, and serves this data to the frontend, continue to:  
👉 **[Document 03: Backend Service & API Technical Reference](03-Backend-Service-and-API-Technical-Reference)**
