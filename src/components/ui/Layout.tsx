import { useState } from 'react'
import type { HTMLAttributes, ReactNode } from 'react'
import Icon from '../Icon'
import type { IconName } from '../Icon'
import { t } from '../../i18n'
import { IconButton, cx } from './Button'

interface ScreenHeaderProps {
  title: ReactNode
  /** Small line above the title (the weekday, a section name). */
  eyebrow?: ReactNode
  /** One sentence under the title. */
  lede?: ReactNode
  /** Renders a Back control above the title, for views opened from another screen. */
  onBack?: () => void
  /** Settings sits top-right on every screen; the desktop rail hides it. */
  onOpenSettings?: () => void
  /** Extra controls placed before the settings button. */
  children?: ReactNode
}

/** The top of every screen: where you are, and the way to Settings. */
export function ScreenHeader({ title, eyebrow, lede, onBack, onOpenSettings, children }: ScreenHeaderProps) {
  return (
    <header className="screen-head">
      {onBack && (
        <button type="button" className="btn btn--ghost screen-head__back" onClick={onBack}>
          <Icon name="chevron-left" className="icon--flip" />
          {t.common.back}
        </button>
      )}
      <div className="screen-head__row">
        <div className="screen-head__titles">
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1>{title}</h1>
        </div>
        <div className="screen-head__actions">
          {children}
          {onOpenSettings && (
            <IconButton icon="settings" label={t.common.settings} className="screen-head__settings" onClick={onOpenSettings} />
          )}
        </div>
      </div>
      {lede && <p className="hint">{lede}</p>}
    </header>
  )
}

interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode
  /** Quiet text after the title (a count, a week number). */
  meta?: ReactNode
  /** A control at the end of the title row. */
  action?: ReactNode
  /** feature = the amber wash for the one thing to do next; good = finished. */
  tone?: 'feature' | 'good'
}

/** A bordered group. Use it around things that belong together, not around
 *  everything: when every block is a card, none of them stands out. */
export function Card({ title, meta, action, tone, className, children, ...rest }: CardProps) {
  return (
    <section className={cx('card', tone && `card--${tone}`, className)} {...rest}>
      {(title || action) && (
        <div className="card__head">
          <h2 className="card__title">
            {title}
            {meta && <span className="meta">{meta}</span>}
          </h2>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

interface DisclosureProps {
  label: ReactNode
  /** Controlled open state; leave out to let the component keep its own. */
  open?: boolean
  onToggle?: (open: boolean) => void
  defaultOpen?: boolean
  className?: string
  children: ReactNode
}

/** A fold: one line that opens to show more. Secondary tools live behind
 *  these so a screen reads as a few lines until the day calls for more. */
export function Disclosure({ label, open, onToggle, defaultOpen = false, className, children }: DisclosureProps) {
  const [own, setOwn] = useState(defaultOpen)
  const isOpen = open ?? own
  return (
    <div className={cx('disclosure', className)}>
      <button
        type="button"
        className="disclosure__toggle"
        aria-expanded={isOpen}
        onClick={() => {
          setOwn(!isOpen)
          onToggle?.(!isOpen)
        }}
      >
        <Icon name="chevron-down" className="disclosure__chevron" />
        {label}
      </button>
      {isOpen && <div className="disclosure__body">{children}</div>}
    </div>
  )
}

interface ListRowProps {
  label: ReactNode
  icon?: IconName
  /** Quiet text at the end, before the arrow. */
  meta?: ReactNode
  onClick: () => void
}

/** A full-width row that goes somewhere. */
export function ListRow({ label, icon, meta, onClick }: ListRowProps) {
  return (
    <button type="button" className="list-row" onClick={onClick}>
      {icon && <Icon name={icon} />}
      <span className="list-row__label">{label}</span>
      {meta && <span className="meta">{meta}</span>}
      <Icon name="chevron-right" className="icon--flip list-row__chevron" />
    </button>
  )
}
