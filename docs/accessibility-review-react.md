# Accessibility Review — React Components

Ревью проведено по компонентам в `src/components/`. Оценка по WCAG 2.1 AA.

> **Статус: все 15 проблем исправлены.** См. список изменений ниже.

---

## Общая оценка

Кодовая база демонстрирует осознанный подход к доступности: семантический HTML, ARIA-атрибуты, `.sr-only` текст, управление фокусом в поповере, `role="alert"` / `role="status"` для динамического контента. Ниже перечислены конкретные проблемы и рекомендации.

---

## 1. Критические проблемы (WCAG A / AA)

### 1.1 `index.html` — `maximum-scale=1.0` запрещает зум

**Файл:** `index.html`, строка 7

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
```

**Критерий:** WCAG 1.4.4 Resize Text  
**Проблема:** `maximum-scale=1.0` блокирует пинч-зум на мобильных устройствах. Пользователи со слабым зрением не смогут увеличить текст.  
**Рекомендация:** Удалить `maximum-scale=1.0` или установить `maximum-scale=5.0`.

### 1.2 Sparkline SVG — данные недоступны для screen reader

**Файл:** `WeatherSparkline.tsx` — компонент `SparklineDashes`

```tsx
<svg role="img" aria-label="Hourly temperature sparkline">
```

**Критерий:** WCAG 1.1.1 Non-text Content  
**Проблема:** `aria-label` даёт общую подпись, но сами температурные значения внутри SVG (`<line>`) не имеют текстовых альтернатив. Screen reader озвучит только «Hourly temperature sparkline» без конкретных данных.  
**Рекомендация:** Добавить скрытую таблицу или `<desc>` с диапазоном температур, например: `<desc>Температура от 12 °C до 24 °C за 24 часа</desc>`. Или разместить `sr-only` текст рядом с SVG.

### 1.3 Popover — отсутствует `aria-labelledby` / `aria-label` на `<section>`

**Файл:** `SelectedLocationPopover.tsx`, строка ~264

```tsx
<section
  ref={popoverRef}
  id={SELECTED_LOCATION_POPOVER_ID}
  popover="manual"
  ...
>
```

**Критерий:** WCAG 4.1.2 Name, Role, Value  
**Проблема:** `<section>` с `popover="manual"` не имеет `aria-label` или `aria-labelledby`. Роль диалога задаётся на вложенном `<div role="dialog">`, но внешний `<section>` в popover-стеке останется безымянным landmark.  
**Рекомендация:** Добавить `aria-label="Location details"` на `<section>`, либо удалить landmark-роль через `role="presentation"`.

### 1.4 Отсутствует `prefers-reduced-motion`

**Файл:** `styles.css`  
**Критерий:** WCAG 2.3.3 Animation from Interactions  
**Проблема:** Используются Lottie-анимации погоды и `behavior: 'smooth'` для скролла, но нет CSS `@media (prefers-reduced-motion: reduce)` ни для анимаций, ни для `scroll-behavior`.  
**Рекомендация:** Добавить media-query для отключения / замедления Lottie-анимаций и переходов.

---

## 2. Серьёзные проблемы (WCAG AA)

### 2.1 Sparkline icon track — `title` вместо текстовой альтернативы

**Файл:** `WeatherSparkline.tsx` — компонент `SparklineIconTrack`

```tsx
<div ... title={summary}>
  <WeatherConditionIcon weatherCode={weatherCode} isDay={true} />
</div>
```

**Критерий:** WCAG 1.1.1 Non-text Content  
**Проблема:** Иконки помечены `aria-hidden="true"` (правильно), но `title` не озвучивается большинством screen readers. Информация о состоянии погоды (summary) пропадает.  
**Рекомендация:** Добавить `sr-only` span с `summary` внутри или рядом с иконкой, либо использовать `aria-label` на контейнере иконки с `role="img"`.

### 2.2 `WeatherConditionIcon` — всегда `aria-hidden="true"`

**Файл:** `WeatherConditionIcon.tsx`

```tsx
<div ref={containerRef} className={...} aria-hidden="true" />
```

**Проблема:** В контекстах, где иконка — единственный визуальный индикатор состояния (например, в `CurrentWeatherCard`), screen reader не получит информации о погодных условиях. В `CurrentWeatherCard` рядом выводится `summary` текстом, что частично компенсирует проблему, но в `SparklineIconTrack` этого нет.  
**Рекомендация:** Убедиться, что `summary` текст всегда доступен рядом с иконкой. В изолированных контекстах рассмотреть вынос `aria-hidden` в пропс.

### 2.3 Popover — `aria-modal="false"` при `popover="manual"`

**Файл:** `SelectedLocationPopover.tsx`

```tsx
<div role="dialog" aria-modal="false" aria-label="Location details" tabIndex={-1}>
```

**Проблема:** `popover="manual"` требует ручного управления закрытием — пользователь может tab за пределы поповера, потерять контекст и не понять, что поповер открыт. Focus trap отсутствует.  
**Рекомендация:** Реализовать focus trap (цикл Tab/Shift+Tab внутри поповера) или переключить на `aria-modal="true"` если поповер блокирует контент. Альтернативно — добавить явную инструкцию `aria-describedby` с текстом «Press Escape to close».

### 2.4 `<time>` элемент без `datetime` атрибута

**Файл:** `WeatherGraph.tsx` — компонент `WeatherUpdateTimestamp`

```tsx
<time className="weather-global-timestamp" title={...}>
  ⟳ {mainFmt.short}
</time>
```

**Критерий:** WCAG 1.3.1 Info and Relationships  
**Проблема:** `<time>` не имеет `datetime` атрибута с машинно-читаемым значением. Assistive technology не сможет интерпретировать дату.  
**Рекомендация:** Добавить `datetime={mainTime}` с ISO-строкой.

### 2.5 `input:focus` — только border, нет видимого outline

**Файл:** `styles.css`, строка 175

```css
input:focus {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px rgb(var(--color-sky-wash-rgb) / 0.18);
}
```

**Критерий:** WCAG 2.4.7 Focus Visible  
**Проблема:** У `<input>` стоит `outline: none` (строка 167), а индикация фокуса — через `border-color` + `box-shadow`. `box-shadow` с opacity 0.18 может быть едва видим при низком контрасте дисплея.  
**Рекомендация:** Увеличить `box-shadow` opacity до 0.4+ или вернуть `outline` для `input:focus-visible`.

---

## 3. Умеренные проблемы

### 3.1 Status pill — цвет как единственный индикатор

**Файл:** `WeatherCards.tsx`

```tsx
<span className={`status-pill status-pill--${status}`}>{status}</span>
```

**Критерий:** WCAG 1.4.1 Use of Color  
**Проблема:** Текст pill содержит статус (`loading`, `error`, `ready`), что хорошо. Но визуально разные статусы отличаются только цветом фона. Для дальтоников разница может быть неразличима.  
**Рекомендация:** Добавить иконку или рамку для error-статуса.

### 3.2 `<article>` внутри `<button>` — вложенный interactive/landmark

**Файл:** `WeatherGraph.tsx` — `WeatherLocationInner`

Внутри `<button className="selected-location-card-button">` располагается `<article>` (через `CurrentWeatherCard`). По спецификации HTML, `<button>` не может содержать `<article>`.  
**Рекомендация:** Заменить `<article>` внутри кнопки на `<div>`.

### 3.3 Metric card — `<article>` без heading

**Файл:** `AppHeader.tsx`

```tsx
<article className="metric-card">
  <span>Boot state</span>
  <strong>{bootedLabel}</strong>
</article>
```

**Критерий:** WCAG 1.3.1 Info and Relationships  
**Проблема:** `<article>` ожидает heading для идентификации. Здесь `<span>` выполняет роль заголовка, но не является им семантически.  
**Рекомендация:** Использовать `<div>` вместо `<article>`, или добавить `aria-label` на каждый metric-card.

### 3.4 Hardcoded `id` — коллизия при множественных экземплярах

**Файлы:** `SelectedLocationSearchPanel.tsx`

```tsx
const searchInputId = 'selected-location-search-input'
```

**Проблема:** Если компонент будет отрендерен дважды (например, в SPA), `id` дублируется — `aria-controls` и `htmlFor` потеряют привязку.  
**Рекомендация:** Использовать `React.useId()` для генерации уникальных `id`.

### 3.5 Keyboard navigation — нет skip link

**Файл:** `App.tsx`

**Критерий:** WCAG 2.4.1 Bypass Blocks  
**Проблема:** Нет ссылки «Skip to main content». При навигации Tab пользователь будет проходить через header и все элементы управления перед контентом.  
**Рекомендация:** Добавить скрытую ссылку `<a href="#main" class="sr-only focus:not-sr-only">Skip to main content</a>` в начало `<main>` или перед ним.

---

## 4. Рекомендации по улучшению (Best Practices)

### 4.1 `lang` атрибут на динамическом контенте

Названия городов могут быть на разных языках. Для screen readers, которые переключают произношение по `lang`, стоит рассмотреть `lang` атрибут на элементах с названиями локаций.

### 4.2 Live regions для обновления погоды

При автоматическом обновлении погоды (`WeatherUpdateTimestamp`) значение меняется без уведомления screen reader. Рассмотреть `aria-live="polite"` на timestamp или отдельный `sr-only` live region.

### 4.3 Touch target size

Кнопка статуса `app-header-trigger` и кнопки удаления `×` в saved picks должны иметь минимальный размер 44×44 CSS px (WCAG 2.5.5 Target Size). Проверить реальные размеры.

### 4.4 Цветовой контраст

Многие текстовые переменные используют opacity (`text-subtle: 0.54`, `text-muted`). Нужна ручная проверка контрастности конкретных комбинаций `text-subtle` на `surface-*` фонах — порог 4.5:1 для мелкого текста.

### 4.5 Тёмная тема

`color-scheme: light` задана, но `prefers-color-scheme: dark` не обработан. Пользователи, предпочитающие тёмную тему, увидят светлый интерфейс.

---

## Сводная таблица

| # | Компонент | Критерий WCAG | Серьёзность | Описание |
|---|-----------|---------------|-------------|----------|
| 1.1 | `index.html` | 1.4.4 Resize Text | Критическая | `maximum-scale=1.0` блокирует зум |
| 1.2 | `WeatherSparkline` | 1.1.1 Non-text Content | Критическая | SVG sparkline без текстового описания данных |
| 1.3 | `SelectedLocationPopover` | 4.1.2 Name, Role, Value | Критическая | Popover `<section>` без имени |
| 1.4 | `styles.css` | 2.3.3 Animation | Критическая | Нет `prefers-reduced-motion` |
| 2.1 | `WeatherSparkline` | 1.1.1 Non-text Content | Серьёзная | Icon `title` не озвучивается screen reader |
| 2.2 | `WeatherConditionIcon` | 1.1.1 Non-text Content | Серьёзная | `aria-hidden` без текстовой замены в sparkline |
| 2.3 | `SelectedLocationPopover` | 2.4.3 Focus Order | Серьёзная | Нет focus trap в ручном поповере |
| 2.4 | `WeatherGraph` | 1.3.1 Info and Relationships | Серьёзная | `<time>` без `datetime` |
| 2.5 | `styles.css` | 2.4.7 Focus Visible | Серьёзная | Слабо видимый фокус на `<input>` |
| 3.1 | `WeatherCards` | 1.4.1 Use of Color | Умеренная | Цвет — единственный индикатор status pill |
| 3.2 | `WeatherGraph` | HTML spec | Умеренная | `<article>` внутри `<button>` |
| 3.3 | `AppHeader` | 1.3.1 Info and Relationships | Умеренная | `<article>` без heading |
| 3.4 | `SearchPanel` | 4.1.1 Parsing | Умеренная | Hardcoded `id` — риск дублирования |
| 3.5 | `App` | 2.4.1 Bypass Blocks | Умеренная | Нет skip link |

---

## Что уже хорошо

- `<main>`, `<header>`, `<section>`, `<h1>`–`<h3>` — правильные landmark-ы и heading hierarchy
- `.sr-only` текст для скрытых заголовков и fallback-состояний
- `aria-expanded`, `aria-controls`, `aria-haspopup="dialog"` на триггерах поповера
- `role="alert"` для ошибок загрузки, `role="status"` для индикаторов загрузки
- Escape закрывает поповер и возвращает фокус на триггер
- `aria-busy="true"` на skeleton fallback-ах
- `aria-hidden="true"` на декоративных элементах (dot, arrow, skeleton)
- `focus-visible` стили на кнопках с `outline: 2px solid`
- `htmlFor` привязка на search input
- `aria-label` на списках результатов и кнопке удаления
