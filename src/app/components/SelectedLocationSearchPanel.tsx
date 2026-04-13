import type { FormEvent } from 'react'
import type { LocationSearchResult } from '../rels/location-models'

type SelectedLocationSearchPanelProps = {
  isEditingLocation: boolean
  searchQuery: string
  searchStatus: string
  searchError: string | null
  searchResults: LocationSearchResult[]
  savedResults: LocationSearchResult[]
  onSubmitSearch: (event: FormEvent<HTMLFormElement>) => void
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
  onQueryChange,
  onCancel,
  onSelectResult,
  onSelectSavedResult,
  onRemoveSavedResult,
}: SelectedLocationSearchPanelProps) {
  if (!isEditingLocation) {
    return null
  }

  return (
    <section className="selected-location-search" data-location-search-panel>
      <div className="selected-location-search__layout">
        <div className="selected-location-search__main">
          <div className="selected-location-search__header">
            <div>
              <div className="mini-section-label">Find replacement</div>
              <p className="selected-location-search__hint">
                Search results live on the popover router and apply to this selected slot in place.
              </p>
            </div>
          </div>

          <form className="selected-location-search__form" onSubmit={onSubmitSearch} data-location-search-form>
            <label className="selected-location-search__field">
              <span className="selected-location-search__label">City or region</span>
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => onQueryChange(event.currentTarget.value)}
                placeholder="Search for a location"
                data-location-search-input
              />
            </label>

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
            <p className="selected-location-search__status" aria-live="polite" data-location-search-status>
              Searching for matches...
            </p>
          ) : null}

          {searchStatus === 'error' && searchError ? (
            <p className="selected-location-search__status selected-location-search__status--error" data-location-search-status>
              {searchError}
            </p>
          ) : null}

          {searchStatus === 'ready' && !searchResults.length ? (
            <p className="selected-location-search__status" data-location-search-empty>
              No matches found. Try a broader city or region name.
            </p>
          ) : null}

          {searchResults.length ? (
            <div className="selected-location-search__results" data-location-search-results>
              {searchResults.map((result) => (
                <button
                  key={result.id}
                  className="selected-location-search__result"
                  type="button"
                  onClick={() => onSelectResult(result)}
                  data-location-search-result={result.id}
                >
                  <strong>{result.name}</strong>
                  <span>{result.subtitle || `${result.latitude.toFixed(2)}, ${result.longitude.toFixed(2)}`}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <aside className="selected-location-search__sidebar" aria-label="Saved locations">
          <div>
            <div className="mini-section-label">Saved picks</div>
            <p className="selected-location-search__saved-hint">
              Selected results stay here for quick reuse while you keep searching.
            </p>
          </div>

          {savedResults.length ? (
            <div className="selected-location-search__saved-list" data-location-search-saved-list>
              {savedResults.map((result) => (
                <div key={result.id} className="selected-location-search__saved-item">
                  <button
                    className="selected-location-search__saved-result"
                    type="button"
                    onClick={() => onSelectSavedResult(result)}
                    data-location-search-saved-result={result.id}
                  >
                    <strong>{result.name}</strong>
                    <span>{result.subtitle || `${result.latitude.toFixed(2)}, ${result.longitude.toFixed(2)}`}</span>
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
                </div>
              ))}
            </div>
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
