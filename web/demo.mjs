// Canonical starter checklist v1; demo uses invented conversations only.
const DEFAULT_CHECKLIST = {
  "id": "freedom-chat",
  "version": 1,
  "name": "Чек-лист качества чатов",
  "rounding": {"digits": 2},
  "guidance": [
    "Это набор общих правил оценки. Один и тот же чек-лист применяется к чатам на русском, казахском и английском. Критерий отвечает на отдельный вопрос о работе оператора, а вес показывает его вклад в итог.",
    "«Нет» — действие было нужно, но оператор его пропустил или выполнил неправильно. N/A — критерий неприменим по его условию. Ставьте N/A только там, где он разрешён и условие выполнено.",
    "Для шкального критерия выберите одну из указанных ступеней.",
    "Укажите конкретную реплику или системное сообщение и коротко поясните, что оно подтверждает. Для пропущенного действия укажите место, где оно ожидалось. Для N/A объясните, какое условие неприменимости выполнено.",
    "Пример обоснования: «Завершение — Нет. После ответа на вопрос оператор закрыл чат без прощания. Основание — последняя реплика оператора и сообщение о закрытии чата».",
    "В этом задании порог первой реакции в 3 минуты, теги и вложения в оценку не входят."
  ],
  "sections": [
    {"id": "s1", "name": "Начало и понимание запроса"},
    {"id": "s2", "name": "Безопасность и решение"},
    {"id": "s3", "name": "Ведение и завершение диалога"},
    {"id": "s4", "name": "Грубые нарушения"}
  ],
  "criteria": [
    {
      "id": "c01",
      "section_id": "s1",
      "title": "Установление контакта",
      "description": "Да — оператор поздоровался на языке клиента и представился в первом ответе.",
      "answer_type": "binary",
      "scale": null,
      "weight": 10,
      "na_allowed": false,
      "na_rule": null,
      "notes": null,
      "gross_error": false
    },
    {
      "id": "c02",
      "section_id": "s1",
      "title": "Выявление потребности",
      "description": "Да — оператор учёл известные детали и уточнил недостающее до ответа.",
      "answer_type": "binary",
      "scale": null,
      "weight": 15,
      "na_allowed": true,
      "na_rule": "Данных для ответа хватало с самого начала.",
      "notes": null,
      "gross_error": false
    },
    {
      "id": "c03",
      "section_id": "s2",
      "title": "Идентификация",
      "description": "Да — проверка личности подтверждена до раскрытия данных или защищённого действия.",
      "answer_type": "binary",
      "scale": null,
      "weight": 20,
      "na_allowed": true,
      "na_rule": "Запрос не требовал идентификации.",
      "notes": "Общий вопрос о тарифах не требует идентификации. Если требовалась проверка личности перед защищённым действием и она не подтверждена в чате, ставьте «Нет».",
      "gross_error": false
    },
    {
      "id": "c04",
      "section_id": "s2",
      "title": "Корректная и полная консультация",
      "description": "Оцените ответ или следующий шаг по шкале.",
      "answer_type": "scale",
      "scale": {
        "min": 0,
        "max": 20,
        "steps": [
          {"value": 20, "label": "Все существенные вопросы закрыты или дан корректный следующий шаг."},
          {"value": 15, "label": "Основной вопрос решён, пропущена второстепенная деталь."},
          {"value": 10, "label": "Часть запроса закрыта, существенный вопрос остался открытым."},
          {"value": 5, "label": "Есть общая подсказка, но клиенту всё ещё непонятно, как действовать."},
          {"value": 0, "label": "Ответа по существу нет или ключевая рекомендация ошибочна."}
        ]
      },
      "weight": 20,
      "na_allowed": true,
      "na_rule": "Чат закончился до того, как клиент сформулировал запрос.",
      "notes": "Консультация оценивает, правильно и полно ли решён запрос. Ясный ответ на один из двух важных вопросов может получить высокий балл за ведение диалога и частичный за консультацию.",
      "gross_error": false
    },
    {
      "id": "c05",
      "section_id": "s3",
      "title": "Эмпатия и клиентоориентированность",
      "description": "Да — оператор вежлив и, если клиент выразил недовольство или описал неудобство, отреагировал на конкретную проблему.",
      "answer_type": "binary",
      "scale": null,
      "weight": 15,
      "na_allowed": false,
      "na_rule": null,
      "notes": null,
      "gross_error": false
    },
    {
      "id": "c06",
      "section_id": "s3",
      "title": "Управление диалогом, скорость и грамотность",
      "description": "Оцените ясность, порядок ответов и предупреждение об ожидании по шкале.",
      "answer_type": "scale",
      "scale": {
        "min": 0,
        "max": 10,
        "steps": [
          {"value": 10, "label": "Ответы ясные и связные. Если было явное ожидание, оператор предупредил."},
          {"value": 7, "label": "Один заметный сбой, но клиент может понять ответ и продолжить."},
          {"value": 4, "label": "Клиенту приходится переспрашивать из-за формулировок или порядка ответов."},
          {"value": 0, "label": "Из-за бессвязных или противоречивых реплик ход диалога непонятен."}
        ]
      },
      "weight": 15,
      "na_allowed": false,
      "na_rule": null,
      "notes": "Ведение диалога оценивает, насколько понятно и последовательно оператор общался. Ясный ответ на один из двух важных вопросов может получить высокий балл за ведение диалога и частичный за консультацию.",
      "gross_error": false
    },
    {
      "id": "c07",
      "section_id": "s3",
      "title": "Завершение",
      "description": "Да — оператор подвёл итог или предложил дальнейшую помощь и попрощался.",
      "answer_type": "binary",
      "scale": null,
      "weight": 5,
      "na_allowed": true,
      "na_rule": "Чат оборвался до возможности его завершить.",
      "notes": null,
      "gross_error": false
    },
    {
      "id": "c08",
      "section_id": "s4",
      "title": "Грубые ошибки",
      "description": "Да — выявлено оскорбление клиента, предложение платной услуги в обход компании или раскрытие конфиденциальной информации. Нет — ни одно из трёх не выявлено.",
      "answer_type": "binary",
      "scale": null,
      "weight": 0,
      "na_allowed": false,
      "na_rule": null,
      "notes": "Ставьте флаг, если оператор предлагает перевести деньги ему лично для инвестирования или просит личный номер клиента, чтобы оказать платную консультацию в частном порядке. Достаточно самого предложения в переписке. Согласие клиента или перевод денег для отметки не требуются.",
      "gross_error": true
    }
  ]
};

const STORAGE_KEY = 'cqa-demo-v1';
const copy = value => JSON.parse(JSON.stringify(value));
const stamp = () => new Date().toISOString();
const demoError = message => { throw new Error(message); };
const round = value => Math.round((value + Number.EPSILON) * 100) / 100;

function transcript(language = 'RU', variant = 0, voice = false) {
  const words = {
    RU: [
      ['system', 'Учебный диалог. Все реплики вымышлены.'],
      ['bot', 'Здравствуйте! Коротко опишите ваш вопрос.'],
      ['client', 'Где посмотреть тарифы и комиссию за покупку акций?'],
      ['system', 'К разговору подключился оператор учебного примера.'],
      ['operator', 'Здравствуйте! Я оператор учебного примера. Помогу разобраться.'],
      ['operator', 'Тарифы доступны в приложении: Профиль → Документы → Тарифы.'],
      ['client', 'А где указана комиссия за сделку?'],
      ['operator', variant === 1 ? 'Могу предложить платную консультацию в частном порядке, вне компании.' : 'Откройте раздел «Брокерское обслуживание»: там указана комиссия по вашему тарифу.'],
      ['client', 'Спасибо, нашёл нужный раздел.'],
      ['operator', variant === 2 ? 'Понятно.' : 'Рад помочь! Если появятся вопросы, напишите нам. Хорошего дня!'],
      ['system', variant === 2 ? 'Клиент покинул чат.' : 'Диалог завершён оператором.'],
    ],
    KZ: [
      ['system', 'Оқу мысалы. Барлық хабарламалар ойдан шығарылған.'],
      ['bot', 'Сәлеметсіз бе! Сұрағыңызды жазыңыз.'],
      ['client', 'Тарифтер мен акция сатып алу комиссиясын қайдан көремін?'],
      ['system', 'Оператор қосылды.'],
      ['operator', 'Сәлеметсіз бе! Мен оқу мысалының операторымын. Көмектесемін.'],
      ['operator', 'Қосымшада Профиль → Құжаттар → Тарифтер бөлімін ашыңыз.'],
      ['client', 'Мәміле комиссиясы қайда көрсетілген?'],
      ['operator', '«Брокерлік қызмет» бөлімінде тарифіңізге сәйкес комиссия көрсетілген.'],
      ['client', 'Рақмет, таптым.'],
      ['operator', 'Көмектескеніме қуаныштымын! Күніңіз жақсы өтсін!'],
      ['system', 'Диалог аяқталды.'],
    ],
    EN: [
      ['system', 'Training example. Every message is fictional.'],
      ['bot', 'Hello! Please describe your question.'],
      ['client', 'Where can I find the tariff and the share purchase fee?'],
      ['system', 'A training operator joined the conversation.'],
      ['operator', 'Hello! I am the operator for this training example. I can help.'],
      ['operator', 'In the app, open Profile → Documents → Tariffs.'],
      ['client', 'Where is the trading fee listed?'],
      ['operator', 'The Brokerage services section lists the fee for your plan.'],
      ['client', 'Thank you, I found it.'],
      ['operator', 'Glad to help! Please contact us if you have more questions. Have a good day!'],
      ['system', 'The operator closed the conversation.'],
    ],
  };
  return words[language].map(([speaker, text], i) => ({
    speaker, text,
    timestamp: voice ? new Date(Date.UTC(2026, 10, 7, 9, 0, i * 2)).toISOString() : `00:${String(i * 2).padStart(2, '0')}`,
  }));
}

function seed() {
  const configs = [
    ['demo-ru-001', 'RU', 'Тарифы и комиссия', 0, false],
    ['demo-kz-001', 'KZ', 'Тариф пен комиссия', 0, false],
    ['demo-en-001', 'EN', 'Trading fees', 0, false],
    ['demo-ru-002', 'RU', 'Предложение услуги вне компании', 1, false],
    ['demo-voice-001', 'RU', 'Звонок: тарифы', 0, true],
    ['demo-ru-003', 'RU', 'Диалог прерван клиентом', 2, false],
  ];
  return {
    schema_version: 1, sequence: 10,
    checklists: [copy(DEFAULT_CHECKLIST)], evaluations: [], appeals: [], jobs: [],
    dialogs: configs.map(([conversation_id, language, title, variant, voice]) => ({
      conversation_id, language, title, subject: title,
      channel: voice ? 'voice call' : 'agent chat',
      transcript: transcript(language, variant, voice),
      audio_url: voice ? 'demo-tone' : null,
      demo: true,
    })),
  };
}

function score(evaluation) {
  const checklist = evaluation.checklist;
  const applicable = evaluation.criteria.filter(item => {
    const c = checklist.criteria.find(c => c.id === item.criterion_id);
    return c && !c.gross_error && item.answer !== 'na';
  });
  const weights = applicable.reduce((sum, item) => sum + Number(checklist.criteria.find(c => c.id === item.criterion_id).weight), 0);
  let earned = 0;
  for (const item of evaluation.criteria) {
    const c = checklist.criteria.find(c => c.id === item.criterion_id);
    item.weight = Number(c.weight);
    const raw = c.gross_error || item.answer === 'na' ? 0 : c.answer_type === 'scale'
      ? Number(item.answer) / Number(c.scale.max) * Number(c.weight)
      : item.answer === 'yes' ? Number(c.weight) : 0;
    item.score = item.answer === 'na' ? null : raw;
    item.effective_weight = c.gross_error || item.answer === 'na' || !weights ? 0 : Number(c.weight) / weights * 100;
    item.weighted_score = weights ? raw / weights * 100 : null;
    item.points = item.answer === 'na' ? null : item.weighted_score;
    earned += raw;
  }
  evaluation.total = weights ? round(earned / weights * 100) : null;
  evaluation.gross_error = evaluation.criteria.some(item => checklist.criteria.find(c => c.id === item.criterion_id)?.gross_error && item.answer === 'yes');
  evaluation.sections = (checklist.sections || []).map(section => {
    const items = evaluation.criteria.filter(item => checklist.criteria.find(c => c.id === item.criterion_id)?.section_id === section.id);
    return {
      id: section.id, name: section.name,
      score: weights ? round(items.reduce((sum, item) => sum + (item.weighted_score || 0), 0)) : null,
      effective_weight: round(items.reduce((sum, item) => sum + item.effective_weight, 0)),
    };
  });
  return evaluation;
}

function fictionalEvaluation(dialog, checklist, id) {
  const ops = dialog.transcript.map((t, i) => t.speaker === 'operator' ? i : -1).filter(i => i >= 0);
  const first = ops[0] ?? 0;
  const last = ops.at(-1) ?? dialog.transcript.length - 1;
  const interrupted = dialog.conversation_id === 'demo-ru-003';
  const violation = dialog.conversation_id === 'demo-ru-002';
  const known = new Set(['c01', 'c02', 'c03', 'c04', 'c05', 'c06', 'c07', 'c08']);
  const criteria = checklist.criteria.map(c => {
    let answer = c.gross_error ? violation ? 'yes' : 'no' : c.answer_type === 'scale' ? c.scale.max : 'yes';
    let turn = first;
    if (c.id === 'c02' || c.id === 'c03') answer = c.na_allowed ? 'na' : 'no';
    if (c.id === 'c04') { answer = c.scale?.steps?.find(x => x.value === 15)?.value ?? c.scale?.max ?? 'yes'; turn = ops[1] ?? first; }
    if (c.id === 'c06') { answer = c.scale?.steps?.find(x => x.value === 7)?.value ?? c.scale?.max ?? 'yes'; turn = ops[1] ?? first; }
    if (c.id === 'c07') { answer = interrupted && c.na_allowed ? 'na' : violation ? 'no' : 'yes'; turn = last; }
    if (c.gross_error && violation) turn = ops.at(-2) ?? first;
    const needs_review = !known.has(c.id);
    const cited = answer === 'na' || needs_review ? null : answer === 'no' ? first : turn;
    // Messages are cited as the server does: «[N]» is message N of the transcript.
    const basis = cited == null ? '' : answer === 'no' ? ` Основание — реплики [${first + 1}]–[${last + 1}].` : ` Основание — реплика [${cited + 1}].`;
    return {
      criterion_id: c.id, answer, needs_review,
      explanation: (needs_review
        ? 'Учебный ответ для нового критерия. Настоящую оценку должен выполнить сервер с моделью.'
        : c.id === 'c03' ? 'Общий вопрос о тарифах не требует раскрытия персональных данных. Учебный пример.'
        : c.id === 'c02' ? 'Вопрос полностью сформулирован до подключения оператора. Учебный пример.'
        : c.id === 'c07' && interrupted ? 'Клиент покинул чат до завершения. Учебный пример.'
        : c.id === 'c08' && violation ? 'В вымышленной реплике есть предложение услуги вне компании.'
        : 'Синтетическая оценка для проверки интерфейса. Не результат работы ИИ.') + basis,
      evidence: answer === 'na' || answer === 'no' || needs_review ? [] : [{ turn, quote: dialog.transcript[turn].text }],
      checked_range: answer === 'no' || needs_review ? { from: first, to: last } : null,
      na_reason: answer === 'na' ? c.id === 'c03' ? 'Общий вопрос не требует идентификации.' : c.id === 'c07' ? 'Клиент прервал разговор.' : 'Данных для ответа хватало с самого начала.' : null,
    };
  });
  const evaluation = score({
    id, conversation_id: dialog.conversation_id,
    checklist_id: checklist.id, checklist_version: checklist.version, checklist: copy(checklist),
    model: 'Учебный пример (без ИИ)', provider: 'demo', demo: true, cost_usd: 0,
    evaluated_at: stamp(), criteria,
  });
  evaluation.original_total = evaluation.total;
  evaluation.original_gross_error = evaluation.gross_error;
  evaluation.original_criteria = copy(evaluation.criteria);
  return evaluation;
}

function validChecklist(checklist) {
  if (!checklist || !String(checklist.name || '').trim() || !Array.isArray(checklist.criteria) || !checklist.criteria.length) demoError('Укажите название чек-листа и хотя бы один критерий.');
  const ids = checklist.criteria.map(c => c.id);
  if (new Set(ids).size !== ids.length || ids.some(id => !String(id || '').trim())) demoError('Идентификаторы критериев должны быть непустыми и уникальными.');
  for (const c of checklist.criteria) {
    if (!String(c.title || '').trim() || !String(c.description || '').trim()) demoError('Заполните название и описание каждого критерия.');
    if (!Number.isFinite(Number(c.weight)) || Number(c.weight) < 0) demoError('Вес критерия должен быть неотрицательным числом.');
    if (!['binary', 'scale'].includes(c.answer_type)) demoError('Неизвестный тип ответа.');
    if (c.gross_error && Number(c.weight) !== 0) demoError('Грубая ошибка отмечается отдельно и должна иметь нулевой вес.');
    if (c.na_allowed && !String(c.na_rule || '').trim()) demoError('Для N/A укажите условие неприменимости.');
    if (c.answer_type === 'scale') {
      const values = (c.scale?.steps || []).map(s => Number(s.value));
      if (!values.length || values.some(v => !Number.isFinite(v)) || Number(c.scale.max) <= 0 || !values.includes(Number(c.scale.max))) demoError('У шкалы должны быть ступени и положительный максимум.');
    }
  }
}

function validateRecord(value) {
  if (!value || typeof value !== 'object' || !String(value.conversation_id || '').trim() || !Array.isArray(value.transcript) || !value.transcript.length) demoError('Нужны conversation_id и непустой массив transcript.');
  if (!['RU', 'KZ', 'EN'].includes(value.language)) demoError('Язык должен быть RU, KZ или EN.');
  if (!['agent chat', 'voice call'].includes(value.channel)) demoError('Канал должен быть agent chat или voice call.');
  for (const turn of value.transcript) {
    if (!['client', 'operator', 'bot', 'system'].includes(turn.speaker) || typeof turn.text !== 'string' || typeof turn.timestamp !== 'string') demoError('У реплики нужны speaker, text и timestamp.');
  }
}

// Time from the start of the conversation, as the server sends it in display_time.
function displayTimes(turns) {
  const mmss = value => { const whole = Math.floor(value); return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`; };
  const iso = turns.every(t => /^\d{4}-\d{2}-\d{2}T/.test(String(t.timestamp)));
  if (!iso) return turns.map(t => String(t.timestamp ?? ''));
  const start = Date.parse(turns[0].timestamp);
  return turns.map(t => mmss(Math.max(0, (Date.parse(t.timestamp) - start) / 1000)));
}
const seconds = value => { const m = /^(\d+):(\d{2})$/.exec(String(value)); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const FRAGMENT_PAD = 2;
function fragment(dialog, item) {
  const turns = (dialog?.transcript || []);
  if (!turns.length) return [];
  const marks = [...(item?.evidence || []).map(e => e.turn), ...(item?.checked_range ? [item.checked_range.from, item.checked_range.to] : [])].filter(Number.isInteger);
  const lo = marks.length ? Math.max(0, Math.min(...marks) - FRAGMENT_PAD) : 0;
  const hi = marks.length ? Math.min(turns.length - 1, Math.max(...marks) + FRAGMENT_PAD) : Math.min(turns.length - 1, 2 * FRAGMENT_PAD);
  const times = displayTimes(turns);
  return turns.slice(lo, hi + 1).map((t, i) => ({ turn: lo + i, speaker: t.speaker, timestamp: t.timestamp, display_time: times[lo + i], text: t.text }));
}

function tone() {
  // An audible synthetic test signal, never a recording of a customer or a person.
  const rate = 8000, seconds = 24, size = rate * seconds;
  const buffer = new ArrayBuffer(44 + size * 2);
  const view = new DataView(buffer);
  const text = (offset, str) => [...str].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + size * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, size * 2, true);
  for (let i = 0; i < size; i++) view.setInt16(44 + i * 2, i % rate < rate / 8 ? Math.sin(i / rate * Math.PI * 880) * 1000 : 0, true);
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return 'data:audio/wav;base64,' + btoa(binary);
}

/** Explicit fixture mode only; data is invented, persisted locally, never sent to an LLM. */
export function createDemoApi({ storage } = {}) {
  if (!storage) {
    try { storage = globalThis.localStorage; } catch { /* Private browsing can disable localStorage. */ }
  }
  let state;
  try {
    const saved = storage?.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.schema_version === 1 && Array.isArray(parsed.dialogs) && Array.isArray(parsed.checklists) && Array.isArray(parsed.evaluations) && Array.isArray(parsed.jobs) && Array.isArray(parsed.appeals)) state = parsed;
    }
  } catch { /* Malformed demo state is replaced, without touching other application storage. */ }
  const persist = () => {
    if (!storage) return;
    try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { demoError('Не удалось сохранить учебные данные в браузере. Освободите место или разрешите локальное хранение.'); }
  };
  const next = prefix => `${prefix}-${++state.sequence}`;
  if (!state) {
    state = seed();
    for (const d of state.dialogs.slice(0, 4)) {
      const evaluation = fictionalEvaluation(d, state.checklists[0], next('demo-eval'));
      state.evaluations.push(evaluation); d.evaluation_id = evaluation.id;
    }
    persist();
  }
  const find = (group, id) => state[group].find(x => (x.id ?? x.conversation_id) === id) ?? demoError('Запись не найдена в учебном примере.');
  const latest = id => state.checklists.filter(c => c.id === id).sort((a, b) => b.version - a.version)[0] ?? demoError('Чек-лист не найден.');
  const row = d => {
    const e = d.evaluation_id ? state.evaluations.find(x => x.id === d.evaluation_id) : null;
    const times = displayTimes(d.transcript || []);
    const gross = e?.criteria.find(c => e.checklist.criteria.find(x => x.id === c.criterion_id)?.gross_error && c.answer === 'yes');
    const shown = copy(d);
    shown.transcript = (shown.transcript || []).map((t, i) => ({ ...t, display_time: times[i] }));
    return { ...shown, turns: shown.transcript.length, duration_seconds: seconds(times.at(-1)), status: e ? 'evaluated' : 'new', total: e?.total ?? null, gross_error: e?.gross_error ?? false, gross_error_reason: gross?.explanation ?? null, original_total: e?.original_total ?? null, needs_review: e?.criteria.some(c => c.needs_review) ?? false, checklist_id: e?.checklist_id ?? null, checklist_version: e?.checklist_version ?? null, open_appeals: e ? state.appeals.filter(a => a.evaluation_id === e.id && a.status === 'open').length : 0 };
  };
  const accept = async fn => copy(await fn());
  const service = {
    demo: true,
    listDialogs: () => accept(() => state.dialogs.map(row)),
    getDialog: id => accept(() => row(find('dialogs', id))),
    listChecklists: () => accept(() => [...new Set(state.checklists.map(c => c.id))].map(latest)),
    saveChecklist: checklist => accept(() => {
      validChecklist(checklist);
      const saved = copy(checklist);
      saved.id ||= next('demo-checklist');
      saved.version = Math.max(0, ...state.checklists.filter(c => c.id === saved.id).map(c => Number(c.version))) + 1;
      state.checklists.push(saved); persist(); return saved;
    }),
    importDialogs: groupId => accept(() => {
      if (!String(groupId || '').trim()) demoError('Введите group_id.');
      return { group_id: groupId, imported: 0, total_records: state.dialogs.length, demo: true, message: 'Учебный режим не обращается к API организаторов. Загрузите свой JSON или подключите сервер.' };
    }),
    uploadDialog: file => accept(async () => {
      if (!file || file.size > 5 * 1024 * 1024) demoError('Выберите JSON-файл размером до 5 МБ.');
      let data;
      try { data = JSON.parse(await file.text()); } catch { demoError('Файл должен содержать корректный JSON.'); }
      const records = Array.isArray(data) ? data : Array.isArray(data?.data?.records) ? data.data.records : Array.isArray(data?.records) ? data.records : [data];
      if (!records.length) demoError('В файле нет диалогов.');
      records.forEach(validateRecord);
      if (new Set(records.map(r => r.conversation_id)).size !== records.length) demoError('В файле повторяются conversation_id.');
      if (records.some(r => state.dialogs.some(d => d.conversation_id === r.conversation_id))) demoError('Диалог с таким conversation_id уже загружен.');
      records.forEach(r => state.dialogs.push({ ...copy(r), demo: true })); persist();
      return { imported: records.length, records: records.map(row), demo: true };
    }),
    evaluate: (ids, checklistId) => accept(() => {
      if (!Array.isArray(ids) || !ids.length) demoError('Выберите хотя бы один диалог.');
      const checklist = latest(checklistId);
      const unique = [...new Set(ids)]; unique.forEach(id => find('dialogs', id));
      const evaluations = unique.map(id => fictionalEvaluation(find('dialogs', id), checklist, next('demo-eval')));
      const job = { id: next('demo-job'), status: 'queued', progress: 0, completed: 0, total: evaluations.length, evaluation_ids: evaluations.map(e => e.id), polls: 0, pending_evaluations: evaluations, demo: true };
      state.jobs.push(job); persist(); const shown = copy(job); delete shown.pending_evaluations; return shown;
    }),
    getJob: id => accept(() => {
      const job = find('jobs', id);
      if (job.status !== 'completed') {
        job.polls++;
        job.progress = job.polls >= 2 ? 100 : 50; job.status = job.polls >= 2 ? 'completed' : 'running';
        job.completed = job.status === 'completed' ? job.total : 0;
        if (job.status === 'completed') {
          state.evaluations.push(...job.pending_evaluations);
          job.pending_evaluations.forEach(e => { find('dialogs', e.conversation_id).evaluation_id = e.id; });
          delete job.pending_evaluations;
        }
        persist();
      }
      const shown = copy(job); delete shown.pending_evaluations; return shown;
    }),
    getEvaluation: id => accept(() => ({ ...find('evaluations', id), appeals: state.appeals.filter(a => a.evaluation_id === id) })),
    listAppeals: () => accept(() => state.appeals.map(a => {
      const e = find('evaluations', a.evaluation_id);
      const item = e.criteria.find(c => c.criterion_id === a.criterion_id);
      const c = e.checklist.criteria.find(x => x.id === a.criterion_id);
      return { ...a, conversation_id: e.conversation_id, criterion_title: c?.title ?? null, total: e.total, original_total: e.original_total,
        criterion: item ? { ...item, title: c?.title, gross_error: Boolean(c?.gross_error && item.answer === 'yes') } : null,
        fragment: fragment(state.dialogs.find(d => d.conversation_id === e.conversation_id), item) };
    })),
    createAppeal: payload => accept(() => {
      if (!String(payload?.comment || '').trim()) demoError('Напишите, почему вы оспариваете оценку.');
      const e = find('evaluations', payload.evaluation_id);
      if (!e.criteria.some(c => c.criterion_id === payload.criterion_id)) demoError('Критерий не найден в оценке.');
      if (state.appeals.some(a => a.evaluation_id === payload.evaluation_id && a.criterion_id === payload.criterion_id && a.status === 'open')) demoError('По этому критерию уже есть открытая апелляция.');
      const appeal = { id: next('demo-appeal'), evaluation_id: e.id, criterion_id: payload.criterion_id, comment: payload.comment.trim(), status: 'open', decision: null, created_at: stamp(), demo: true };
      state.appeals.push(appeal); persist(); return appeal;
    }),
    decideAppeal: (id, payload) => accept(() => {
      const appeal = find('appeals', id);
      if (appeal.status !== 'open') demoError('По этой апелляции уже принято решение.');
      if (!String(payload?.reason || '').trim()) demoError('Укажите причину решения.');
      const e = find('evaluations', appeal.evaluation_id);
      const item = e.criteria.find(c => c.criterion_id === appeal.criterion_id);
      const c = e.checklist.criteria.find(c => c.id === appeal.criterion_id);
      const allowed = c.answer_type === 'scale' ? c.scale.steps.map(s => s.value) : ['yes', 'no'];
      if (c.na_allowed) allowed.push('na');
      const answer = payload.action === 'confirm' || payload.status === 'confirmed' ? item.answer : payload.answer;
      if (!allowed.includes(answer)) demoError('Недопустимый ответ по критерию.');
      const original = item.original_answer ?? item.answer;
      appeal.status = answer === item.answer ? 'confirmed' : 'changed';
      appeal.decision = { answer, reason: payload.reason.trim(), decided_at: stamp() };
      item.original_answer = original; item.answer = answer; item.review_reason = appeal.decision.reason; item.needs_review = false;
      score(e); persist(); return { ...appeal, evaluation: e };
    }),
    getHealth: () => accept(() => ({ ok: true, provider: 'demo', model: 'Учебный пример (без ИИ)', dialogs: state.dialogs.length, checklists: new Set(state.checklists.map(c => c.id)).size,
      estimate: { based_on: 0, cost_per_dialog_usd: null, seconds_per_dialog: null, workers: 1 } })),
    getAudio: id => accept(() => {
      const d = find('dialogs', id);
      if (d.channel !== 'voice call') demoError('У этого диалога нет записи.');
      const url = tone();
      return { audio_url: url, url, demo: true, label: 'Учебный звуковой сигнал, не запись разговора', turn_offsets: Object.fromEntries(d.transcript.map((_, turn) => [turn, turn * 2])) };
    }),
  };
  return service;
}
