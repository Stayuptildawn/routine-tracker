import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

/** Two-tap destructive button: the first tap arms it (label swaps to the
 *  confirm text), the second fires. Disarms by itself after a few seconds so
 *  a stray tap never leaves a live trigger behind. Replaces window.confirm,
 *  which looks foreign in the PWA and can't be styled or backed out of. */
export default function ConfirmButton({
  className,
  label,
  confirmLabel,
  title,
  onConfirm,
}: {
  className?: string
  label: ReactNode
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
      className={armed ? `${className ?? ''} confirm-armed`.trim() : className}
      title={title}
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
