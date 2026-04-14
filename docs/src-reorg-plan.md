# src Reorganization Plan

## Goal

- Move DKT models out of `src/app/**` into `src/models/**`.
- Keep React UI components in `src/components/**`.
- Move `src/react-sync/**` to `src/dkt-react-sync/**` because it is framework/runtime infrastructure, not app UI.
- Remove barrel and re-export files in the final state.
- Keep every change bisectable: one file move or one model extraction per commit.

## Validation For Every Atomic Step

Run after each file move or model extraction:

```powershell
npm run build
npm test
```

Only after both commands pass:

```powershell
git add -A
git commit -m "<conventional commit message>"
```

## Atomic Sequence

1. Add this plan file and commit it.
2. Extract `CurrentWeather` to `src/models/CurrentWeather.ts`.
3. Extract `HourlyForecastSeries` to `src/models/HourlyForecastSeries.ts`.
4. Extract `DailyForecastSeries` to `src/models/DailyForecastSeries.ts`.
5. Move shared model types out of `src/app/rels/location-models.ts` as needed.
6. Extract `WeatherLocation` to `src/models/WeatherLocation.ts`.
7. Extract `SelectedLocation` to `src/models/SelectedLocation.ts`.
8. Move `src/app/Routers/SelectedLocationPopover.ts` to `src/models/SelectedLocationPopoverRouter.ts`.
9. Move `src/app/Routers/Root.ts` to `src/models/RootRouter.ts`.
10. Move `src/app/SessionRoot.ts` to `src/models/SessionRoot.ts`.
11. Move `src/app/AppRoot.ts` to `src/models/AppRoot.ts`.
12. Move model helper files from `src/app/rels/**` into `src/models/**` if they are still needed there.
13. Move `src/react-sync/**` to `src/dkt-react-sync/**` one file at a time, updating imports after each file move.
14. Remove remaining `src/app/rels/*.ts` re-export files and `src/app/rels/index.ts`.
15. Remove now-empty legacy folders under `src/app/**` if nothing references them.
16. Run final build and full test suite.

## Notes

- During the transition, temporary compatibility imports are acceptable inside the same commit.
- Temporary re-exports are acceptable only as an intermediate state; they must be removed before the final verification commit.
- Prefer moving low-dependency files first so each step stays small.