// The content translator (lib/contentMaps.ts) maps seeded data between
// language packs BY POSITION - these tests pin the invariant that makes that
// safe: every pack's seed is shape-identical to English, cue keys match, and
// block names cover the same numbers.
import { describe, expect, it } from 'vitest'
import { languages } from '../src/i18n'
import { buildContentMaps } from '../src/lib/contentMaps'

const packs = Object.entries(languages)

describe('language packs are position-parallel', () => {
  it('same routine count and task counts per routine as English', () => {
    const en = languages.en
    for (const [id, pack] of packs) {
      expect(pack.seed.length, `${id}.seed length`).toBe(en.seed.length)
      pack.seed.forEach((routine, i) => {
        expect(routine.tasks.length, `${id}.seed[${i}] (${routine.name}) task count`).toBe(en.seed[i].tasks.length)
        expect(routine.category, `${id}.seed[${i}] category`).toBe(en.seed[i].category)
        expect(routine.active ?? true, `${id}.seed[${i}] active`).toBe(en.seed[i].active ?? true)
      })
    }
  })
  it('same cue keys and block numbers as English', () => {
    const en = languages.en
    for (const [id, pack] of packs) {
      expect(Object.keys(pack.cues).sort(), `${id}.cues keys`).toEqual(Object.keys(en.cues).sort())
      expect(Object.keys(pack.blocks.names).sort(), `${id}.blocks.names keys`).toEqual(
        Object.keys(en.blocks.names).sort(),
      )
    }
  })
})

describe('buildContentMaps', () => {
  it('maps seeded strings from any pack to the target pack', () => {
    const toFa = buildContentMaps('fa')
    expect(toFa.routineNames.get('Morning Routine')).toBe(languages.fa.seed[0].name)
    expect(toFa.routineNames.get(languages.de.seed[0].name)).toBe(languages.fa.seed[0].name)
    expect(toFa.taskLabels.get('💊 Take medication')).toBe(languages.fa.seed[0].tasks[2].label)
    expect(toFa.cueTexts.get(languages.en.cues['Leg Press'])).toBe(languages.fa.cues['Leg Press'])
    expect(toFa.blockNames.get('Block 1 — PPL')).toBe(languages.fa.blocks.names[1])
  })
  it('round-trips: translating there and back restores the original', () => {
    const toZh = buildContentMaps('zh')
    const backToEn = buildContentMaps('en')
    const zhName = toZh.routineNames.get('Bedtime Routine')!
    expect(backToEn.routineNames.get(zhName)).toBe('Bedtime Routine')
  })
  it('knows nothing about user-written content', () => {
    const toFr = buildContentMaps('fr')
    expect(toFr.routineNames.get('My Custom Routine')).toBeUndefined()
    expect(toFr.taskLabels.get('water the plants')).toBeUndefined()
  })
})
