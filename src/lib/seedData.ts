import type { Tier } from './types'

// First-login seed, extracted from Weekly_Planner_v2.xlsx.
// tier: core = minimum viable routine (all that's shown on low-energy days),
// bonus = only shown on high-energy days. days: 1=Mon .. 7=Sun, omitted = daily.
interface SeedTask {
  label: string
  tier: Tier
  days?: number[]
}

export const SEED_ROUTINES: { name: string; category: string; tasks: SeedTask[] }[] = [
  {
    name: 'Morning Routine',
    category: 'daily',
    tasks: [
      { label: '☀️ Wake up + light on', tier: 'core' },
      { label: '🚿 Bathroom / shower', tier: 'standard' },
      { label: '💊 Take medication', tier: 'core' },
      { label: '💧 Drink water', tier: 'core' },
      { label: '👕 Get dressed (sensory-safe)', tier: 'standard' },
      { label: '🍳 Eat breakfast', tier: 'core' },
      { label: '🎒 Check bag / launch pad', tier: 'standard' },
      { label: '📅 Review calendar', tier: 'bonus' },
    ],
  },
  {
    name: 'Leave House',
    category: 'daily',
    tasks: [
      { label: '🔑 Keys', tier: 'core' },
      { label: '📱 Phone', tier: 'core' },
      { label: '💳 Wallet / cards', tier: 'core' },
      { label: '💧 Water bottle', tier: 'standard' },
      { label: '🔌 Charger', tier: 'standard' },
      { label: '🎒 Bag packed the night before', tier: 'standard' },
      { label: '⏱ Left with 10 min buffer', tier: 'bonus' },
    ],
  },
  {
    name: 'Take Medication',
    category: 'daily',
    tasks: [
      { label: '💊 Morning dose', tier: 'core' },
      { label: '🎒 Backup dose in bag', tier: 'standard' },
      { label: '🔄 Refill check', tier: 'standard', days: [3, 6] },
    ],
  },
  {
    name: 'Drink Water',
    category: 'daily',
    tasks: [
      { label: '💧 Glass on waking', tier: 'core' },
      { label: '💊 With medication', tier: 'core' },
      { label: '📚 Before study block', tier: 'standard' },
      { label: '🏋️ Before gym', tier: 'standard' },
      { label: '🌙 Evening glass', tier: 'standard' },
    ],
  },
  {
    name: 'Cleaning Routine',
    category: 'daily',
    tasks: [
      { label: '🍽 Dishes', tier: 'core', days: [1, 2, 3, 4, 5] },
      { label: '🧹 Wipe counters', tier: 'standard' },
      { label: '🗑 Trash out', tier: 'standard' },
      { label: '👕 Laundry off floor', tier: 'standard' },
      { label: '🚿 Bathroom quick wipe', tier: 'bonus' },
      { label: '🧹 Vacuum one room', tier: 'bonus' },
    ],
  },
  {
    name: 'Study Time',
    category: 'focus',
    tasks: [
      { label: '🎯 Define session goal', tier: 'core' },
      { label: '🍅 Pomodoro block 1 (25 min)', tier: 'core' },
      { label: '🍅 Pomodoro block 2 (25 min)', tier: 'standard' },
      { label: '☕ Break taken', tier: 'standard' },
      { label: '📝 Reviewed / summarized', tier: 'bonus' },
    ],
  },
  {
    name: 'Bedtime Routine',
    category: 'daily',
    tasks: [
      { label: '💡 Dim lights', tier: 'standard' },
      { label: '📵 No screens (30 min before)', tier: 'standard' },
      { label: '🎒 Prepare tomorrow’s items', tier: 'core' },
      { label: '📖 Low-stimulation activity', tier: 'standard' },
      { label: '😴 Consistent sleep time', tier: 'core' },
    ],
  },
  {
    name: 'Spanish Learning',
    category: 'focus',
    tasks: [
      { label: '📖 2h structured study', tier: 'standard' },
      { label: '🗣 1h speaking practice', tier: 'standard' },
      { label: '🗂 Vocabulary review', tier: 'core' },
      { label: '🎧 Listening (podcast/show)', tier: 'bonus' },
    ],
  },
  {
    name: 'Thesis',
    category: 'focus',
    tasks: [
      { label: '💻 Coding project', tier: 'core' },
      { label: '📞 Director call prep', tier: 'standard', days: [5] },
      { label: '📞 Call with directors', tier: 'standard', days: [5] },
      { label: '📝 Documentation', tier: 'standard' },
      { label: '✅ Next action defined', tier: 'core' },
    ],
  },
  {
    name: 'Gym',
    category: 'health',
    tasks: [
      { label: '🏋️ Gym session', tier: 'core', days: [1, 2, 3, 4, 5] },
      { label: '💪 Body parts trained', tier: 'standard', days: [1, 2, 3, 4, 5] },
      { label: '🏃 5k run (Zone 2)', tier: 'standard', days: [2, 5] },
      { label: '🧘 Recovery / mobility', tier: 'standard', days: [1, 2, 3, 4, 5] },
    ],
  },
  // Tracker-type routines: no daily tasks, they exist as reminder categories.
  { name: 'Immigration', category: 'tracker', tasks: [] },
  { name: 'Job Search', category: 'tracker', tasks: [] },
]
