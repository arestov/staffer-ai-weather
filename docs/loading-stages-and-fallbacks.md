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
│  useSyncRoot(runtime) → snapshot { booted, rootNodeId, sessionId }
│
├── <header> (boot state, root node, session ID)
│
└── <RootScope runtime>    ← provides ReactScopeRuntimeContext + ScopeContext(rootScope)
    │
    └── <One rel="pioneer" fallback={GraphFallback}>              [Scope: SessionRoot]
        │
        ├── <One rel="mainLocation" fallback={LocationFallback(featured)}>  [Scope: SelectedLocation]
        │   └── <FeaturedLocationCard>
        │       └── <WeatherLocationInner featured>
        │           │  useAttrs(['loadStatus','lastError','weatherFetchedAt'])  ← reads from SelectedLocation scope (always empty)
        │           │
        │           └── <div.location-card.location-card--featured>
        │               └── <One rel="weatherLocation" fallback={LocationFallback(featured)}>  [Scope: WeatherLocation]
        │                   └── <div.location-card__body>
        │                       ├── <One rel="currentWeather" fallback={LocationFallback(featured)}>  [Scope: CurrentWeather]
        │                       │   └── <article.weather-readout>
        │                       │       └── <CurrentWeatherCard>  ← shapeOf, useAttrs
        │                       │
        │                       └── {featured &&
        │                           <div.forecast-panels>
        │                             ├── "Hourly forecast"
        │                             │   └── <Many rel="hourlyForecastSeries" item={ForecastCard} empty={ForecastEmpty}>
        │                             └── "Daily forecast"
        │                                 └── <Many rel="dailyForecastSeries" item={ForecastCard} empty={ForecastEmpty}>
        │                           }
        │
        └── <Many rel="additionalLocations" item={AdditionalLocationCard} empty={LocationCardsFallback(3)}>
            └── <AdditionalLocationCard>
                └── <WeatherLocationInner>  (featured=false, no forecast panels)
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
- `<One rel="weatherLocation">` — not yet synced → **LocationFallback(featured)**

> **BUG: Double card wrapping.** `WeatherLocationInner` already provides a `<div.location-card>` wrapper, but `LocationFallback` renders another `<article.location-card>` inside it:
> ```html
> <div class="location-card location-card--featured">         ← WeatherLocationInner
>   <article class="location-card location-card--featured     ← LocationFallback
>            location-card--placeholder">
>     <div class="location-card__body">...</div>
>   </article>
> </div>
> ```

### Stage 5 — weatherLocation Synced, currentWeather Not Created
- `WeatherLocation` node synced (loadStatus='idle'), `<One rel="weatherLocation">` resolves
- `currentWeather` rel is `null` (not yet created — created by `applyWeather` action)
- `<One rel="currentWeather" fallback={LocationFallback(featured)}>` → **LocationFallback(featured)** (full card with forecast panels!)
- Sibling `{featured && <div.forecast-panels>...}` also renders:
  - `<Many rel="hourlyForecastSeries" empty={ForecastEmpty}>` → **ForecastEmpty**
  - `<Many rel="dailyForecastSeries" empty={ForecastEmpty}>` → **ForecastEmpty**

> **BUG: Double forecast display.** Two sets of "Hourly forecast" + "Daily forecast":
> 1. From `LocationFallback` (currentWeather fallback) — wrapped in its own card body
> 2. From the sibling forecast panels — with `ForecastEmpty` placeholders
>
> The user sees this as two skeletons, with the upper one wrapped in an extra component.

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

## Summary of Issues

| Stage | Issue | Root Cause |
|-------|-------|------------|
| 4 | Double card wrapping | `LocationFallback` used as `weatherLocation` fallback includes `<article.location-card>` inside `WeatherLocationInner`'s `<div.location-card>` |
| 5 | Double forecast display | `LocationFallback` used as `currentWeather` fallback includes forecast panels; real forecast panels render as siblings |
