/**
 * AI Roadmap — офлайн-демо.
 *
 * Полностью статичная версия: без сервера, без сети, без ключей API,
 * без регистрации/логина. Профиль передаётся сразу в шаблонный генератор
 * плана прямо в браузере; результат и переписка с ассистентом хранятся
 * только в localStorage этого устройства. Ничего никуда не отправляется —
 * это единственный безопасный способ сделать демо публичным на GitHub Pages:
 * настоящий ключ Anthropic нельзя встраивать в клиентский код, потому что
 * он был бы виден любому в исходниках страницы.
 */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const STORAGE_KEY = 'ai-roadmap-demo-state';

const PHASES = [
  { id: 'offer', label: 'Подтверждение offer' },
  { id: 'scholarship', label: 'Стипендия / грант' },
  { id: 'documents', label: 'Документы' },
  { id: 'finance', label: 'Финансы и оплата' },
  { id: 'visa', label: 'Виза' },
  { id: 'arrival', label: 'Переезд и жильё' },
  { id: 'study', label: 'Начало учёбы' },
];
const PHASE_LABELS = new Map(PHASES.map((p) => [p.id, p.label]));

const STATUS_LABELS = {
  not_started: 'Не начато',
  in_progress: 'В процессе',
  done: 'Готово',
};

const state = {
  profile: null,
  roadmap: null,
  messages: [],
  pendingProposal: null,
  filter: 'all',
  streaming: false,
};

/* ------------------------------------------------------------------ */
/* Хранилище (localStorage — данные не покидают браузер)               */
/* ------------------------------------------------------------------ */

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    state.profile = saved.profile ?? null;
    state.roadmap = saved.roadmap ?? null;
    state.messages = saved.messages ?? [];
    state.pendingProposal = saved.pendingProposal ?? null;
    return Boolean(state.roadmap);
  } catch {
    return false;
  }
}

function persist() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      profile: state.profile,
      roadmap: state.roadmap,
      messages: state.messages,
      pendingProposal: state.pendingProposal,
    })
  );
}

/* ------------------------------------------------------------------ */
/* Инициализация                                                       */
/* ------------------------------------------------------------------ */

function init() {
  if (loadState()) {
    showScreen('roadmap');
    renderRoadmap();
    renderChatHistory();
    return;
  }
  showScreen('intake');
}

function showScreen(name) {
  $('#screenIntake').hidden = name !== 'intake';
  $('#screenLoading').hidden = name !== 'loading';
  $('#screenRoadmap').hidden = name !== 'roadmap';
  $('#resetBtn').hidden = name !== 'roadmap';
}

/* ------------------------------------------------------------------ */
/* Анкета                                                              */
/* ------------------------------------------------------------------ */

/** Типовой профиль — чтобы посмотреть план без ввода своих данных. */
const SAMPLE_PROFILE = {
  name: 'Аружан',
  citizenship: 'Казахстан',
  educationLevel: 'бакалавриат',
  specialty: 'Информационные системы',
  city: 'Алматы',
  country: 'Казахстан',
  university: 'Delft University of Technology',
  program: 'MSc Computer Science',
  degreeLevel: 'магистратура',
  intakeDate: sampleIntakeMonth(),
  offerStatus: 'received',
  funding: 'scholarship',
  notes: 'Нужно общежитие, загранпаспорт истекает в мае.',
};

/** Сентябрь ближайшего учебного года — чтобы дата не выглядела просроченной. */
function sampleIntakeMonth() {
  const now = new Date();
  const year = now.getMonth() >= 8 ? now.getFullYear() + 1 : now.getFullYear();
  return `${year}-09`;
}

function fillSampleProfile() {
  const form = $('#profileForm');
  for (const [name, value] of Object.entries(SAMPLE_PROFILE)) {
    const field = form.elements[name];
    if (!field) continue;
    if (field instanceof RadioNodeList) {
      const match = [...field].find((el) => el.value === value);
      if (match) match.checked = true;
    } else {
      field.value = value;
    }
  }
  showFormError(null);
}

function initForm() {
  $('#fillSampleBtn').addEventListener('click', fillSampleProfile);

  $('#profileForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const profile = Object.fromEntries(new FormData(form).entries());

    const missing = ['name', 'university', 'program'].filter((f) => !profile[f]?.trim());
    if (missing.length) {
      showFormError('Заполните обязательные поля: имя, университет, программа.');
      form.elements[missing[0]].focus();
      return;
    }
    showFormError(null);

    showScreen('loading');
    markLoading('build');

    // Небольшая пауза только ради ощущения «идёт сборка» — вся работа
    // на самом деле синхронна и не требует сети.
    setTimeout(() => {
      markLoading('render');
      state.profile = profile;
      state.roadmap = normalizeRoadmap(buildRoadmap(profile));
      state.messages = [];
      state.pendingProposal = null;
      persist();

      setTimeout(() => {
        showScreen('roadmap');
        renderRoadmap();
        renderChatHistory();
      }, 300);
    }, 500);
  });

  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('Начать заново? Текущий план и переписка будут потеряны.')) return;
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });
}

function showFormError(message) {
  const el = $('#formError');
  el.textContent = message ?? '';
  el.hidden = !message;
  if (message) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function markLoading(step) {
  const order = ['build', 'render'];
  const index = order.indexOf(step);
  $$('#loadingSteps li').forEach((li, i) => {
    li.classList.toggle('is-active', i === index);
    li.classList.toggle('is-done', i < index);
  });
}

/* ------------------------------------------------------------------ */
/* Генератор плана (шаблонный, полностью локальный)                    */
/* ------------------------------------------------------------------ */

const day = 86400000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * day).toISOString().slice(0, 10);

function buildRoadmap(profile) {
  const name = profile.name || 'абитуриент';
  const uni = profile.university || 'выбранный вуз';
  const program = profile.program || 'выбранная программа';
  const hasScholarship = profile.funding === 'scholarship';

  const steps = [
    {
      id: 'confirm-offer',
      phase: 'offer',
      title: 'Подтвердить offer в личном кабинете',
      description:
        'Войдите в портал абитуриента и нажмите «Accept». До подтверждения место за вами не закреплено.',
      why: 'Место держат ограниченное время. Если не подтвердить в срок, его отдают из листа ожидания.',
      deadline: iso(21),
      deadlineNote: '',
      estimateDays: 1,
      checklist: ['Войти в портал', 'Нажать Accept', 'Сохранить PDF-подтверждение'],
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
            deadline: '',
            deadlineNote: 'сроки уточняйте у вашего стипендиального фонда',
            estimateDays: 14,
            checklist: [
              'Уточнить список документов у фонда',
              'Собрать пакет документов',
              'Подать заявку до дедлайна фонда',
            ],
          },
        ]
      : []),
    {
      id: 'collect-documents',
      phase: 'documents',
      title: 'Собрать пакет документов',
      description:
        'Оригиналы диплома и приложения, паспорт, сертификат по языку, фото. Уточните в приёмной комиссии, нужен ли апостиль.',
      why: 'Без полного пакета вуз не выдаст письмо для визы, а это самый длинный этап цепочки.',
      deadline: '',
      deadlineNote: 'обычно за 60 дней до начала семестра',
      estimateDays: 21,
      checklist: [
        'Диплом и приложение с оценками',
        'Нотариальный перевод на язык обучения',
        'Апостиль (уточнить необходимость)',
        'Загранпаспорт со сроком действия на весь период учёбы',
        'Сертификат IELTS / TOEFL',
      ],
    },
    {
      id: 'legalize-diploma',
      phase: 'documents',
      title: 'Легализовать диплом',
      description: 'Проставьте апостиль в министерстве образования и сделайте присяжный перевод.',
      why: 'Процедура занимает недели и не ускоряется. Начатая поздно, она срывает подачу на визу.',
      deadline: '',
      deadlineNote: 'начать сразу после подтверждения offer',
      estimateDays: 30,
      checklist: ['Подать документы на апостиль', 'Заказать присяжный перевод'],
    },
    {
      id: 'pay-tuition',
      phase: 'finance',
      title: 'Оплатить первый взнос',
      description: 'Переведите первый взнос по реквизитам из письма и сохраните SWIFT-подтверждение.',
      why: 'Квитанция об оплате входит в визовый пакет как подтверждение финансовой состоятельности.',
      deadline: iso(45),
      deadlineNote: '',
      estimateDays: 3,
      checklist: ['Проверить реквизиты', 'Сделать перевод', 'Сохранить SWIFT-подтверждение'],
    },
    {
      id: 'proof-of-funds',
      phase: 'finance',
      title: 'Подготовить подтверждение средств',
      description: 'Откройте счёт и обеспечьте выписку на сумму прожиточного минимума за год.',
      why: 'Консульства требуют, чтобы деньги пролежали на счету определённый срок — обычно от трёх месяцев.',
      deadline: '',
      deadlineNote: 'за 3 месяца до подачи на визу',
      estimateDays: 90,
      checklist: ['Открыть счёт', 'Внести сумму', 'Заказать выписку с печатью банка'],
    },
    {
      id: 'visa-appointment',
      phase: 'visa',
      title: 'Записаться в консульство',
      description: 'Слоты разбирают за недели вперёд. Запишитесь, как только получите письмо о зачислении.',
      why: 'Очередь в консульство — самое частое место, где абитуриенты теряют семестр.',
      deadline: '',
      deadlineNote: 'сразу после получения письма о зачислении',
      estimateDays: 1,
      checklist: ['Найти сайт консульства', 'Записаться на подачу', 'Распечатать подтверждение записи'],
    },
    {
      id: 'submit-visa',
      phase: 'visa',
      title: 'Подать документы на студенческую визу',
      description: 'Придите на подачу с полным пакетом: письмо о зачислении, оплата, выписка, страховка, фото.',
      why: 'Неполный пакет означает повторную запись и потерю нескольких недель.',
      deadline: '',
      deadlineNote: 'за 60–90 дней до начала семестра',
      estimateDays: 30,
      checklist: [
        'Письмо о зачислении',
        'Квитанция об оплате',
        'Банковская выписка',
        'Медицинская страховка',
        'Заполненная визовая анкета',
      ],
    },
    {
      id: 'housing',
      phase: 'arrival',
      title: 'Забронировать жильё',
      description: 'Подайте заявку на общежитие; параллельно смотрите частную аренду как запасной вариант.',
      why: 'Мест в общежитии меньше, чем поступающих, и распределяют их по дате заявки.',
      deadline: '',
      deadlineNote: 'за 2–3 месяца до заезда',
      estimateDays: 14,
      checklist: ['Подать заявку на общежитие', 'Посмотреть частную аренду', 'Заложить депозит'],
    },
    {
      id: 'flight-arrival',
      phase: 'arrival',
      title: 'Купить билеты и спланировать заезд',
      description: 'Возьмите билет с запасом в несколько дней до ориентационной недели.',
      why: 'Регистрация, банк и SIM-карта занимают первые дни и требуют личного присутствия.',
      deadline: '',
      deadlineNote: 'после получения визы',
      estimateDays: 2,
      checklist: ['Купить билет', 'Оформить страховку на въезд', 'Распечатать документы для границы'],
    },
    {
      id: 'orientation',
      phase: 'study',
      title: 'Пройти регистрацию и ориентационную неделю',
      description: 'Получите студенческий, зарегистрируйтесь по месту жительства и запишитесь на курсы.',
      why: 'Без регистрации в течение установленного срока нарушается визовый режим.',
      deadline: iso(150),
      deadlineNote: '',
      estimateDays: 7,
      checklist: ['Регистрация в вузе', 'Регистрация по месту жительства', 'Запись на курсы'],
    },
  ];

  return {
    title: `План поступления: ${program}`,
    summary:
      `${name}, это офлайн-демо плана для «${uni}». Показывает типичную ` +
      'последовательность действий после offer, собранную по шаблону — без проверки ' +
      'по сайту вуза, без ссылок и без реальных дедлайнов. Все шаги помечены как общая практика.',
    university: uni,
    program,
    confidence: 'unverified',
    steps: steps.map((s, i) => ({ ...s, order: i + 1, status: 'not_started', sources: [], verified: false })),
    openQuestions: [
      'Нужен ли апостиль на диплом для вашей страны гражданства?',
      'Какая сумма требуется на счету для подачи на визу?',
      'Открыт ли приём заявок на общежитие на ваш семестр?',
      ...(hasScholarship
        ? ['Какие документы и сроки требует ваш стипендиальный фонд для отдельного конкурса?']
        : []),
    ],
    contacts: [
      {
        label: 'Офлайн-демо',
        value: 'Это шаблон без связи с конкретным вузом — контакты приёмной комиссии здесь не подставляются',
        url: '',
      },
    ],
  };
}

/**
 * Статус шага не входит в шаблон — им управляет пользователь.
 * При пересборке плана (например, после apply предложения) сохраняем
 * уже отмеченные статусы по id шага.
 */
function normalizeRoadmap(roadmap, previous = null) {
  const previousStatus = new Map((previous?.steps ?? []).map((s) => [s.id, s.status]));
  const steps = (roadmap.steps ?? [])
    .map((step, index) => ({
      ...step,
      id: step.id || `step-${index + 1}`,
      order: Number.isInteger(step.order) ? step.order : index + 1,
      status: previousStatus.get(step.id) ?? step.status ?? 'not_started',
      checklist: step.checklist ?? [],
      sources: step.sources ?? [],
    }))
    .sort((a, b) => a.order - b.order)
    .map((step, index) => ({ ...step, order: index + 1 }));

  return {
    ...roadmap,
    steps,
    openQuestions: roadmap.openQuestions ?? [],
    contacts: roadmap.contacts ?? [],
    updatedAt: new Date().toISOString(),
  };
}

function progressOf(roadmap) {
  const steps = roadmap?.steps ?? [];
  const done = steps.filter((s) => s.status === 'done').length;
  return {
    total: steps.length,
    done,
    percent: steps.length ? Math.round((done / steps.length) * 100) : 0,
  };
}

/** Применяет операции из предложения чата (add/update/remove шага). */
function applyOperations(roadmap, operations) {
  const steps = roadmap.steps.map((s) => ({ ...s }));
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
      if (Array.isArray(op.checklist)) step.checklist = op.checklist;
      step.verified = false;
      applied.push(`обновлён шаг «${step.title}»`);
      continue;
    }
    if (op.op === 'add_step') {
      if (steps.some((s) => s.id === op.stepId)) continue;
      steps.push({
        id: op.stepId,
        order: steps.length + 1,
        phase: op.phase || 'documents',
        title: op.title || 'Новый шаг',
        description: op.description || '',
        why: op.why || '',
        deadline: op.deadline || '',
        deadlineNote: '',
        estimateDays: 0,
        status: 'not_started',
        checklist: op.checklist ?? [],
        sources: [],
        verified: false,
      });
      applied.push(`добавлен шаг «${op.title || op.stepId}»`);
    }
  }

  return {
    roadmap: { ...roadmap, steps: steps.map((s, i) => ({ ...s, order: i + 1 })), updatedAt: new Date().toISOString() },
    applied,
  };
}

/* ------------------------------------------------------------------ */
/* Таймлайн                                                            */
/* ------------------------------------------------------------------ */

function renderRoadmap() {
  const { roadmap } = state;
  $('#roadmapTitle').textContent = roadmap.title;
  $('#roadmapSummary').textContent = roadmap.summary;

  const conf = $('#confidence');
  conf.className = `confidence ${roadmap.confidence}`;
  conf.textContent = 'Шаблон — не привязан к конкретному вузу';

  $('#chatContext').textContent = `Знает ваш профиль и все ${roadmap.steps.length} шагов плана`;

  renderProgress();
  renderTimeline();
  renderPanels();
}

function renderProgress() {
  const p = progressOf(state.roadmap);
  $('#progressFill').style.width = `${p.percent}%`;
  $('#progressLabel').textContent = `${p.done} из ${p.total} готово`;
}

function renderTimeline() {
  const list = $('#timeline');
  const steps = state.roadmap.steps.filter((s) => state.filter === 'all' || s.status === state.filter);

  if (!steps.length) {
    list.innerHTML = `<li class="msg-empty">Нет шагов с этим статусом.</li>`;
    return;
  }

  let lastPhase = null;
  list.innerHTML = steps
    .map((step) => {
      let head = '';
      if (step.phase !== lastPhase) {
        lastPhase = step.phase;
        head = `<li class="tl-phase" role="presentation">${esc(PHASE_LABELS.get(step.phase) ?? step.phase)}</li>`;
      }
      return head + stepMarkup(step);
    })
    .join('');

  list.querySelectorAll('.status-select').forEach((select) => {
    select.addEventListener('change', () => updateStatus(select.dataset.step, select.value));
  });
}

function stepMarkup(step) {
  const due = deadlineTag(step);
  const verified = `<span class="tag unverified">общая практика</span>`;
  const estimate = step.estimateDays > 0 ? `<span class="tag">≈ ${step.estimateDays} дн.</span>` : '';

  const checklist = step.checklist?.length
    ? `<ul class="tl-check">${step.checklist.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
    : '';

  const why = step.why
    ? `<details class="tl-why"><summary>Зачем этот шаг</summary><p>${esc(step.why)}</p></details>`
    : '';

  return `
    <li class="tl-item" data-status="${step.status}" data-step="${esc(step.id)}">
      <span class="tl-marker" aria-hidden="true">${step.status === 'done' ? '✓' : step.order}</span>
      <div class="tl-card">
        <div class="tl-top">
          <h3 class="tl-title">${esc(step.title)}</h3>
          <label class="sr-only" for="st-${esc(step.id)}">Статус шага «${esc(step.title)}»</label>
          <select class="status-select" id="st-${esc(step.id)}" data-step="${esc(step.id)}">
            ${Object.entries(STATUS_LABELS)
              .map(([value, label]) => `<option value="${value}"${step.status === value ? ' selected' : ''}>${label}</option>`)
              .join('')}
          </select>
        </div>
        <p class="tl-desc">${esc(step.description)}</p>
        <div class="tl-meta">${due}${estimate}${verified}</div>
        ${checklist}
        ${why}
      </div>
    </li>`;
}

function deadlineTag(step) {
  if (step.deadline) {
    const days = daysUntil(step.deadline);
    const cls = days < 0 ? 'due-past' : days <= 14 ? 'due-soon' : 'due';
    const suffix = days < 0 ? `просрочено на ${Math.abs(days)} дн.` : days === 0 ? 'сегодня' : `через ${days} дн.`;
    return `<span class="tag ${cls}">${formatDate(step.deadline)} · ${suffix}</span>`;
  }
  if (step.deadlineNote) return `<span class="tag">${esc(step.deadlineNote)}</span>`;
  return '';
}

function updateStatus(stepId, status) {
  const step = state.roadmap.steps.find((s) => s.id === stepId);
  if (!step) return;
  step.status = status;
  state.roadmap.updatedAt = new Date().toISOString();
  persist();

  renderProgress();
  const item = document.querySelector(`.tl-item[data-step="${CSS.escape(stepId)}"]`);
  if (item) {
    item.dataset.status = status;
    item.querySelector('.tl-marker').textContent = status === 'done' ? '✓' : step.order;
  }
  if (state.filter !== 'all') renderTimeline();
}

function renderPanels() {
  const { roadmap } = state;
  fillPanel('#openQuestionsPanel', '#openQuestions', roadmap.openQuestions, (q) => esc(q));
  fillPanel('#contactsPanel', '#contacts', roadmap.contacts, (c) => `${esc(c.label)}: ${esc(c.value)}`);
}

function fillPanel(panelSel, listSel, items, render) {
  const panel = $(panelSel);
  if (!items?.length) {
    panel.hidden = true;
    return;
  }
  $(listSel).innerHTML = items.map((i) => `<li>${render(i)}</li>`).join('');
  panel.hidden = false;
}

function initFilters() {
  $$('.filters .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      $$('.filters .chip').forEach((c) => c.classList.remove('is-active'));
      chip.classList.add('is-active');
      state.filter = chip.dataset.filter;
      renderTimeline();
    });
  });
}

/* ------------------------------------------------------------------ */
/* Чат (локальная эвристика — без обращения к какой-либо модели)       */
/* ------------------------------------------------------------------ */

function renderChatHistory() {
  const log = $('#chatLog');
  log.innerHTML = '';

  if (!state.messages.length) {
    log.innerHTML = `<p class="msg msg-empty">Спросите про любой шаг: зачем он нужен, что делать при срыве срока, какие документы собрать. Ассистент здесь отвечает по заранее заданным правилам — это офлайн-демо, а не языковая модель.</p>`;
  } else {
    for (const m of state.messages) {
      if (m.system) appendSystem(m.content);
      else appendMessage(m.role, m.content);
    }
  }

  if (state.pendingProposal) appendProposal(state.pendingProposal);
  log.scrollTop = log.scrollHeight;
}

function appendMessage(role, text) {
  const el = document.createElement('div');
  el.className = `msg msg-${role === 'user' ? 'user' : 'ai'}`;
  el.textContent = text;
  $('#chatLog').append(el);
  return el;
}

function appendSystem(text) {
  const el = document.createElement('div');
  el.className = 'msg msg-system';
  el.textContent = text;
  $('#chatLog').append(el);
}

function appendProposal(proposal) {
  const el = document.createElement('div');
  el.className = 'proposal';
  el.innerHTML = `
    <h3>Предлагаю обновить план</h3>
    <p>${esc(proposal.rationale)}</p>
    <ul>${proposal.operations.map((op) => `<li>${esc(describeOp(op))}</li>`).join('')}</ul>
    <div class="proposal-actions">
      <button class="btn btn-primary btn-sm" data-apply type="button">Применить</button>
      <button class="btn btn-ghost btn-sm" data-dismiss type="button">Не нужно</button>
    </div>`;

  el.querySelector('[data-apply]').addEventListener('click', () => applyProposal(el));
  el.querySelector('[data-dismiss]').addEventListener('click', () => dismissProposal(el));

  $('#chatLog').append(el);
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function describeOp(op) {
  const step = state.roadmap?.steps.find((s) => s.id === op.stepId);
  const name = op.title || step?.title || op.stepId;
  if (op.op === 'add_step') return `Добавить шаг «${name}»`;
  if (op.op === 'remove_step') return `Убрать шаг «${name}»`;
  const changes = [];
  if (op.deadline) changes.push(`срок → ${formatDate(op.deadline)}`);
  if (op.description) changes.push('описание');
  return `Обновить «${name}»${changes.length ? `: ${changes.join(', ')}` : ''}`;
}

function applyProposal(card) {
  card.querySelectorAll('button').forEach((b) => (b.disabled = true));
  const { roadmap, applied } = applyOperations(state.roadmap, state.pendingProposal.operations);
  state.roadmap = roadmap;
  state.pendingProposal = null;
  persist();

  renderRoadmap();
  card.remove();
  const systemText = applied.length ? `План обновлён: ${applied.join(', ')}` : 'Изменений не потребовалось';
  appendSystem(systemText);
  state.messages.push({ role: 'assistant', content: systemText, system: true });
  persist();
  $('#chatLog').scrollTop = $('#chatLog').scrollHeight;
}

function dismissProposal(card) {
  state.pendingProposal = null;
  persist();
  card.remove();
}

function initChat() {
  const form = $('#chatForm');
  const input = $('#chatInput');

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  $$('#chatSuggestions .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      input.value = chip.textContent.trim();
      form.requestSubmit();
    });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = input.value.trim();
    if (!message || state.streaming) return;

    input.value = '';
    input.style.height = 'auto';
    $('#chatSuggestions').hidden = true;

    $('#chatLog').querySelector('.msg-empty')?.remove();
    appendMessage('user', message);
    state.messages.push({ role: 'user', content: message });
    persist();

    sendMessage(message);
  });
}

/** Детерминированная эвристика ответа — без обращения к какой-либо модели. */
function heuristicReply(userMessage) {
  const name = state.profile?.name || 'коллега';
  const steps = state.roadmap?.steps ?? [];
  const lower = userMessage.toLowerCase();

  if (/дедлайн|срок|перенес|продлил|продлен|не успе/.test(lower) && steps.length) {
    const target = steps.find((s) => s.status !== 'done') ?? steps[0];
    return {
      text:
        `${name}, если срок по шагу «${target.title}» изменился, план стоит пересобрать вокруг новой даты — ` +
        'от неё зависят визовый блок и бронь жилья. Я подготовил предложение по обновлению, посмотрите его ниже.' +
        '\n\n(Офлайн-демо: ответ собран по заранее заданным правилам, а не языковой моделью.)',
      proposal: {
        rationale: 'Вы сообщили об изменении срока — сдвигаю дедлайн ближайшего незавершённого шага.',
        operations: [
          {
            op: 'update_step',
            stepId: target.id,
            deadline: new Date(Date.now() + 30 * day).toISOString().slice(0, 10),
            description: `${target.description} Срок обновлён по вашему сообщению.`,
          },
        ],
      },
    };
  }

  if (/зачем|почему|why/.test(lower) && steps.length) {
    const target = steps.find((s) => s.status !== 'done') ?? steps[0];
    return {
      text:
        `${name}, шаг ${target.order} — «${target.title}». ${target.why}` +
        '\n\n(Офлайн-демо: ответ собран из данных плана без обращения к какой-либо модели.)',
      proposal: null,
    };
  }

  if (/виз/.test(lower)) {
    const visaStep = steps.find((s) => s.phase === 'visa');
    return {
      text: visaStep
        ? `${name}, по визе — шаг ${visaStep.order} «${visaStep.title}»: ${visaStep.description}`
        : `${name}, в этом плане нет отдельного визового шага — уточните требования у консульства.`,
      proposal: null,
    };
  }

  return {
    text:
      `${name}, это офлайн-демо: ассистент отвечает по заранее заданным правилам, а не языковой моделью. ` +
      `В вашем плане ${steps.length} шагов, ближайший — «${steps[0]?.title ?? 'не задан'}». ` +
      'Попробуйте спросить про срок, конкретный шаг или визу.',
    proposal: null,
  };
}

function sendMessage(message) {
  state.streaming = true;
  $('#chatSend').disabled = true;

  const log = $('#chatLog');
  const bubble = appendMessage('assistant', '');
  bubble.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
  log.scrollTop = log.scrollHeight;

  const { text, proposal } = heuristicReply(message);

  // Имитация потокового ответа — исключительно ради интерфейса.
  setTimeout(() => {
    bubble.textContent = '';
    let shown = '';
    const chunks = text.match(/.{1,24}/gs) ?? [];
    let i = 0;

    const tick = () => {
      if (i >= chunks.length) {
        state.messages.push({ role: 'assistant', content: text, ...(proposal ? { proposal } : {}) });
        state.pendingProposal = proposal;
        persist();
        if (proposal) appendProposal(proposal);
        state.streaming = false;
        $('#chatSend').disabled = false;
        log.scrollTop = log.scrollHeight;
        return;
      }
      shown += chunks[i++];
      bubble.textContent = shown;
      log.scrollTop = log.scrollHeight;
      setTimeout(tick, 18);
    };
    tick();
  }, 350);
}

/* ------------------------------------------------------------------ */
/* Утилиты                                                             */
/* ------------------------------------------------------------------ */

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function formatDate(isoDate) {
  if (!isoDate) return '';
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function daysUntil(isoDate) {
  const target = new Date(`${isoDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / day);
}

/* ------------------------------------------------------------------ */

initForm();
initFilters();
initChat();
init();
