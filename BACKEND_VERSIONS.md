# Backend & data versions

One place to see which backend/data version is where, what is in it, and
the commits behind it. Add a new entry at the top of **Versions** for every
change that alters the data the dashboard shows (new tables, a pipeline or
resolver fix, a re-backfill). UI-only changes don't need an entry.

Check what a running backend reads: `GET /api/health` returns
`utilization_api_table` and `odometer_resolved_table`.

## Where things stand (6 Oct 2026)

Onboarded 3 new customers (Purple Mobility, Enviiirowheels, Flytta) and 22 new vehicles (including 1 for AVG LOGISTICS). Dim tables and historical metrics updated in BigQuery, and backend deployed to Cloud Run.

| | Production |
|---|---|
| Code | `main` |
| Backend | Cloud Run `drivn-backend-00021-g6w` -- `BQ_UTILIZATION_API_TABLE=utilization_daily_api_v2`, `BQ_ODOMETER_RESOLVED_TABLE=odometer_daily_resolved_v2`. Confirmed via `GET /api/health`. |
| Daily jobs (IST) | 08:30 `drivn-ingest-daily`, 08:30 `drivn-soh-daily`, 09:00 `drivn-resolve-odometer` -- all redeployed to incorporate new customer tags & vehicles |
| Tables read (dashboard + billing) | `utilization_daily_api_v2`, `odometer_daily_resolved_v2`, plus `dim_vehicle` (98 vehicles), `dim_customer` (8 customers), `vehicle_mileage_soc`, `vehicle_soh_latest` |
| Excess-km billing | Terms synced for Flytta (12,000 km, 15 INR/km) and Enviiirowheels (17,083.33 km, 12 INR/km) |
| Data coverage | Full history backfilled for all 22 new vehicles (4,497 total resolved odometer rows through 5 Oct 2026) |

## Versions

### Onboarding: Purple Mobility, Enviiirowheels, Flytta (6 Oct 2026)

- **New Customers:** Purple Mobility (6 buses), Enviiirowheels (10 trucks), Flytta (5 trucks), plus HR55BE1725 added to AVG LOGISTICS.
- **Sync & Backfill:** `seed-dimensions` merged all 22 vehicles, pulled historical trips from Fleetx (April–October 2026), resolved odometer readings into `odometer_daily_resolved_v2`, and updated starting odometers.
- **Excess KM Terms:** Synced from `Excess KM & Battery Replacement.xlsx` into `dim_vehicle`.
- **Backend & Cloud Run:** `_CUSTOMER_REGISTRY` updated in `backend/metrics.py`, frontend types & color palette updated, and Cloud Run backend (`drivn-backend-00021-g6w`) + 3 scheduled ingestion jobs deployed.

### v2 — IST query window (29 Sep 2026)

- **Commits:** `6b90b89` (fix + test), `3458852` (`/api/health` table
  names), `03759ba` (resolver: 1,500 km/day, 1.5M km cap), `b92f776`
  (excess km billing). Merged to `main` (fast-forward from `f439e54`).
- **Fix:** `api_pipeline._to_epoch_ms` builds the Fleetx `/trips/` window at
  IST midnight. It used the host clock, so on Cloud Run (UTC) each day's
  window ran 05:30–05:30 IST and overnight trips ending before 05:30 IST
  were dropped from every day.
- **Deployed:** `drivn-ingest-daily` and `drivn-backend-00019-49g` from
  `3458852`; new job `drivn-resolve-odometer` (09:00 IST daily, trigger
  `drivn-resolve-odometer-trigger`) from `b92f776`. Before this the
  resolver only ran when someone ran it by hand.
- **Data:** `utilization_daily_api_v2` re-fetched from Fleetx for
  7 Apr – 28 Sep 2026; `odometer_daily_resolved_v2` rebuilt from it with the
  resolver from `03759ba` (`resolver_version` 2.0.0, same as v1's).
- **Difference from v1:** [versions/v2_ist_window_diff.md](versions/v2_ist_window_diff.md)
  (only 21–28 Sep changes; August identical).
- **Pending:** copy the `_v2` tables over the production tables (back them
  up first) so 21–28 Sep is corrected on the live dashboard. Do it before
  a daily ingest runs, or re-ingest from 29 Sep afterwards.
- **Not in this version:** DL1PD8669's odometer counter reset (25 Sep) is
  uncorrected; the SoH vs odometer chart still shows ~2,400 km for it.

### v1 — before 29 Sep 2026

- **Commits:** backend `drivn-backend-00018-qdz`, deployed 28 Sep 16:37 IST
  from the working tree just before `14a6514` was committed at 16:44
  (Cloud Run source deploys record no commit hash).
- **Tables:** `utilization_daily_api` (bulk backfill 7 Apr – 20 Sep loaded
  22 Sep; then one day per night by `drivn-ingest-daily`),
  `odometer_daily_resolved` (rebuilt 29 Sep with the resolver that is now
  `03759ba`: 1,500 km/day rule, 1.5M km cap).
- **Backend env:** `UTILIZATION_SOURCE=api`, `DISTANCE_SOURCE=odometer`.
- **Known issue:** days loaded by the Cloud Run job (21 Sep onward) miss
  overnight trips; fixed in v2.

## Milestones before versioning

| Date | Commit | Change |
|---|---|---|
| 28 Sep 2026 | `14a6514` | SoH vs odometer chart (`vehicle_soh_latest`, `drivn-soh-daily`) |
| 24 Sep 2026 | `9b5e8b5` | Tag-driven `dim_vehicle`/`dim_customer` sync with auto-backfill |
| 24 Sep 2026 | `f758cfe` | Odometer resolver (`odometer_daily_resolved`), `DISTANCE_SOURCE` |
| 22 Sep 2026 | `391e8d5` | `utilization_daily_api` daily ingestion made safe to re-run |
| 18 Sep 2026 | `a916c98` | Dashboard excludes today (IST) |
| 17 Sep 2026 | `be5b04c` | Backend source switchable, Excel → API (`UTILIZATION_SOURCE`) |
| 17 Sep 2026 | `31ecbc0` | Fleetx API pipeline added alongside Excel |
| 11 Sep 2026 | `c4a83d8` | FastAPI backend on BigQuery |
| 11 Sep 2026 | `571a99a` | BigQuery ingestion pipeline (Excel) |
