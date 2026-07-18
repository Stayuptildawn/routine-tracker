import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n'

// Exercise-name input with a suggestion dropdown fed by the bundled exercise
// database (1,289 names + muscle groups). The database is a lazy chunk: it
// loads on first focus, never on app start, and is excluded from the PWA
// precache - before it arrives (or if it never does) this is just an input.
// Picking a suggestion also reports the exercise's muscle group so the
// caller can pre-select it in its muscle dropdown.

type Entry = [name: string, muscle: string]

let dbCache: Entry[] | null = null
let dbLoading: Promise<Entry[]> | null = null

function loadDb(): Promise<Entry[]> {
  if (dbCache) return Promise.resolve(dbCache)
  dbLoading ??= import('../../supabase/functions/_shared/exerciseDb').then((m) => {
    dbCache = m.EXERCISE_DB
    return dbCache
  })
  return dbLoading
}

interface Props {
  value: string
  placeholder?: string
  onChange: (name: string) => void
  /** A suggestion was picked: the exact name plus its muscle group. */
  onPick: (name: string, muscle: string) => void
  onEnter?: () => void
}

const MAX_SHOWN = 8

export default function ExerciseAutocomplete({ value, placeholder, onChange, onPick, onEnter }: Props) {
  const [db, setDb] = useState<Entry[] | null>(dbCache)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  // close on tap-away (mousedown, so option clicks via onMouseDown still win)
  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [])

  const q = value.trim().toLowerCase()
  const matches =
    open && db && q.length >= 2
      ? db.filter(([n]) => n.toLowerCase().includes(q)).slice(0, MAX_SHOWN)
      : []

  function pick([name, muscle]: Entry) {
    setOpen(false)
    onPick(name, muscle)
  }

  return (
    <div className="exercise-ac" ref={rootRef}>
      <input
        value={value}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true)
          if (!db) loadDb().then(setDb, () => {}) // offline: stay a plain input
        }}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (matches.length > 0) {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => (a + 1) % matches.length)
              return
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => (a - 1 + matches.length) % matches.length)
              return
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              pick(matches[Math.min(active, matches.length - 1)])
              return
            }
            if (e.key === 'Escape') {
              setOpen(false)
              return
            }
          }
          if (e.key === 'Enter' && onEnter) {
            e.preventDefault()
            onEnter()
          }
        }}
      />
      {matches.length > 0 && (
        <div className="exercise-ac-list" role="listbox">
          {matches.map((entry, i) => (
            <button
              key={entry[0]}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'exercise-ac-item active' : 'exercise-ac-item'}
              // mousedown, not click: fires before the input's blur
              onMouseDown={(e) => {
                e.preventDefault()
                pick(entry)
              }}
            >
              <span className="exercise-ac-name">{entry[0]}</span>
              <span className="exercise-ac-muscle">{t.muscles[entry[1]] ?? entry[1]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
