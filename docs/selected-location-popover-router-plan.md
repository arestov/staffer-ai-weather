# SelectedLocation Popover Router Plan

## Goal

Add a dedicated simple router for `SelectedLocation` so a click on any selected-location card opens a compact popover below that card. The popover should reuse the same weather data for now and expose a close button. Later this surface will host location search and replacement.

## Sidekick / DKT mapping

Relevant DKT behavior from Sidekick and current `dkt`:

- auxiliary surfaces should use a named router under `SessionRoot`;
- `is_simple_router: true` is the main behavior switch for direct current-model focus;
- cross-router navigation should go through `SessionRoot.navigateRouterToResource(...)`;
- router close should clear router current state instead of mutating page-local component state.

For this weather app the popover is not a detached popup and does not need spyglass transport. The Sidekick popup lessons still apply at the router level, but not at the geometry-transport level.

## Design

### 1. Named simple router

Add a named router relation under `SessionRoot`:

- `router-selectedLocationPopover`

Router requirements:

- extends `Router`;
- `is_simple_router: true`;
- `works_without_main_resident: true`;
- no URL/history semantics.

Open flow:

- click a `SelectedLocation` card;
- dispatch `navigateRouterToResource` on `SessionRoot` with `router-selectedLocationPopover`;
- router focuses the clicked `SelectedLocation` model.

Close flow:

- close button dispatches a root action that resolves the named router and calls `eraseModel`.

### 2. Popover rendering strategy

Render the popover inline under the clicked card instead of using floating viewport positioning.

Why this is the right first step:

- the requested layout is local: full width of the component, below the component;
- no popup-size-based geometry calculation is needed;
- no `anchor-name` propagation is required;
- this keeps tests deterministic in jsdom and avoids transport-specific complexity.

The router still owns open/close state. The DOM only decides where to render the active router model.

### 3. React integration

Add a small root-targeted action hook/helper so card components can dispatch router actions to `SessionRoot`, not to the current `SelectedLocation` scope.

Add a root subscription helper for:

- router scope lookup from `SessionRoot`;
- current popover model lookup from router scope.

Card behavior:

- card wrapper becomes clickable;
- if current router model id equals the current card scope id, render popover below the card;
- compact popover body reuses existing weather readout and compact forecast summary;
- close button sits at top-right inside the popover.

### 4. Test strategy

Use `vitest` with a node/jsdom harness similar to the existing repl.

Test harness goals:

- no real browser;
- no SharedWorker;
- direct in-memory transport between page runtime and worker runtime;
- mocked backend weather API.

Planned tests:

1. smoke: app boots and weather loads;
2. featured location: click featured `SelectedLocation`, popover opens, close works;
3. additional location: click one additional `SelectedLocation`, popover opens, close works.

Assertions should cover both DOM state and runtime state when practical:

- visible popover content;
- router current model matches clicked `SelectedLocation`;
- router current model resets to `null` after close.

## Implementation order

1. Add named simple router model and wire it into `SessionRoot`.
2. Add root action to close the popover router.
3. Add root-scoped React helpers.
4. Update `App.tsx` to open/close and render inline popover.
5. Add compact popover styles.
6. Add vitest config, harness, mocked weather API tests.
7. Run build and tests.