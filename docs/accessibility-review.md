# Accessibility Review

## Scope

Review target:

- `src/App.tsx`
- `src/app/components/AppHeader.tsx`
- `src/app/components/SelectedLocationPopover.tsx`
- `src/app/components/SelectedLocationSearchPanel.tsx`
- `src/app/components/WeatherCards.tsx`
- `src/app/components/WeatherGraph.tsx`
- `src/styles.css`

The review focuses on keyboard access, semantic structure, screen reader behavior, live regions, form labeling, and discoverability of dynamic UI.

## Summary

The current UI has a solid baseline in a few places: real `button` elements are used for most actions, the search field has a visible text label, and some transient states already expose `aria-live` or `aria-busy`.

The main accessibility risks are architectural rather than cosmetic:

1. The app header behaves like a hover disclosure instead of a keyboard/touch-driven disclosure widget.
2. The selected-location popover behaves visually like a dialog/popover but does not yet manage focus or expose strong semantics.
3. Important content sections are visually labeled but not represented as a heading structure or lists.
4. Search results and weather collections are rendered as generic `div` groups, which weakens screen reader navigation and state announcement.
5. Several statuses are visible but not reliably announced when async state changes.

## Findings

### Critical

#### 1. Header disclosure is not a real disclosure pattern

Files:

- `src/app/components/AppHeader.tsx`
- `src/styles.css`

Problem:

- The header panel is shown through CSS hover and `:focus-within` only.
- The trigger button has no text content and does not toggle any state.
- There is no `aria-expanded`, `aria-controls`, or persisted open/closed state.
- On touch devices or assistive tech users who do not discover the tiny unlabeled dot visually, the status panel is easy to miss.

Impact:

- Fails the expected behavior of a disclosure button.
- Makes app status and retry action harder to discover for keyboard and touch users.
- Creates ambiguity for screen readers because the button says “Show app header” but does not actually change a semantic expanded state.

Recommended fix:

- Convert the trigger into a stateful disclosure button.
- Keep the panel mounted, but drive visibility from React state.
- Add `aria-expanded`, `aria-controls`, a stable panel id, and visible button text or an accessible icon+label combination.
- Close on `Escape` and on outside click if you want popover-like behavior.

#### 2. Selected-location popover lacks focus management and dialog semantics

Files:

- `src/app/components/SelectedLocationPopover.tsx`
- `src/app/components/WeatherGraph.tsx`

Problem:

- Opening the selected-location popover does not move focus into the popover.
- Closing it does not restore focus to the trigger card.
- The surface is presented as an overlay editor, but it is not exposed as a dialog-like structure and does not trap or guide focus.
- There is no documented keyboard dismissal path besides tabbing to the close button.

Impact:

- Keyboard users may lose context after opening the editor.
- Screen reader users do not receive a strong signal that focus has moved into a separate transient layer.
- This is especially risky because the layer contains form controls and stateful editing actions.

Recommended fix:

- Treat the surface as a dialog/popover editor with explicit semantics.
- Move focus to the first meaningful control when opened.
- Restore focus to the originating location card when closed.
- Add `Escape` handling.
- If full dialog behavior is too heavy, at minimum add labeled region semantics and deterministic focus transfer.

### High

#### 3. Large weather cards are interactive, but their accessible name is implicit and unstable

Files:

- `src/app/components/WeatherGraph.tsx`
- `src/app/components/WeatherCards.tsx`

Problem:

- Each selected location card is a large `button` wrapping a complex weather card.
- The accessible name is derived indirectly from all nested text content instead of a concise explicit label.
- The name can change as forecast and weather text change, making the control noisy in screen readers.

Impact:

- Screen reader output becomes verbose and inconsistent.
- It is harder to understand the primary action of the control.

Recommended fix:

- Add an explicit `aria-label` or `aria-labelledby` that names the action clearly, for example “Open details for Berlin”.
- Keep rich weather details as visible content, but do not rely on the whole subtree as the control name.

#### 4. Visual section labels are not exposed as headings

Files:

- `src/app/components/WeatherGraph.tsx`
- `src/app/components/SelectedLocationPopover.tsx`
- `src/app/components/SelectedLocationSearchPanel.tsx`
- `src/app/components/WeatherCards.tsx`

Problem:

- Labels such as “Hourly forecast”, “Daily forecast”, “Current weather”, “Saved picks”, and “Find replacement” are mostly rendered as `div` or `p` elements.
- The page has very little real heading structure.

Impact:

- Screen reader users cannot navigate the UI efficiently by heading.
- The popover and search sub-sections are harder to scan semantically.

Recommended fix:

- Promote major labels to `h1`/`h2`/`h3` as appropriate.
- Keep decorative uppercase styling in CSS, but use semantic headings in markup.

#### 5. Search results and saved locations are not expressed as lists

Files:

- `src/app/components/SelectedLocationSearchPanel.tsx`

Problem:

- Search results and saved picks are rendered as groups of buttons in generic containers.
- There is no list semantics and no item count or grouping relationship announced.

Impact:

- Screen reader navigation is weaker than necessary.
- Users do not get structure such as “list with N items”.

Recommended fix:

- Render both collections as `ul`/`li`.
- Keep buttons inside list items for actions.
- Consider associating the search status text with the result list via `aria-describedby`.

### Medium

#### 6. Search field is labeled, but its help and async status are not programmatically tied together

Files:

- `src/app/components/SelectedLocationSearchPanel.tsx`

Problem:

- The input has a visible label, but the hint text and loading/error status are separate paragraphs with no id linkage.
- Search is debounced and async, yet the field does not expose related description or status ids.

Impact:

- Screen reader users may not hear the usage hint or changing search status in the right context.

Recommended fix:

- Add explicit ids for the input, hint, and status region.
- Use `aria-describedby` on the input to connect the hint and current status.
- Consider a result count announcement when results arrive.

#### 7. Loading skeletons expose busy states, but not always meaningful text alternatives

Files:

- `src/app/components/WeatherCards.tsx`
- `src/app/components/WeatherGraph.tsx`

Problem:

- Skeleton blocks are mostly hidden from assistive tech with `aria-hidden`, which is correct.
- However, several loading areas rely on visual placeholders without a nearby text status describing what is loading.

Impact:

- Users can land inside a busy region without learning whether the app is loading current weather, forecast data, or search data.

Recommended fix:

- Pair `aria-busy` with a concise visible or screen-reader-only loading message.
- Make the loading scope specific, for example “Loading current weather for Berlin”.

#### 8. Error announcements are inconsistent across surfaces

Files:

- `src/app/components/AppHeader.tsx`
- `src/app/components/WeatherCards.tsx`
- `src/app/components/SelectedLocationSearchPanel.tsx`

Problem:

- Some errors are in `aria-live` containers, some are not.
- Retry buttons are present, but error blocks are not consistently exposed as alert-like regions.

Impact:

- Important failures can be missed, especially when they appear outside the currently focused area.

Recommended fix:

- Use a consistent pattern for async failures.
- For important failures, prefer `role="alert"` or an assertive/polite live region depending on severity.

#### 9. Forecast chips are visually grouped but not semantically identified as a forecast list

Files:

- `src/app/components/WeatherCards.tsx`
- `src/app/components/WeatherGraph.tsx`

Problem:

- Forecast items are rendered as `article` elements in horizontally scrolling `div` containers.
- There is no list role or list semantics.

Impact:

- Users lose collection structure and item count.

Recommended fix:

- Use `ul`/`li` or `role="list"`/`role="listitem"` if layout constraints make native list elements awkward.

### Low

#### 10. The close button name is redundant with visible text

Files:

- `src/app/components/SelectedLocationPopover.tsx`

Problem:

- The close button already contains visible text “Close”, but also sets `aria-label="Close location popover"`.

Impact:

- Not a major issue, but can create unnecessary divergence between visible and spoken names.

Recommended fix:

- Prefer visible text as the accessible name unless extra specificity is required.

#### 11. Small accent text may have contrast risk on translucent panels

Files:

- `src/styles.css`

Problem:

- Muted text and small uppercase labels use translucent colors over layered dark gradients.
- The exact contrast ratio likely changes with backdrop blending.

Impact:

- Small section labels may be difficult to read for low-vision users.

Recommended fix:

- Verify contrast for the smallest muted text against the effective rendered background.
- Increase foreground opacity or size where necessary.

## Priority Fix Order

1. Rebuild the app header as a proper disclosure.
2. Add focus management and semantics to the selected-location popover.
3. Give interactive location cards explicit accessible names.
4. Convert visual labels to real headings and convert result/forecast groups to lists.
5. Normalize loading and error announcements across weather and search flows.

## Candidate Lint Rules To Enforce

Useful automated checks for this codebase:

- interactive controls must have an accessible name
- form controls must have labels
- non-interactive elements should not behave like interactive widgets
- ARIA usage should match supported roles and states
- elements using click handlers should preserve keyboard accessibility
- redundant or invalid ARIA should be flagged

Linting will not catch the focus-management and disclosure-pattern issues by itself, so manual review must remain part of the workflow.
