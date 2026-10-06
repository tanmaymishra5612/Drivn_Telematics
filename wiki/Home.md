# Drivn Telematics Analytics Platform: Handover Documentation

Welcome to the comprehensive technical and operational handover documentation for the **Drivn Commercial EV Telematics Platform** (`telematics-analytics-dashboard-drivn`). 

This documentation provides an exhaustive, production-grade guide for incoming software engineers, data engineers, and DevOps/operations leads taking over full ownership of the platform.

---

## Handover Documentation Index

The handover is structured into **six dedicated technical documents**:

| # | Document Title | Domain / Focus | Key Topics Covered |
|:---|:---|:---|:---|
| **01** | [**System Architecture & Data Lineage Overview**](01-System-Architecture-and-Data-Lineage) | Macro Architecture | End-to-end system topology, Netlify/Cloud Run/BigQuery split, data lineage stages, security boundaries, and the table directory. |
| **02** | [**Data Pipeline & Warehouse Specification**](02-Data-Pipeline-and-Warehouse-Specification) | ETL & Warehouse Layer | Fleetx API ingestion, Cloud Run Jobs (`08:30` and `09:00` IST), cleansing, odometer resolution algorithm, BigQuery schemas (`_v2`), and excess-km billing. |
| **03** | [**Backend Service & API Technical Reference**](03-Backend-Service-and-API-Technical-Reference) | Application Layer | FastAPI architecture, multi-worker BigQuery thread pooling, dual in-process TTL caching, cache invalidation protocols, and complete REST API contracts. |
| **04** | [**Dashboard & Metric Dictionary**](04-Dashboard-and-Metric-Dictionary) | Business Logic & UI | Mathematical formulations for all KPI metrics, active day vs tenure definitions, Bus vs Truck logic, React/Vite UI architecture, and Plotly bundle handling. |
| **05** | [**Operational Runbook & Disaster Recovery**](05-Operational-Runbook-and-Disaster-Recovery) | Operations & Reliability | Daily monitoring checklist, manual pipeline commands, deployment runbooks (Netlify push vs Cloud Run deploy), backup table restoration, and troubleshooting gotchas. |
| **06** | [**Developer Onboarding & Access Management**](06-Developer-Onboarding-and-Access-Management) | People & Governance | Account inventory (GCP, Fleetx, Netlify, GitHub), credential provisioning, day-1 local environment setup, technical debt backlog, and handover checklist. |
---

## Platform Overview at a Glance

```
┌─────────────────────────┐     ┌────────────────────────┐     ┌────────────────────────┐
│      DATA SOURCES       │     │  STORAGE & COMPUTE     │     │     PRESENTATION       │
│                         │     │                        │     │                        │
│  • Fleetx IoT API       │────▶│  • Cloud Run Jobs      │────▶│  • Netlify React SPA   │
│  • Vehicle Dimensions   │     │  • BigQuery (telematics)│     │  • Cloud Run FastAPI   │
│  • Excess KM Contracts  │     │  • In-Memory TTL Cache │     │  • Excel Export Engine │
└─────────────────────────┘     └────────────────────────┘     └────────────────────────┘
```

* **Core Mission**: Automated ingestion, utilization analytics, battery health monitoring, uptime classification, and monthly contractual excess-km billing for commercial EV fleets (electric buses and heavy-duty trucks).
* **Key Customers**: FreshBus, ZingBus, BillionE, and other commercial fleet operators.
* **Production Cloud Infrastructure**:
  * **Cloud Provider**: Google Cloud Platform (GCP Project: `drivn-project-1`, Region: `asia-south1` / Mumbai).
  * **Data Warehouse**: Google BigQuery (Dataset: `telematics`, active tables: `*_v2`).
  * **Backend API**: Google Cloud Run (`drivn-backend`, Python 3.11 / FastAPI / pandas).
  * **Frontend Dashboard**: Netlify (`drivn-fleet-intelligence.netlify.app`, React 18 / TypeScript / Vite).
  * **Scheduled Jobs**: Google Cloud Scheduler + Cloud Run Jobs (`drivn-ingest-daily`, `drivn-soh-daily`, `drivn-resolve-odometer`).

---

## Current Platform State (October 2026)

1. **Production Table Version**: All systems (Cloud Run backend, scheduled ingestion jobs, odometer resolution, and billing) run on the **`_v2` tables** (`utilization_daily_api_v2`, `odometer_daily_resolved_v2`). 
2. **Scheduled Ingestion**: Fully automated. Fleetx trips from the previous day are ingested at **08:30 IST**, battery State-of-Health is snapshotted at **08:30 IST**, and daily odometers are resolved at **09:00 IST**.
3. **Deployment Separation**: Frontend updates auto-deploy via Netlify on push to `main`. Backend and scheduled job updates require manual CLI deployments via `gcloud` (documented in [Doc 05](05-Operational-Runbook-and-Disaster-Recovery)).

---

## How to Sync This Wiki to GitHub Wiki

This repository maintains the entire wiki inside the `wiki/` directory. To publish or synchronize changes with the GitHub Wiki repository:

```bash
# 1. Clone the GitHub wiki repo for this project (one-time)
git clone https://github.com/gcpdrivn/telematics-analytics-dashboard-drivn.wiki.git /tmp/drivn-wiki

# 2. Copy the wiki contents from this repo
cp -r wiki/* /tmp/drivn-wiki/

# 3. Commit and push to update the GitHub Wiki online
cd /tmp/drivn-wiki
git add .
git commit -m "Update handover documentation"
git push origin master
```

---

*To begin reading the system documentation, proceed to [01. System Architecture & Data Lineage Overview](01-System-Architecture-and-Data-Lineage).*
