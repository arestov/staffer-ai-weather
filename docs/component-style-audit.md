# Component Style Audit: Implementation ↔ Design

Сопоставление каждого стилизованного компонента в `src/styles.css` с соответствующим элементом в Paper «weather app».

Артборды-источники:
- **4-0** — Desktop / Edit Mode
- **DP-0** — Desktop / Open Popover
- **GV-0** — Desktop / Close Popover
- **1BZ-1** — Desktop / Switch Location
- **18T-1** — Desktop / Loading States

---

## Таблица компонентов

### 1. Страница и фон

| CSS класс | Роль в рендер-дереве | Дизайн-элемент | Дизайн bg | Дизайн border | Текущий CSS bg | Текущий CSS border | Расхождение |
|---|---|---|---|---|---|---|---|
| `body` | Корневой фон страницы | Artboard background (4S-0) | #ECE7E1 solid + radial blobs (sky-wash 16%, signal 24%) | — | radial blobs (sky-wash 16%, signal 24%) + gradient paper→fog | — | ✅ OK |
| `body::before` | Декоративная сетка | Background grid lines (4W…4Z) | steel 12%/8% line grid + paper radials | — | steel 12%/8% grid + paper radials | — | ✅ OK |

### 2. App Header (Status trigger + panel)

| CSS класс | Роль в рендер-дереве | Дизайн-элемент | Дизайн bg | Дизайн border | Текущий CSS bg | Текущий CSS border | Расхождение |
|---|---|---|---|---|---|---|---|
| `.app-header-trigger` | `App` → `AppHeader` → trigger button | Нет прямого аналога (дизайн показывает «MinVær» лого, а не Status pill) | — | — | radial-gradient paper + linear-gradient paper/fog | glow + panel shadow | ⚠️ Компонент уникален для реализации, нет в дизайне |
| `.app-header-trigger__dot` | Зелёная точка внутри trigger | Нет в дизайне | — | — | #EAFB57 solid + signal glow | — | ⚠️ Уникален для реализации |
| `.app-header` | Раскрывающаяся панель статуса | Нет в дизайне | — | — | `var(--surface-popover)` | `--border-medium` | ⚠️ Уникален для реализации |
| `.metric-card` | Карточка метрики (Boot state, Root node…) | Нет в дизайне | — | — | `rgb(ink / 0.04)` | `--border-subtle` | ⚠️ Уникален для реализации |

### 3. Featured Location Card (главная карточка погоды)

| CSS класс | Роль в рендер-дереве | Дизайн-элемент | Дизайн bg | Дизайн border | Текущий CSS bg | Текущий CSS border | Расхождение |
|---|---|---|---|---|---|---|---|
| `.location-card--featured` | `WeatherGraph` → `FeaturedLocationCard` → `.location-card` | Frame 5B-0 / FM-0 (1336×440) | `linear-gradient(180deg, white/52%, fog/62%)` | 2px `#1715131F` (ink/12%) | `linear-gradient(180deg, rgb(255 255 255/0.52), rgb(fog/0.62))` | 2px `--border-medium` (ink/12%) | ✅ OK |
| `.location-card--featured` box-shadow | — | — | — | `#17151314 0px 28px 40px` (ink/8%) | `--shadow-soft` = `0 28px 40px rgb(ink/0.08)` | — | ✅ OK |

### 4. Weather Readout (featured card / additional card)

| CSS класс | Роль в рендер-дереве | Дизайн-элемент | Дизайн bg | Дизайн border | Текущий CSS bg | Текущий CSS border | Расхождение |
|---|---|---|---|---|---|---|---|
| `.weather-readout` (on featured card) | Внутри `.location-card__body` | Нет отдельного фрейма — readout рисуется напрямую в featured card body без собственного контейнера | transparent (часть featured card) | нет | `var(--surface-card-soft)` = `rgb(ink/0.06)` | `--border-subtle` | ⚠️ В дизайне weather readout в featured card **не** имеет собственного bg или border — он просто часть featured card body. Однако в popover readout есть bg. Это нормально — CSS использует один класс для обоих. |
| `.weather-readout__label` | Location name label | Text 5E-0 "Featured selected slot" | — | — | `--text-muted` (soot/66%) | — | Дизайн: `#6C655C` (soot-like) IBM Plex Mono 12px. CSS: soot/66% ≈ `#807a72` ≠ `#6C655C`. |
| `.weather-readout__value` | Temperature "27°" | Text 5I-0 | — | — | `--text-primary` | — | Дизайн: Bricolage 156px, `#171513`. CSS: Bricolage clamp(3rem,8vw,5rem). ✅ цвета OK. ⚠️ Размер шрифта рассмотрен в sizing. |
| `.weather-readout__summary` | "Clear enough to…" | Text 5G-0 | — | — | `--text-secondary` (soot/88%) | — | Дизайн: `#47423D` (soot) Source Sans 20px. CSS: soot/88% ≈ `#524d48`. ⚠️ `#47423D` это чистый soot без альфы, а не soot/88%. |
| `.weather-readout__meta` | Status pill row | Frame 5J-0 | — | — | `--text-muted` | — | ✅ OK |

### 5. Status Pill (IDLE / READY / ERROR…)

| CSS класс | Роль в рендер-дереве | Дизайн-элемент | Дизайн bg | Дизайн border | Текущий CSS bg | Текущий CSS border | Расхождение |
|---|---|---|---|---|---|---|---|
| `.status-pill--ready` | Inside `.weather-readout__meta` | Frame 5L-0 "Idle" pill | `#EAFB57` solid (signal) | нет | `var(--feedback-success-bg)` = `rgb(signal / 0.3)` | — | ❌ **Дизайн**: signal **solid**. **CSS**: signal **30%** opacity. Должен быть `#EAFB57` solid. |
| `.status-pill--ready` text | — | Text 5M-0 "Idle" | `#171513` (ink) | — | `--feedback-success-text` = `rgb(ink / 0.9)` | — | ⚠️ Дизайн ink solid, CSS ink/90%. Близко. |

### 6. Forecast Chips (Hourly / Daily на featured card)

| CSS класс | Роль в рендер-дереве | Дизайн-элемент | Дизайн bg | Дизайн border | Текущий CSS bg | Текущий CSS border | Расхождение |
|---|---|---|---|---|---|---|---|
| `.forecast-chip` (on featured card) | `FeaturedLocationCard` → `forecast-panels` → `forecast-list` → `ForecastCard` | Frame 5R-0 / 5V-0 (180×124) | `#1715130F` (ink/6%) | 1px `#17151314` (ink/8%) | `rgb(ink / 0.06)` | `--border-subtle` = `rgb(ink / 0.08)` | ✅ OK |
| `.forecast-chip__label` | "Hourly" / "Daily" | Text 5S-0 / 5W-0 | `#6C655C` IBM Plex 11px | — | `--text-muted` (soot/66%) | — | ⚠️ Тот же muted color offset. |
| `.forecast-chip strong` | "24°" / "18°" | Text 5T-0 / 5X-0 | `#171513` Bricolage 38px | — | `--text-primary` Bricolage 1.2rem | — | ⚠️ Размер в sizing. Цвет ✅. |
| `.forecast-chip p` | "15:00 / still bright" | Text 5U-0 / 5Y-0 | `#47423D` (soot) Source Sans 16px | — | `--text-secondary` (soot/88%) | — | ⚠️ Чистый soot vs soot/88%. |

### 7. Additional Location Cards ("Siste søk")

| CSS класс | Роль в рендер-дереве | Дизайн-элемент | Дизайн bg | Дизайн border | Текущий CSS bg | Текущий CSS border | Расхождение |
|---|---|---|---|---|---|---|---|
| `.location-card` (non-featured) | `WeatherGraph` → `AdditionalLocationCard` → button → `.location-card` | Frame 77-0 / 7E-0 / 7O-0 (312×144) | `#FFFFFF94` (white/58%) | 1px `#1715131A` (ink/10%) | `var(--surface-card)` = `rgb(255 255 255 / 0.58)` | 2px `--border-medium` (ink/12%) | ⚠️ Border: дизайн 1px ink/10%, CSS 2px ink/12%. |

### 8. Popover Surface

| CSS класс | Роль в рендер-дереве | Дизайн-элемент | Дизайн bg | Дизайн border | Текущий CSS bg | Текущий CSS border | Расхождение |
|---|---|---|---|---|---|---|---|
| `.selected-location-popover--floating` | `SelectedLocationPopoverLayer` → `<section popover>` | Frame EK-0 / 62-0 (1080×362/454) | `#FFFFFFD6` (white/84%) | 2px `#1715131F` (ink/12%) | `var(--surface-popover)` = `rgb(255 255 255 / 0.84)` | 2px `--border-medium` (ink/12%) | ✅ OK |
| `.selected-location-popover--floating` box-shadow | — | — | — | `#17151317 0px 28px 40px` (ink/9%) | `--shadow-soft` = `0 28px 40px rgb(ink/0.08)` | — | ✅ Близко (9% vs 8%) |

### 9. Popover Arrow

| CSS класс | Роль в рендер-дереве | Дизайн-элемент | Дизайн bg | Дизайн border | Текущий CSS bg | Текущий CSS border | Расхождение |
|---|---|---|---|---|---|---|---|
| `.selected-location-popover-arrow--floating` | `SelectedLocationPopoverLayer` → `<section popover>` arrow | Rect EL-0 / 73-0 (28×28) | `#FFFFFFD6` (white/84%) | 2px `#1715131F` top+left | `var(--surface-popover)` | 2px `--border-medium` | ✅ OK |

### 10. Popover Header (Edit location + Close)

| CSS класс | Роль в рендер-дереве | Дизайн-элемент | Дизайн bg | Дизайн border | Текущий CSS bg | Текущий CSS border | Расхождение |
|---|---|---|---|---|---|---|---|
| `.selected-location-popover__edit-trigger` | "Search Another Location" button | Frame 6O-0 / F3-0 (188×40) | `#EAFB57` **solid** (signal) | нет | `linear-gradient(180deg, rgb(signal/0.94), rgb(signal/0.74))` | `rgb(signal/0.42)` | ❌ **Дизайн**: solid signal, без border. **CSS**: полупрозрачный градиент + полупрозрачный border. |
| `.selected-location-popover__close` | Close button "×" | Frame FH-0 / 67-0 (65×40) | `#171513` **solid** (ink) | нет | `var(--color-ink)` | transparent | ✅ bg OK |
| `.selected-location-popover__close` text | "Close" / "×" | Text FI-0 / 68-0 | `#ECE7E1` (paper) Source Sans 16px | — | `var(--color-paper)` | — | ✅ OK |

### 11. Popover Weather Section (inner readout)

| CSS класс | Роль в рендер-дереве | Дизайн-элемент | Дизайн bg | Дизайн border | Текущий CSS bg | Текущий CSS border | Расхождение |
|---|---|---|---|---|---|---|---|
| `.weather-readout--popover` (inside popover body) | Popover → `SelectedLocationPopoverWeatherSection` → `.weather-readout` | Frame F0-0 / 6A-0 (1028×228) | `#1715130A` (ink/4%) | 1px `#17151314` (ink/8%) | `var(--surface-card-soft)` = `rgb(ink/0.06)` | `--border-subtle` = `rgb(ink/0.08)` | ⚠️ bg: дизайн ink/4%, CSS ink/6%. Близко. |

### 12. Popover Forecast Chips (inside popover)

| CSS класс | Роль в рендер-дереве | Дизайн-элемент | Дизайн bg | Дизайн border | Текущий CSS bg | Текущий CSS border | Расхождение |
|---|---|---|---|---|---|---|---|
| `.forecast-chip` (popover context) | Popover → forecasts → chips | Frame F8-0 / F6-0 (100×44) | `#1715130F` (ink/6%) | нет | `rgb(ink/0.06)` | `--border-subtle` | ⚠️ Дизайн: **нет border** на popover chips. CSS: есть border. |

### 13. "Search another location" button (inside popover weather section)

| CSS класс | Роль в рендер-дереве | Дизайн-элемент | Дизайн bg | Дизайн border | Текущий CSS bg | Текущий CSS border | Расхождение |
|---|---|---|---|---|---|---|---|
| `.selected-location-search__controls > button:not(.secondary)` | Search submit button | — | — | — | same as edit-trigger gradient | same | ❌ Наследует ту же проблему с signal-gradient |

### 14. Search Panel (Edit Mode)

| CSS класс | Роль в рендер-дереве | Дизайн-элемент | Дизайн bg | Дизайн border | Текущий CSS bg | Текущий CSS border | Расхождение |
|---|---|---|---|---|---|---|---|
| `.selected-location-search` | Popover → `SelectedLocationSearchPanel` → search section | Нет единого wrapper-фрейма — search panel внутри popover body (69-0) | — | — | `rgb(ink/0.04)` | `--border-subtle` | ⚠️ В дизайне search panel не имеет собственный bg-wrapper, он часть popover body. |

### 15. Search Input

| CSS класс | Роль в рендер-дереве | Дизайн-элемент | Дизайн bg | Дизайн border | Текущий CSS bg | Текущий CSS border | Расхождение |
|---|---|---|---|---|---|---|---|
| `input` | Search text field | Frame 6S-0 (280×52) | `#ECE7E1` (paper solid) | 1px `#1715131F` (ink/12%) | `var(--surface-control)` = `rgb(paper/0.94)` | `--border-subtle` (ink/8%) | ⚠️ bg: дизайн paper solid, CSS paper/94%. border: дизайн ink/12%, CSS ink/8%. |

### 16. Search Results

| CSS класс | Роль в рендер-дереве | Дизайн-элемент | Дизайн bg | Дизайн border | Текущий CSS bg | Текущий CSS border | Расхождение |
|---|---|---|---|---|---|---|---|
| `.selected-location-search__result` | Search result row | Frame 6V-0 / 6Y-0 (280×72) | `#1715130D` (ink/5%) | 1px `#17151314` (ink/8%) | `rgb(ink/0.06)` | нет | ⚠️ Дизайн: есть 1px border `#17151314`. CSS: нет border. Bg: дизайн ink/5%, CSS ink/6%. Близко. |
| `.selected-location-search__saved-result` | Saved pick row | Аналогично 6V-0 | `#1715130D` (ink/5%) | 1px `#17151314` (ink/8%) | `rgb(ink/0.06)` | нет | ⚠️ Та же разница что и result. |

### 17. Search Sidebar (Saved Picks)

| CSS класс | Роль в рендер-дереве | Дизайн-элемент | Дизайн bg | Дизайн border | Текущий CSS bg | Текущий CSS border | Расхождение |
|---|---|---|---|---|---|---|---|
| `.selected-location-search__sidebar` | Sidebar "Saved picks" | Frame 6Q-0 (280×320) | нет bg (transparent) | нет border | `rgb(ink/0.04)` | `--border-subtle` | ⚠️ Дизайн: **нет** bg/border на sidebar. CSS: есть bg и border. |

### 18. "Use current location" button

| CSS класс | Роль в рендер-дереве | Дизайн-элемент | Дизайн bg | Дизайн border | Текущий CSS bg | Текущий CSS border | Расхождение |
|---|---|---|---|---|---|---|---|
| `.selected-location-search__result--current` | "Use current location" special row | Нет прямого аналога | — | — | `var(--surface-sky-tint)` | `--border-medium` | ⚠️ Уникален для реализации |

---

## Сводка расхождений с приоритетами

### ❌ Критические (заметно отличаются от дизайна)

1. **"Search Another Location" button** — CSS использует `linear-gradient(signal/0.94, signal/0.74)` + border `signal/0.42`. Дизайн: **`#EAFB57` solid**, без border.
2. **Search submit button** — наследует ту же проблему.
3. **Status pill `--ready`** — CSS использует `signal/0.3` (бледный). Дизайн: `#EAFB57` solid.

### ⚠️ Заметные (мелкие различия)

4. **Additional location card border** — CSS: 2px ink/12%. Дизайн: 1px ink/10%.
5. **Search results / saved results** — CSS: нет border. Дизайн: 1px `#17151314`.
6. **Search sidebar** — CSS: имеет bg + border. Дизайн: transparent, без border.
7. **Popover weather readout bg** — CSS: ink/6%. Дизайн: ink/4%.
8. **Popover forecast chips** — CSS: есть border. Дизайн: нет border у popover chips.
9. **Input field** — CSS: paper/94% bg, ink/8% border. Дизайн: paper solid, ink/12% border.
10. **Text colors** — `--text-secondary` и `--text-muted` используют alpha на soot, дизайн использует плоские цвета (`#47423D` = soot, `#6C655C`).
