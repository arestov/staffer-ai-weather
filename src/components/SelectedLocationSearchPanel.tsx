import { memo, useId, type FormEvent } from 'react'
import type { LocationSearchResult } from '../models/WeatherLocation'

type SelectedLocationSearchPanelProps = {
  isEditingLocation: boolean
  searchQuery: string
  searchStatus: string
  searchError: string | null
  currentLocationStatus: string
  currentLocationError: string | null
  searchResults: LocationSearchResult[]
  savedResults: LocationSearchResult[]
  onSubmitSearch: (event: FormEvent<HTMLFormElement>) => void
  onRetrySearch?: () => void
  onQueryChange: (query: string) => void
  onUseCurrentLocation: () => void
  onCancel: () => void
  onSelectResult: (result: LocationSearchResult) => void
  onSelectSavedResult: (result: LocationSearchResult) => void
  onRemoveSavedResult: (resultId: string) => void
}

export const SelectedLocationSearchPanel = memo(function SelectedLocationSearchPanel({
  isEditingLocation,
  searchQuery,
  searchStatus,
  searchError,
  currentLocationStatus,
  currentLocationError,
  searchResults,
  savedResults,
  onSubmitSearch,
  onRetrySearch,
  onQueryChange,
  onUseCurrentLocation,
  onCancel,
  onSelectResult,
  onSelectSavedResult,
  onRemoveSavedResult,
}: SelectedLocationSearchPanelProps) {
  const baseId = useId()
  const searchInputId = `${baseId}-search-input`
  const searchTitleId = `${baseId}-search-title`
  const searchHintId = `${baseId}-search-hint`
  const searchStatusId = `${baseId}-search-status`
  const searchResultsId = `${baseId}-search-results-list`
  const savedTitleId = `${baseId}-search-saved-title`
  const searchFieldDescription = [searchHintId, searchStatus !== 'idle' ? searchStatusId : null]
    .filter(Boolean)
    .join(' ')

  if (!isEditingLocation) {
    return null
  }

  return (
    <section
      className="selected-location-search"
      aria-labelledby={searchTitleId}
      data-location-search-panel
    >
      <div className="selected-location-search__layout">
        <div className="selected-location-search__main">
          <div className="selected-location-search__header">
            <div>
              <h3 id={searchTitleId} className="mini-section-label">
                Find replacement
              </h3>
              <p id={searchHintId} className="selected-location-search__hint">
                Search results live on the popover router and apply to this selected slot in place.
              </p>
            </div>
          </div>

          <form className="selected-location-search__form" onSubmit={onSubmitSearch} data-location-search-form>
            <label className="selected-location-search__field" htmlFor={searchInputId}>
              <span className="selected-location-search__label">City or region</span>
            </label>

            <input
              id={searchInputId}
              type="text"
              value={searchQuery}
              onChange={(event) => onQueryChange(event.currentTarget.value)}
              placeholder="Search for a location"
              aria-controls={searchResults.length ? searchResultsId : undefined}
              aria-describedby={searchFieldDescription || undefined}
              autoComplete="off"
              data-location-search-input
            />

            <div className="selected-location-search__controls">
              <button type="submit" data-location-search-submit>
                Search
              </button>
              <button
                className="secondary"
                type="button"
                onClick={onCancel}
                data-location-search-cancel
              >
                Cancel
              </button>
            </div>
          </form>

          <ul
            className="selected-location-search__results selected-location-search__results--current"
            aria-label="Current location"
            data-location-search-current
          >
            <li>
              <button
                className="selected-location-search__result selected-location-search__result--current"
                type="button"
                onClick={onUseCurrentLocation}
                data-location-search-current-location
              >
                <strong>Use current location</strong>
                <span>Provide location permission</span>
              </button>
            </li>
          </ul>

          {currentLocationStatus === 'loading' ? (
            <p
              className="selected-location-search__status"
              role="status"
              data-location-search-current-location-status
            >
              Detecting your current location...
            </p>
          ) : null}

          {currentLocationStatus === 'error' && currentLocationError ? (
            <p
              className="selected-location-search__status selected-location-search__status--error"
              role="alert"
              data-location-search-current-location-error
            >
              {currentLocationError}
            </p>
          ) : null}

          {searchStatus === 'loading' ? (
            <p
              id={searchStatusId}
              className="selected-location-search__status"
              role="status"
              data-location-search-status
            >
              Searching for matches...
            </p>
          ) : null}

          {searchStatus === 'error' && searchError ? (
            <div
              id={searchStatusId}
              className="selected-location-search__status selected-location-search__status--error"
              role="alert"
              data-location-search-status
            >
              <p>{searchError}</p>
              {onRetrySearch ? (
                <button
                  type="button"
                  className="secondary"
                  onClick={onRetrySearch}
                  data-location-search-retry
                >
                  Retry search
                </button>
              ) : null}
            </div>
          ) : null}

          {searchStatus === 'ready' && !searchResults.length ? (
            <p
              id={searchStatusId}
              className="selected-location-search__status"
              role="status"
              data-location-search-empty
            >
              No matches found. Try a broader city or region name.
            </p>
          ) : null}

          {searchResults.length ? (
            <ul
              id={searchResultsId}
              className="selected-location-search__results"
              aria-label="Search results"
              data-location-search-results
            >
              {searchResults.map((result) => (
                <li key={result.id}>
                  <button
                    className="selected-location-search__result"
                    type="button"
                    onClick={() => onSelectResult(result)}
                    data-location-search-result={result.id}
                  >
                    <strong>{result.name}</strong>
                    <span>
                      {result.subtitle || `${result.latitude.toFixed(2)}, ${result.longitude.toFixed(2)}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <aside
          className="selected-location-search__sidebar"
          aria-labelledby={savedTitleId}
        >
          <div>
            <h3 id={savedTitleId} className="mini-section-label">
              Saved picks
            </h3>
            <p className="selected-location-search__saved-hint">
              Selected results stay here for quick reuse while you keep searching.
            </p>
          </div>

          {savedResults.length ? (
            <ul className="selected-location-search__saved-list" data-location-search-saved-list>
              {savedResults.map((result) => (
                <li key={result.id} className="selected-location-search__saved-item">
                  <button
                    className="selected-location-search__saved-result"
                    type="button"
                    onClick={() => onSelectSavedResult(result)}
                    data-location-search-saved-result={result.id}
                  >
                    <strong>{result.name}</strong>
                    <span>
                      {result.subtitle || `${result.latitude.toFixed(2)}, ${result.longitude.toFixed(2)}`}
                    </span>
                  </button>

                  <button
                    className="secondary selected-location-search__saved-remove"
                    type="button"
                    onClick={() => onRemoveSavedResult(result.id)}
                    aria-label={`Remove ${result.name} from saved picks`}
                    data-location-search-saved-remove={result.id}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="selected-location-search__saved-empty" data-location-search-saved-empty>
              Pick a location from the search results to keep it here.
            </p>
          )}
        </aside>
      </div>
    </section>
  )
})

