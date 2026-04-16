# Mobile Optimisation: Full Implementation Brief

You are optimising an existing production Next.js site called **Macro Bias** (macro-bias.com) for mobile screens. The site currently works on desktop and has responsive Tailwind utilities throughout, but a full audit has identified **3 HIGH**, **9 MEDIUM**, and **15+ LOW** severity mobile issues that need to be fixed. Your job is to resolve every issue in priority order, verify the build passes, and leave no regressions.

Read this entire document before writing any code. Then create a detailed plan. Then execute.

---

## 1. THE EXISTING SYSTEM

### Architecture
- **Framework**: Next.js 15 (App Router), TypeScript, Tailwind CSS 3
- **Deployment**: Vercel
- **Key directories**:
  - `src/app/` — page components (App Router)
  - `src/components/` — shared UI components
  - `src/components/dashboard/` — dashboard-specific chart/gauge components
  - `src/components/track-record/` — PerformanceChart
- **Tailwind config**: Default breakpoints (`sm: 640px`, `md: 768px`, `lg: 1024px`, `xl: 1280px`)
- **Fonts**: Space Grotesk + IBM Plex Mono via CSS variables in `layout.tsx`
- **Charts**: Recharts library (ResponsiveContainer, LineChart, AreaChart)
- **No existing hamburger/mobile menu** — this is the most critical gap

### Touch target standard
All interactive elements (links, buttons) must be a minimum of **44×44px** (Apple HIG / WCAG 2.5.5). Use `min-h-[44px]` and adequate padding to ensure this.

---

## 2. AUDIT FINDINGS BY FILE

### 2.1 `src/components/SiteNav.tsx` — **CRITICAL**

**Current state**: All nav links use `className="hidden sm:inline"`. Below 640px the entire navigation disappears. Only the "Get Signals" button remains. There is **no hamburger menu, no drawer, no toggle** of any kind.

**Required changes**:

1. **Add a hamburger menu for mobile** (screens `< sm` / below 640px):
   - Add a state variable `const [mobileMenuOpen, setMobileMenuOpen] = useState(false)`
   - Render a hamburger button (`☰` or an SVG icon) in the nav bar, visible only below `sm` (`sm:hidden`)
   - When toggled open, render a full-width dropdown panel below the nav bar containing all nav links stacked vertically
   - The dropdown should have the same dark background as the nav, a bottom border, and `z-50` layering
   - Close the menu when a link is clicked (add `onClick={() => setMobileMenuOpen(false)}` to each link)
   - The existing desktop link list (`hidden sm:flex` row) stays unchanged

2. **Increase "Get Signals" button touch target**:
   - Change `py-1.5` → `py-2.5` on the CTA button (already visible on mobile)

3. **Logo link hit area**:
   - Add `py-2` to the logo `<Link>` so the tap target is taller

**Nav links to include in mobile menu** (same as desktop):
```
Dashboard | Track Record | Briefings | Regime | Pricing | Refer & Earn
```
Plus the "Get Signals" CTA button at the bottom of the mobile menu.

**Exact hamburger/close icon to use** (inline SVG, no external icon library):
```tsx
// Hamburger (3 lines)
<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
  <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
</svg>

// Close (X)
<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
  <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
</svg>
```

---

### 2.2 `src/app/track-record/page.tsx` — **HIGH**

**Current state**: The stats strip uses `grid grid-cols-3` with no responsive modifier. On a 375px phone (327px after `px-6` padding), each column is only ~109px. The `text-2xl sm:text-3xl` values and `text-[10px] tracking-[0.36em]` labels with `border-r` + `px-6` padding cause the cells to visually crush or overflow.

**Required changes**:

1. **Stats strip**: Change `grid-cols-3` → `grid grid-cols-3 sm:grid-cols-3` but reduce inner padding on mobile:
   - On each stat cell, use `px-3 sm:px-6` instead of `px-6`
   - Reduce value font size: `text-xl sm:text-2xl md:text-3xl`
   - Keep the `border-r border-white/10` dividers — they still work with smaller padding

2. **Methodology grid**: Change `grid gap-10 lg:grid-cols-3` → `grid gap-10 md:grid-cols-3`

3. **Chart legend**: Add `flex-wrap` to the `flex items-center gap-6` legend row so it wraps on small screens

---

### 2.3 `src/app/dashboard/page.tsx` — **HIGH**

**Current state**: The historical analogs table uses `min-w-[44rem]` (704px) inside an `overflow-x-auto` wrapper, requiring horizontal scrolling on every mobile device. Additionally, the cross-asset map grid doesn't activate multi-column until `lg`.

**Required changes**:

1. **Historical analogs table scroll UX**: Keep `overflow-x-auto` but improve the mobile experience:
   - Add a `text-[10px] text-zinc-500 sm:hidden` label above the table: `"← scroll to see all columns →"`
   - Remove `whitespace-nowrap` from the outer wrapper div — apply it only to `<th>` and `<td>` elements that need it (ticker symbols, dates)
   - Ensure the wrapper uses `w-full` with `-mx-4 px-4` only applied at mobile breakpoints so it doesn't cause double-edge overflow at larger sizes

2. **Cross-asset map grid**: Change `grid grid-cols-1 gap-3 lg:grid-cols-3` → `grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5` (or 3-col at `lg` if 5-col is too dense)

3. **Dashboard header metadata**: Change `grid grid-cols-1 gap-4 md:grid-cols-3` → `grid grid-cols-1 gap-3 sm:grid-cols-3` so the date/snapshot/breadth strip shows inline sooner

4. **0.5px borders**: Search for `border-[0.5px]` in this file and replace with `border border-white/5` (sub-pixel borders are invisible on many Android devices)

---

### 2.4 `src/components/paywall-wrapper.tsx` — **MEDIUM**

**Current state**: Modal is `max-w-[22rem]` (352px) in a 375px viewport — near edge-to-edge. Modal is positioned `absolute inset-0 items-center` which centers it in the parent container height, so on a long dashboard page the modal may be scrolled out of view.

**Required changes**:

1. **Modal width**: Change `max-w-[22rem]` → `max-w-[min(22rem,calc(100vw-2rem))]` so there's always at least 16px of margin on each side on any screen width

2. **Modal positioning**: Change the overlay from `absolute inset-0` to `fixed inset-0` so the modal is always centered in the **viewport**, not the parent container. This is especially important on the dashboard where paywall-wrapped sections appear deep in a scrollable page.

3. **Modal overflow safety**: Add `max-h-[90dvh] overflow-y-auto` to the modal panel in case content ever grows

---

### 2.5 `src/components/track-record/PerformanceChart.tsx` — **MEDIUM**

**Current state**: `margin={{ left: -8 }}` pulls the chart left of container, risking Y-axis label clipping inside bordered card wrappers. X-axis tick density can cause overlapping dates on narrow screens.

**Required changes**:

1. **Y-axis margin**: Change `margin={{ left: -8, right: 8, top: 8, bottom: 0 }}` → `margin={{ left: 4, right: 8, top: 8, bottom: 0 }}` and add `width={48}` to the `<YAxis>` component to explicitly reserve label space

2. **X-axis tick density**: Change tick interval from `Math.floor(data.length / 6)` → `Math.floor(data.length / 4)` to reduce to 4 ticks on all screen sizes, preventing overlap on narrow screens. The chart is inside a `ResponsiveContainer` so this will naturally adapt.

3. **X-axis tick angle on small screens**: Add `angle={0}` as a prop (explicit, for clarity) — do NOT angle ticks, just reduce count

---

### 2.6 `src/app/briefings/page.tsx` — **MEDIUM**

**Current state**: Briefing list item links use `py-4` (32px height) — below the 44px touch target minimum. The `AssetToggle` component in the header row may overflow on narrow screens.

**Required changes**:

1. **List item touch targets**: On the archive list `<Link>` rows, change `py-4` → `py-3 min-h-[44px] flex items-center` to ensure 44px minimum while keeping visual rhythm

2. **Header row layout**: Change the header `flex items-center justify-between` to `flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between` so the label and `AssetToggle` stack vertically on mobile instead of potentially overflowing

---

### 2.7 `src/app/pricing/page.tsx` — **MEDIUM**

**Current state**: Pricing card comparison grid only splits at `lg` (1024px). Tablets (768–1024px) see two tall stacked cards instead of side-by-side, defeating the comparison layout.

**Required changes**:

1. **Pricing grid**: Change `grid gap-6 lg:grid-cols-2` → `grid gap-6 md:grid-cols-2`

---

### 2.8 `src/app/refer/refer-page-client.tsx` — **MEDIUM**

**Current state**: Email addresses in the recent referrals list have no truncation, risking overflow in `flex justify-between` rows. Copy/Open buttons are 32px tall (below 44px minimum).

**Required changes**:

1. **Email truncation**: On the `referred_email` display spans in the recent referrals list, add `truncate max-w-[180px] sm:max-w-none` 

2. **Button touch targets**: On the Copy Link / Open Landing buttons, change `py-2` → `py-2.5 min-h-[44px]`

3. **Outer vertical padding**: Change `py-20` → `py-12 sm:py-20`

4. **Referral link grid**: Change `lg:grid-cols-[1.3fr_0.9fr]` → `md:grid-cols-[1.3fr_0.9fr]`

---

### 2.9 `src/components/ReferralPromoCard.tsx` — **MEDIUM**

**Current state**: CTA buttons use `py-2 text-sm` giving ~36-38px height. Both buttons are `inline-flex` in a `flex-wrap` row with no `w-full` on mobile.

**Required changes**:

1. **Button touch targets**: Change `py-2` → `py-2.5 min-h-[44px]` on both `<Link>` buttons

2. **Full-width on mobile**: Add `w-full sm:w-auto` to both buttons so they fill the card width on narrow screens

---

### 2.10 `src/components/SiteFooter.tsx` — **LOW**

**Required changes**:

1. **Footer link touch targets**: Add `px-1 py-2 -mx-1` to each footer `<a>` / `<Link>` element

2. **Copyright text size**: Change `text-[10px]` → `text-[11px]`

3. **Bottom safe-area padding**: Add `pb-safe` or `pb-6` to the footer's outer `<footer>` element for notched iPhones — use `className="... pb-6 sm:pb-8"`

---

### 2.11 `src/app/page.tsx` (Homepage) — **LOW**

**Required changes**:

1. **Section vertical padding**: Change `py-24` → `py-16 sm:py-24` on all major sections (hero, pillars, auth) to reduce wasted space on short mobile screens

2. **Auth grid breakpoint**: Change `xl:grid-cols-[minmax(0,1fr)_420px]` → `lg:grid-cols-[minmax(0,1fr)_420px]`

3. **Pillar grid breakpoint**: Change `lg:grid-cols-3` → `md:grid-cols-3` on the quant pillars section

4. **CTA button widths**: Add `w-full sm:w-auto sm:min-w-[220px]` to the hero CTA buttons

---

### 2.12 `src/app/regime/page.tsx` — **LOW**

**Required changes**:

1. **CTA buttons**: Add `w-full sm:w-auto` to both CTA buttons in the bottom section

---

### 2.13 `src/components/dashboard/AssetHeatmap.tsx` — **LOW**

**Required changes**:

1. **Grid steps**: Change `sm:grid-cols-2 xl:grid-cols-5` → `sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5`

2. **Section gap**: Change `space-y-12` → `space-y-6 sm:space-y-12`

3. **Price text size**: Change `text-2xl font-semibold` → `text-xl sm:text-2xl font-semibold`

---

### 2.14 `src/components/dashboard/SignalBreakdown.tsx` — **LOW**

**Required changes**:

1. **Grid breakpoint**: Change `xl:grid-cols-4` → `lg:grid-cols-4`

2. **Min-width on pillar left column**: Add `min-w-0` to the left content div inside each pillar card to prevent overflow

---

## 3. EXECUTION ORDER

Execute in this exact order — highest severity first, shared layout components first within each tier:

### Pass 1 — HIGH severity (critical, do these first)
1. `src/components/SiteNav.tsx` — add mobile hamburger menu
2. `src/app/track-record/page.tsx` — fix crushing stats strip
3. `src/app/dashboard/page.tsx` — fix analog table + grid steps

### Pass 2 — MEDIUM severity
4. `src/components/paywall-wrapper.tsx` — modal width + fixed positioning
5. `src/components/track-record/PerformanceChart.tsx` — Y-axis + tick density
6. `src/app/briefings/page.tsx` — touch targets + header overflow
7. `src/app/pricing/page.tsx` — grid breakpoint
8. `src/app/refer/refer-page-client.tsx` — truncation + touch targets
9. `src/components/ReferralPromoCard.tsx` — touch targets + full-width

### Pass 3 — LOW severity (polish)
10. `src/components/SiteFooter.tsx` — tap targets + safe-area
11. `src/app/page.tsx` — padding + grid breakpoints
12. `src/app/regime/page.tsx` — button widths
13. `src/components/dashboard/AssetHeatmap.tsx` — grid steps + spacing
14. `src/components/dashboard/SignalBreakdown.tsx` — grid + min-width

---

## 4. CONSTRAINTS

- **Do not** install any new npm packages. Use only inline SVGs for the hamburger icon (no Heroicons, Lucide, or similar).
- **Do not** change any visual design, colours, typography weight/family, or spacing on desktop (`sm:` and above). All changes must be behind mobile-only breakpoints or use the `sm:` modifier to restore desktop behaviour.
- **Do not** create new files unless absolutely necessary (the hamburger state can live in `SiteNav.tsx` itself as it is already a client component).
- **Do not** add `"use client"` to any currently server-only component. If a component needs state for mobile toggle, check whether it is already a client component first.
- After every Pass, run `npx next build` and confirm it succeeds before continuing to the next Pass.
- After all 3 Passes, run `npm run referral:simulate` to confirm the referral funnel still works.

---

## 5. DEFINITION OF DONE

- [ ] `npx next build` succeeds with 0 errors
- [ ] `npm run referral:simulate` passes 88/88
- [ ] On a 375px viewport, all navigation links are reachable via the hamburger menu
- [ ] On a 375px viewport, the track-record stats strip is readable (no overflow, no crushing)
- [ ] On a 375px viewport, all buttons and links meet the 44px touch target minimum
- [ ] The paywall modal is always visible in the viewport regardless of page scroll position
- [ ] No desktop layout has changed (verify on 1280px viewport)
