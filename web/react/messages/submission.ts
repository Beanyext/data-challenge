export const submissionMessages: Record<string, { en: string; kk: string }> = {
  "Выгрузка результатов": {
    "en": "Results export",
    "kk": "Нәтижелерді экспорттау"
  },
  "Подготовьте файл для сдачи и проверьте каждый диалог исходного набора.": {
    "en": "Prepare the submission file and validate every source conversation.",
    "kk": "Тапсыру файлын дайындап, бастапқы жинақтағы әр диалогты тексеріңіз."
  },
  "Схема 1.0": {
    "en": "Schema 1.0",
    "kk": "1.0 схемасы"
  },
  "Подготовка файла": {
    "en": "Prepare file",
    "kk": "Файлды дайындау"
  },
  "Настройки выгрузки": {
    "en": "Export settings",
    "kk": "Экспорт параметрлері"
  },
  "Набор": {
    "en": "Dataset",
    "kk": "Деректер жинағы"
  },
  "DEV · 65 диалогов": {
    "en": "DEV · 65 conversations",
    "kk": "DEV · 65 диалог"
  },
  "PROD · 10 чатов": {
    "en": "PROD · 10 chats",
    "kk": "PROD · 10 чат"
  },
  "Название команды": {
    "en": "Team name",
    "kk": "Команда атауы"
  },
  "Исходный JSON организаторов": {
    "en": "Original organizer JSON",
    "kk": "Ұйымдастырушылардың бастапқы JSON файлы"
  },
  "Выберите полный набор, чтобы проверить ID, количество и номера реплик.": {
    "en": "Choose the full dataset to validate IDs, counts and message numbers.",
    "kk": "ID, санын және реплика нөмірлерін тексеру үшін толық жинақты таңдаңыз."
  },
  "До 20 МБ на файл": {
    "en": "Up to 20 MB per file",
    "kk": "Әр файл 20 МБ-қа дейін"
  },
  "Источник сохранённых оценок": {
    "en": "Saved evaluation source",
    "kk": "Сақталған бағалардың көзі"
  },
  "JSON-файлы оценщика": {
    "en": "Evaluator JSON files",
    "kk": "Бағалаушының JSON файлдары"
  },
  "Файлы оценщика": {
    "en": "Evaluator files",
    "kk": "Бағалаушы файлдары"
  },
  "Выбрано файлов: {count}.": {
    "en": "Selected files: {count}.",
    "kk": "Таңдалған файлдар: {count}."
  },
  "Выберите отдельные оценки или JSON с массивом evaluations.": {
    "en": "Choose individual evaluations or JSON containing an evaluations array.",
    "kk": "Жеке бағаларды немесе evaluations массиві бар JSON таңдаңыз."
  },
  "Можно выбрать summary.json вместе с оценками: он будет пропущен.": {
    "en": "You may select summary.json with the evaluations; it will be skipped.",
    "kk": "summary.json файлын бағалармен бірге таңдауға болады: ол өткізіледі."
  },
  "Сейчас подключён учебный API. Для чтения настоящих оценок подключите сервер команды или выберите JSON-файлы оценщика.": {
    "en": "The demo API is connected. Connect your team server or choose evaluator JSON files to read actual evaluations.",
    "kk": "Оқу API қосылған. Нақты бағаларды оқу үшін команда серверін қосыңыз немесе бағалаушының JSON файлдарын таңдаңыз."
  },
  "Будут прочитаны только сохранённые оценки всего исходного набора. Фильтры списка диалогов на выгрузку не влияют.": {
    "en": "Only saved evaluations for the complete source dataset will be read. Conversation filters do not affect export.",
    "kk": "Толық бастапқы жинақтың сақталған бағалары ғана оқылады. Диалог сүзгілері экспортқа әсер етпейді."
  },
  "Режим модели": {
    "en": "Model mode",
    "kk": "Модель режимі"
  },
  "Укажите режим": {
    "en": "Choose mode",
    "kk": "Режимді таңдаңыз"
  },
  "Локальная": {
    "en": "Local",
    "kk": "Жергілікті"
  },
  "Внешний API": {
    "en": "External API",
    "kk": "Сыртқы API"
  },
  "Гибридный": {
    "en": "Hybrid",
    "kk": "Аралас"
  },
  "Название модели": {
    "en": "Model name",
    "kk": "Модель атауы"
  },
  "Фактически использованные модели": {
    "en": "Models actually used",
    "kk": "Іс жүзінде қолданылған модельдер"
  },
  "Версия оценок": {
    "en": "Evaluation version",
    "kk": "Баға нұсқасы"
  },
  "Исходные ответы AI": {
    "en": "Original AI answers",
    "kk": "AI бастапқы жауаптары"
  },
  "Финальные ответы после пересмотра": {
    "en": "Final reviewed answers",
    "kk": "Қайта қаралған соңғы жауаптар"
  },
  "По умолчанию выбраны исходные ответы AI. Приложение к регламенту не уточняет выбор после пересмотра.": {
    "en": "Original AI answers are selected by default. The rules appendix does not specify which version to submit after review.",
    "kk": "Әдепкіде AI бастапқы жауаптары таңдалған. Регламент қосымшасында қайта қаралғаннан кейінгі нұсқа нақтыланбаған."
  },
  "Название модели заполняется из оценок, если поле пустое. Для Anthropic режим определяется как внешний API. Для остальных источников укажите его самостоятельно.": {
    "en": "An empty model name is filled from saved evaluations. Anthropic is identified as an external API; select the mode for other sources.",
    "kk": "Бос модель атауы сақталған бағалардан толтырылады. Anthropic сыртқы API ретінде анықталады, басқа көздер үшін режимді өзіңіз таңдаңыз."
  },
  "Читаем результаты…": {
    "en": "Reading results…",
    "kk": "Нәтижелер оқылуда…"
  },
  "Проверить результаты": {
    "en": "Validate results",
    "kk": "Нәтижелерді тексеру"
  },
  "Перед сдачей": {
    "en": "Before submission",
    "kk": "Тапсыру алдында"
  },
  "Проверьте исходный набор": {
    "en": "Check the source dataset",
    "kk": "Бастапқы жинақты тексеріңіз"
  },
  "DEV: 60 чатов и 5 звонков. PROD: 10 контрольных чатов. Исходные ID сохраняются.": {
    "en": "DEV: 60 chats and 5 calls. PROD: 10 control chats. Original IDs are preserved.",
    "kk": "DEV: 60 чат және 5 қоңырау. PROD: 10 бақылау чаты. Бастапқы ID сақталады."
  },
  "Проверьте результаты": {
    "en": "Check the results",
    "kk": "Нәтижелерді тексеріңіз"
  },
  "Восемь критериев, исходные шкалы, N/A и балл. Реплики в файле нумеруются с 1.": {
    "en": "Eight criteria, raw scales, N/A and score. Messages in the file are numbered from 1.",
    "kk": "Сегіз критерий, бастапқы шкалалар, N/A және ұпай. Файлдағы репликалар 1-ден нөмірленеді."
  },
  "Сохраните в репозиторий": {
    "en": "Save to the repository",
    "kk": "Репозиторийге сақтаңыз"
  },
  "Скачайте JSON и поместите его в": {
    "en": "Download JSON and place it in",
    "kk": "JSON файлын жүктеп, мына жерге орналастырыңыз"
  },
  "Затем сделайте commit и push в открытый репозиторий команды.": {
    "en": "Then commit and push to the team's public repository.",
    "kk": "Содан кейін команданың ашық репозиторийіне commit және push жасаңыз."
  },
  "Экспорт читает готовые оценки. Новый вызов модели не запускается. Учебные и mock-оценки для сдачи запрещены.": {
    "en": "Export reads saved evaluations without making a new model call. Demo and mock evaluations cannot be submitted.",
    "kk": "Экспорт дайын бағаларды оқиды, модельді қайта шақырмайды. Оқу және mock бағаларын тапсыруға болмайды."
  },
  "К диалогам": {
    "en": "Back to conversations",
    "kk": "Диалогтарға оралу"
  },
  "Файл пока нельзя скачать": {
    "en": "File cannot be downloaded yet",
    "kk": "Файлды әзірге жүктеп алу мүмкін емес"
  },
  "Формат проверен": {
    "en": "Format validated",
    "kk": "Пішім тексерілді"
  },
  "{count} результатов": {
    "en": "{count} results",
    "kk": "{count} нәтиже"
  },
  "Успешно": {
    "en": "Successful",
    "kk": "Сәтті"
  },
  "С ошибкой": {
    "en": "Errors",
    "kk": "Қателер"
  },
  "Команда": {
    "en": "Team",
    "kk": "Команда"
  },
  "Модель": {
    "en": "Model",
    "kk": "Модель"
  },
  "Есть диалоги со статусом error. Они остаются в файле с пустыми критериями и score: null. Можно исправить оценки и повторить проверку перед сдачей.": {
    "en": "Some conversations have status error. They remain in the file with empty criteria and score: null. You can fix the evaluations and validate again before submission.",
    "kk": "Кейбір диалогтардың күйі error. Олар файлда бос критерийлермен және score: null мәнімен қалады. Тапсыруға дейін бағаларды түзетіп, қайта тексере аласыз."
  },
  "Проверьте предупреждения": {
    "en": "Review warnings",
    "kk": "Ескертулерді тексеріңіз"
  },
  "Предупреждения": {
    "en": "Warnings",
    "kk": "Ескертулер"
  },
  "Я проверил предупреждения и хочу сохранить этот файл.": {
    "en": "I have reviewed the warnings and want to save this file.",
    "kk": "Ескертулерді тексердім және осы файлды сақтағым келеді."
  },
  "Я проверил предупреждения и записи со статусом error и хочу сохранить этот файл.": {
    "en": "I have reviewed the warnings and error records and want to save this file.",
    "kk": "Ескертулерді және error жазбаларын тексердім, осы файлды сақтағым келеді."
  },
  "Скачать results.json": {
    "en": "Download results.json",
    "kk": "results.json жүктеп алу"
  },
  "Для {path}": {
    "en": "For {path}",
    "kk": "{path} үшін"
  },
  "Скачивание не записывает файл в git и не отправляет результаты организаторам.": {
    "en": "Downloading does not add the file to git or send results to organizers.",
    "kk": "Жүктеп алу файлды git-ке жазбайды және нәтижелерді ұйымдастырушыларға жібермейді."
  },
  "Выберите JSON-файл размером не более 20 МБ.": {
    "en": "Choose a JSON file no larger than 20 MB.",
    "kk": "20 МБ-тан аспайтын JSON файлын таңдаңыз."
  },
  "Не удалось прочитать JSON. Проверьте формат и кодировку UTF-8.": {
    "en": "Unable to read JSON. Check its format and UTF-8 encoding.",
    "kk": "JSON оқу мүмкін болмады. Пішімін және UTF-8 кодтауын тексеріңіз."
  },
  "Выберите от 1 до 200 файлов оценщика общим размером до 50 МБ.": {
    "en": "Choose 1 to 200 evaluator files with a combined size up to 50 MB.",
    "kk": "Жалпы көлемі 50 МБ-тан аспайтын 1–200 бағалаушы файлын таңдаңыз."
  },
  "Подключение изменилось во время чтения. Повторите проверку.": {
    "en": "The connection changed while reading. Validate again.",
    "kk": "Оқу барысында қосылым өзгерді. Қайта тексеріңіз."
  },
  "Подключение изменилось. Повторите проверку.": {
    "en": "The connection changed. Validate again.",
    "kk": "Қосылым өзгерді. Қайта тексеріңіз."
  },
  "Среди оценок есть ID вне выбранного исходного набора.": {
    "en": "Some evaluation IDs are not in the selected source dataset.",
    "kk": "Кейбір баға ID таңдалған бастапқы жинаққа кірмейді."
  },
  "Не хватает сохранённых результатов: {count}. Загрузите оценки или явные записи об ошибке для всех диалогов.": {
    "en": "Missing saved results: {count}. Upload evaluations or explicit error records for every conversation.",
    "kk": "Сақталған нәтижелер жетіспейді: {count}. Әр диалог үшін бағаны немесе айқын қате жазбасын жүктеңіз."
  },
  "Оценщик завершил обработку диалога с ошибкой. Подробности в локальном журнале оценщика.": {
    "en": "The evaluator failed to process this conversation. See its local log for details.",
    "kk": "Бағалаушы диалогты өңдеуді қатемен аяқтады. Мәліметтер жергілікті журналда."
  },
  "Прочитано {completed} из {total} диалогов.": {
    "en": "Read {completed} of {total} conversations.",
    "kk": "{total} диалогтың {completed} оқылды."
  },
  "Файл подготовлен. Сохраните его как {path}.": {
    "en": "File prepared. Save it as {path}.",
    "kk": "Файл дайын. Оны {path} ретінде сақтаңыз."
  },
  "Не удалось подготовить файл. Проверьте исходные данные и повторите попытку.": {
    "en": "Unable to prepare the file. Check source data and try again.",
    "kk": "Файл дайындау мүмкін болмады. Бастапқы деректерді тексеріп, қайталаңыз."
  },
  "Выберите набор DEV или PROD.": {
    "en": "Choose DEV or PROD.",
    "kk": "DEV немесе PROD таңдаңыз."
  },
  "API организаторов сообщил об ошибке получения набора.": {
    "en": "The organizers' API reported a dataset error.",
    "kk": "Ұйымдастырушылар API жинақты алу қатесін хабарлады."
  },
  "Поле isSuccess в исходном ответе должно быть логическим true.": {
    "en": "The source isSuccess field must be boolean true.",
    "kk": "Бастапқы isSuccess өрісі логикалық true болуы керек."
  },
  "Исходный JSON должен содержать массив records или быть массивом диалогов.": {
    "en": "Source JSON must contain a records array or be a conversation array.",
    "kk": "Бастапқы JSON records массивін қамтуы немесе диалогтар массиві болуы керек."
  },
  "В исходном наборе некорректный dataset_group_id.": {
    "en": "The source dataset_group_id is invalid.",
    "kk": "Бастапқы dataset_group_id жарамсыз."
  },
  "В исходном JSON не указан dataset_group_id. Проверьте, что выбран правильный набор.": {
    "en": "Source JSON has no dataset_group_id. Check that the dataset is correct.",
    "kk": "Бастапқы JSON ішінде dataset_group_id жоқ. Дұрыс жинақ таңдалғанын тексеріңіз."
  },
  "Источник DEV нельзя использовать для сдачи PROD.": {
    "en": "A DEV source cannot be submitted as PROD.",
    "kk": "DEV көзін PROD ретінде тапсыруға болмайды."
  },
  "Поле total_records должно быть неотрицательным целым числом.": {
    "en": "total_records must be a non-negative integer.",
    "kk": "total_records нөлден кем емес бүтін сан болуы керек."
  },
  "Количество записей не совпадает с total_records в исходном JSON.": {
    "en": "Record count does not match source total_records.",
    "kk": "Жазбалар саны бастапқы total_records мәніне сәйкес емес."
  },
  "Для DEV требуется ровно 65 диалогов: 60 чатов и 5 звонков.": {
    "en": "DEV requires exactly 65 conversations: 60 chats and 5 calls.",
    "kk": "DEV үшін дәл 65 диалог қажет: 60 чат және 5 қоңырау."
  },
  "Для PROD требуется ровно 10 диалогов, все с каналом agent chat.": {
    "en": "PROD requires exactly 10 conversations, all agent chat.",
    "kk": "PROD үшін дәл 10 диалог қажет, барлығы agent chat."
  },
  "Выберите JSON-файлы с исходными оценками.": {
    "en": "Choose JSON files with source evaluations.",
    "kk": "Бастапқы бағалары бар JSON файлдарын таңдаңыз."
  },
  "Учебный API нельзя использовать как источник результатов для сдачи.": {
    "en": "The demo API cannot supply submission results.",
    "kk": "Оқу API тапсыру нәтижелерінің көзі бола алмайды."
  },
  "Не настроен серверный API для чтения сохранённых оценок.": {
    "en": "The saved-evaluation API is not configured.",
    "kk": "Сақталған бағаларды оқу API бапталмаған."
  },
  "Сначала загрузите исходный набор диалогов.": {
    "en": "Upload the original conversation dataset first.",
    "kk": "Алдымен бастапқы диалогтар жинағын жүктеңіз."
  },
  "Исходный набор содержит отсутствующие или повторяющиеся conversation_id.": {
    "en": "The source dataset has missing or duplicate conversation_id values.",
    "kk": "Бастапқы жинақта conversation_id жоқ немесе қайталанады."
  },
  "Не удалось прочитать список диалогов с сервера. Проверьте подключение и повторите сбор.": {
    "en": "Unable to read server conversations. Check the connection and collect again.",
    "kk": "Сервердегі диалогтарды оқу мүмкін болмады. Қосылымды тексеріп, қайта жинаңыз."
  },
  "Сервер вернул некорректный список диалогов.": {
    "en": "The server returned an invalid conversation list.",
    "kk": "Сервер жарамсыз диалогтар тізімін қайтарды."
  },
  "Список сервера содержит некорректные или повторяющиеся conversation_id.": {
    "en": "The server list has invalid or duplicate conversation_id values.",
    "kk": "Сервер тізімінде conversation_id жарамсыз немесе қайталанады."
  },
  "Не удалось обновить индикатор прогресса.": {
    "en": "Unable to update progress.",
    "kk": "Орындалу көрсеткішін жаңарту мүмкін болмады."
  },
  "Укажите режим модели: local, external_api или hybrid.": {
    "en": "Choose model mode: local, external_api or hybrid.",
    "kk": "Модель режимін таңдаңыз: local, external_api немесе hybrid."
  },
  "Общее имя модели должно перечислять все фактически использованные модели, включая резервные вызовы.": {
    "en": "The model name must list every model actually used, including fallback calls.",
    "kk": "Модель атауында резервтік шақыруларды қоса, барлық қолданылған модельдер көрсетілуі керек."
  },
  "Mock/demo/учебная модель запрещена для сдачи.": {
    "en": "Mock, demo and training models cannot be submitted.",
    "kk": "Mock, demo және оқу модельдерін тапсыруға болмайды."
  },
  "Нужен исходный список диалогов выбранного набора.": {
    "en": "The original conversation list is required.",
    "kk": "Таңдалған жинақтың бастапқы диалогтар тізімі қажет."
  },
  "Набор должен быть dev или prod.": {
    "en": "Dataset must be dev or prod.",
    "kk": "Жинақ dev немесе prod болуы керек."
  },
  "DEV должен содержать 60 чатов и 5 звонков.": {
    "en": "DEV must contain 60 chats and 5 calls.",
    "kk": "DEV ішінде 60 чат және 5 қоңырау болуы керек."
  },
  "PROD должен содержать ровно 10 чатов без звонков.": {
    "en": "PROD must contain exactly 10 chats and no calls.",
    "kk": "PROD ішінде қоңыраусыз дәл 10 чат болуы керек."
  },
  "Количество результатов не совпадает с исходным набором.": {
    "en": "Result count does not match the source dataset.",
    "kk": "Нәтижелер саны бастапқы жинаққа сәйкес емес."
  },
  "Не для всех исходных диалогов есть результат.": {
    "en": "Some source conversations have no result.",
    "kk": "Кейбір бастапқы диалогтарда нәтиже жоқ."
  },
  "Нужен массив оценок диалогов.": {
    "en": "An evaluation array is required.",
    "kk": "Диалогтар бағасының массиві қажет."
  },
  "Источник оценки должен быть original или final.": {
    "en": "Evaluation source must be original or final.",
    "kk": "Баға көзі original немесе final болуы керек."
  },
  "требуется непустая строка.": {
    "en": "a non-empty string is required.",
    "kk": "бос емес жол қажет."
  },
  "текст содержит подписанный адрес или данные доступа.": {
    "en": "text contains a signed URL or credentials.",
    "kk": "мәтінде қолтаңбалы сілтеме немесе кіру деректері бар."
  },
  "подписанный адрес скрыт.": {
    "en": "a signed URL was hidden.",
    "kk": "қолтаңбалы сілтеме жасырылды."
  },
  "текст содержит возможный ключ или токен.": {
    "en": "text may contain a key or token.",
    "kk": "мәтінде кілт немесе токен болуы мүмкін."
  },
  "ожидается объект.": {
    "en": "an object is required.",
    "kk": "нысан қажет."
  },
  "есть поля вне формата сдачи.": {
    "en": "there are fields outside the submission schema.",
    "kk": "тапсыру схемасына кірмейтін өрістер бар."
  },
  "нет исходного ID.": {
    "en": "source ID is missing.",
    "kk": "бастапқы ID жоқ."
  },
  "ID содержит данные доступа.": {
    "en": "ID contains credentials.",
    "kk": "ID кіру деректерін қамтиды."
  },
  "исходный ID повторяется.": {
    "en": "source ID is duplicated.",
    "kk": "бастапқы ID қайталанады."
  },
  "нужен исходный массив transcript.": {
    "en": "the original transcript array is required.",
    "kk": "бастапқы transcript массиві қажет."
  },
  "неизвестный канал.": {
    "en": "unknown channel.",
    "kk": "белгісіз арна."
  },
  "N/A для этого критерия запрещён.": {
    "en": "N/A is not allowed for this criterion.",
    "kk": "Бұл критерий үшін N/A рұқсат етілмейді."
  },
  "требуется boolean, а не строка или число.": {
    "en": "a boolean is required, not a string or number.",
    "kk": "жол немесе сан емес, boolean қажет."
  },
  "значение не входит в исходную шкалу.": {
    "en": "value is outside the original scale.",
    "kk": "мән бастапқы шкалаға кірмейді."
  },
  "final_score должен быть числом от 0 до 100 с точностью до двух знаков.": {
    "en": "final_score must be 0–100 with up to two decimals.",
    "kk": "final_score екі ондық таңбаға дейінгі 0–100 саны болуы керек."
  },
  "итог не совпадает с расчётом по исходным весам.": {
    "en": "total does not match the original-weight calculation.",
    "kk": "қорытынды бастапқы салмақтармен есепке сәйкес емес."
  },
  "critical_flag должен быть boolean.": {
    "en": "critical_flag must be boolean.",
    "kk": "critical_flag boolean болуы керек."
  },
  "critical_flag не совпадает с критерием critical.": {
    "en": "critical_flag does not match critical.",
    "kk": "critical_flag мәні critical критерийіне сәйкес емес."
  },
  "снимок чек-листа не соответствует исходным восьми критериям.": {
    "en": "the checklist snapshot does not match the eight original criteria.",
    "kk": "чек-парақ көшірмесі бастапқы сегіз критерийге сәйкес емес."
  },
  "в снимке неизвестный или повторный критерий.": {
    "en": "the snapshot contains an unknown or duplicate criterion.",
    "kk": "көшірмеде белгісіз немесе қайталанатын критерий бар."
  },
  "после пересмотра нужны original_criteria; восстановление исходных доказательств по отдельным ответам запрещено.": {
    "en": "reviewed results require original_criteria; original evidence cannot be reconstructed from individual answers.",
    "kk": "қайта қаралған нәтижелер үшін original_criteria қажет; жеке жауаптардан бастапқы дәлелдерді қалпына келтіруге болмайды."
  },
  "явно выбрана пересмотренная оценка.": {
    "en": "the reviewed evaluation was explicitly selected.",
    "kk": "қайта қаралған баға нақты таңдалған."
  },
  "evidence должен быть массивом.": {
    "en": "evidence must be an array.",
    "kk": "evidence массив болуы керек."
  },
  "ссылка на реплику выходит за исходный транскрипт.": {
    "en": "message reference is outside the original transcript.",
    "kk": "реплика сілтемесі бастапқы транскрипттен тыс."
  },
  "evidence_turns должен быть массивом.": {
    "en": "evidence_turns must be an array.",
    "kk": "evidence_turns массив болуы керек."
  },
  "готовый индекс реплики выходит за исходный транскрипт.": {
    "en": "message index is outside the original transcript.",
    "kk": "реплика индексі бастапқы транскрипттен тыс."
  },
  "checked_range выходит за исходный транскрипт.": {
    "en": "checked_range is outside the original transcript.",
    "kk": "checked_range бастапқы транскрипттен тыс."
  },
  "имя фактически использованной модели некорректно.": {
    "en": "the actual model name is invalid.",
    "kk": "қолданылған модель атауы жарамсыз."
  },
  "mock/demo/учебная модель запрещена для сдачи.": {
    "en": "mock, demo and training models cannot be submitted.",
    "kk": "mock, demo және оқу модельдерін тапсыруға болмайды."
  },
  "в оценке нет имени модели; проверьте указанное общее имя модели.": {
    "en": "evaluation has no model name; review the overall model name.",
    "kk": "бағада модель атауы жоқ; жалпы модель атауын тексеріңіз."
  },
  "отсутствует исходный ID диалога.": {
    "en": "original conversation ID is missing.",
    "kk": "бастапқы диалог ID жоқ."
  },
  "ID отсутствует в исходном наборе.": {
    "en": "ID is not in the source dataset.",
    "kk": "ID бастапқы жинақта жоқ."
  },
  "учебный диалог запрещён для сдачи.": {
    "en": "a demo conversation cannot be submitted.",
    "kk": "оқу диалогын тапсыруға болмайды."
  },
  "mock/demo-оценка запрещена для сдачи.": {
    "en": "mock/demo evaluations cannot be submitted.",
    "kk": "mock/demo бағаларын тапсыруға болмайды."
  },
  "оценки нет; явная ошибка не указана.": {
    "en": "evaluation is missing without an explicit error.",
    "kk": "баға жоқ және айқын қате көрсетілмеген."
  },
  "оценка относится к другому диалогу.": {
    "en": "evaluation belongs to another conversation.",
    "kk": "баға басқа диалогқа тиесілі."
  },
  "нужны ровно восемь критериев.": {
    "en": "exactly eight criteria are required.",
    "kk": "дәл сегіз критерий қажет."
  },
  "неизвестный или повторный критерий.": {
    "en": "unknown or duplicate criterion.",
    "kk": "белгісіз немесе қайталанатын критерий."
  },
  "ответ требует проверки и не готов к сдаче.": {
    "en": "answer needs review and cannot be submitted yet.",
    "kk": "жауап тексеруді қажет етеді және тапсыруға дайын емес."
  },
  "нет ссылок на реплики.": {
    "en": "no message references.",
    "kk": "репликаларға сілтемелер жоқ."
  },
  "сохранённый итог не совпадает с расчётом исходной оценки.": {
    "en": "saved total does not match the original evaluation calculation.",
    "kk": "сақталған қорытынды бастапқы бағаның есебіне сәйкес емес."
  },
  "сохранённый признак грубой ошибки не совпадает с critical.": {
    "en": "saved critical-error flag does not match critical.",
    "kk": "сақталған өрескел қате белгісі critical мәніне сәйкес емес."
  },
  "текст содержит возможные контакты или личный идентификатор. Проверьте и обезличьте обоснование перед публикацией.": {
    "en": "text may contain contact details or a personal identifier. Review and anonymize the rationale before publishing.",
    "kk": "мәтінде байланыс деректері немесе жеке идентификатор болуы мүмкін. Жарияламас бұрын негіздемені тексеріп, иесіздендіріңіз."
  },
  "запись должна быть объектом.": {
    "en": "record must be an object.",
    "kk": "жазба нысан болуы керек."
  },
  "нужен непустой строковый conversation_id.": {
    "en": "a non-empty string conversation_id is required.",
    "kk": "бос емес жол түріндегі conversation_id қажет."
  },
  "conversation_id повторяется в исходном наборе.": {
    "en": "conversation_id is duplicated in the source dataset.",
    "kk": "conversation_id бастапқы жинақта қайталанады."
  },
  "канал должен быть agent chat или voice call.": {
    "en": "channel must be agent chat or voice call.",
    "kk": "арна agent chat немесе voice call болуы керек."
  },
  "transcript должен быть массивом.": {
    "en": "transcript must be an array.",
    "kk": "transcript массив болуы керек."
  },
  "не передан объект файла.": {
    "en": "file object is missing.",
    "kk": "файл нысаны берілмеген."
  },
  "это готовый файл сдачи. Выберите исходные оценки, чтобы не преобразовать номера реплик повторно.": {
    "en": "this is a final submission file. Choose original evaluations to avoid renumbering messages twice.",
    "kk": "бұл дайын тапсыру файлы. Репликаларды қайта нөмірлемеу үшін бастапқы бағаларды таңдаңыз."
  },
  "источник сообщил об ошибке.": {
    "en": "the source reported an error.",
    "kk": "дерек көзі қате хабарлады."
  },
  "служебный summary.json пропущен; он не содержит оценки диалогов.": {
    "en": "summary.json was skipped because it contains no conversation evaluations.",
    "kk": "summary.json өткізіліп жіберілді: онда диалог бағалары жоқ."
  },
  "исходные оценки не найдены.": {
    "en": "source evaluations were not found.",
    "kk": "бастапқы бағалар табылмады."
  },
  "готовый формат сдачи не принимается как исходная оценка.": {
    "en": "a final submission cannot be used as a source evaluation.",
    "kk": "дайын тапсыру файлын бастапқы баға ретінде қолдануға болмайды."
  },
  "conversation_id повторяется среди загруженных оценок.": {
    "en": "conversation_id is duplicated among uploaded evaluations.",
    "kk": "conversation_id жүктелген бағаларда қайталанады."
  },
  "Результат {index}": {
    "en": "Result {index}",
    "kk": "Нәтиже {index}"
  },
  "Исходный диалог {index}": {
    "en": "Source conversation {index}",
    "kk": "Бастапқы диалог {index}"
  },
  "Диалог {index}": {
    "en": "Conversation {index}",
    "kk": "Диалог {index}"
  },
  "Файл {index}": {
    "en": "File {index}",
    "kk": "Файл {index}"
  },
  "оценка {index}": {
    "en": "evaluation {index}",
    "kk": "баға {index}"
  },
  "обоснование": {
    "en": "rationale",
    "kk": "негіздеме"
  },
  "ошибка": {
    "en": "error",
    "kk": "қате"
  },
  "чек-лист": {
    "en": "checklist",
    "kk": "чек-парақ"
  },
  "снимок чек-листа": {
    "en": "checklist snapshot",
    "kk": "чек-парақ көшірмесі"
  },
  "итог": {
    "en": "total",
    "kk": "қорытынды"
  },
  "Документ": {
    "en": "Document",
    "kk": "Құжат"
  },
  "schema_version должен быть строкой 1.0.": {
    "en": "schema_version must be the string 1.0.",
    "kk": "schema_version мәні 1.0 жолы болуы керек."
  },
  "results должен быть массивом.": {
    "en": "results must be an array.",
    "kk": "results массив болуы керек."
  },
  "status должен быть ok или error.": {
    "en": "status must be ok or error.",
    "kk": "status мәні ok немесе error болуы керек."
  },
  "при error нужны criteria: [] и score: null.": {
    "en": "error records require criteria: [] and score: null.",
    "kk": "error жазбаларына criteria: [] және score: null қажет."
  },
  "ID повторяется.": {
    "en": "ID is duplicated.",
    "kk": "ID қайталанады."
  },
  "неизвестный или повторный канонический criterion_id.": {
    "en": "unknown or duplicate canonical criterion_id.",
    "kk": "белгісіз немесе қайталанатын канондық criterion_id."
  },
  "индекс реплики вне исходного транскрипта.": {
    "en": "message index is outside the original transcript.",
    "kk": "реплика индексі бастапқы транскрипттен тыс."
  },
  "индексы реплик повторяются.": {
    "en": "message indices are duplicated.",
    "kk": "реплика индекстері қайталанады."
  },
  "индексы реплик должны быть отсортированы.": {
    "en": "message indices must be sorted.",
    "kk": "реплика индекстері сұрыпталуы керек."
  },
  "отсутствует поле {field}.": {
    "en": "field {field} is missing.",
    "kk": "{field} өрісі жоқ."
  },
  "тип, вес, N/A или признак грубой ошибки изменён у {id}.": {
    "en": "type, weight, N/A or critical-error flag was changed for {id}.",
    "kk": "{id} үшін түрі, салмағы, N/A немесе өрескел қате белгісі өзгерген."
  },
  "у бинарного критерия {id} не должно быть шкалы.": {
    "en": "binary criterion {id} must not have a scale.",
    "kk": "{id} бинарлық критерийінде шкала болмауы керек."
  },
  "изменена исходная шкала {id}.": {
    "en": "original scale {id} was changed.",
    "kk": "{id} бастапқы шкаласы өзгерген."
  },
  "реплика {index} должна содержать текст, допустимую роль и строковое время, если оно задано.": {
    "en": "message {index} must contain text, a valid role and a string timestamp if provided.",
    "kk": "{index} репликасында мәтін, рұқсат етілген рөл және берілсе, жол түріндегі уақыт болуы керек."
  },
  "Диалогов сервера вне исходного набора: {count}. Они не включены в результат.": {
    "en": "Server conversations outside the source dataset: {count}. They are excluded.",
    "kk": "Бастапқы жинаққа кірмейтін сервер диалогтары: {count}. Олар нәтижеге қосылмайды."
  },
  "Исходный набор {dataset} должен содержать ровно {count} диалогов.": {
    "en": "Source dataset {dataset} must contain exactly {count} conversations.",
    "kk": "{dataset} бастапқы жинағында дәл {count} диалог болуы керек."
  }
};
