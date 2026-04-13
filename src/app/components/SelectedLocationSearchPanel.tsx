import type { FormEvent, RefObject } from 'react'
import type { LocationSearchResult } from '../rels/location-models'

type SelectedLocationSearchPanelProps = {
  selectedLocationId: string
  isEditingLocation: boolean
  searchQuery: string
  searchStatus: string
  searchError: string | null
  searchResults: LocationSearchResult[]
  searchInputRef: RefObject<HTMLInputElement | null>
  onSubmitSearch: (event: FormEvent<HTMLFormElement>) => void
  onCancel: () => void
  onSelectResult: (result: LocationSearchResult) => void
}

export function SelectedLocationSearchPanel({
  selectedLocationId,
  isEditingLocation,
  searchQuery,
  searchStatus,
  searchError,
  searchResults,
  searchInputRef,
  onSubmitSearch,
  onCancel,
  onSelectResult,
}: SelectedLocationSearchPanelProps) {
  if (!isEditingLocation) {
    return null
  }

  return (
    <section className="selected-location-search" data-location-search-panel>
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
            key={`${selectedLocationId}:${searchQuery}:${isEditingLocation ? 'editing' : 'idle'}`}
            ref={searchInputRef}
            type="text"
            defaultValue={searchQuery}
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
    </section>
  )
}
