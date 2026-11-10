import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { cx } from './ui/Button'
import type { ButtonVariant } from './ui/Button'

/** Two-tap destructive button: the first tap arms it (label swaps to the
 *  confirm text), the second fires. Disarms by itself after a few seconds so
 *  a stray tap never leaves a live trigger behind. Replaces window.confirm,
 *  which looks foreign in the PWA and can't be styled or backed out of. */
export default function ConfirmButton({
  variant = 'danger',
  size,
  iconOnly,
  className,
  label,
  ariaLabel,
  confirmLabel,
  title,
  onConfirm,
}: {
  /** The resting look; once armed it always turns the solid danger colour. */
  variant?: ButtonVariant
  size?: 'sm'
  /** The resting label is a lone icon: render it as a square icon button. */
  iconOnly?: boolean
  className?: string
  label: ReactNode
  /** Names an icon-only button for screen readers. */
  ariaLabel?: string
  confirmLabel: string
  title?: string
  onConfirm: () => void
}) {
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])

  return (
    <button
      type="button"
      className={cx(
        armed ? 'btn btn--armed' : iconOnly ? 'icon-btn icon-btn--danger' : `btn btn--${variant}`,
        size && !iconOnly && `btn--${size}`,
        className,
      )}
      title={title}
      aria-label={armed ? undefined : ariaLabel ?? (iconOnly ? title : undefined)}
      onClick={() => {
        if (armed) {
          setArmed(false)
          onConfirm()
        } else {
          setArmed(true)
        }
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  )
}
