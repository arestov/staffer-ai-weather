type SelectedLocationPopoverHeaderProps = {
  isEditingLocation: boolean
  onClose: () => void
}

export function SelectedLocationPopoverHeader({
  isEditingLocation,
  onClose,
}: SelectedLocationPopoverHeaderProps) {
  return (
    <div className="selected-location-popover__header">
      <div className="selected-location-popover__header-content">
        {isEditingLocation ? (
          <p className="selected-location-popover__header-note">
            Pick a replacement below to update this location card.
          </p>
        ) : null}
      </div>

      <button
        className="secondary selected-location-popover__close"
        type="button"
        onClick={onClose}
        aria-label="Close popover"
        data-popover-close
        {...(isEditingLocation ? { 'data-popover-focus': '' } : {})}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  )
}
