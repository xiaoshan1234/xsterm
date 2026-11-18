# Models

`src/models` contains small, framework-independent primitives shared by
features:

- application error codes
- branded identifiers
- result types

Runtime projections and feature-specific schemas belong to the owning feature
under `features/<name>/contracts.ts`. Do not introduce a parallel aggregate
universe here unless production adapters create and consume it.
