/**
 * Идентичность сайта — единственное, чем общие модули отличаются между
 * сайтами-сёстрами (общий планировщик, Австрия). Всё остальное в js/
 * кроме plan.js, content.js и index.html — общее ядро и должно совпадать
 * побайтово; это проверяет scripts/sync-core.sh.
 */
export const SITE = {
  name: 'План поступления',
  url: 'https://stellasdeutsch-dev.github.io/ai-roadmap-demo/',
  storageKey: 'ai-roadmap-demo-state',
  filePrefix: 'ai-roadmap',
  icsProdId: '-//AI Roadmap//Admission planner//RU',
  icsUidDomain: 'ai-roadmap',
};
