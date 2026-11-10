import type { ReactNode } from 'react'
import Icon from '../Icon'
import type { IconName } from '../Icon'
import { t } from '../../i18n'
import { Button, IconButton, cx } from './Button'

type Tone = 'info' | 'good' | 'warn' | 'error'

const TONE_ICON: Record<Tone, IconName | null> = { info: null, good: 'check', warn: 'shield', error: 'alert' }

interface NoticeProps {
  /** info = neutral note; good = it worked; warn = heads-up; error = it failed. */
  tone?: Tone
  icon?: IconName
  onDismiss?: () => void
  className?: string
  children: ReactNode
}

/** An inline message. The tone picks colour and icon, so good news never
 *  looks like the failure under it. Errors are announced immediately. */
export function Notice({ tone = 'info', icon, onDismiss, className, children }: NoticeProps) {
  const shown = icon ?? TONE_ICON[tone]
  return (
    <div className={cx('notice', `notice--${tone}`, className)} role={tone === 'error' ? 'alert' : 'status'}>
      {shown && <Icon name={shown} />}
      <div className="notice__body">{children}</div>
      {onDismiss && <IconButton icon="x" label={t.common.dismiss} onClick={onDismiss} />}
    </div>
  )
}

/** Shown in place of a list that has nothing in it yet. */
export function EmptyState({ icon, children, action }: { icon?: IconName; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <Icon name={icon} />}
      <p>{children}</p>
      {action}
    </div>
  )
}

/** Shown when a screen's first load fails: says so, and offers the way out.
 *  A failed load must never pass for "nothing here". */
export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="empty" role="alert">
      <Icon name="alert" />
      <p>{t.common.loadFailed}</p>
      <Button onClick={onRetry}>{t.common.retry}</Button>
    </div>
  )
}

/** A thin track that fills from the start edge. `value` runs 0..1. */
export function ProgressBar({ value, tone, className }: { value: number; tone?: 'accent' | 'good'; className?: string }) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  return (
    <div className={cx('progress', tone === 'good' && 'progress--good', className)} aria-hidden="true">
      <div className="progress__fill" style={{ transform: `scaleX(${clamped})` }} />
    </div>
  )
}
