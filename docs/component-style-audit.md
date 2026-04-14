# Component Style Audit: Implementation ↔ Design

Сопоставление каждого стилизованного компонента в `src/styles.css` с соответствующим элементом в Paper «weather app».

Артборды-источники:
- **4-0** — Desktop / Edit Mode
- **DP-0** — Desktop / Open Popover
- **GV-0** — Desktop / Close Popover
- **1BZ-1** — Desktop / Switch Location
- **18T-1** — Desktop / Loading States

> **Верификация**: собранные стили проверены Playwright-скриптом `test/repl/playwright-style-audit.mjs`
> против вычисленных (computed) значений `getComputedStyle()`.
> Последний прогон: 2026-04-14.

---

## Таблица компонентов

### 1. Страница и фон

| CSS класс | Роль в рендер-дереве | Дизайн-элемент | Дизайн bg | Дизайн border | CSS (source) | Computed (actual) | Вердикт |
|---|---|---|---|---|---|---|---|
| `body` | Корневой фон страницы | Artboard background (4S-0) | #ECE7E1 solid + radial blobs (sky-wash 16%, signal 24%) | — | radial blobs (sky-wash 16%, signal 24%) + gradient paper→fog | `radial-gradient(...rgba(124,201,214,0.16)...), radial-gradient(...rgba(234,251,87,0.24)...), linear-gradient(rgb(236,231,225), rgba(216,209,200,0.92))` | ✅ OK |
| `body::before` | Декоративная сетка | Background grid lines (4W…4Z) | steel 12%/8% line grid + paper radials | — | steel 12%/8% grid + paper radials | `linear-gradient(90deg, rgba(163,155,144,0.12) 1px,...), linear-gradient(rgba(163,155,144,0.08) 1px,...), radial-gradient(...)` | ✅ OK |

### 2. App Header (Status trigger + panel)

| CSS класс | Роль в рендер-дереве | Дизайн-элемент | CSS bg | Computed bg | Вердикт |
|---|---|---|---|---|---|
| `.app-header-trigger` | `App` → `AppHeader` → trigger button | Нет прямого аналога (дизайн показывает «MinVær» лого) | radial-gradient paper + linear-gradient paper/fog | `radial-gradient(circle at 35% 35%, rgba(236,231,225,0.96),...) + linear-gradient(135deg, rgba(236,231,225,0.92), rgba(216,209,200,0.82))` | ⚠️ Уникален для реализации |
| `.app-header-trigger__dot` | Зелёная точка внутри trigger | Нет в дизайне | `#EAFB57` solid + signal glow | `rgb(234,251,87)`, box-shadow `rgba(234,251,87,0.22) 0 0 0 5.6px` | ⚠️ Уникален для реализации |
| `.app-header` | Раскрывающаяся панель статуса | Нет в дизайне | `var(--surface-popover)` | — (не видна по умолчанию) | ⚠️ Уникален для реализации |
| `.metric-card` | Карточка метрики (Boot state, Root node…) | Нет в дизайне | `rgb(ink / 0.04)` | — (не видна по умолчанию) | ⚠️ Уникален для реализации |

### 3. Featured Location Card (главная карточка погоды)

| CSS класс | Дизайн | CSS (source) | Computed (actual) | Вердикт |
|---|---|---|---|---|
| `.location-card--featured` bg | `linear-gradient(180deg, white/52%, fog/62%)` | `linear-gradient(180deg, rgb(255 255 255/0.52), rgb(fog/0.62))` | `linear-gradient(rgba(255,255,255,0.52), rgba(216,209,200,0.62))` | ✅ OK |
| `.location-card--featured` border | 2px `#1715131F` (ink/12%) | `1px solid rgb(ink/0.1)` (наследует `.location-card`) | `1px solid rgba(23,21,19,0.1)` = 1px ink/10% | ⚠️ Дизайн 2px ink/12%, CSS 1px ink/10% |
| `.location-card--featured` box-shadow | `#17151314 0px 28px 40px` (ink/8%) | `--shadow-soft` = `0 28px 40px rgb(ink/0.08)` | `rgba(23,21,19,0.08) 0px 28px 40px` | ✅ OK |

### 4. Weather Readout (featured card / additional card)

| CSS класс | Дизайн | CSS (source) | Computed (actual) | Вердикт |
|---|---|---|---|---|
| `.weather-readout` bg (featured card) | transparent (часть featured card body) | `--surface-card-soft` = `rgb(ink/0.04)` | `rgba(23,21,19,0.04)` = ink/4% | ⚠️ Дизайн: нет отдельного bg. CSS: ink/4%. Сознательное решение — один класс для featured и popover. |
| `.weather-readout` border | нет | `--border-subtle` = ink/8% | `1px solid rgba(23,21,19,0.08)` | ⚠️ Дизайн: нет border у readout на featured card. CSS: 1px ink/8%. |
| `.weather-readout__label` color | `#6C655C` IBM Plex Mono 12px | `--text-muted` = `#6c655c` | `rgb(108,101,92)` = #6C655C | ✅ OK |
| `.weather-readout__label` font | IBM Plex Mono 12px | IBM Plex Mono 0.7rem | `"IBM Plex Mono" 11.2px` | ✅ Близко (11.2 vs 12) |
| `.weather-readout__value` color | `#171513` (ink) Bricolage 156px | `--text-primary` = ink/96% | `rgba(23,21,19,0.96)` | ✅ OK (96% ≈ solid) |
| `.weather-readout__value` font | Bricolage 156px | Bricolage clamp(3rem,8vw,5rem) | `"Bricolage Grotesque" 86.4px` | ⚠️ Размер: дизайн 156px, CSS 86.4px. Рассмотрено в sizing. |
| `.weather-readout__summary` color | `#47423D` (soot) Source Sans 20px | `--text-secondary` = `#47423d` | `rgb(71,66,61)` = #47423D | ✅ OK |
| `.weather-readout__meta` color | — | `--text-muted` = `#6c655c` | `rgb(108,101,92)` = #6C655C | ✅ OK |

### 5. Status Pill (IDLE / READY / ERROR…)

| CSS класс | Дизайн | CSS (source) | Computed (actual) | Вердикт |
|---|---|---|---|---|
| `.status-pill--ready` bg | `#EAFB57` solid (signal) | `--feedback-success-bg` = `var(--color-signal)` | `rgb(234,251,87)` = #EAFB57 solid | ✅ OK |
| `.status-pill--ready` text | `#171513` (ink) | `--feedback-success-text` = `var(--color-ink)` | `rgb(23,21,19)` = ink solid | ✅ OK |

### 6. Forecast Chips (Hourly / Daily на featured card)

| CSS класс | Дизайн | CSS (source) | Computed (actual) | Вердикт |
|---|---|---|---|---|
| `.forecast-chip` bg | `#1715130F` (ink/6%) | `rgb(ink/0.06)` | `rgba(23,21,19,0.06)` = ink/6% | ✅ OK |
| `.forecast-chip` border | 1px `#17151314` (ink/8%) | `--border-subtle` = ink/8% | `1px solid rgba(23,21,19,0.08)` | ✅ OK |
| `.forecast-chip__label` color | `#6C655C` IBM Plex 11px | `--text-muted` = `#6c655c` | `rgb(108,101,92)` = #6C655C, IBM Plex Mono 10.88px | ✅ OK |
| `.forecast-chip strong` color | `#171513` Bricolage 38px | `--text-primary` Bricolage 1.2rem | `rgba(23,21,19,0.96)` Bricolage 19.2px | ✅ Цвет OK. ⚠️ Размер: дизайн 38px, CSS 19.2px. |
| `.forecast-chip p` color | `#47423D` Source Sans 16px | `--text-secondary` = `#47423d` | `rgb(71,66,61)` Source Sans 14.08px | ✅ Цвет OK. ⚠️ Размер: дизайн 16px, CSS 14.08px. |

### 7. Additional Location Cards ("Siste søk")

| CSS класс | Дизайн | CSS (source) | Computed (actual) | Вердикт |
|---|---|---|---|---|
| `.location-card` bg | `#FFFFFF94` (white/58%) | `--surface-card` = `rgb(255 255 255/0.58)` | `rgba(255,255,255,0.58)` = white/58% | ✅ OK |
| `.location-card` border | 1px `#1715131A` (ink/10%) | `1px solid rgb(ink/0.1)` | `1px solid rgba(23,21,19,0.1)` = 1px ink/10% | ✅ OK |
| `.location-card` box-shadow | `#17151314 0px 28px 40px` (ink/8%) | `--shadow-soft` | `rgba(23,21,19,0.08) 0px 28px 40px` | ✅ OK |

### 8. Popover Surface

| CSS класс | Дизайн | CSS (source) | Computed (actual) | Вердикт |
|---|---|---|---|---|
| `.selected-location-popover--floating` bg | `#FFFFFFD6` (white/84%) | `--surface-popover` = `rgb(255 255 255/0.84)` | `rgba(255,255,255,0.84)` = white/84% | ✅ OK |
| `.selected-location-popover--floating` border | 2px `#1715131F` (ink/12%) | `2px solid --border-medium`; `border-width: 2px 0 0 0` | `border-width: 2px 0px 0px`, color `rgba(23,21,19,0.12)` | ✅ Top-only border by design (arrow connects below) |
| `.selected-location-popover--floating` box-shadow | `#17151317 0px 28px 40px` (ink/9%) | нет (убран для floating) | `none` | ⚠️ Дизайн ink/9% shadow, CSS: none. |

### 9. Popover Arrow

| CSS класс | Дизайн | CSS (source) | Computed (actual) | Вердикт |
|---|---|---|---|---|
| `.selected-location-popover-arrow--floating` bg | `#FFFFFFD6` (white/84%) | `--surface-popover` | `rgba(255,255,255,0.84)` | ✅ OK |
| arrow border | 2px `#1715131F` top+left | `2px solid --border-medium` top+left | `border-width: 2px 0px 0px 2px`, color `rgba(23,21,19,0.12)` | ✅ OK |
| arrow box-shadow | — | `-5px -5px 18px rgb(ink/0.06)` | `rgba(23,21,19,0.06) -5px -5px 18px` | ✅ OK |

### 10. Popover Header (Edit location + Close)

| CSS класс | Дизайн | CSS (source) | Computed (actual) | Вердикт |
|---|---|---|---|---|
| `button.selected-location-popover__edit-trigger` bg | `#EAFB57` **solid** (signal), нет border | `var(--color-signal)`, border transparent | `rgb(234,251,87)` = #EAFB57 solid, border `transparent` | ✅ OK |
| `button.selected-location-popover__edit-trigger` text | ink | `var(--color-ink)` | `rgb(23,21,19)` = ink | ✅ OK |
| `button.selected-location-popover__close` bg | `#171513` **solid** (ink), нет border | `var(--color-ink)`, border transparent | `rgb(23,21,19)` = ink solid, border `transparent` | ✅ OK |
| `.selected-location-popover__close` text | `#ECE7E1` (paper) | `var(--color-paper)` | `rgb(236,231,225)` = paper | ✅ OK |

### 11. Popover Weather Section (inner readout)

| CSS класс | Дизайн | CSS (source) | Computed (actual) | Вердикт |
|---|---|---|---|---|
| `.weather-readout` in popover bg | `#1715130A` (ink/4%) | `--surface-card-soft` = ink/4% | `rgba(23,21,19,0.04)` = ink/4% | ✅ OK |
| `.weather-readout` in popover border | 1px `#17151314` (ink/8%) | `--border-subtle` = ink/8% | `1px solid rgba(23,21,19,0.08)` | ✅ OK |

### 12. Popover Forecast Chips (inside popover)

| CSS класс | Дизайн | CSS (source) | Computed (actual) | Вердикт |
|---|---|---|---|---|
| `.forecast-chip` (popover) bg | `#1715130F` (ink/6%) | `rgb(ink/0.06)` | `rgba(23,21,19,0.06)` = ink/6% | ✅ OK |
| `.forecast-chip` (popover) border | нет | `.selected-location-popover__body .forecast-chip { border: none }` | `border-width: 0px` | ✅ OK |

### 13. "Search another location" button (inside search panel)

| CSS класс | Дизайн | CSS (source) | Computed (actual) | Вердикт |
|---|---|---|---|---|
| `.selected-location-search__controls > button:not(.secondary)` | signal solid | `var(--color-signal)`, border transparent | `rgb(234,251,87)` = #EAFB57, border transparent | ✅ OK |

### 14. Search Panel (Edit Mode)

| CSS класс | Дизайн | CSS (source) | Computed (actual) | Вердикт |
|---|---|---|---|---|
| `.selected-location-search` | Нет wrapper-фрейма (часть popover body) | `rgb(ink/0.04)`, `--border-subtle` | `rgba(23,21,19,0.04)`, `1px solid rgba(23,21,19,0.08)` | ⚠️ Уникален для реализации |

### 15. Search Input

| CSS класс | Дизайн | CSS (source) | Computed (actual) | Вердикт |
|---|---|---|---|---|
| `input` bg | `#ECE7E1` (paper solid) | `--surface-control` = `var(--color-paper)` | `rgb(236,231,225)` = #ECE7E1 paper solid | ✅ OK |
| `input` border | 1px `#1715131F` (ink/12%) | `--border-medium` = ink/12% | `1px solid rgba(23,21,19,0.12)` | ✅ OK |

### 16. Search Results

| CSS класс | Дизайн | CSS (source) | Computed (actual) | Вердикт |
|---|---|---|---|---|
| `.selected-location-search__result` bg | `#1715130D` (ink/5%) | `rgb(ink/0.05)` | `rgba(23,21,19,0.05)` (by source; Playwright captured `--current` variant) | ✅ OK (by source) |
| `.selected-location-search__result` border | 1px `#17151314` (ink/8%) | `1px solid rgb(ink/0.08)` | `1px solid rgba(23,21,19,0.08)` (by source) | ✅ OK |

### 17. Search Sidebar (Saved Picks)

| CSS класс | Дизайн | CSS (source) | Computed (actual) | Вердикт |
|---|---|---|---|---|
| `.selected-location-search__sidebar` bg | transparent | `background: transparent` | `rgba(0,0,0,0)` = transparent | ✅ OK |
| `.selected-location-search__sidebar` border | нет | `border: none` | `border-width: 0px` | ✅ OK |

### 18. "Use current location" button

| CSS класс | Дизайн | CSS (source) | Computed (actual) | Вердикт |
|---|---|---|---|---|
| `.selected-location-search__result--current` | Нет прямого аналога | `--surface-sky-tint`, `--border-medium` | `rgba(124,201,214,0.14)`, `1px solid rgba(23,21,19,0.12)` | ⚠️ Уникален для реализации |

---

## Сводка: вердикт после верификации

### ✅ Ранее ❌ — исправлены

1. **"Search Another Location" button** — теперь `#EAFB57` solid, border transparent. ✅
2. **Close (×) button** — теперь `#171513` solid, border transparent. ✅
3. **Search submit button** — теперь `#EAFB57` solid, border transparent. ✅
4. **Status pill `--ready`** — теперь `#EAFB57` solid bg, ink solid text. ✅
5. **Popover forecast chips border** — теперь `border: none`. ✅
6. **Search sidebar bg/border** — теперь `transparent`, `border: none`. ✅
7. **Search results border** — теперь `1px solid ink/8%`. ✅
8. **Search input** — теперь paper solid bg, ink/12% border. ✅
9. **Text colors** — `--text-secondary` = `#47423d`, `--text-muted` = `#6c655c`. Прямые hex, совпадают с дизайном. ✅

### ⚠️ Остаточные различия (мелкие, сознательные)

1. **Featured card border** — дизайн: 2px ink/12%. CSS: 1px ink/10% (наследует `.location-card`). Различие в толщине и прозрачности.
2. **Featured card weather-readout bg/border** — дизайн: нет (transparent, часть card). CSS: ink/4% bg + ink/8% border. Сознательное решение — один `.weather-readout` класс для featured и popover контекстов.
3. **Popover box-shadow** — дизайн: ink/9% `0 28px 40px`. CSS: none (для floating popover). Может быть утеряно при переработке.
4. **Font sizes** — температура (86.4px vs 156px), chip strong (19.2px vs 38px), chip p (14.08px vs 16px) — рассмотрено в sizing micro-tuning, используется responsive clamp.

### 🔎 Не проверено Playwright (элементы невидимы по умолчанию)

- `.app-header` (панель статуса) — открывается по триггеру, не проверена
- `.metric-card` — часть панели статуса
- `.selected-location-search__saved-result` — появляется только при наличии сохранённых результатов
