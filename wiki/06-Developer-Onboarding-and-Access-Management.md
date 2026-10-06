# Document 06: Developer Onboarding & Access Management

**Target Platform:** Drivn Commercial EV Telematics Platform  
**Repository:** `gcpdrivn/telematics-analytics-dashboard-drivn`  
**Classification:** Core Engineering Handover  
**Document Status:** Production Reference  

---

## 1. Executive Summary & Purpose

This document serves as the **operational transition safety net** for incoming software engineers, data engineers, and engineering managers taking over the Drivn telematics platform.

When an engineer leaves an organization, the most frequent failure modes are orphaned accounts, missing permissions, forgotten environment variables, and undocumented manual maintenance steps. This guide ensures seamless ownership transfer, complete credential handover, day-1 local setup instructions, and a clear architectural roadmap of outstanding technical debt.

---

## 2. Account Inventory & Ownership Transfer Matrix

All production infrastructure, databases, and third-party vendor platforms must have their administrative ownership transferred to the incoming engineering lead prior to departure.

| Service / Platform | Resource Identifier | Access Level Required | Primary Purpose / Location | Handover Action Item |
|:---|:---|:---|:---|:---|
| **Google Cloud Platform (GCP)** | Project: `drivn-project-1` | `Owner` or `Editor` + `Security Admin` | Houses BigQuery, Cloud Run Services, Cloud Run Jobs, Cloud Scheduler, and Secret Manager. | Grant incoming lead `Project Owner` IAM role. Verify billing admin role. |
| **GCP Billing Account** | Account ID: `0171D6-8AABC0-333680` | `Billing Account Administrator` | Manages project billing, budgets (₹10,000/mo), and alert recipients. | Add incoming lead to budget alert email distribution list. |
| **GitHub** | `gcpdrivn/telematics-analytics-dashboard-drivn` | `Admin` / `Owner` | Source code repository and issue tracker. | Ensure incoming lead has Admin rights on the `gcpdrivn` GitHub organization. |
| **Netlify** | Site: `drivn-fleet-intelligence` | `Team Owner` or `Collaborator` | Static frontend CDN hosting, build pipeline, and custom domain routing. | Invite incoming lead to Netlify team; transfer site administration. |
| **Fleetx Enterprise Portal** | Base: `https://api.fleetx.io` | Company Admin / API User | Vendor IoT telematics portal for vehicle tagging and API access credentials. | Verify incoming lead has active login credentials for the Fleetx web console. |
| **GCP Secret Manager** | Secrets: `fleetx-username`, `fleetx-password` | `Secret Manager Admin` | Stores the API credentials used by daily scheduled Cloud Run jobs. | Confirm incoming lead can view and rotate secrets via GCP Console. |

---

## 3. Day-1 Local Environment Bootstrap Guide

Follow these steps to set up a complete local development environment from scratch.

### 3.1 Prerequisites
Ensure the host development machine has the following tools installed:
* **Python**: `3.11+`
* **Node.js**: `18.x+` (and `npm`)
* **Package Manager**: `uv` (Fast Python package installer and resolver: `curl -LsSf https://astral.sh/uv/install.sh | sh`)
* **Google Cloud SDK**: `gcloud` CLI installed and on system `$PATH`

### 3.2 Step-by-Step Setup

```bash
# 1. Clone the repository
git clone https://github.com/gcpdrivn/telematics-analytics-dashboard-drivn.git
cd telematics-analytics-dashboard-drivn

# 2. Install Python virtual environment and dependencies
uv sync

# 3. Authenticate with Google Cloud
# Note: Local development uses Application Default Credentials (ADC)
gcloud auth login
gcloud auth application-default login

# Set active project
gcloud config set project drivn-project-1

# 4. Configure local environment variables
cp .env.example .env
# Edit .env and verify GCP_PROJECT_ID=drivn-project-1, BQ_DATASET=telematics

# 5. Install Frontend dependencies
cd frontend
npm install
cd ..

# 6. Run the test suite to verify installation integrity
uv run pytest
```

### 3.3 Running Local Development Servers
To test both frontend and backend concurrently:

```bash
# Terminal 1: Backend API (FastAPI with auto-reload)
uv run uvicorn backend.main:app --reload --port 8000

# Terminal 2: Frontend Client (Vite Dev Server)
cd frontend
npm run dev
```

* **Frontend URL**: `http://localhost:5173`
* **Backend API Docs (Swagger UI)**: `http://localhost:8000/docs`
* **Health Endpoint**: `http://localhost:8000/api/health`

The Vite dev server automatically proxies all `/api/*` network requests to `http://localhost:8000`.

---

## 4. Secrets & Authentication Protocols

### 4.1 Application Default Credentials (ADC) Philosophy
The platform strictly follows Google's recommended security best practices: **no service account key files (`.json`) are stored on disk or committed to git**.

* **Locally**: `google-cloud-bigquery` resolves authentication automatically through the user credentials created by `gcloud auth application-default login`.
* **In Production (Cloud Run)**: `google-cloud-bigquery` resolves authentication via Cloud Run's internal metadata server using the attached service account identity (`fleet-intelligence-backend@drivn-project-1.iam.gserviceaccount.com`).
* **In Netlify**: Netlify only hosts static compiled JS/CSS and makes client-side calls through its redirect proxy; it holds zero GCP credentials.

### 4.2 Fleetx Credentials Rotation Protocol
The daily ingestion jobs read Fleetx credentials directly from GCP Secret Manager at runtime:

```bash
# View current secret version
gcloud secrets versions access latest --secret=fleetx-username
gcloud secrets versions access latest --secret=fleetx-password

# Update Fleetx password if rotated by vendor
echo -n "NEW_PASSWORD_HERE" | gcloud secrets versions add fleetx-password --data-file=-
```

---

## 5. Known Technical Debt, Tradeoffs & Future Roadmap

These architectural items were intentionally deferred during Phase 1 development and represent the recommended backlog for the incoming engineering team:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              ENGINEERING BACKLOG & ROADMAP                             │
│                                                                                        │
│  [Priority 1] CI/CD for Backend & Scheduled Jobs (GitHub Actions / Cloud Build)       │
│  [Priority 2] Endpoint Security Hardening (Locking down --allow-unauthenticated)       │
│  [Priority 3] Automated Operational Alerting (Slack webhook for ingestion failures)    │
│  [Priority 4] Dynamic Fleet Administration Portal (Replace Excel upload workflows)    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1. Automated CI/CD for Cloud Run Deployments (High Priority)
* **Current State**: Frontend pushes auto-deploy to Netlify, but backend and job code requires manual `gcloud run deploy` commands from an engineer's terminal.
* **Recommended Solution**: Configure a GitHub Actions workflow using Workload Identity Federation to trigger `gcloud run deploy` automatically whenever changes to `backend/**` or `ingestion/**` land on `main`.

### 2. Backend Security Hardening (Medium Priority)
* **Current State**: Cloud Run is deployed with `--allow-unauthenticated`. While the API is read-only and BigQuery writes are restricted to IAM-authorized jobs, public consumers can query fleet metrics if they know the URL.
* **Recommended Solution**: Configure Netlify to inject a private pre-shared secret header (e.g. `X-Drivn-Internal-Key`) on all proxied requests and enforce validation in `backend/main.py` middleware. (Note: The GitHub repository should be made private before storing header secrets in `netlify.toml`).

### 3. Automated Error Alerting (Medium Priority)
* **Current State**: Ingestion job failures must be detected by checking Cloud Run execution logs manually.
* **Recommended Solution**: Set up GCP Cloud Monitoring Alerting Policies to trigger an email or Slack webhook notification if `drivn-ingest-daily` or `drivn-resolve-odometer` exits with a non-zero exit code.

### 4. Replacing Excel Dimension Uploads (Low Priority)
* **Current State**: Onboarding a new vehicle requires dropping `Vehicle_Update_uploader.xlsx` into `data/raw/` and running `uv run seed-dimensions`.
* **Recommended Solution**: Build a lightweight admin page in the React dashboard with write-back capabilities to `dim_vehicle` via authenticated REST endpoints.

---

## 6. Handover Sign-Off Checklist

Before the departing engineer's final day, complete this verification checklist together:

- [ ] **GCP IAM Admin Rights**: Incoming lead has logged into GCP Console (`drivn-project-1`) and verified full access to BigQuery, Cloud Run, Cloud Scheduler, and Secret Manager.
- [ ] **Billing Verification**: Incoming lead is added as a billing contact on account `0171D6-8AABC0-333680`.
- [ ] **GitHub Access**: Incoming lead has pushed a test commit or verified maintainer rights on `gcpdrivn/telematics-analytics-dashboard-drivn`.
- [ ] **Netlify Admin**: Incoming lead has logged into Netlify and verified access to `drivn-fleet-intelligence`.
- [ ] **Fleetx Portal Access**: Incoming lead has verified active credentials to the Fleetx web portal.
- [ ] **Local Build Verified**: Incoming lead has successfully cloned the repository, executed `uv sync`, authenticated `gcloud auth application-default login`, and booted both dev servers.
- [ ] **Test Execution**: Ran `uv run pytest` locally with 100% passing tests.
- [ ] **Live Manual Deploy Test**: Conducted a dry-run deploy of `drivn-backend` and verified execution logs.

---

## 7. Master Documentation Index & Summary

All technical aspects of the platform are now comprehensively documented across the six core handover documents:

1. [**01. System Architecture & Data Lineage Overview**](01-System-Architecture-and-Data-Lineage): The macro cloud topology, data stages, and warehouse catalog.
2. [**02. Data Pipeline & Warehouse Specification**](02-Data-Pipeline-and-Warehouse-Specification): BigQuery schemas, ETL pipelines, odometer resolution algorithms, and billing rules.
3. [**03. Backend Service & API Technical Reference**](03-Backend-Service-and-API-Technical-Reference): FastAPI architecture, in-process caching, and complete REST API contracts.
4. [**04. Dashboard & Metric Dictionary**](04-Dashboard-and-Metric-Dictionary): Mathematical formulations, active-day normalization, and React UI components.
5. [**05. Operational Runbook & Disaster Recovery**](05-Operational-Runbook-and-Disaster-Recovery): Deployments, monitoring routines, and disaster recovery procedures.
6. [**06. Developer Onboarding & Access Management**](06-Developer-Onboarding-and-Access-Management): Credentials, local setup, technical debt backlog, and handover sign-off.
