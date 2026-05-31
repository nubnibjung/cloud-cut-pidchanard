# Database Design

The schema is normalized around workspace/project/timeline ownership and denormalized where editor reads need JSON payloads: project settings, asset metadata, clip transforms, effect params, and operation payloads.

Soft-deletable tables keep `deleted_at` and all list queries filter it. Hard cleanup is handled by the daily worker cleanup job after retention windows.
