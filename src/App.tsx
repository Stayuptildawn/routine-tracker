import { useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, configured } from './lib/supabase'
import { SEED_ROUTINES } from './lib/seedData'
import { flushMessageQueue, flushTapQueue } from './lib/actions'
import { flushOps } from './lib/offline'
import { armBackGuard, onBackButton } from './lib/backButton'
import Auth from './screens/Auth'
import SetPassword from './screens/SetPassword'
import Now from './screens/Now'
import Week from './screens/Week'
import Gym from './screens/Gym'
import History from './screens/History'
import Reflect from './screens/Reflect'
import Reminders from './screens/Reminders'
import Settings from './screens/Settings'
import type { Theme } from './screens/Settings'
import Icon from './components/Icon'
import type { IconName } from './components/Icon'

// 'reminders' is a sub-view of Now (reached via "See all"), not a sixth tab
type Tab = 'now' | 'week' | 'gym' | 'history' | 'reflect' | 'reminders'

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'now', label: 'Now', icon: 'sun' },
  { id: 'week', label: 'Week', icon: 'calendar' },
  { id: 'gym', label: 'Workout', icon: 'dumbbell' },
  { id: 'history', label: 'AI Log', icon: 'bot' },
  { id: 'reflect', label: 'Reflect', icon: 'leaf' },
]

/** Import the spreadsheet routines on first login. */
async function seedIfEmpty() {
  const { count } = await supabase.from('routines').select('id', { count: 'exact', head: true })
  if (count && count > 0) return
  for (const [i, seed] of SEED_ROUTINES.entries()) {
    const { data: routine, error } = await supabase
      .from('routines')
      .insert({ name: seed.name, category: seed.category, sort_order: i, active: seed.active ?? true })
      .select('id')
      .single()
    if (error || !routine) continue
    if (seed.tasks.length > 0) {
      await supabase.from('tasks').insert(
        seed.tasks.map((t, j) => ({
          routine_id: routine.id,
          label: t.label,
          sort_order: j,
          tier: t.tier,
          scheduled_days: t.days ?? [1, 2, 3, 4, 5, 6, 7],
        })),
      )
    }
  }
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [seeding, setSeeding] = useState(true)
  const [tab, setTab] = useState<Tab>('now')
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('theme') as Theme) ?? 'auto')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [recovering, setRecovering] = useState(false)

  // installed-PWA back (Android button, iOS swipe): open overlays close
  // themselves via useOverlay; this fallback returns to Now, and always
  // swallows the press so back never leaves the app
  const tabRef = useRef(tab)
  tabRef.current = tab
  useEffect(() => {
    armBackGuard()
    return onBackButton(() => {
      if (tabRef.current !== 'now') {
        setTab('now')
        window.scrollTo(0, 0)
      }
      return true
    })
  }, [])

  useEffect(() => {
    if (theme === 'auto') {
      delete document.documentElement.dataset.theme
      localStorage.removeItem('theme')
    } else {
      document.documentElement.dataset.theme = theme
      localStorage.setItem('theme', theme)
    }
  }, [theme])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      // invite/reset links land here: force a password set before the app
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    let cancelled = false
    setSeeding(true)
    // block first render until seeding finishes, or a fresh account
    // briefly sees "Nothing scheduled" instead of its routines
    seedIfEmpty().finally(() => {
      if (!cancelled) setSeeding(false)
    })
    flushMessageQueue()
    flushTapQueue()
    flushOps()
    const onOnline = () => {
      flushMessageQueue()
      flushTapQueue()
      flushOps()
    }
    window.addEventListener('online', onOnline)
    return () => {
      cancelled = true
      window.removeEventListener('online', onOnline)
    }
  }, [session])

  if (!configured)
    return (
      <div className="center-note">
        Missing Supabase credentials — copy .env.example to .env and fill it in (see README).
      </div>
    )
  if (!ready) return <div className="center-note">Loading…</div>
  if (!session) return <Auth />
  if (recovering) return <SetPassword onDone={() => setRecovering(false)} />
  if (seeding) return <div className="center-note">Setting up your routines…</div>

  // screens stay mounted so switching back is instant (state survives,
  // no refetch flash); each refreshes itself in the background when shown
  return (
    <div className="app">
      <main className="content">
        <div hidden={tab !== 'now'}>
          <Now visible={tab === 'now'} onOpenReminders={() => setTab('reminders')} onOpenSettings={() => setSettingsOpen(true)} />
        </div>
        {tab === 'reminders' && <Reminders onBack={() => setTab('now')} />}
        <div hidden={tab !== 'week'}>
          <Week visible={tab === 'week'} />
        </div>
        <div hidden={tab !== 'gym'}>
          <Gym visible={tab === 'gym'} />
        </div>
        <div hidden={tab !== 'history'}>
          <History visible={tab === 'history'} />
        </div>
        <div hidden={tab !== 'reflect'}>
          <Reflect visible={tab === 'reflect'} />
        </div>
      </main>
      <nav className="tabbar" aria-label="Main">
        {TABS.map((t) => {
          const current = tab === t.id || (tab === 'reminders' && t.id === 'now')
          return (
          <button
            key={t.id}
            className={current ? 'tab active' : 'tab'}
            aria-current={current ? 'page' : undefined}
            onClick={() => {
              setTab(t.id)
              window.scrollTo(0, 0)
            }}
          >
            <span className="tab-icon"><Icon name={t.icon} /></span>
            <span className="tab-label">{t.label}</span>
          </button>
          )
        })}
        <button className="settings-rail" onClick={() => setSettingsOpen(true)} title="Settings">
          <Icon name="settings" /> Settings
        </button>
      </nav>
      {settingsOpen && <Settings theme={theme} onTheme={setTheme} onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
