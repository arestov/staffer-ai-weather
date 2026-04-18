# Loading Stages & Fallback Tree

## Model Graph

```
AppRoot
├── weatherLocation: WeatherLocation[]        (4 cities, created by handleInit)
├── location: SelectedLocation[]              (linked to weatherLocations)
├── mainLocation: SelectedLocation            (first location)
└── additionalLocations: SelectedLocation[]   (remaining locations)

SessionRoot (pioneer)
├── mainLocation ─► SelectedLocation
│   └── weatherLocation ─► WeatherLocation
│       ├── currentWeather ─► CurrentWeather         (created by applyWeather)
│       ├── hourlyForecastSeries ─► HourlyForecast[] (created by applyWeather)
│       └── dailyForecastSeries ─► DailyForecast[]   (created by applyWeather)
└── additionalLocations ─► SelectedLocation[]
    └── weatherLocation ─► WeatherLocation (same shape as above)
```

## Component Tree with Fallbacks

```
<App session>
└── <RootScope runtime>    ← provides ReactScopeRuntimeContext + ScopeContext(rootScope)
    │
    └── <One rel="pioneer" fallback={GraphFallback}>              [Scope: SessionRoot]
        │
    ├── <WeatherUpdateTimestamp />
    │
    ├── <section.main-stage>
    │   └── <One rel="mainLocation" fallback={<LocationFallback featured forecastLimit={...} />}>  [Scope: SelectedLocation]
    │       └── <FeaturedLocationCard>
    │           └── <WeatherLocationInner featured>
    │               └── <div.selected-location-shell--featured>
    │                   └── <div.selected-location-card-button>
    │                       └── <div.location-card.location-card--featured>
    │                           └── <One rel="weatherLocation" fallback={weatherLocationBodyFallback}>  [Scope: WeatherLocation]
    │                               └── <div.location-card__body>
    │                                   ├── <One rel="currentWeather" fallback={<WeatherReadoutFallback />}>  [Scope: CurrentWeather]
    │                                   │   └── <article.weather-readout>
    │                                   │       └── <CurrentWeatherCard>  ← shapeOf, useAttrs
    │                                   │
    │                                   └── {featured &&
    │                                       <div.forecast-panels>
    │                                         ├── <HourlySparklineSection />
    │                                         └── <DailySparklineSection />
    │                                       }
    │
    └── <section.secondary-stage>
      └── <div.location-grid>
        └── <Many rel="additionalLocations" item={AdditionalLocationCard} empty={<LocationCardsFallback count={3} />}>
          └── <AdditionalLocationCard>
            └── <WeatherLocationInner>
              └── same shell/card/body structure as featured, without forecast panels

<SelectedLocationPopoverLayer>
└── <div.selected-location-popover__surface>
  └── <One rel="weatherLocation" fallback={<PopoverWeatherSectionFallback />}>
    └── <div.selected-location-popover__body>
      ├── <One rel="currentWeather" fallback={<WeatherReadoutFallback variant="popover" />}>
      │   └── <article.weather-readout--popover>
      └── <PopoverForecastColumns />
```

## Loading Stages

### Stage 0 — JS Bundle Loading
- Browser loads `index.html`, Vite serves the JS bundle
- `SharedWorker` is instantiated, transport created via `createSharedWorkerTransport`
- `createPageSyncReceiverRuntime` creates `ReactSyncReceiver` + `ShapeRegistry`
- UI: nothing rendered yet

### Stage 1 — Page Runtime Bootstrap
- `runtime.bootstrap()` sends `CONTROL_BOOTSTRAP_MODEL` to worker
- `useSyncRoot` returns `{ booted: false, rootNodeId: null, sessionId: null }`
- `<RootScope>` provides null root scope
- `<One rel="pioneer">` — scope is `null` → **renders GraphFallback**
- **Visible:** Full page skeleton (featured card + 3 additional card skeletons)

### Stage 2 — Worker Bootstraps DKT Runtime
- Worker receives message, `bootstrapApp()` calls `prepareAppRuntime()` + `runtime.start({ App: AppRoot })`
- `handleInit` action fires: creates 4 `WeatherLocation` nodes, 4 `SelectedLocation` nodes, sets `mainLocation` + `additionalLocations`
- `bootstrapSession()` creates `SessionRoot` via `hookSessionRoot()`
- `addSyncStream()` begins sending sync tree to the page
- Worker sends `SESSION_BOOTED` → page sets `booted: true, sessionId`
- **Visible:** Still GraphFallback (pioneer rel not yet synced to receiver)

### Stage 3 — Pioneer Synced
- Sync stream delivers `SessionRoot` tree nodes → `ReactSyncReceiver` builds graph
- `<One rel="pioneer">` resolves → renders actual children
- `<One rel="mainLocation">` not yet resolved → **LocationFallback(featured)**
- `<Many rel="additionalLocations" empty={LocationCardsFallback}>` → **LocationCardsFallback(3)**
- **Visible:** Same visual as Stage 1 but now driven by One/Many fallbacks, not GraphFallback

### Stage 4 — mainLocation Synced
- `SelectedLocation` node synced, `<One rel="mainLocation">` resolves
- Renders `FeaturedLocationCard` → `WeatherLocationInner(featured=true)`
- `WeatherLocationInner` wraps in `<div class="location-card location-card--featured">`
- `<One rel="weatherLocation">` — not yet synced → `weatherLocationBodyFallback` inside the same shell/card wrapper
- The fallback now keeps the same outer geometry as the resolved card and only substitutes the inner body

### Stage 5 — weatherLocation Synced, currentWeather Not Created
- `WeatherLocation` node synced (loadStatus='idle'), `<One rel="weatherLocation">` resolves
- `currentWeather` rel is `null` (not yet created — created by `applyWeather` action)
- `<One rel="currentWeather" fallback={<WeatherReadoutFallback />}>` replaces only the readout block
- Sibling forecast panels remain separate and render their own loading state until each series resolves

### Stage 6 — Weather API Fetch
- Worker calls `fetchWeatherForAllLocations()`:
  1. `startLoading` action → `loadStatus='loading'`
  2. `fetchWeatherFromOpenMeteo(lat, lon)` for each city
  3. On success: `applyWeather` creates `currentWeather`, sets `hourlyForecastSeries` and `dailyForecastSeries` in one transaction
- All three rels appear simultaneously in the sync stream

### Stage 7 — Weather Data Applied
- `currentWeather` exists → `<One rel="currentWeather">` resolves → renders `CurrentWeatherCard`
- `hourlyForecastSeries` populated → `<Many>` renders `ForecastCard` items
- `dailyForecastSeries` populated → `<Many>` renders `ForecastCard` items
- **Visible:** Full weather data, no placeholders

### Stage 8 — Live Updates
- 10-minute interval timer re-fetches weather for all locations
- `startLoading` → fetch → `applyWeather` or `failWeather`
- On error: exponential backoff (30s, up to 3 retries then 10min)

## Shape Mounting Flow

1. `<One>`/`<Many>` calls `useShape(getRelShape(rel))` — declares rel dependency
2. `useShape` → `useEffect` → `runtime.mountShape(scope, shape)`
3. `ShapeRegistry.mount()` compiles shape → publishes shape graph to worker → requests shape for node
4. Worker receives `SYNC_REQUIRE_SHAPE` → updates sync structure usage → sends targeted tree data
5. `ReactSyncReceiver` processes incoming sync batches → updates nodes → notifies subscribers
6. `useSyncExternalStore` triggers re-render when `readOne`/`readMany` returns new data

## Fallback Contract

- `LocationFallback` now mirrors the real selected-location shell: `selected-location-shell` → `selected-location-card-button` → `location-card` → `location-card__body`.
- `LocationCardsFallback` therefore matches the actual additional locations grid in both width and height, instead of rendering a different standalone card shape.
- `WeatherReadoutFallback` has a compact `variant="popover"` mode so the popover fallback matches the smaller popover readout geometry.
- `PopoverWeatherSectionFallback` now uses a dedicated popover columns fallback instead of the featured-card forecast chips fallback.
