import { useState } from 'react'
import { useOverlay } from '../lib/overlay'
import type { Task, TaskLog } from '../lib/types'
import Icon from '../components/Icon'

interface PlayerProps {
  routineName: string
  tasks: Task[] // the routine's visible tasks, in order
  logs: Map<string, TaskLog>
  focusTaskId?: string | null // start here instead of the first pending task
  onStatus: (task: Task, status: 'done' | 'skipped') => void
  onExit: () => void
  /** true while the exit transition plays (usePresence in the parent) */
  closing?: boolean
}

const handled = (logs: Map<string, TaskLog>, t: Task) => {
  const s = logs.get(t.id)?.status
  return s === 'done' || s === 'skipped' || s === 'partial'
}

/** Full-screen "just this one thing" mode: one task, two big buttons. */
export default function Player({ routineName, tasks, logs, focusTaskId, onStatus, onExit, closing }: PlayerProps) {
  // which task to show next; falls back to the first pending one
  const [preferredId, setPreferredId] = useState<string | null>(focusTaskId ?? null)

  // Escape and the installed-PWA back button close the player like the exit link
  const trapRef = useOverlay<HTMLDivElement>(onExit)

  const pending = tasks.filter((t) => !handled(logs, t))
  const current = pending.find((t) => t.id === preferredId) ?? pending[0]
  const doneCount = tasks.length - pending.length

  function tap(status: 'done' | 'skipped') {
    if (!current) return
    // line up the next pending task after this one before the logs update
    const after = tasks.slice(tasks.indexOf(current) + 1).find((t) => !handled(logs, t))
    setPreferredId(after?.id ?? null)
    onStatus(current, status)
  }

  return (
    <div
      ref={trapRef}
      className="player"
      data-closing={closing || undefined}
      role="dialog"
      aria-modal="true"
      aria-label={`${routineName} player`}
    >
      <div className="player-rail" aria-hidden="true">
        <div className="player-rail-fill" style={{ transform: `scaleX(${doneCount / tasks.length})` }} />
      </div>
      <div className="player-inner">
        <div className="player-top">
          <span className="eyebrow">
            {routineName} · {Math.min(doneCount + 1, tasks.length)} of {tasks.length}
          </span>
          <button className="link" onClick={onExit}>
            exit
          </button>
        </div>

        {current ? (
          <>
            <div className="player-task" key={current.id}>
              {current.label}
            </div>
            <div className="player-buttons">
              <button className="player-done" onClick={() => tap('done')}>
                Done
              </button>
              <button className="player-skip" onClick={() => tap('skipped')}>
                Skip
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="player-task complete">
              <Icon name="check" /><br />
              That’s {routineName} handled.
            </div>
            <div className="player-buttons">
              <button className="player-done" onClick={onExit}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
