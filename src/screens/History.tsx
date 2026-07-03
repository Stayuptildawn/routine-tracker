import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeAction, undoAiAction } from '../lib/actions'
import type { AiAction } from '../lib/types'

const STATUS_LABEL: Record<AiAction['status'], string> = {
  applied: 'AI-sorted',
  confirmed: 'Confirmed',
  undone: 'Undone',
}

export default function History() {
  const [items, setItems] = useState<AiAction[]>([])

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('ai_actions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
    setItems((data as AiAction[]) ?? [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function undo(item: AiAction) {
    await undoAiAction(item.id, item.actions)
    load()
  }

  return (
    <div className="history">
      <h1>AI action log</h1>
      <p className="gentle">Everything the AI did, and what you said. Anything can be undone.</p>
      {items.map((item) => (
        <div key={item.id} className={`ai-item ${item.status}`}>
          <div className="ai-raw">“{item.raw_text}”</div>
          <div className="ai-did">
            {item.actions.map((a, i) => (
              <div key={i}>{describeAction(a)}</div>
            ))}
          </div>
          <div className="ai-meta">
            <span className={`badge ${item.status}`}>{STATUS_LABEL[item.status]}</span>
            <span className="ai-time">{new Date(item.created_at).toLocaleString()}</span>
            {item.status !== 'undone' && (
              <button className="link" onClick={() => undo(item)}>
                Undo
              </button>
            )}
          </div>
        </div>
      ))}
      {items.length === 0 && <p className="gentle">No AI actions yet — try the message box on the Now tab.</p>}
    </div>
  )
}
