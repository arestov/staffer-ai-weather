import { useAttrs } from '../../dkt-react-sync/hooks/useAttrs'
import { readStringAttr } from '../../shared/attrReaders'

type SelectedLocationPopoverSearchTriggerProps = {
  onStartEdit: (seedQuery: string) => void
}

export function SelectedLocationPopoverSearchTrigger({
  onStartEdit,
}: SelectedLocationPopoverSearchTriggerProps) {
  const attrs = useAttrs(['location', 'name'])
  const seedQuery = readStringAttr(attrs.location).trim() || readStringAttr(attrs.name).trim()

  return (
    <div className="selected-location-popover__footer">
      <button
        className="secondary selected-location-popover__edit-trigger"
        type="button"
        onClick={() => onStartEdit(seedQuery)}
        data-location-edit-trigger
        data-popover-focus
      >
        Search Another Location
      </button>
    </div>
  )
}