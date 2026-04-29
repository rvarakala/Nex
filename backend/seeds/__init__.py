"""Seed package — extracted from `server.py` to keep startup logic isolated.

  • `demo.run_demo_seed(db, billing_module)` — idempotent dev/demo seeding.
"""
from .demo import run_demo_seed

__all__ = ["run_demo_seed"]
