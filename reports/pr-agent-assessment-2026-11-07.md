# PR-Agent: польза и риски для CQA перед сдачей

## Решение

Рекомендую отложить постоянное подключение до сдачи. Сейчас инструмент может дать дополнительный взгляд на изменения, но новая GitHub-автоматизация потребует отдельной настройки прав, модели, расходов и исключений данных. Он не проверит вместо нас живой сценарий и точность оценки относительно эталона.

В этой задаче просмотрены официальные README, документация, action.yaml, Dockerfile.github_action_dockerhub, configuration.toml, ignore.toml и SECURITY.md. Это оценка подключения по документации и конфигурации, не полный аудит исходного кода и зависимостей. Инструмент не устанавливался и не запускался.

## Что полезно

- Дополнительное AI-ревью изменений и предложения к коду через review/improve; можно передать инструкции о защищённых модулях и приоритетах CQA. [README](https://github.com/The-PR-Agent/pr-agent), [настройки](https://github.com/The-PR-Agent/pr-agent/blob/main/pr_agent/settings/configuration.toml).
- Для GitHub Action используется отдельный Docker-контейнер: менять зависимости самого CQA не требуется. Понадобятся workflow, токен GitHub и настройка модели. [GitHub integration](https://docs.pr-agent.ai/installation/github/), [action.yaml](https://github.com/The-PR-Agent/pr-agent/blob/main/action.yaml).
- Есть plain-diff режим: входом служит подготовленный diff, результат выводится локально без PR URL и токена GitHub. Для модели всё равно нужен облачный ключ или уже настроенная локальная модель. [Plain-diff mode](https://docs.pr-agent.ai/usage-guide/plain_diff_mode/).

## Риски именно перед нашей сдачей

1. **Расходы и передача кода.** Самостоятельный запуск не означает, что анализ остаётся локальным: при облачной модели данные идут выбранному LLM-провайдеру. По текущим правилам команды такие вызовы не разрешены автоматически. [Data privacy](https://docs.pr-agent.ai/overview/data_privacy/), [SECURITY.md](https://github.com/The-PR-Agent/pr-agent/blob/main/SECURITY.md).
2. **Публикация и права.** Стандартный workflow запрашивает contents:read, issues:write, pull-requests:write и публикует review в GitHub. Это внешняя запись, требующая отдельного согласования. Опция publish_output включена по умолчанию; её выключение само по себе не отменяет обращения к облачной модели. [GitHub integration](https://docs.pr-agent.ai/installation/github/), [configuration.toml](https://github.com/The-PR-Agent/pr-agent/blob/main/pr_agent/settings/configuration.toml).
3. **Неполное покрытие большого изменения.** В просмотренной конфигурации большой diff по умолчанию обрезается, а разбиение review на несколько вызовов отключено. Отсутствие замечаний нельзя считать подтверждением проверки всех файлов. В нашей ветке история ещё требует слияния main перед PR, поэтому сначала нужен осмысленный итоговый diff. [configuration.toml](https://github.com/The-PR-Agent/pr-agent/blob/main/pr_agent/settings/configuration.toml).
4. **Контекст команды нужно передать явно.** По умолчанию в контекст включается AGENTS.md из default branch. Новые указания из нашей переписки, включая запрет изменений защищённых файлов и платных перезамеров, автоматически ему неизвестны. [configuration.toml](https://github.com/The-PR-Agent/pr-agent/blob/main/pr_agent/settings/configuration.toml).
5. **Подвижная версия runtime.** Пример использует action@main, а Dockerfile — rolling tag github_action. Для воспроизводимости следует фиксировать проверенный digest контейнера; одного SHA wrapper-репозитория недостаточно для фиксации rolling image. [Dockerfile](https://github.com/The-PR-Agent/pr-agent/blob/main/Dockerfile.github_action_dockerhub), [SECURITY.md](https://github.com/The-PR-Agent/pr-agent/blob/main/SECURITY.md).

## Если подключать после сдачи

Начать с ручного review одного небольшого PR. Не включать автоматические describe/improve и автоприменение изменений. Согласовать провайдера и бюджет, ограничить права и закрепить runtime. Исключить .env, data/, outputs/, реальные диалоги, результаты с обоснованиями и изображения; фильтры ignore.glob нужно настроить явно, просмотренный default содержит только vendor/**. Любое замечание подтверждать тестом или воспроизведением. [ignore.toml](https://github.com/The-PR-Agent/pr-agent/blob/main/pr_agent/settings/ignore.toml).

Установки, вызовов LLM, изменения workflow, добавления Secrets и записей в GitHub не выполнялось. В CQA создан только этот отчёт; предыдущие незакоммиченные исправления сохранены.
