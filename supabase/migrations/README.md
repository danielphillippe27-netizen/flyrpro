# Canonical migrations

This is the only directory where new WolfGrid backend migrations are added.

The historical migration folders in the iOS workspace and the former repository root are frozen. Changes needed by any client must be expressed here as an idempotent migration and verified by the canonical migration rebuild workflow.
