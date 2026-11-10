import { useState } from 'react'
import { t } from '../i18n'
import type { Task, TaskLog } from '../lib/types'
import Icon from '../components/Icon'
import { Button, Sheet } from '../components/ui'

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

const handled = (logs: Map<string, TaskLog>, task: Task) => {
  const s = logs.get(task.id)?.status
  return s === 'done' || s === 'skipped' || s === 'partial'
}

/** Full-screen "just this one thing" mode: one task, two big buttons. */
export default function Player({ routineName, tasks, logs, focusTaskId, onStatus, onExit, closing }: PlayerProps) {
  // which task to show next; falls back to the first pending one
  const [preferredId, setPreferredId] = useState<string | null>(focusTaskId ?? null)

  const pending = tasks.filter((task) => !handled(logs, task))
  const current = pending.find((task) => task.id === preferredId) ?? pending[0]
  const doneCount = tasks.length - pending.length

  function tap(status: 'done' | 'skipped') {
    if (!current) return
    // line up the next pending task after this one before the logs update
    const after = tasks.slice(tasks.indexOf(current) + 1).find((task) => !handled(logs, task))
    setPreferredId(after?.id ?? null)
    onStatus(current, status)
  }

  return (
    <Sheet
      title={t.player.progress(routineName, Math.min(doneCount + 1, tasks.length), tasks.length)}
      label={t.player.aria(routineName)}
      onClose={onExit}
      closeLabel={t.player.exit}
      closing={closing}
      progress={doneCount / tasks.length}
    >
      {current ? (
        <>
          <div className="player__task" key={current.id}>
            {current.label}
          </div>
          <div className="actions actions--stretch sheet__foot">
            <Button variant="primary" size="lg" onClick={() => tap('done')}>
              {t.common.done}
            </Button>
            <Button size="lg" onClick={() => tap('skipped')}>
              {t.common.skip}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="player__task player__task--done">
            <Icon name="check" />
            <br />
            {t.player.handled(routineName)}
          </div>
          <div className="actions actions--stretch sheet__foot">
            <Button variant="primary" size="lg" onClick={onExit}>
              {t.common.close}
            </Button>
          </div>
        </>
      )}
    </Sheet>
  )
}
