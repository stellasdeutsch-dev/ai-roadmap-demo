/**
 * Данные плана: фазы, генератор шаблона, обратное планирование дедлайнов
 * от даты начала учёбы, нормализация и CRUD-операции над шагами.
 *
 * Ничего в этом файле не трогает DOM и не читает localStorage — чистые
 * функции над обычными объектами. Это единственное место, которое знает
 * форму шага и правила её изменения; timeline.js и assistant.js вызывают
 * эти функции, а не мутируют шаги напрямую.
 */

export const PHASES = [
  { id: 'offer', label: 'Подтверждение offer' },
  { id: 'scholarship', label: 'Стипендия / грант' },
  { id: 'documents', label: 'Документы' },
  { id: 'finance', label: 'Финансы и оплата' },
  { id: 'visa', label: 'Виза' },
  { id: 'arrival', label: 'Переезд и жильё' },
  { id: 'study', label: 'Начало учёбы' },
];
export const PHASE_LABELS = new Map(PHASES.map((p) => [p.id, p.label]));
const PHASE_ORDER = new Map(PHASES.map((p, i) => [p.id, i]));

export const STATUSES = ['not_started', 'in_progress', 'done'];

/* ------------------------------------------------------------------ */
/* Дата: локальные календарные сутки, без сдвига часовым поясом        */
/* ------------------------------------------------------------------ */

const DAY = 86400000;

/** YYYY-MM-DD из локальных компонентов даты — в отличие от toISOString()
 *  не даёт сдвига на день в часовых поясах восточнее UTC. */
function toLocalISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/** Сегодня в полдень по местному времени — безопасная точка отсчёта. */
function todayLocalNoon() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
}

/** YYYY-MM-DD через N дней от сегодня. */
export function dateFromToday(offsetDays) {
  return toLocalISODate(addDays(todayLocalNoon(), offsetDays));
}

/** "YYYY-MM" из поля intakeDate → Date на 1-е число этого месяца, полдень. */
function parseIntakeMonth(value) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return null;
  const [y, m] = value.split('-').map(Number);
  return new Date(y, m - 1, 1, 12, 0, 0);
}

/** Дата за leadDays до начала учёбы, либо '' если intake неизвестен. */
function beforeIntake(intake, leadDays) {
  if (!intake) return '';
  return toLocalISODate(addDays(intake, -leadDays));
}

export function makeId(prefix = 'step') {
  const rnd = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${rnd}`;
}

/* ------------------------------------------------------------------ */
/* Чек-лист: нормализация к { text, done }                             */
/* ------------------------------------------------------------------ */

/** Принимает строки (старый формат) или объекты (новый) — приводит к
 *  единому виду. Идемпотентна: повторный вызов ничего не портит. */
export function normalizeChecklist(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (typeof item === 'string') return { text: item, done: false };
      if (item && typeof item.text === 'string') return { text: item.text, done: Boolean(item.done) };
      return null;
    })
    .filter(Boolean);
}

function cl(...items) {
  return items.map((text) => ({ text, done: false }));
}

/** Если весь чек-лист закрыт — статус done; если что-то закрыто и статус
 *  был not_started — in_progress; если статус был done, а что-то сняли —
 *  обратно в in_progress. Шаги без чек-листа статус не меняют сами по себе. */
export function syncStatusFromChecklist(step) {
  if (!step.checklist?.length) return step;
  const allDone = step.checklist.every((i) => i.done);
  const anyDone = step.checklist.some((i) => i.done);
  if (allDone) step.status = 'done';
  else if (anyDone && step.status === 'not_started') step.status = 'in_progress';
  else if (!anyDone && step.status === 'done') step.status = 'in_progress';
  return step;
}

/* ------------------------------------------------------------------ */
/* Генератор плана                                                     */
/* ------------------------------------------------------------------ */

export function buildRoadmap(profile) {
  const name = profile.name || 'абитуриент';
  const uni = profile.university || 'выбранный вуз';
  const program = profile.program || 'выбранная программа';
  const hasScholarship = profile.funding === 'scholarship';
  const isPhD = profile.degreeLevel === 'PhD';
  const intake = parseIntakeMonth(profile.intakeDate);

  /** Дедлайн от intake, если он известен; иначе пусто — с текстовой
   *  подсказкой вместо придуманной даты. */
  const dl = (leadDays, note) =>
    intake ? { deadline: beforeIntake(intake, leadDays), deadlineNote: '' } : { deadline: '', deadlineNote: note };

  const preOffer = [];
  if (profile.offerStatus === 'planning') {
    preOffer.push(
      {
        id: 'choose-programs',
        phase: 'offer',
        title: 'Выбрать программы и проверить требования',
        description: 'Составьте список из 3–5 программ и сверьте требования по языку, оценкам и дедлайнам подачи.',
        why: 'Требования сильно различаются между вузами — без сверки легко потратить месяц на программу, куда не пройдёте по формальным критериям.',
        estimateDays: 14,
        checklist: cl('Составить список программ', 'Сверить требования по каждой', 'Отметить дедлайны подачи'),
        ...dl(210, 'начните как можно раньше — от этого зависят все остальные сроки'),
      },
      {
        id: 'submit-application',
        phase: 'offer',
        title: 'Подготовить и подать заявку',
        description: 'Соберите документы для подачи: мотивационное письмо, рекомендации, транскрипт — и отправьте заявку до дедлайна вуза.',
        why: 'У большинства программ жёсткий дедлайн подачи — пропущенный означает перенос на следующий набор, то есть на год.',
        estimateDays: 30,
        checklist: cl('Мотивационное письмо', 'Рекомендательные письма', 'Транскрипт с оценками', 'Подать заявку до дедлайна'),
        ...dl(190, 'уточните дедлайн подачи на сайте программы'),
      }
    );
  } else if (profile.offerStatus === 'waiting') {
    preOffer.push({
      id: 'await-decision',
      phase: 'offer',
      title: 'Дождаться решения вуза',
      description: 'Пока идёт рассмотрение заявки, держите план B: запасные программы или дополнительный набор документов, если попросят.',
      why: 'Вузы обычно отвечают за 4–8 недель после дедлайна подачи. Если приближается ваш желаемый срок начала учёбы, а ответа нет — стоит уточнить статус напрямую.',
      estimateDays: 42,
      checklist: cl('Проверить статус заявки в личном кабинете', 'Подготовить запасной вариант'),
      ...dl(180, 'уточните ожидаемый срок ответа у приёмной комиссии'),
    });
  }

  const steps = [
    ...preOffer,
    {
      id: 'confirm-offer',
      phase: 'offer',
      title: 'Подтвердить offer в личном кабинете',
      description: 'Войдите в портал абитуриента и нажмите «Accept». До подтверждения место за вами не закреплено.',
      why: 'Место держат ограниченное время. Если не подтвердить в срок, его отдают из листа ожидания.',
      estimateDays: 1,
      checklist: cl('Войти в портал', 'Нажать Accept', 'Сохранить PDF-подтверждение'),
      // Срок подтверждения задаёт сам вуз в письме о зачислении и обычно
      // не зависит от даты начала учёбы — поэтому не считаем от intake,
      // а не выдумываем дату вовсе.
      deadline: '',
      deadlineNote: 'срок указан в вашем письме о зачислении — обычно 2–4 недели с даты получения',
    },
    ...(hasScholarship
      ? [
          {
            id: 'scholarship-application',
            phase: 'scholarship',
            title: 'Подать документы на стипендию или грант',
            description:
              'Соберите и отправьте полный пакет документов в организацию, которая финансирует ваше обучение. Точный перечень и сроки уточните на её официальном сайте — они у каждого фонда свои.',
            why: 'Требования и дедлайны конкурса зависят от конкретного фонда. Пропущенный дедлайн подачи обычно означает перенос на следующий набор.',
            estimateDays: 14,
            checklist: cl('Уточнить список документов у фонда', 'Собрать пакет документов', 'Подать заявку до дедлайна фонда'),
            ...dl(120, 'сроки уточняйте у вашего стипендиального фонда — они не совпадают с дедлайнами вуза'),
          },
        ]
      : []),
    {
      id: 'collect-documents',
      phase: 'documents',
      title: 'Собрать пакет документов',
      description: `Оригиналы диплома и приложения, паспорт, сертификат по языку, фото${
        profile.citizenship ? ` — уточните для граждан «${profile.citizenship}», нужен ли апостиль` : '. Уточните в приёмной комиссии, нужен ли апостиль'
      }.`,
      why: 'Без полного пакета вуз не выдаст письмо для визы, а это самый длинный этап цепочки.',
      estimateDays: 21,
      checklist: cl(
        'Диплом и приложение с оценками',
        'Нотариальный перевод на язык обучения',
        'Апостиль (уточнить необходимость)',
        'Загранпаспорт со сроком действия на весь период учёбы',
        'Сертификат IELTS / TOEFL'
      ),
      ...dl(60, 'обычно за 60 дней до начала семестра'),
    },
    ...(isPhD
      ? [
          {
            id: 'research-proposal',
            phase: 'documents',
            title: 'Согласовать исследовательское предложение с научным руководителем',
            description: 'Для PhD-программы обычно нужен research proposal и предварительное согласие потенциального научного руководителя — это часть заявки или условие offer.',
            why: 'Без согласия руководителя и внятного плана исследования кафедра может не утвердить зачисление, даже если формальный offer уже получен.',
            estimateDays: 30,
            checklist: cl('Написать research proposal', 'Связаться с потенциальными руководителями', 'Приложить примеры научных работ'),
            ...dl(150, 'начните как можно раньше — переписка с руководителями может занять недели'),
          },
        ]
      : []),
    {
      id: 'legalize-diploma',
      phase: 'documents',
      title: 'Легализовать диплом',
      description: 'Проставьте апостиль в министерстве образования и сделайте присяжный перевод.',
      why: 'Процедура занимает недели и не ускоряется. Начатая поздно, она срывает подачу на визу.',
      estimateDays: 30,
      checklist: cl('Подать документы на апостиль', 'Заказать присяжный перевод'),
      ...dl(100, 'начать сразу после подтверждения offer'),
    },
    {
      id: 'pay-tuition',
      phase: 'finance',
      title: 'Оплатить первый взнос',
      description: 'Переведите первый взнос по реквизитам из письма и сохраните SWIFT-подтверждение.',
      why: 'Квитанция об оплате входит в визовый пакет как подтверждение финансовой состоятельности.',
      estimateDays: 3,
      checklist: cl('Проверить реквизиты', 'Сделать перевод', 'Сохранить SWIFT-подтверждение'),
      ...dl(45, 'обычно после получения счёта от вуза, не позднее чем за 45 дней до начала семестра'),
    },
    {
      id: 'proof-of-funds',
      phase: 'finance',
      title: 'Подготовить подтверждение средств',
      description: 'Откройте счёт и обеспечьте выписку на сумму прожиточного минимума за год.',
      why: 'Консульства требуют, чтобы деньги пролежали на счету определённый срок — обычно от трёх месяцев.',
      estimateDays: 90,
      checklist: cl('Открыть счёт', 'Внести сумму', 'Заказать выписку с печатью банка'),
      ...dl(90, 'за 3 месяца до подачи на визу'),
    },
    {
      id: 'visa-appointment',
      phase: 'visa',
      title: 'Записаться в консульство',
      description: `Слоты разбирают за недели вперёд. Запишитесь, как только получите письмо о зачислении${
        profile.city ? ` — ищите ближайший к городу «${profile.city}» визовый центр или консульство` : ''
      }.`,
      why: 'Очередь в консульство — самое частое место, где абитуриенты теряют семестр.',
      estimateDays: 1,
      checklist: cl('Найти сайт консульства', 'Записаться на подачу', 'Распечатать подтверждение записи'),
      ...dl(75, 'сразу после получения письма о зачислении, не позднее чем за 75 дней до начала семестра'),
    },
    {
      id: 'submit-visa',
      phase: 'visa',
      title: 'Подать документы на студенческую визу',
      description: 'Придите на подачу с полным пакетом: письмо о зачислении, оплата, выписка, страховка, фото.',
      why: 'Неполный пакет означает повторную запись и потерю нескольких недель.',
      estimateDays: 30,
      checklist: cl('Письмо о зачислении', 'Квитанция об оплате', 'Банковская выписка', 'Медицинская страховка', 'Заполненная визовая анкета'),
      ...dl(60, 'за 60–90 дней до начала семестра'),
    },
    {
      id: 'housing',
      phase: 'arrival',
      title: 'Забронировать жильё',
      description: 'Подайте заявку на общежитие; параллельно смотрите частную аренду как запасной вариант.',
      why: 'Мест в общежитии меньше, чем поступающих, и распределяют их по дате заявки.',
      estimateDays: 14,
      checklist: cl('Подать заявку на общежитие', 'Посмотреть частную аренду', 'Заложить депозит'),
      ...dl(60, 'за 2–3 месяца до заезда'),
    },
    {
      id: 'flight-arrival',
      phase: 'arrival',
      title: 'Купить билеты и спланировать заезд',
      description: 'Возьмите билет с запасом в несколько дней до ориентационной недели.',
      why: 'Регистрация, банк и SIM-карта занимают первые дни и требуют личного присутствия.',
      estimateDays: 2,
      checklist: cl('Купить билет', 'Оформить страховку на въезд', 'Распечатать документы для границы'),
      ...dl(10, 'после получения визы, не позднее чем за 10 дней до начала семестра'),
    },
    {
      id: 'orientation',
      phase: 'study',
      title: 'Пройти регистрацию и ориентационную неделю',
      description: 'Получите студенческий, зарегистрируйтесь по месту жительства и запишитесь на курсы.',
      why: 'Без регистрации в течение установленного срока нарушается визовый режим.',
      estimateDays: 7,
      checklist: cl('Регистрация в вузе', 'Регистрация по месту жительства', 'Запись на курсы'),
      ...dl(0, 'в начале семестра'),
    },
  ];

  const recap = [profile.specialty, profile.educationLevel]
    .filter(Boolean)
    .join(', ');

  return {
    title: `План поступления: ${program}`,
    summary:
      `${name}, это шаблонный план для «${uni}»${recap ? ` (текущий уровень: ${recap})` : ''}. ` +
      'Показывает типичную последовательность действий после offer — ' +
      (intake
        ? 'сроки посчитаны в обратном порядке от даты начала учёбы, но без проверки по сайту вуза.'
        : 'без даты начала учёбы сроки не посчитаны, только общие ориентиры. Укажите месяц начала учёбы, чтобы увидеть даты.'),
    university: uni,
    program,
    notes: profile.notes || '',
    confidence: 'unverified',
    steps: steps.map((s) => ({
      ...s,
      status: 'not_started',
      sources: [],
      verified: false,
      custom: false,
      checklist: normalizeChecklist(s.checklist),
    })),
    openQuestions: [
      profile.citizenship
        ? `Нужен ли апостиль на диплом для граждан «${profile.citizenship}»?`
        : 'Нужен ли апостиль на диплом для вашей страны гражданства?',
      'Какая сумма требуется на счету для подачи на визу?',
      'Открыт ли приём заявок на общежитие на ваш семестр?',
      ...(profile.citizenship && profile.country
        ? [
            `Если университет находится в вашей стране проживания (${profile.country}), визовые шаги, вероятно, не понадобятся — проверьте это в первую очередь, прежде чем следовать визовому блоку плана.`,
          ]
        : []),
      ...(hasScholarship ? ['Какие документы и сроки требует ваш стипендиальный фонд для отдельного конкурса?'] : []),
    ],
    contacts: [
      {
        label: 'Шаблон',
        value: 'Не привязан к конкретному вузу — контакты приёмной комиссии здесь не подставляются',
        url: '',
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Нормализация и агрегаты                                             */
/* ------------------------------------------------------------------ */

/**
 * Приводит роадмап к канонической форме: чек-листы — к { text, done },
 * статусы шагов с известным id сохраняются из previous (при перегенерации
 * или после chat-предложений), шаги сортируются по порядку фаз из PHASES
 * (а не по полю order, которое иначе легко рассинхронизировать), order
 * пересчитывается как позиция после сортировки.
 */
export function normalizeRoadmap(roadmap, previous = null) {
  const previousStatus = new Map((previous?.steps ?? []).map((s) => [s.id, s.status]));

  const steps = (roadmap.steps ?? [])
    .map((step, index) => ({
      ...step,
      id: step.id || makeId(),
      phase: step.phase || 'documents',
      status: previousStatus.get(step.id) ?? step.status ?? 'not_started',
      checklist: normalizeChecklist(step.checklist),
      sources: step.sources ?? [],
      custom: Boolean(step.custom),
    }))
    .sort((a, b) => (PHASE_ORDER.get(a.phase) ?? 999) - (PHASE_ORDER.get(b.phase) ?? 999))
    .map((step, index) => ({ ...step, order: index + 1 }));

  return {
    ...roadmap,
    steps,
    openQuestions: roadmap.openQuestions ?? [],
    contacts: roadmap.contacts ?? [],
    notes: roadmap.notes ?? '',
    updatedAt: new Date().toISOString(),
  };
}

/** total/done — целыми шагами (для подписи «N из M готово»).
 *  percent — по пунктам чек-листа (шаг без чек-листа считается за 1 пункт),
 *  поэтому частично отмеченный чек-лист двигает прогресс-бар, а не ждёт
 *  полного закрытия шага. */
export function progressOf(roadmap) {
  const steps = roadmap?.steps ?? [];
  const doneSteps = steps.filter((s) => s.status === 'done').length;

  let totalUnits = 0;
  let doneUnits = 0;
  for (const s of steps) {
    const items = s.checklist ?? [];
    if (items.length) {
      totalUnits += items.length;
      doneUnits += items.filter((i) => i.done).length;
    } else {
      totalUnits += 1;
      doneUnits += s.status === 'done' ? 1 : 0;
    }
  }

  return {
    total: steps.length,
    done: doneSteps,
    percent: totalUnits ? Math.round((doneUnits / totalUnits) * 100) : 0,
  };
}

/**
 * Применяет операции add_step / update_step / remove_step. Используется и
 * предложениями чата, и прямым редактированием пользователя (передайте
 * custom: true в add_step, чтобы пометить шаг как добавленный вручную).
 * Результат всегда проходит через normalizeRoadmap — сортировка по фазам
 * и форма чек-листа гарантированы независимо от вызывающего кода.
 */
export function applyOperations(roadmap, operations) {
  const steps = roadmap.steps.map((s) => ({ ...s, checklist: s.checklist.map((i) => ({ ...i })) }));
  const applied = [];

  for (const op of operations ?? []) {
    if (op.op === 'remove_step') {
      const index = steps.findIndex((s) => s.id === op.stepId);
      if (index !== -1) {
        applied.push(`удалён шаг «${steps[index].title}»`);
        steps.splice(index, 1);
      }
      continue;
    }
    if (op.op === 'update_step') {
      const step = steps.find((s) => s.id === op.stepId);
      if (!step) continue;
      for (const field of ['title', 'description', 'why', 'deadline', 'phase']) {
        if (typeof op[field] === 'string' && op[field] !== '') step[field] = op[field];
      }
      if (op.deadline === '') { step.deadline = ''; }
      if (Array.isArray(op.checklist)) step.checklist = normalizeChecklist(op.checklist);
      if (!step.custom) step.verified = false;
      applied.push(`обновлён шаг «${step.title}»`);
      continue;
    }
    if (op.op === 'add_step') {
      const id = op.stepId || makeId();
      if (steps.some((s) => s.id === id)) continue;
      steps.push({
        id,
        phase: op.phase || 'documents',
        title: op.title || 'Новый шаг',
        description: op.description || '',
        why: op.why || '',
        deadline: op.deadline || '',
        deadlineNote: op.deadlineNote || '',
        estimateDays: Number.isFinite(op.estimateDays) ? op.estimateDays : 0,
        status: 'not_started',
        checklist: normalizeChecklist(op.checklist ?? []),
        sources: [],
        verified: false,
        custom: Boolean(op.custom),
      });
      applied.push(`добавлен шаг «${op.title || 'без названия'}»`);
    }
  }

  return { roadmap: normalizeRoadmap({ ...roadmap, steps }, roadmap), applied };
}

export function isValidStatus(status) {
  return STATUSES.includes(status);
}
