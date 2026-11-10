import type { ButtonHTMLAttributes, ReactNode } from 'react'
import Icon from '../Icon'
import type { IconName } from '../Icon'

/** Joins class names, skipping the falsy ones. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = the one filled action of a view; secondary = outlined;
   *  ghost = text only; danger = outlined in the danger colour. */
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  /** Stretch to the full width of the container. */
  block?: boolean
  icon?: IconName
  /** Disables the button and shows a spinner beside the label. */
  busy?: boolean
  children?: ReactNode
}

/** The app's only button. Every action control goes through here so they
 *  share one height, one focus ring and one set of four looks. */
export function Button({
  variant = 'secondary',
  size = 'md',
  block,
  icon,
  busy,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('btn', `btn--${variant}`, size !== 'md' && `btn--${size}`, block && 'btn--block', className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <span className="spinner" aria-hidden="true" /> : icon && <Icon name={icon} />}
      {children}
    </button>
  )
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName
  /** Read by screen readers and shown as the tooltip: an icon alone says nothing. */
  label: string
  /** filled = quiet fill behind the icon; primary = the amber fill. */
  variant?: 'plain' | 'filled' | 'primary'
  iconClassName?: string
}

/** A 44px square target around a single icon. */
export function IconButton({ icon, label, variant = 'plain', className, iconClassName, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      className={cx('icon-btn', variant !== 'plain' && `icon-btn--${variant}`, className)}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} className={iconClassName} />
    </button>
  )
}
