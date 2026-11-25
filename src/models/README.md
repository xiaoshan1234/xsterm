# Models

`src/models` contains small, framework-independent primitives shared by
features:

- application error codes
- branded identifiers
- result types
- terminal property contracts shared by launch templates and live terminals

Runtime projections and feature-specific schemas belong to the owning feature
under `features/<name>/contracts.ts`. Do not introduce a parallel aggregate
universe here unless production adapters create and consume it.

Core terminal, workspace, window, and pane identity fields use branded IDs from
this directory. Generate IDs through the matching factory, and parse persisted
or wire data at its adapter boundary before constructing domain objects.
