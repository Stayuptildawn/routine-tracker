import type { ReactNode } from 'react'
import Icon from '../Icon'
import type { IconName } from '../Icon'
import { cx } from './Button'

export interface ChoiceOption<T> {
  value: T
  label: ReactNode
  icon?: IconName
  /** Spoken name and tooltip, for options whose visible label is terse ("D", "6M"). */
  hint?: string
  disabled?: boolean
}

interface ChoiceProps<T> {
  options: ChoiceOption<T>[]
  value: T | null
  onChange: (value: T) => void
  /** Names the group for screen readers. */
  label?: string
  disabled?: boolean
  className?: string
}

function options<T>({ options, value, onChange, disabled }: ChoiceProps<T>, itemClass: string) {
  return options.map((o) => (
    <button
      key={String(o.value)}
      type="button"
      className={itemClass}
      aria-pressed={o.value === value}
      aria-label={o.hint}
      title={o.hint}
      disabled={disabled || o.disabled}
      onClick={() => onChange(o.value)}
    >
      {o.icon && <Icon name={o.icon} />}
      {o.label}
    </button>
  ))
}

/** A switch between a few short, equal options that share one track
 *  (energy level, theme, on/off, the Workout views). */
export function Segmented<T>(props: ChoiceProps<T>) {
  return (
    <div className={cx('seg', props.className)} role="group" aria-label={props.label}>
      {options(props, 'seg__opt')}
    </div>
  )
}

/** The same single choice as wrapping pills, for longer or more numerous
 *  options (body parts, plan sessions, check-in answers). The handler is
 *  called with the tapped value even when it is already selected, so a
 *  caller can treat a second tap as "clear". */
export function Chips<T>(props: ChoiceProps<T>) {
  return (
    <div className={cx('chips', props.className)} role="group" aria-label={props.label}>
      {options(props, 'chip')}
    </div>
  )
}
