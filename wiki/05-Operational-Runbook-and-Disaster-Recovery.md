# Document 05: Operational Runbook & Disaster Recovery

**Target Platform:** Drivn Commercial EV Telematics Platform  
**Repository:** `gcpdrivn/telematics-analytics-dashboard-drivn`  
**Classification:** Core Engineering Handover  
**Document Status:** Production Reference  

---

## 1. Executive Summary & Operational Topology

The **Drivn Operational Runbook** provides on-call engineers, devops personnel, and system maintainers with procedures for routine administration, deployments, monitoring, troubleshooting, and disaster recovery.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               OPERATIONAL INFRASTRUCTURE                               │
│                                                                                        │
│  • Google Cloud Platform: Project `drivn-project-1`, Region `asia-south1` (Mumbai)     │
│  • Netlify: Static CDN host for frontend (Auto-deployed from `main`)                   │
│  • Google Cloud Run: Container host for FastAPI backend (Manual deploy via gcloud)     │
│  • Cloud Run Jobs: Three scheduled container jobs for ingestion and reconciliation     │
│  • Cloud Scheduler: Three cron triggers firing in IST timezone                         │
│  • Cloud Secret Manager: Holds Fleetx API credentials                                  │
│  • BigQuery: Analytical warehouse with automatic 30-day snapshot backups               │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Production Identifiers Directory

| Resource Description | Identifier / URL / Name | Operational Notes |
|:---|:---|:---|
| **GCP Project** | `drivn-project-1` | Primary Google Cloud project. |
| **GCP Region** | `asia-south1` | All services, jobs, and BigQuery datasets reside in Mumbai. |
| **BigQuery Dataset** | `telematics` | Production dataset containing `*_v2` tables and views. |
| **Cloud Run API Service** | `drivn-backend` | Active FastAPI container service. |
| **Backend Stable URL** | `https://drivn-backend-304868514241.asia-south1.run.app` | Target configured in `netlify.toml` proxy. |
| **Backend Service Account** | `fleet-intelligence-backend@drivn-project-1.iam.gserviceaccount.com` | Roles: `bigquery.dataViewer`, `bigquery.jobUser`. |
| **Ingestion Service Account** | `drivn-ingestion-job@drivn-project-1.iam.gserviceaccount.com` | Roles: `bigquery.dataEditor`, `bigquery.jobUser`, `run.invoker`, `secretmanager.secretAccessor`. |
| **Netlify Production Site** | `https://drivn-fleet-intelligence.netlify.app` | Public production dashboard. |
| **GitHub Repository** | `gcpdrivn/telematics-analytics-dashboard-drivn` | Primary Git repository. |
| **GCP Billing Account** | `0171D6-8AABC0-333680` | ₹10,000/month budget alert set at 50%, 90%, 100%. |

---

## 2. Deploying Changes: Automatic vs. Manual Workflows

A common operational misunderstanding is assuming that pushing code to GitHub deploys the entire application. **It does not.**

```
Developer pushes to `main` branch
       │
       ├──▶ Frontend changes (`frontend/**`): Auto-deployed to Netlify (1-2 mins)
       │
       └──▶ Backend / Ingestion (`backend/**`, `ingestion/**`, `Dockerfile`):
            NO AUTOMATIC DEPLOYMENT! Requires manual `gcloud` CLI command.
```

### 2.1 Frontend Deployments (Automatic)
* Any commit pushed to the `main` branch that touches `frontend/**` triggers Netlify's continuous integration build automatically.
* Verification: Check Netlify Dashboard or verify [drivn-fleet-intelligence.netlify.app](https://drivn-fleet-intelligence.netlify.app).
* Build command executed by Netlify: `tsc -b && vite build`.

### 2.2 Backend Service Deployments (Manual via `gcloud`)
Any code changes to `backend/`, `Dockerfile`, or `pyproject.toml` require explicit redeployment using Cloud Build:

```bash
# Ensure gcloud CLI is authenticated and configured
cd /home/yogesh/Desktop/Drivn/telematics-analytics-dashboard-drivn

# Deploy to Cloud Run (Takes 1-3 minutes)
gcloud run deploy drivn-backend \
  --source . \
  --region asia-south1 \
  --quiet
```

* Cloud Run keeps the old container revision serving traffic until the new revision passes its startup health check, guaranteeing **zero downtime**.
* Redeploying the container **automatically purges all in-memory caches**.
* Verify deployment success:
  ```bash
  curl -s https://drivn-backend-304868514241.asia-south1.run.app/api/health
  ```

### 2.3 Scheduled Ingestion Jobs Deployments (Manual via `gcloud`)
If modifications are made to `ingestion/` logic, the three Cloud Run Jobs must be redeployed so their container images are updated:

```bash
# Redeploy the 08:30 daily trips ingestion job
gcloud run jobs deploy drivn-ingest-daily --source . --region asia-south1 --quiet

# Redeploy the 08:30 morning battery SoH job
gcloud run jobs deploy drivn-soh-daily --source . --region asia-south1 --quiet

# Redeploy the 09:00 daily odometer reconciliation job
gcloud run jobs deploy drivn-resolve-odometer --source . --region asia-south1 --quiet
```

---

## 3. Daily Scheduled Operations & Monitoring Checklist

Every morning between 08:30 and 09:05 AM IST, three automated jobs execute in sequence:

| Job Name | Schedule (IST) | Trigger Name | Purpose | Output Table |
|:---|:---|:---|:---|:---|
| `drivn-ingest-daily` | `08:30 AM` | `drivn-ingest-daily-trigger` | Pulls yesterday's Fleetx trips | `utilization_daily_api_v2` |
| `drivn-soh-daily` | `08:30 AM` | `drivn-soh-daily-trigger` | Pings Realtime API for SoH | `vehicle_soh_latest` |
| `drivn-resolve-odometer` | `09:00 AM` | `drivn-resolve-odometer-trigger` | Reconciles odometers & gaps | `odometer_daily_resolved_v2` |

### 3.1 Daily Health Check Routine (09:15 AM IST)
Run these commands to confirm that today's ingestion and odometer runs succeeded:

```bash
# 1. Check latest execution status of the three jobs
gcloud run jobs executions list --job drivn-ingest-daily --region asia-south1 --limit 1
gcloud run jobs executions list --job drivn-soh-daily --region asia-south1 --limit 1
gcloud run jobs executions list --job drivn-resolve-odometer --region asia-south1 --limit 1

# 2. Check the logs of the ingestion job if status != Succeeded
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="drivn-ingest-daily"' \
  --limit 50 --freshness 1d --format="value(textPayload)"

# 3. Check health and active table pointers on the live API
curl -s https://drivn-backend-304868514241.asia-south1.run.app/api/health | jq .
```

### 3.2 Triggering an Immediate On-Demand Execution
If a scheduled run fails due to third-party vendor downtime or network errors, trigger it manually via CLI:

```bash
# Execute job and wait for completion in terminal
gcloud run jobs execute drivn-ingest-daily --region asia-south1 --wait
gcloud run jobs execute drivn-resolve-odometer --region asia-south1 --wait

# Refresh the dashboard cache immediately
curl -X POST https://drivn-backend-304868514241.asia-south1.run.app/api/admin/refresh-cache
```

---

## 4. Operational Runbooks for Routine Maintenance

### Runbook A: Onboarding a New Vehicle or Updating Customer Tags
When a new EV bus or truck joins the fleet:
1. **Tag in Fleetx**: Ensure the vehicle is tagged with its customer name in the Fleetx portal (must match tags in `ingestion/dimension_sync.py`'s `CUSTOMER_TAGS`).
2. **Download Export**: Download the fresh vehicle uploader export and save as `data/raw/Vehicle_Update_uploader.xlsx`.
3. **Execute Sync**:
   ```bash
   # Preview the changes (shows added plates, deactivations, and customer tags)
   uv run seed-dimensions --dry-run

   # Apply changes (prompts for confirmation, takes backup, runs backfill)
   uv run seed-dimensions
   ```
4. **Automated Actions**: `seed-dimensions` automatically:
   * Takes a 30-day table snapshot backup.
   * Merges changes into `dim_vehicle`.
   * Pulls the vehicle's full historical trips from Fleetx (`vehicle_backfill.py`).
   * Rebuilds `odometer_daily_resolved_v2`.
   * Calls `POST /api/admin/refresh-cache` on Cloud Run so the vehicle appears on the dashboard immediately.

### Runbook B: Monthly Contractual Excess-KM Billing
Execute this procedure at the close of every calendar month:
1. **Sync Terms**: If contract terms or allowances changed, update `data/raw/Excess KM & Battery Replacement.xlsx` and run:
   ```bash
   uv run sync-excess-km
   ```
2. **Export Billing Statements**:
   ```bash
   # Generates data/exports/excess_km_<YYYY-MM>.xlsx for the last completed month
   uv run export-excess-km

   # Or export a specific historical month
   uv run export-excess-km --month 2026-09
   ```
3. **Verify Flags**: Open the generated workbook and check the `Summary` sheet for any vehicles tagged `needs_review = TRUE`. Inspect the `Daily Readings` sheet to review days with unverified telemetry or odometer discrepancies.

---

## 5. Disaster Recovery & Data Rollback Procedures

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              DISASTER RECOVERY ESCALATION                              │
│                                                                                        │
│  Data Corruption Scenario ──▶ Tier 1: Restore from Table Snapshot (Up to 30 days)      │
│                           ──▶ Tier 2: BigQuery System Time Travel (Up to 7 days)       │
│                           ──▶ Tier 3: Full Reprocessing from Raw API Feeds             │
│                                                                                        │
│  Bad Deployment Scenario  ──▶ Roll back Cloud Run revision traffic instantly           │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 5.1 Reverting BigQuery Tables from Snapshot Backups
Before any destructive mutation (e.g. `seed-dimensions`, `sync-excess-km`), the pipeline creates a table clone timestamped with the current date:
`telematics.dim_vehicle_backup_<YYYYMMDDTHHMMSSZ>`.

To restore a table from its snapshot:
```sql
-- Restore dim_vehicle from a snapshot
CREATE OR REPLACE TABLE `drivn-project-1.telematics.dim_vehicle`
CLONE `drivn-project-1.telematics.dim_vehicle_backup_20260930T091207Z`;
```
After executing the SQL restoration, immediately invalidate the cache:
```bash
curl -X POST https://drivn-backend-304868514241.asia-south1.run.app/api/admin/refresh-cache
```

### 5.2 BigQuery Point-in-Time Time Travel (7-Day Retention)
If an accidental update occurred and no snapshot exists, leverage BigQuery's native 7-day time travel:
```sql
-- Inspect data from 3 hours ago
SELECT * FROM `drivn-project-1.telematics.utilization_daily_api_v2`
FOR SYSTEM_TIME AS OF TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 3 HOUR);

-- Restore table to state from 3 hours ago
CREATE OR REPLACE TABLE `drivn-project-1.telematics.utilization_daily_api_v2`
AS SELECT * FROM `drivn-project-1.telematics.utilization_daily_api_v2`
FOR SYSTEM_TIME AS OF TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 3 HOUR);
```

### 5.3 Instant Cloud Run Backend Revision Rollback
If a backend deployment introduces bugs, roll back traffic to the previous healthy revision in seconds without rebuilding:

```bash
# 1. List recent revisions to identify the previous healthy revision ID
gcloud run revisions list --service drivn-backend --region asia-south1 --limit 5

# 2. Shift 100% of traffic immediately to the healthy revision
gcloud run services update-traffic drivn-backend \
  --region asia-south1 \
  --to-revisions=drivn-backend-00019-49g=100
```

---

## 6. Critical Troubleshooting & Known Gotchas

### Gotcha 1: TypeScript Build Mode Failure on Netlify
* **Symptom**: `tsc --noEmit` succeeds locally, but Netlify build fails with TypeScript errors.
* **Cause**: Running `tsc --noEmit` against the root `tsconfig.json` checks nothing because it uses composite project references (`"files": []`).
* **Fix**: Always test builds locally using `npm run build` (`tsc -b && vite build`) inside `frontend/`, which properly recurses into sub-configs.

### Gotcha 2: The Uvicorn `--reload` Trapped Process
* **Symptom**: Editing backend Python files does not update API responses.
* **Cause**: Launching uvicorn without `--reload` causes Python bytecode to stay cached in memory.
* **Fix**: Always develop with `uv run uvicorn backend.main:app --reload --port 8000`.

### Gotcha 3: The Public `--allow-unauthenticated` Status
* **Symptom**: The backend endpoint is publicly accessible via curl without API keys.
* **Context**: This is an intentional Phase 1 architectural decision to allow Netlify's server-side reverse proxy to route requests without complex JWT authentication.
* **Recommendation**: If sensitive financial data expands, configure pre-shared secret verification headers between Netlify and Cloud Run.

---

## 7. Summary & Next Steps

This runbook detailed routine maintenance, deployment workflows, daily monitoring, disaster recovery, and troubleshooting procedures.

To complete the handover with credential provisioning, account transfers, and developer onboarding, continue to:  
👉 **[Document 06: Developer Onboarding & Access Management](06-Developer-Onboarding-and-Access-Management)**
