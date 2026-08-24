import { useEffect, useRef } from 'react'
import gsap from 'gsap'

import { usePrefersReducedMotion } from './ui'

/**
 * The tagline that builds itself letter by letter and then unbuilds the same
 * way before the next line takes over.
 *
 * Each character is its own span with its own 3D transform, so the line arrives
 * as a wave rotating up out of the page rather than a plain fade. Exit reverses
 * the stagger (`from: 'end'`) so it reads as the sentence retracting the way it
 * came, which is what makes the loop feel deliberate instead of repetitive.
 */
const LINES = [
  'Your AI Solution Partner',
  'Your Secrets, Shared Once',
  'Practical AI. Real Engineering.',
]

export function Tagline() {
  const host = useRef<HTMLDivElement>(null)
  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    if (reduced || !host.current) return
    const root = host.current
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ repeat: -1 })

      LINES.forEach((_, i) => {
        const chars = root.querySelectorAll<HTMLElement>(`[data-line="${i}"] span`)
        const line = root.querySelector<HTMLElement>(`[data-line="${i}"]`)

        tl.set(line, { display: 'inline-block' })
          .fromTo(
            chars,
            { opacity: 0, rotateX: -90, y: 26, z: -140, filter: 'blur(6px)' },
            {
              opacity: 1,
              rotateX: 0,
              y: 0,
              z: 0,
              filter: 'blur(0px)',
              duration: 0.55,
              // expo, not back/elastic — overshoot reads as decorative bounce
              ease: 'expo.out',
              stagger: 0.032,
            },
          )
          .to({}, { duration: 1.9 }) // hold, so it is actually readable
          .to(chars, {
            opacity: 0,
            rotateX: 90,
            y: -26,
            z: -140,
            filter: 'blur(6px)',
            duration: 0.32,
            ease: 'power2.in',
            stagger: { each: 0.022, from: 'end' }, // retracts the way it arrived
          })
          .set(line, { display: 'none' })
      })
    }, root)

    return () => ctx.revert()
  }, [reduced])

  // Reduced motion: no animation, no cycling — just the primary line.
  if (reduced) {
    return (
      <p className="text-xl font-semibold text-paper/90 sm:text-2xl">
        {LINES[0]}
      </p>
    )
  }

  return (
    <div
      ref={host}
      className="flex min-h-[2.5rem] items-center text-xl font-semibold sm:min-h-[3rem] sm:text-2xl"
      style={{ perspective: '600px' }}
      aria-label={LINES[0]}
    >
      <span aria-hidden>
        {LINES.map((line, i) => (
          <span key={line} data-line={i} style={{ display: i === 0 ? 'inline-block' : 'none' }}>
            {[...line].map((ch, j) => (
              <span
                key={`${i}-${j}`}
                className="inline-block will-change-transform"
                style={{ whiteSpace: ch === ' ' ? 'pre' : undefined }}
              >
                {ch}
              </span>
            ))}
          </span>
        ))}
      </span>
      <span
        className="ml-1 inline-block h-[1.1em] w-[3px] bg-brand-red"
        style={{ animation: 'caret 1.06s step-end infinite' }}
        aria-hidden
      />
    </div>
  )
}
