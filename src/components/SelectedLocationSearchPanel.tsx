import type { FormEvent } from 'react'
import type { LocationSearchResult } from '../app/rels/location-models'

type SelectedLocationSearchPanelProps = {
  isEditingLocation: boolean
  searchQuery: string
  searchStatus: string
  searchError: string | null
  searchResults: LocationSearchResult[]
  savedResults: LocationSearchResult[]
  onSubmitSearch: (event: FormEvent<HTMLFormElement>) => void
  onRetrySearch?: () => void
  onQueryChange: (query: string) => void
  onCancel: () => void
  onSelectResult: (result: LocationSearchResult) => void
  onSelectSavedResult: (result: LocationSearchResult) => void
  onRemoveSavedResult: (resultId: string) => void
}

export function SelectedLocationSearchPanel({
  isEditingLocation,
  searchQuery,
  searchStatus,
  searchError,
  searchResults,
  savedResults,
  onSubmitSearch,
  onRetrySearch,
  onQueryChange,
  onCancel,
  onSelectResult,
  onSelectSavedResult,
  onRemoveSavedResult,
}: SelectedLocationSearchPanelProps) {
  const searchInputId = 'selected-location-search-input'
  const searchTitleId = 'selected-location-search-title'
  const searchHintId = 'selected-location-search-hint'
  const searchStatusId = 'selected-location-search-status'
  const searchResultsId = 'selected-location-search-results-list'
  const savedTitleId = 'selected-location-search-saved-title'
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
}
