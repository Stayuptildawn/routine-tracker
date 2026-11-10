import { useId } from 'react'
import type { ReactNode } from 'react'
import { useOverlay } from '../../lib/overlay'
import { t } from '../../i18n'
import { IconButton, cx } from './Button'
import { ProgressBar } from './Feedback'

interface SheetProps {
  /** Small caps line in the top bar: where you are. */
  title: ReactNode
  /** Accessible name of the whole view. */
  label: string
  onClose: () => void
  /** Name of the close button ("exit", "close"). */
  closeLabel?: string
  /** true while the exit transition plays (usePresence in the parent) */
  closing?: boolean
  /** 0..1 draws a progress rail across the top edge. */
  progress?: number
  className?: string
  children: ReactNode
}

/** A full-screen view that takes over from the tabs (settings, a session,
 *  the routine player, an editor). Focus is trapped inside, the page behind
 *  is pinned, and Escape or the phone's back button close it. */
export function Sheet({ title, label, onClose, closeLabel, closing, progress, className, children }: SheetProps) {
  const ref = useOverlay<HTMLDivElement>(onClose)
  return (
    <div
      ref={ref}
      className={cx('sheet', className)}
      data-closing={closing || undefined}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      {progress !== undefined && <ProgressBar value={progress} className="sheet__progress" />}
      <div className="sheet__inner">
        <header className="sheet__bar">
          <span className="eyebrow">{title}</span>
          <IconButton icon="x" label={closeLabel ?? t.common.close} onClick={onClose} />
        </header>
        {children}
      </div>
    </div>
  )
}

interface DialogProps {
  title?: ReactNode
  /** Accessible name when there is no visible title. */
  label?: string
  onClose: () => void
  closing?: boolean
  className?: string
  children: ReactNode
}

/** A small question or message over the page: a bottom sheet on phones
 *  (thumb reach), a centred card on wider screens. Tapping the dimmed page,
 *  Escape and the back button all close it. */
export function Dialog({ title, label, onClose, closing, className, children }: DialogProps) {
  const ref = useOverlay<HTMLDivElement>(onClose)
  const titleId = useId()
  return (
    <div className="dialog-backdrop" data-closing={closing || undefined} onClick={onClose}>
      <div
        ref={ref}
        className={cx('dialog', className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : label}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <h2 className="dialog__title" id={titleId}>
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  )
}
