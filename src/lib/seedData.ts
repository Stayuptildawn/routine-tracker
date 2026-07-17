import { t } from '../i18n'

// First-login seed. The content itself lives in the language pack (src/i18n)
// so a translated build seeds translated routines; this module keeps the
// import site stable.
export const SEED_ROUTINES = t.seed
