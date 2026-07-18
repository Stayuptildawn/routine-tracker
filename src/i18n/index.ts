import { en } from './en'
import type { Strings } from './en'
import { fr } from './fr'
import { es } from './es'
import { de } from './de'
import { zh } from './zh'
import { ar } from './ar'
import { fa } from './fa'
import { tr } from './tr'
import { ru } from './ru'
import { cs } from './cs'
import { ja } from './ja'

// The language registry. Adding a language is two steps:
//   1. copy en.ts -> xx.ts and translate the values (each pack is typed as
//      `Strings`, so TypeScript flags anything missed);
//   2. import it here and add it to `languages`.
// The Settings screen shows a language picker automatically once there's more
// than one entry. Switching stores the choice and reloads - strings are read
// once at module load, which keeps every call site a plain property access.

export type { Strings } from './en'

// exported for the content translator (lib/contentMaps.ts), which maps
// seeded data between packs - all packs are statically bundled anyway
export const languages: Record<string, Strings> = { en, fr, es, de, zh, ar, fa, tr, ru, cs, ja }

const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('lang') : null
export const lang = stored && languages[stored] ? stored : 'en'

export const t: Strings = languages[lang]

/** BCP-47 tag for toLocaleDateString etc.; undefined = follow the device. */
export const locale = t.locale

export const availableLanguages = Object.keys(languages).map((id) => ({ id, name: languages[id].name }))

export function setLanguage(id: string) {
  if (!languages[id]) return
  localStorage.setItem('lang', id)
  location.reload()
}

// <html lang/dir> follow the pack (the RTL packs flip the layout)
if (typeof document !== 'undefined') {
  document.documentElement.lang = t.langTag
  document.documentElement.dir = t.dir
}
