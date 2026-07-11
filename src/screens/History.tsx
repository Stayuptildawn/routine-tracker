import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeAction, undoAiAction } from '../lib/actions'
import Icon from '../components/Icon'
import type { AiAction } from '../lib/types'
import ConfirmButton from '../components/ConfirmButton'
import Skeleton from '../components/Skeleton'

const STATUS_LABEL: Record<AiAction['status'], string> = {
  applied: 'AI-sorted',
  confirmed: 'Confirmed',
  undone: 'Undone',
}

export default function History({ visible }: { visible: boolean }) {
  const [items, setItems] = useState<AiAction[]>([])
  const [counts, setCounts] = useState<{ kept: number; undone: number } | null>(null)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    const [{ data }, keptRes, undoneRes] = await Promise.all([
      supabase.from('ai_actions').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('ai_actions').select('id', { count: 'exact', head: true }).in('status', ['applied', 'confirmed']),
      supabase.from('ai_actions').select('id', { count: 'exact', head: true }).eq('status', 'undone'),
    ])
    setItems((data as AiAction[]) ?? [])
    setCounts({ kept: keptRes.count ?? 0, undone: undoneRes.count ?? 0 })
    setLoaded(true)
  }, [])

  // refresh whenever the tab is shown - silent, the old data stays on screen
  useEffect(() => {
    if (visible) load()
  }, [visible, load])

  async function undo(item: AiAction) {
    await undoAiAction(item.id, item.actions)
    load()
  }

  return (
    <div className="history">
      <h1>AI action log</h1>
      <p className="gentle">Everything the AI did, and what you said. Anything can be undone.</p>
      {counts && counts.kept + counts.undone > 0 && (
        <p className="gentle ai-stats">
          Accuracy so far: <strong>{Math.round((counts.kept / (counts.kept + counts.undone)) * 100)}%</strong>{' '}
          — {counts.kept} kept, {counts.undone} undone.
        </p>
      )}
      {items.map((item) => (
        <div key={item.id} className={`ai-item ${item.status}`}>
          <div className="ai-raw">“{item.raw_text}”</div>
          <div className="ai-did">
            {item.actions.map((a, i) => {
              const d = describeAction(a)
              return (
                <div key={i}>
                  <Icon name={d.icon} /> {d.text}
                </div>
              )
            })}
          </div>
          <div className="ai-meta">
            <span className={`badge ${item.status}`}>{STATUS_LABEL[item.status]}</span>
            <span className="ai-time">{new Date(item.created_at).toLocaleString()}</span>
            {item.status !== 'undone' && (
              <ConfirmButton
                className="link"
                label="Undo"
                confirmLabel="revert all of this?"
                title="Reverts everything this message did (listed above)"
                onConfirm={() => undo(item)}
              />
            )}
          </div>
        </div>
      ))}
      {!loaded && <Skeleton cards={3} />}
      {loaded && items.length === 0 && (
        <p className="gentle">No AI actions yet — try the message box on the Now tab.</p>
      )}
    </div>
  )
}
