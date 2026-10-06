import type { CrosstabCustomer, CustomerName } from "../api/types"
import { ALL_CUSTOMERS } from "./CustomerCharts/colors"

/** Shared pill-button customer picker -- extracted from the near-identical
 * markup that used to be duplicated in CrosstabMatrix, UptimeTable, and the
 * trajectory section of CustomersPage. */
export function CustomerSelector({
  value,
  onChange,
  includeAll = true,
  customers = ALL_CUSTOMERS,
}: {
  value: CrosstabCustomer
  onChange: (c: CrosstabCustomer) => void
  includeAll?: boolean
  customers?: CustomerName[]
}) {
  const options: CrosstabCustomer[] = includeAll ? ["All", ...customers] : customers

  return (
    <div className="customer-nav">
      {options.map((c) => (
        <button key={c} className={`seg-pill ${value === c ? "active" : ""}`} onClick={() => onChange(c)}>
          {c}
        </button>
      ))}
    </div>
  )
}
