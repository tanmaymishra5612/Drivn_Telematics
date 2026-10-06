import datetime as dt
import numpy as np
import pandas as pd
import pytest

from backend import metrics


def test_resolve_total_days_with_install_date():
    window_start = pd.Timestamp("2026-04-07")
    end_date = pd.Timestamp("2026-10-05")
    obs_days = 182.0

    # Normal install date before first report date
    row = pd.Series(
        {
            "install_date": pd.Timestamp("2026-09-01"),
            "first_date": pd.Timestamp("2026-09-10"),
            "vehicle_type": "Bus",
            "Customer": "FreshBus",
        }
    )
    # (2026-10-05 - 2026-09-01) + 1 = 35 days
    assert metrics.resolve_total_days(row, window_start, end_date, obs_days) == 35.0

    # Install date clipped to window start if before window
    row_early = pd.Series(
        {
            "install_date": pd.Timestamp("2026-01-01"),
            "first_date": pd.Timestamp("2026-04-10"),
            "vehicle_type": "Truck",
            "Customer": "BillionE",
        }
    )
    # (2026-10-05 - 2026-04-07) + 1 = 182 days
    assert metrics.resolve_total_days(row_early, window_start, end_date, obs_days) == 182.0

    # Install date in future/after first_date is clipped to first_date
    row_future = pd.Series(
        {
            "install_date": pd.Timestamp("2026-10-10"),
            "first_date": pd.Timestamp("2026-09-20"),
            "vehicle_type": "Bus",
            "Customer": "Purple Mobility",
        }
    )
    # Clipped to first_date (2026-09-20): (2026-10-05 - 2026-09-20) + 1 = 16 days
    assert metrics.resolve_total_days(row_future, window_start, end_date, obs_days) == 16.0


def test_resolve_total_days_fallback_fixed_vs_dynamic_bus():
    window_start = pd.Timestamp("2026-04-07")
    end_date = pd.Timestamp("2026-10-05")
    obs_days = 182.0

    # Fixed contractual bus (FreshBus / ZingBus in FIXED_FLEET_SIZE) without install_date
    freshbus_row = pd.Series(
        {
            "install_date": np.nan,
            "first_date": pd.Timestamp("2026-08-01"),
            "vehicle_type": "Bus",
            "Customer": "FreshBus",
        }
    )
    assert metrics.resolve_total_days(freshbus_row, window_start, end_date, obs_days) == 182.0

    zingbus_row = pd.Series(
        {
            "install_date": np.nan,
            "first_date": pd.Timestamp("2026-08-01"),
            "vehicle_type": "Bus",
            "Customer": "ZingBus",
        }
    )
    assert metrics.resolve_total_days(zingbus_row, window_start, end_date, obs_days) == 182.0

    # Dynamic bus fleet (Purple Mobility, NOT in FIXED_FLEET_SIZE) without install_date
    # Must use tenure from first_date (2026-10-04 to 2026-10-05 = 2 days), not 182 days!
    purple_row = pd.Series(
        {
            "install_date": np.nan,
            "first_date": pd.Timestamp("2026-10-04"),
            "vehicle_type": "Bus",
            "Customer": "Purple Mobility",
        }
    )
    assert metrics.resolve_total_days(purple_row, window_start, end_date, obs_days) == 2.0


def test_resolve_total_days_fallback_truck():
    window_start = pd.Timestamp("2026-04-07")
    end_date = pd.Timestamp("2026-10-05")
    obs_days = 182.0

    # Dynamic truck without install_date
    truck_row = pd.Series(
        {
            "install_date": np.nan,
            "first_date": pd.Timestamp("2026-10-01"),
            "vehicle_type": "Truck",
            "Customer": "Enviiirowheels",
        }
    )
    # (2026-10-05 - 2026-10-01) + 1 = 5 days
    assert metrics.resolve_total_days(truck_row, window_start, end_date, obs_days) == 5.0
