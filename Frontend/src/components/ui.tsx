import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronLeft, ChevronRight, Copy } from 'lucide-react'

/** Primary action. Petrol by default; `danger` for anything destructive. */
export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled,
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  variant?: 'primary' | 'danger' | 'ghost'
  disabled?: boolean
  className?: string
}) {
  const styles = {
    primary:
      'bg-brand-navy-lit text-white hover:bg-brand-navy-lit/85 shadow-[0_10px_30px_-12px] shadow-brand-navy-lit/70',
    danger: 'bg-brand-red text-white hover:bg-brand-red-hot shadow-[0_10px_30px_-12px] shadow-brand-red/70',
    ghost: 'glass text-paper hover:bg-white/8',
  }[variant]
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`cursor-pointer rounded-xl px-5 py-3 text-sm font-semibold tracking-wide transition-all duration-200 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${className}`}
    >
      {children}
    </button>
  )
}

/** Copy-to-clipboard with a confirmation the eye can actually catch. */
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => setDone(false), 1800)
    return () => clearTimeout(t)
  }, [done])

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setDone(true)
        } catch {
          setDone(false)
        }
      }}
      className="flex cursor-pointer items-center gap-2 rounded-lg bg-white/6 px-3 py-2 text-xs font-semibold text-paper transition hover:bg-white/12"
      aria-label={done ? 'Copied' : label}
    >
      {done ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
      {done ? 'Copied' : label}
    </button>
  )
}

const STATUS = {
  active: { label: 'Active', cls: 'bg-emerald-400/12 text-emerald-300 border-emerald-400/25' },
  viewed: { label: 'Viewed & destroyed', cls: 'bg-brand-navy-lit/15 text-sky-300 border-sky-400/25' },
  expired: { label: 'Expired', cls: 'bg-white/6 text-muted border-white/12' },
  revoked: { label: 'Revoked', cls: 'bg-brand-red/15 text-red-300 border-brand-red/30' },
  destroyed: { label: 'Destroyed', cls: 'bg-brand-red/20 text-red-300 border-brand-red/40' },
} as const

export function StatusPill({ status }: { status: keyof typeof STATUS }) {
  const s = STATUS[status] ?? STATUS.expired
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${s.cls}`}>
      {s.label}
    </span>
  )
}

/** Live countdown. Ticks once a second, stops at zero. */
export function Countdown({ to }: { to: string }) {
  const [left, setLeft] = useState(() => new Date(to).getTime() - Date.now())
  useEffect(() => {
    const id = setInterval(() => setLeft(new Date(to).getTime() - Date.now()), 1000)
    return () => clearInterval(id)
  }, [to])

  if (left <= 0) return <span className="font-mono text-xs text-muted">expired</span>
  const s = Math.floor(left / 1000)
  const parts =
    s >= 86400
      ? `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`
      : s >= 3600
        ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
        : `${Math.floor(s / 60)}m ${s % 60}s`
  return <span className="font-mono text-xs text-muted">{parts} left</span>
}

/** Section heading with the hairline rule used across the app. */
export function SectionTitle({ kicker, title, sub }: { kicker?: string; title: string; sub?: string }) {
  return (
    <div className="mb-8">
      {kicker && (
        <p className="mb-2 font-mono text-xs tracking-[0.2em] text-brand-red uppercase">{kicker}</p>
      )}
      <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h2>
      {sub && <p className="mt-3 max-w-2xl text-muted">{sub}</p>}
    </div>
  )
}

// --- pagination -------------------------------------------------------------
// The list endpoints return up to 200 rows in one call, and both the dashboard
// and the requests page used to render every one of them. Paging is therefore
// purely a display concern — no request is repeated when you change page.

/**
 * Slice a list into pages.
 *
 * The clamp is the part that matters. Revoking the only row on the last page
 * shrinks the list under you, and a stale `page` would render an empty screen.
 * Clamping during RENDER rather than in an effect means that never paints — an
 * effect would show the blank frame first and correct it afterwards.
 */
export function usePaged<T>(rows: T[] | null, pageSize: number) {
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil((rows?.length ?? 0) / pageSize))
  const safe = Math.min(page, pageCount - 1)
  return {
    page: safe,
    setPage,
    pageCount,
    slice: rows ? rows.slice(safe * pageSize, safe * pageSize + pageSize) : [],
  }
}

/**
 * Which page numbers to show: always the first, the last, and the current one
 * with a neighbour either side, with gaps collapsed to an ellipsis.
 *
 * 200 rows at 4 per page is 50 pages. Printing 50 buttons would just be a
 * smaller version of the wall of content this exists to fix.
 */
function pageSlots(page: number, count: number): (number | 'gap')[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i)

  const wanted = [0, count - 1, page - 1, page, page + 1]
  const nums = [...new Set(wanted)].filter((n) => n >= 0 && n < count).sort((a, b) => a - b)

  const out: (number | 'gap')[] = []
  let prev = -1
  for (const n of nums) {
    if (prev !== -1 && n - prev > 1) out.push('gap')
    out.push(n)
    prev = n
  }
  return out
}

/**
 * Numbered pager. Presentational — the caller owns the page state, normally via
 * `usePaged`, so that paging never touches the data it is paging over.
 */
export function Pager({
  page,
  pageCount,
  total,
  pageSize,
  onChange,
  noun,
}: {
  /** zero-based */
  page: number
  pageCount: number
  total: number
  pageSize: number
  onChange: (next: number) => void
  /** plural, for the "Showing 5–8 of 17 requests" line */
  noun: string
}) {
  // One page needs no controls. This is what keeps the page visually identical
  // for anyone who has fewer rows than the page size.
  if (pageCount <= 1) return null

  const from = page * pageSize + 1
  const to = Math.min(total, from + pageSize - 1)

  const step =
    'flex h-9 min-w-9 cursor-pointer items-center justify-center rounded-lg px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent'

  return (
    <nav
      aria-label="Pagination"
      className="mt-6 flex flex-col items-center justify-between gap-3 sm:flex-row"
    >
      <p className="text-xs text-muted">
        Showing{' '}
        <span className="text-paper">
          {from}–{to}
        </span>{' '}
        of {total} {noun}
      </p>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(page - 1)}
          disabled={page === 0}
          aria-label="Previous page"
          className={`${step} text-muted hover:bg-white/6 hover:text-paper`}
        >
          <ChevronLeft size={16} />
        </button>

        {pageSlots(page, pageCount).map((slot, i) =>
          slot === 'gap' ? (
            // Decoration, not a control — never announced, never focusable.
            <span key={`gap-${i}`} aria-hidden className="px-1 text-xs text-muted">
              …
            </span>
          ) : (
            <button
              key={slot}
              type="button"
              onClick={() => onChange(slot)}
              aria-label={`Page ${slot + 1}`}
              aria-current={slot === page ? 'page' : undefined}
              className={`${step} ${
                slot === page
                  ? 'bg-brand-navy-lit/20 text-paper'
                  : 'text-muted hover:bg-white/6 hover:text-paper'
              }`}
            >
              {slot + 1}
            </button>
          ),
        )}

        <button
          type="button"
          onClick={() => onChange(page + 1)}
          disabled={page === pageCount - 1}
          aria-label="Next page"
          className={`${step} text-muted hover:bg-white/6 hover:text-paper`}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </nav>
  )
}

/** Card that tilts toward the pointer. Pure CSS transforms, no WebGL. */
export function TiltCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = usePrefersReducedMotion()

  return (
    <div
      ref={ref}
      onPointerMove={(e) => {
        if (reduced || !ref.current) return
        const r = ref.current.getBoundingClientRect()
        const px = (e.clientX - r.left) / r.width - 0.5
        const py = (e.clientY - r.top) / r.height - 0.5
        ref.current.style.transform = `perspective(900px) rotateY(${px * 7}deg) rotateX(${-py * 7}deg) translateZ(0)`
      }}
      onPointerLeave={() => {
        if (ref.current) ref.current.style.transform = ''
      }}
      className={`card p-6 transition-transform duration-300 ease-out ${className}`}
    >
      {children}
    </div>
  )
}

/**
 * Closes a popover when the user clicks outside it or presses Escape.
 *
 * Attach the returned ref to the element that wraps BOTH the trigger and the
 * panel — otherwise clicking the trigger counts as "outside", and the menu
 * closes and reopens in the same gesture.
 *
 * `pointerdown` rather than `click`: it fires before the target's own click
 * handler, so a menu item still activates while the menu closes cleanly. The
 * listeners only exist while `open` is true.
 */
export function useDismissOnOutside<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
): React.RefObject<T | null> {
  const ref = useRef<T>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  return ref
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}
