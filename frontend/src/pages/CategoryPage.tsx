import { useEffect, useMemo, useState } from "react"
import { getKpiSummary, getVehicles } from "../api/client"
import type { Category, CustomerName, KpiSummary, Scope, VehiclesResponse } from "../api/types"
import { ALL_CUSTOMERS } from "../components/CustomerCharts/colors"
import { CustomerSelector } from "../components/CustomerSelector"
import { KpiCards } from "../components/KpiCards"
import { TopBottomBarChart } from "../components/TopBottomBarChart"
import { VehicleTable } from "../components/VehicleTable"
import { useCustomerFilter } from "../hooks/useCustomerFilter"
import { useDateRange } from "../hooks/useDateRange"

/** Shared shell for /buses and /trucks -- same layout (KPI cards, top5/bottom5
 * bar charts, master table), different category filter. */
export function CategoryPage({ category, label }: { category: Category; label: string }) {
  const [range] = useDateRange()
  const [urlCustomer, setUrlCustomer] = useCustomerFilter()
  const [kpi, setKpi] = useState<KpiSummary | null>(null)
  const [vehicles, setVehicles] = useState<VehiclesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setKpi(null)
    setVehicles(null)
    Promise.all([getKpiSummary(category as Scope, range), getVehicles(category, range)])
      .then(([k, v]) => {
        if (cancelled) return
        setKpi(k)
        setVehicles(v)
      })
      .catch((e) => !cancelled && setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [category, range.start, range.end])

  // Available customers for this category (preserving ALL_CUSTOMERS order)
  const categoryCustomers = useMemo(() => {
    if (!vehicles) return []
    const present = new Set(vehicles.vehicles.map((v) => v.customer))
    return ALL_CUSTOMERS.filter((c) => present.has(c))
  }, [vehicles])

  // If URL customer is not in this category's roster, fall back to "All"
  const customer = categoryCustomers.includes(urlCustomer as CustomerName) ? urlCustomer : "All"

  const filteredVehicles = useMemo(() => {
    if (!vehicles) return []
    if (customer === "All") return vehicles.vehicles
    return vehicles.vehicles.filter((v) => v.customer === customer)
  }, [vehicles, customer])

  const benchmark = useMemo(() => {
    if (!filteredVehicles.length) return 0
    return Number((filteredVehicles.reduce((acc, v) => acc + v.avg_km_per_day, 0) / filteredVehicles.length).toFixed(1))
  }, [filteredVehicles])

  const below80Count = useMemo(() => {
    return filteredVehicles.filter((v) => v.is_below_80).length
  }, [filteredVehicles])

  if (error) return <div className="error-box">Failed to load: {error}</div>
  if (!kpi || !vehicles) return <div className="loading">Loading {label.toLowerCase()}…</div>

  return (
    <>
      <KpiCards kpi={kpi} />

      <div className="panel filter-bar">
        <span className="filter-bar-label">Filter by Customer</span>
        <CustomerSelector
          value={customer}
          onChange={setUrlCustomer}
          customers={categoryCustomers}
        />
      </div>

      <div className="charts-grid">
        <div className="panel" id="top-5">
          <div className="panel-header">Top 5 by Avg km/day</div>
          <div className="panel-body">
            <TopBottomBarChart vehicles={filteredVehicles} isTop benchmarkVal={benchmark} />
          </div>
        </div>
        <div className="panel" id="bottom-5">
          <div className="panel-header">Bottom 5 by Avg km/day</div>
          <div className="panel-body">
            <TopBottomBarChart vehicles={filteredVehicles} isTop={false} benchmarkVal={benchmark} />
          </div>
        </div>
      </div>

      <div className="panel" id="vehicle-table">
        <div className="panel-header">
          {label} {customer !== "All" ? `· ${customer}` : ""} ({filteredVehicles.length}) — {below80Count} below 80% active
        </div>
        <VehicleTable vehicles={filteredVehicles} />
      </div>
    </>
  )
}
