# Selected Location Search Router Design

## Goal

Add location search and selection inside the selected-location popover after it is opened.

Constraints:

- use DKT interface/api declarations for side effects;
- do not create model instances for individual search result rows;
- keep the main search state and flow in the popover router;
- keep pure data changes in actions and side effects in interfaces/effects.

## Main structure

### Router owns search state

`weather_selected_location_popover_router` stores:

- `isEditingLocation`
- `searchQuery`
- `searchStatus`
- `searchError`
- `searchResults`
- `searchRequest`
- `activeSearchRequestId`

This keeps the search lifecycle scoped to the popover surface instead of leaking it into React component state or the selected location model.

### Search results stay plain data

`searchResults` is an array of plain objects:

```ts
type LocationSearchResult = {
  id: string
  name: string
  subtitle: string
  latitude: number
  longitude: number
  timezone: string | null
}
```

No `model` relation is created for result rows. React renders these attrs directly from router scope.

### SelectedLocation remains a thin slot model

`weather_selected_location` receives the chosen search result through a pure action:

- router action `selectLocationSearchResult`
- target action on `current_mp_md`: `replaceWeatherLocation`

`SelectedLocation` forwards that payload to its nested `weatherLocation` relation.

### WeatherLocation handles replacement and immediate reload

`weather_location.replaceLocation` updates pure location attrs, clears stale weather rels, and writes a `weatherLoadRequest` token.

An `effects.out` effect reacts to `weatherLoadRequest` and calls `#weatherLoader`.

When the Promise resolves:

- `applyWeatherFromRequest` validates the request id and forwards to `applyWeather`
- `failWeatherFromRequest` validates the request id and forwards to `failWeather`

This keeps late responses from older requests from overwriting newer choices.

## Interface / API declarations

The shared worker runtime now injects two interfaces:

- `locationSearchSource`
- `weatherLoaderSource`

`weather_app_root` exposes them as app-level APIs:

- `locationSearch`
- `weatherLoader`

Descendants consume them as:

- `#locationSearch`
- `#weatherLoader`

This matches the DKT pattern where models do not import network utilities directly for side effects.

## Flow

1. User opens selected-location popover through the named simple router.
2. User clicks `Search Another Location`.
3. Router action `startLocationEditing`:
   - flips `isEditingLocation`
   - seeds `searchQuery`
   - clears old results
   - creates a new `searchRequest`
4. Router `effects.out.runLocationSearch` calls `#locationSearch.search(query)`.
5. Router stores plain `searchResults` on success or `searchError` on failure.
6. User clicks one result.
7. Router action `selectLocationSearchResult`:
   - resets edit/search state
   - forwards payload to current `SelectedLocation`
8. `SelectedLocation.replaceWeatherLocation` forwards payload to nested `WeatherLocation.replaceLocation`.
9. `WeatherLocation.replaceLocation` updates attrs and emits `weatherLoadRequest`.
10. `WeatherLocation.effects.out.loadWeatherForReplacement` calls `#weatherLoader`.
11. Weather data updates through existing `applyWeather` / `failWeather` actions.

## Purity split

### Pure data

- router actions mutate only router attrs / current selected location targets;
- selected-location action only forwards payload;
- weather-location replacement action only updates attrs/rels and request tokens.

### Side effects

- location search runs in router `effects.out` through `#locationSearch`;
- weather reload runs in `WeatherLocation.effects.out` through `#weatherLoader`.

No `self.updateAttr`, `self.updateRel`, or imperative mutation helpers are used inside actions.

## Race handling

- router search uses `activeSearchRequestId`
- weather replacement uses `weatherLoadRequest.requestId`

Both success/failure actions validate request id before applying data.

This prevents stale async responses from older searches or older weather loads from overriding the newest state.

## Test coverage

Tests should verify:

- opening the popover still works for featured and additional locations;
- entering edit mode stores search state on the router;
- search results are plain attrs on the router and do not create extra `weather_location` models before selection;
- selecting a result updates the existing selected-location slot in place;
- the replaced location fetches fresh weather immediately.