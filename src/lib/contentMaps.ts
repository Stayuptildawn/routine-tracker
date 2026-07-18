import { languages } from '../i18n'

// Cross-language lookup tables for seeded content. Every language pack
// carries the same seed in parallel (same routine order, same task positions,
// same cue keys - tests/i18n-seeds.test.ts pins this), so a routine name or
// task label from ANY pack maps deterministically to the target pack's
// counterpart. Strings that match no pack (user-written or user-renamed
// content) are simply absent from the maps - the translator never guesses.

export interface ContentMaps {
  routineNames: Map<string, string>
  taskLabels: Map<string, string>
  cueTexts: Map<string, string>
  blockNames: Map<string, string>
}

export function buildContentMaps(targetId: string): ContentMaps {
  const target = languages[targetId]
  const routineNames = new Map<string, string>()
  const taskLabels = new Map<string, string>()
  const cueTexts = new Map<string, string>()
  const blockNames = new Map<string, string>()
  if (!target) return { routineNames, taskLabels, cueTexts, blockNames }

  const put = (map: Map<string, string>, from: string, to: string | undefined) => {
    if (to && !map.has(from)) map.set(from, to)
  }

  for (const pack of Object.values(languages)) {
    pack.seed.forEach((routine, i) => {
      const tr = target.seed[i]
      if (!tr) return
      put(routineNames, routine.name, tr.name)
      routine.tasks.forEach((task, j) => put(taskLabels, task.label, tr.tasks[j]?.label))
    })
    for (const [exercise, cue] of Object.entries(pack.cues)) {
      put(cueTexts, cue, target.cues[exercise])
    }
    for (const [n, name] of Object.entries(pack.blocks.names)) {
      put(blockNames, name, target.blocks.names[Number(n)])
    }
  }
  return { routineNames, taskLabels, cueTexts, blockNames }
}
