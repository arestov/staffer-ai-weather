export const SELECTED_LOCATION_POPOVER_ROUTER_NAME = 'router-selectedLocationPopover'
export const SELECTED_LOCATION_POPOVER_ID = 'selected-location-popover-layer'
export const SELECTED_LOCATION_POPOVER_ARROW_ID = 'selected-location-popover-arrow'

const SELECTED_LOCATION_POPOVER_SCROLL_OFFSET = 24

export const scrollSelectedLocationIntoView = (selectedLocationId: string) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }

  const anchorElement = document.querySelector(
    `[data-selected-location-id="${selectedLocationId}"]`,
  ) as HTMLElement | null

  if (!anchorElement) {
    return
  }

  const rect = anchorElement.getBoundingClientRect()

  try {
    window.scrollBy({
      top: rect.top - SELECTED_LOCATION_POPOVER_SCROLL_OFFSET,
      behavior: 'smooth',
    })
  } catch {
    // jsdom does not implement scrollBy; ignore to keep tests deterministic.
  }
}
