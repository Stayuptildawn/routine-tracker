import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeAction, undoAiAction } from '../lib/actions'
import { t, locale } from '../i18n'
import Icon from '../components/Icon'
import type { AiAction } from '../lib/types'
import ConfirmButton from '../components/ConfirmButton'
import Skeleton from '../components/Skeleton'
import { EmptyState, ErrorState, ScreenHeader, cx } from '../components/ui'

const STATUS_BADGE: Record<AiAction['status'], string> = {
  applied: 'badge badge--accent',
  confirmed: 'badge badge--good',
  undone: 'badge',
  answered: 'badge',
}

export default function History({
  visible,
  onBack,
  onOpenSettings,
}: {
  visible: boolean
  onBack: () => void
  onOpenSettings: () => void
}) {
  const [items, setItems] = useState<AiAction[]>([])
  const [counts, setCounts] = useState<{ kept: number; undone: number } | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const loadedRef = useRef(false)

  const load = useCallback(async () => {
    const [itemsRes, keptRes, undoneRes] = await Promise.all([
      supabase.from('ai_actions').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('ai_actions').select('id', { count: 'exact', head: true }).in('status', ['applied', 'confirmed']),
      supabase.from('ai_actions').select('id', { count: 'exact', head: true }).eq('status', 'undone'),
    ])
    // a failed first load must not pass for "nothing here"; a failed
    // refresh keeps what is already on screen
    if (itemsRes.error) {
      if (!loadedRef.current) setLoadError(true)
      return
    }
    setLoadError(false)
    loadedRef.current = true
    setItems((itemsRes.data as AiAction[]) ?? [])
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
    <div className="screen history">
      <ScreenHeader title={t.history.title} lede={t.history.subtitle} onBack={onBack} onOpenSettings={onOpenSettings} />
      {counts && counts.kept + counts.undone > 0 && (
        <p className="hint">
          {t.history.accuracyLead}
          <strong>{Math.round((counts.kept / (counts.kept + counts.undone)) * 100)}%</strong>
          {t.history.accuracyTail(counts.kept, counts.undone)}
        </p>
      )}
      {loadError && !loaded && <ErrorState onRetry={load} />}
      {!loaded && !loadError && <Skeleton cards={3} />}
      {items.map((item) => (
        <section key={item.id} className={cx('card log-item', item.status === 'undone' && 'log-item--undone')}>
          <p className="log-item__said selectable">“{item.raw_text}”</p>
          <div className="stack stack--tight">
            {item.actions.map((a, i) => {
              const d = describeAction(a)
              return (
                <p key={i} className={a.type === 'answer' ? 'log-item__answer' : undefined}>
                  <Icon name={d.icon} /> {d.text}
                </p>
              )
            })}
          </div>
          <div className="cluster">
            <span className={STATUS_BADGE[item.status]}>{t.history.statusLabels[item.status]}</span>
            <span className="meta">
              {/* same "12 Jul, 14:32" shape as the Reminders cleared list */}
              {new Date(item.created_at).toLocaleString(locale, {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            {/* an answer-only entry changed nothing, so there is nothing to undo */}
            {item.status !== 'undone' && item.status !== 'answered' && (
              <ConfirmButton
                variant="ghost"
                size="sm"
                className="push-end"
                label={t.common.undo}
                confirmLabel={t.history.undoConfirm}
                title={t.history.undoTitle}
                onConfirm={() => undo(item)}
              />
            )}
          </div>
        </section>
      ))}
      {loaded && items.length === 0 && <EmptyState icon="bot">{t.history.noActions}</EmptyState>}
    </div>
  )
}
