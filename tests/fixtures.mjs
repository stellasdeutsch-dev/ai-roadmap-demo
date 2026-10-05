/**
 * Свое у каждого сайта: какие анкеты перебирать в тестах. Общие тесты
 * (tests/core.test.mjs) берут профили отсюда и не знают, какие поля
 * бывают у конкретного сайта.
 */
const base = {
  name: 'Тест', citizenship: 'Казахстан', educationLevel: 'бакалавриат',
  specialty: 'Информационные системы', city: 'Алматы', country: 'Казахстан',
  university: 'Delft University of Technology', program: 'MSc Computer Science',
};

const matrix = [];
for (const degreeLevel of ['бакалавриат', 'магистратура', 'PhD'])
  for (const offerStatus of ['received', 'waiting', 'planning'])
    for (const funding of ['self', 'scholarship'])
      for (const intakeDate of ['', '2027-09', '2028-02', 'abc', '2027-13', '99999-01', '2027', '  ', undefined, null])
        matrix.push({ ...base, degreeLevel, offerStatus, funding, intakeDate });

export const PROFILES = matrix;

/** Анкеты, где дату не задал человек: месяц начала учёбы пуст. */
export const AUTO_DATED = matrix.filter((p) => !String(p.intakeDate ?? '').trim());

/** Профиль «как заполнит человек» — для проверок, которым нужен один план. */
export const TYPICAL = {
  ...base, degreeLevel: 'магистратура', offerStatus: 'received', funding: 'scholarship',
  intakeDate: '2027-09', notes: 'Нужно общежитие, загранпаспорт истекает в мае.',
};
