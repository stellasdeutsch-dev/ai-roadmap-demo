/**
 * Экспорт / импорт плана и скачивание сырых данных при восстановлении.
 *
 * Это единственный способ пережить очистку данных браузера, режим ITP
 * в Safari (localStorage сайта стирается через 7 дней без визитов) или
 * переход на другое устройство — плана нигде, кроме этого браузера,
 * больше не существует.
 */

import { SCHEMA_VERSION } from './store.js';

function downloadText(text, filename, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Экспортирует текущий план в JSON-файл, скачиваемый пользователем. */
export function exportPlan(state) {
  const payload = {
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    profile: state.profile,
    roadmap: state.roadmap,
    messages: state.messages,
    pendingProposal: state.pendingProposal,
  };
  const name = (state.profile?.program || 'plan').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 40);
  downloadText(JSON.stringify(payload, null, 2), `ai-roadmap-${name}-${todayStamp()}.json`);
}

/** Скачивает сырой, возможно повреждённый, текст из localStorage as-is —
 *  для экрана восстановления, когда автоматический разбор не удался. */
export function downloadRaw(raw) {
  downloadText(raw, `ai-roadmap-raw-${todayStamp()}.json`);
}

/**
 * Читает файл, выбранный через <input type="file">, и возвращает
 * распарсенный объект. Бросает Error с человекочитаемым текстом при
 * неудаче — вызывающий код сам решает, как её показать.
 */
export function importPlanFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('Файл не выбран.'));
    if (file.size > 5 * 1024 * 1024) return reject(new Error('Файл слишком большой — это не похоже на экспорт плана.'));

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
    reader.onload = () => {
      let data;
      try {
        data = JSON.parse(String(reader.result));
      } catch {
        return reject(new Error('Файл повреждён или это не JSON.'));
      }
      if (!data || typeof data !== 'object' || !data.roadmap || !Array.isArray(data.roadmap.steps)) {
        return reject(new Error('В файле нет распознаваемого плана.'));
      }
      resolve(data);
    };
    reader.readAsText(file);
  });
}

export function printPlan() {
  window.print();
}
