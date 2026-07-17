import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeAction, undoAiAction } from '../lib/actions'
import { t, locale } from '../i18n'
import Icon from '../components/Icon'
import type { AiAction } from '../lib/types'
import ConfirmButton from '../components/ConfirmButton'
import Skeleton from '../components/Skeleton'

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
      <h1>{t.history.title}</h1>
      <p className="gentle">{t.history.subtitle}</p>
      {counts && counts.kept + counts.undone > 0 && (
        <p className="gentle ai-stats">
          {t.history.accuracyLead}
          <strong>{Math.round((counts.kept / (counts.kept + counts.undone)) * 100)}%</strong>
          {t.history.accuracyTail(counts.kept, counts.undone)}
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
            <span className={`badge ${item.status}`}>{t.history.statusLabels[item.status]}</span>
            <span className="ai-time">
              {/* same "12 Jul, 14:32" shape as the Reminders cleared list */}
              {new Date(item.created_at).toLocaleString(locale, {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            {item.status !== 'undone' && (
              <ConfirmButton
                className="link"
                label={t.common.undo}
                confirmLabel={t.history.undoConfirm}
                title={t.history.undoTitle}
                onConfirm={() => undo(item)}
              />
            )}
          </div>
        </div>
      ))}
      {!loaded && <Skeleton cards={3} />}
      {loaded && items.length === 0 && (
        <p className="gentle">{t.history.noActions}</p>
      )}
    </div>
  )
}
