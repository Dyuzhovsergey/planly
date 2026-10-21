# Planly — план разработки и журнал инкрементов

Этот документ помогает Codex и разработчику продолжать работу даже в новом чате. **План — предложение, а не разрешение реализовать всё сразу.**

## Текущий статус

- Стадия: Container stack smoke-test foundation принят пользователем.
- Завершённые инкременты: MVP-контракт; Go HTTP-сервер с `GET /health`; PostgreSQL 18.6, миграция `users` и `GET /ready`; Auth foundation; session authentication и `GET /api/v1/me`; изменение часовой зоны через `PATCH /api/v1/me`; Task storage foundation; Task creation API; Task retrieval API; Task list API; Task update API; Task completion API; Task delete API; Frontend foundation; Frontend login/logout; Frontend registration; Frontend automatic time zone; Frontend task creation UI; Frontend task list foundation; Frontend calendar dashboard and task rescheduling; Password policy 8–128; Frontend task completion UI; Frontend task delete UI; Frontend task content editing UI; Containerized API foundation; Frontend container and local reverse proxy foundation; Container stack smoke-test foundation.
- Текущий инкремент: Brand assets foundation.
- Следующее действие: подготовить компактный логотип и favicon на основе согласованной монограммы из `image.svg`.

## Предварительная последовательность

- [x] Уточнить модель пользователя, задачи и временные зоны; выбрать минимальный API.
- [x] Создать каркас Go-сервера с `/health` и тестом.
- [x] Подключить PostgreSQL и базовые миграции; добавить `/ready` с проверкой доступности БД.
- [x] Реализовать пользователей и аутентификацию (Auth foundation, session authentication, `GET /me` и `PATCH /me` приняты).
- [x] Реализовать защищённое хранилище задач и обязательную серверную изоляцию пользовательских данных (storage, создание, получение, список, изменение, завершение и удаление приняты пользователем).
- [ ] Создать React + TypeScript + Vite UI с Tailwind CSS + shadcn/ui (foundation, auth UI и основной task CRUD без shadcn/ui приняты; дальнейшее расширение дизайн-системы отдельно не согласовано).
- [x] Выбрать FullCalendar Standard v7 и реализовать виды месяц / неделя / день с переносом активных задач.
- [ ] Дополнить Docker Compose контейнерами приложения и настроить безопасное веб-развёртывание (локальные API/frontend-контейнеры и reverse proxy приняты; HTTPS и production deployment не реализованы).
- [ ] Отдельно спроектировать и проверить интеграцию с Яндекс Алисой.

Порядок можно пересматривать после обсуждения, без автоматического перехода к следующему пункту.

## Шаблон нового инкремента

**Название:**

**Цель и зачем сейчас:**

**Результат и границы задачи:**

**Файлы:**

**Архитектурные решения и альтернативы:**

**Проверка и критерии готовности:**

**Риски / вопросы:**

**Статус:** предложен / согласован / реализован / принят пользователем.

## Журнал решений

- Planly — многопользовательское **веб-приложение**, без Tauri и обязательного desktop-клиента.
- Backend Go + PostgreSQL + REST API; frontend React + TypeScript + Vite + Tailwind CSS + shadcn/ui.
- Основной экран — календарь (месяц, неделя, день).
- На текущем этапе реализуется только сущность `Task`; отдельная сущность `Event` не входит в согласованный объём.
- Диагностические endpoints: `GET /health` проверяет, что процесс API работает; `GET /ready` проверяет готовность приложения, включая доступность PostgreSQL.
- Пользователь входит по email и паролю; пароль хешируется Argon2id, а браузер использует серверную защищённую cookie-сессию сроком 30 дней.
- Задача обязательно имеет либо точный момент `scheduled_at`, либо дату на весь день `scheduled_date`; задачи без даты и время окончания отложены.
- Часовая зона пользователя хранится как имя IANA; точные моменты передаются в RFC 3339 и хранятся как `timestamptz`.
- При регистрации web-клиент незаметно получает IANA-зону через browser `Intl`, а будущие Android/iOS-клиенты — через системный API устройства; общий fallback — `Europe/Moscow`. Автоматической синхронизации зоны при каждом запуске и пользовательской настройки в текущем frontend нет.
- Продуктовый API использует префикс `/api/v1`, а ошибки — формат `application/problem+json` по RFC 9457.
- Яндекс Алиса — будущий отдельный адаптер; идентификацию разных голосов на одной колонке нужно проверить, не считать её доказанной.

## Завершённые инкременты

### MVP-контракт данных и REST API

**Цель и зачем сейчас:** убрать неоднозначность моделей, времени, аутентификации и публичного API до создания схемы БД и кода.

**Результат и границы задачи:** согласованы модели `User`, `Task` и технической `Session`, правила времени, cookie-сессии, CSRF-защита, endpoints и формат ошибок. Программный код не создавался.

**Файлы:** `docs/PROJECT.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DEVELOPMENT_PLAN.md`, `README.md`.

**Проверка и критерии готовности:** решения не противоречат продуктовым требованиям; `user_id` не принимается от клиента; timed и all-day задачи имеют однозначное представление; следующий инкремент не требует угадывать публичный контракт.

**Статус:** принят пользователем.

### Go API walking skeleton

**Цель и зачем сейчас:** проверить структуру backend, запуск HTTP-сервера и тестирование до подключения инфраструктуры и бизнес-логики.

**Результат и границы задачи:** Go-сервер на стандартной библиотеке предоставляет `GET /health`, отклоняет неподдерживаемые методы и корректно завершается по `SIGINT` или `SIGTERM`. PostgreSQL, `/ready`, аутентификация, задачи, Docker и frontend не добавлялись.

**Файлы:** `go.mod`, `cmd/api/main.go`, `internal/httpapi/router.go`, `internal/httpapi/health.go`, `internal/httpapi/health_test.go`, `README.md`, `docs/DEVELOPMENT_PLAN.md`.

**Проверка и критерии готовности:** `gofmt`, `go test ./...`, `go vet ./...`, `go build ./...` и ручной HTTP-запрос к `/health`.

**Статус:** принят пользователем после ручной проверки запуска, `GET /health`, отклонения `POST /health` и корректного завершения сервера.

### PostgreSQL foundation and readiness

**Цель и зачем сейчас:** создать устойчивую основу хранения данных до реализации аутентификации и задач и отделить проверку жизни процесса от готовности его зависимостей.

**Результат и границы задачи:** локальный PostgreSQL 18.6 запускается через Docker Compose с постоянным volume; API использует `pgxpool`; отдельная команда на основе `tern` применяет встроенные миграции; первая миграция создаёт только таблицу `users`; `GET /ready` проверяет PostgreSQL и возвращает `200` либо безопасный `503`. Sessions, аутентификация, Task и frontend не добавлялись.

**Файлы:** `compose.yaml`, `.env.example`, `go.mod`, `go.sum`, `cmd/api/main.go`, `cmd/migrate/main.go`, `internal/config/`, `internal/platform/postgres/`, `internal/httpapi/`, `migrations/`, `README.md`, `docs/DEVELOPMENT_PLAN.md`.

**Архитектурные решения:** миграции запускаются явно отдельной командой, а не при старте API; создание пула не требует немедленной доступности БД, поэтому `/health` остаётся независимым; `/ready` ограничивает проверку БД тайм-аутом и не возвращает клиенту внутреннюю ошибку; для PostgreSQL 18 volume монтируется в `/var/lib/postgresql` согласно новой структуре официального образа.

**Проверка и критерии готовности:** автоматические Go-проверки и валидация Compose проходят; миграция создаёт `users` и `public.schema_version`; при работающей БД `/ready` возвращает `200`, при остановленной — `503`, а `/health` в обоих случаях возвращает `200`.

**Статус:** принят пользователем после ручной проверки миграции и диагностических endpoints.

### Auth foundation

**Цель и зачем сейчас:** создать проверяемую серверную идентичность пользователя до появления задач, чтобы будущий `user_id` всегда происходил из доверенной сессии.

**Результат и границы задачи:** добавлены Argon2id, repository пользователей, таблица `sessions`, атомарная регистрация пользователя с первой сессией, вход, выход, проверка Origin и CSRF, local/production режимы cookie. `GET/PATCH /me`, Task и frontend не добавлялись.

**Файлы:** `migrations/002_create_sessions.sql`, `internal/auth/`, `internal/platform/postgres/auth_repository.go`, `internal/httpapi/auth.go`, `internal/httpapi/problem.go`, `cmd/api/main.go`, конфигурация, тесты, `README.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DEVELOPMENT_PLAN.md`.

**Архитектурные решения:** handlers управляют HTTP и cookie; auth service содержит валидацию, Argon2id и жизненный цикл сессии; repository изолирует SQL. В БД хранятся только SHA-256-хеши случайных session- и CSRF-токенов. Регистрация пользователя и сессии выполняется одной PostgreSQL-транзакцией.

**Проверка и критерии готовности:** модульные тесты проверяют пароль, service, HTTP-контракты, Origin/CSRF и cookie; интеграционный тест проверяет repository и откат регистрации. Стандартные Go-проверки, миграции и ручной auth-сценарий должны пройти.

**Статус:** принят пользователем после ручной проверки регистрации, входа, Origin/CSRF и выхода.

### Session authentication and current user

**Цель и зачем сейчас:** восстановить доверенную личность пользователя по серверной cookie-сессии до реализации задач и дать браузеру способ получить текущего пользователя и CSRF-токен после перезагрузки.

**Результат и границы задачи:** добавлены session authentication, reusable HTTP middleware и `GET /api/v1/me`. Endpoint возвращает публичного пользователя и CSRF-токен; неизвестная или истёкшая сессия получает `401`. `PATCH /me`, Task и frontend не добавлялись.

**Файлы:** `internal/auth/`, `internal/platform/postgres/auth_repository.go`, `internal/httpapi/session.go`, `internal/httpapi/me.go`, router и тесты, `README.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DEVELOPMENT_PLAN.md`.

**Архитектурные решения:** middleware получает session-cookie и помещает проверенную идентичность в `request.Context`; service проверяет абсолютный срок сессии; repository одним запросом связывает сессию с её владельцем. CSRF-токен детерминированно выводится через HMAC-SHA256 из session-токена, а в БД хранится только его SHA-256-хеш. Старые сессии обновляют CSRF-хеш при первом успешном `/me` без изменения схемы БД.

**Проверка и критерии готовности:** unit-тесты проверяют восстановление личности, истёкшие и неизвестные сессии, совместимость старого CSRF и HTTP-контракт; integration-тест проверяет чтение владельца сессии и обновление CSRF-хеша. Стандартные Go-проверки, Compose и ручные запросы с cookie и без неё должны пройти.

**Статус:** принят пользователем после ручной проверки успешного запроса с действующей cookie и ответа `401` без cookie.

### Current user time zone

**Цель и зачем сейчас:** завершить минимальные настройки пользователя до реализации задач, чтобы календарные диапазоны в следующих инкрементах опирались на изменяемую IANA-таймзону владельца.

**Результат и границы задачи:** добавлен `PATCH /api/v1/me`, который принимает только `timeZone`, возвращает обновлённый auth-envelope и не меняет сессию. Запрос защищён проверками Origin, session-cookie и CSRF. Task и frontend не добавлялись.

**Файлы:** `internal/auth/`, `internal/platform/postgres/auth_repository.go`, `internal/httpapi/session.go`, `internal/httpapi/me.go`, router и тесты, `README.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DEVELOPMENT_PLAN.md`.

**Архитектурные решения:** HTTP middleware последовательно проверяет Origin, восстанавливает доверенную идентичность и проверяет CSRF; handler передаёт service идентификатор только из `request.Context`; service очищает и проверяет IANA-таймзону; repository обновляет пользователя по этому идентификатору и возвращает публичные поля. Новая миграция и зависимости не потребовались.

**Проверка и критерии готовности:** unit-тесты проверяют нормализацию и валидацию зоны; HTTP-тесты покрывают успешный ответ, доверенный `user_id`, Origin, session, CSRF, JSON, `422` и безопасный `500`; integration-тест проверяет PostgreSQL-обновление и отсутствие password hash в результате. Стандартные Go-проверки, Compose и ручной PATCH-сценарий должны пройти.

**Статус:** принят пользователем после ручной проверки успешного изменения IANA-таймзоны и отказов при неверных CSRF-токене и Origin.

### Task storage foundation

**Цель и зачем сейчас:** создать изолированное по владельцу хранение задач до добавления HTTP endpoints, чтобы последующие use cases не могли обращаться к задаче без доверенного `user_id`.

**Результат и границы задачи:** добавлены модель `Task`, календарная дата без часовой зоны, миграция таблицы `tasks` и PostgreSQL repository с операциями `Create` и `FindByID`. HTTP endpoints, list/update/delete и frontend не добавлялись.

**Файлы:** `internal/task/`, `migrations/003_create_tasks.sql`, `internal/platform/postgres/task_repository.go`, `internal/platform/postgres/task_repository_integration_test.go`, `README.md`, `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT_PLAN.md`.

**Архитектурные решения:** timed-задача хранит точный момент в `timestamptz`, all-day задача использует отдельный `CalendarDate` и PostgreSQL `date`; ограничение БД требует ровно одно расписание. `user_id` передаётся repository отдельным доверенным аргументом, присутствует в `INSERT` и условии `FindByID`; чужая и отсутствующая задача возвращают одинаковый `task.ErrNotFound`.

**Проверка и критерии готовности:** unit-тесты проверяют календарную дату и варианты расписания; integration-тест создаёт timed и all-day задачи, проверяет round trip, изоляцию двух пользователей, одинаковый `ErrNotFound` и ограничения схемы. Должны проходить стандартные Go-проверки, Compose и миграция.

**Статус:** принят пользователем после ручного применения миграции и успешного `TestTaskRepositoryIntegration`.

### Task creation API

**Цель и зачем сейчас:** добавить первый защищённый Task use case поверх принятого repository и проверить полный поток session identity → service → PostgreSQL до реализации чтения и изменения задач.

**Результат и границы задачи:** добавлены Task service с валидацией и нормализацией и `POST /api/v1/tasks` для timed/all-day задач. Endpoint возвращает `201` с публичной Task и защищён Origin, session и CSRF. List, GET, update/delete, завершение задач и frontend не добавлялись.

**Файлы:** `internal/task/model.go`, `internal/task/service.go` и тесты; `internal/httpapi/task.go`, router и HTTP-тесты; `cmd/api/main.go`; `README.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DEVELOPMENT_PLAN.md`.

**Архитектурные решения:** handler строго декодирует JSON и получает `user_id` только из session identity; service очищает title, проверяет текст и преобразует RFC 3339 либо `YYYY-MM-DD` в доменный `Schedule`; repository получает владельца отдельным аргументом. `userId` отсутствует во входной модели и отклоняется как неизвестное поле.

**Проверка и критерии готовности:** unit-тесты покрывают нормализацию, Unicode-длину, NUL, timed/all-day и repository errors; HTTP-тесты проверяют `201`, публичный ответ без владельца, Origin/session/CSRF, неизвестный `userId`, `422`, безопасный `500` и `405`. Должны пройти Go-проверки, Compose, PostgreSQL integration-тесты и ручные запросы обоих типов.

**Статус:** принят пользователем после ручной проверки создания timed/all-day задач, нормализации timed-времени в UTC, отклонения `userId` и отказов при неверных Origin и CSRF.

### Task retrieval API

**Цель и зачем сейчас:** добавить чтение одной задачи поверх принятого repository, сохранив серверную изоляцию владельцев и единое поведение для отсутствующих и чужих данных.

**Результат и границы задачи:** добавлены `TaskService.GetByID` и `GET /api/v1/tasks/{id}`. Endpoint использует только session authentication и возвращает существующее публичное представление timed/all-day Task. List, update/delete, завершение задач и frontend не добавлялись.

**Файлы:** `internal/task/service.go` и тесты; `internal/httpapi/task.go`, router и HTTP-тесты; `README.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DEVELOPMENT_PLAN.md`.

**Архитектурные решения:** handler получает `user_id` только из session identity и передаёт его service отдельно от `id` из URL; service проверяет UUID-формат без новой зависимости; repository выполняет существующий запрос одновременно по владельцу и задаче. `task.ErrNotFound` одинаково отображается в `404 task_not_found`; некорректный UUID получает тот же ответ без обращения к БД. Origin и CSRF не проверяются для безопасного `GET`.

**Проверка и критерии готовности:** unit-тесты проверяют доверенного владельца, UUID и ошибки repository; HTTP-тесты покрывают timed/all-day ответы без `userId`, session authentication, одинаковый `404`, безопасный `500` и отсутствие требований Origin/CSRF. Должны пройти стандартные Go-проверки, Compose, repository integration-тест и ручные запросы владельца, другого пользователя и без cookie.

**Статус:** принят пользователем после ручной проверки получения своей задачи, `401` без cookie и одинакового `404 task_not_found` для чужой, отсутствующей и некорректно идентифицированной задачи.

### Task list API

**Цель и зачем сейчас:** добавить календарное чтение задач после получения одной задачи и проверить корректную работу timed/all-day расписаний в диапазоне и часовой зоне владельца.

**Результат и границы задачи:** добавлены `TaskService.List`, repository `ListByRange`, `GET /api/v1/tasks?from=&to=` и миграция частичных индексов расписания. Endpoint возвращает `{"items":[]}` с публичными Task без `userId` и использует только session authentication. Update/delete, завершение задач, пагинация и frontend не добавлялись.

**Файлы:** `internal/task/`; `internal/platform/postgres/task_repository.go` и integration-тест; `internal/httpapi/task.go`, router и HTTP-тесты; `migrations/004_add_task_schedule_indexes.sql`; `README.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DEVELOPMENT_PLAN.md`.

**Архитектурные решения:** `user_id` и IANA-таймзона поступают только из проверенной session identity. Service валидирует обязательные даты, условие `from < to` и максимум 366 дней, затем независимо переводит обе локальные полуночи в UTC, поэтому длительность timed-интервала корректна при переходах DST. Repository отдельно фильтрует `scheduled_at` и `scheduled_date`, всегда ограничивает запрос владельцем и сортирует объединённый результат по локальному календарному времени и `id`. Частичные индексы соответствуют двум разновидностям расписания.

**Проверка и критерии готовности:** unit-тесты проверяют даты, максимальный диапазон, оба DST-перехода и HTTP-контракт; integration-тест проверяет включительную/исключительную границы, оба типа задач, изоляцию владельцев, порядок, пустой список и наличие индексов. Требуются успешные стандартные Go-проверки, Compose, миграция и ручные запросы с cookie и без неё.

**Статус:** принят пользователем после ручной проверки списка своих задач, пустого диапазона, ответа `401` без cookie и валидации неверного диапазона.

### Task update API

**Цель и зачем сейчас:** добавить редактирование существующей задачи после принятых create/get/list use cases и завершить основной поток работы с содержимым и расписанием до отдельных инкрементов завершения и удаления.

**Результат и границы задачи:** добавлены `TaskService.Update`, repository `Update` и защищённый `PATCH /api/v1/tasks/{id}` для частичного изменения `title`, `description` и `schedule`. Пустая строка очищает описание, расписание заменяется целиком и поддерживает переходы timed ↔ all-day. Completed, delete, пагинация и frontend не добавлялись; новые зависимости и миграции не потребовались.

**Файлы:** `internal/task/`; `internal/platform/postgres/task_repository.go` и integration-тест; `internal/httpapi/task.go`, router и HTTP-тесты; `README.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DEVELOPMENT_PLAN.md`.

**Архитектурные решения:** HTTP-модель отдельно хранит признак присутствия каждого PATCH-поля, поэтому отсутствие поля отличается от допустимого `description: ""`, а `null` отклоняется. Endpoint проходит Origin → session → CSRF и получает `user_id` только из session identity. Service нормализует title и переиспользует общие правила расписания. Repository выполняет один атомарный `UPDATE ... WHERE user_id = $1 AND id = $2 RETURNING ...`, сохраняет непереданные поля и одинаково скрывает чужую и отсутствующую задачу.

**Проверка и критерии готовности:** unit-тесты проверяют нормализацию, пустой PATCH, частичные поля, расписание, UUID и ошибки repository; HTTP-тесты покрывают публичный ответ, строгий JSON, `userId`, `completed`, `null`, Origin/session/CSRF и безопасные ошибки; integration-тест проверяет сохранение непереданных полей, очистку описания, `updated_at`, оба перехода расписания и изоляцию владельцев. Требуются успешные unit-, integration-, race- и стандартные Go-проверки, Compose и ручные PATCH-запросы.

**Статус:** принят пользователем после ручной проверки изменения полей, очистки `description`, переходов timed ↔ all-day, отказов при неверных Origin/CSRF и одинакового `404 task_not_found` для чужой, отсутствующей и некорректно идентифицированной задачи.

### Task completion API

**Цель и зачем сейчас:** завершить согласованный жизненный цикл задачи поверх существующего защищённого PATCH до реализации удаления и frontend.

**Результат и границы задачи:** поле `completed` добавлено в `PATCH /api/v1/tasks/{id}` и поддерживается отдельно либо вместе с `title`, `description` и `schedule`. `true` устанавливает `completed_at` временем PostgreSQL, `false` очищает его. Delete, пагинация и frontend не добавлялись; новые endpoints, зависимости и миграции не потребовались.

**Файлы:** `internal/task/`; `internal/platform/postgres/task_repository.go` и integration-тест; `internal/httpapi/task.go` и HTTP-тесты; `README.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DEVELOPMENT_PLAN.md`.

**Архитектурные решения:** generic HTTP-поле различает отсутствие `completed` и явный `false`, а `null` отклоняет. Endpoint сохраняет цепочку Origin → session → CSRF и получает `user_id` только из session identity. Repository в одном `UPDATE ... WHERE user_id = $1 AND id = $2` использует время PostgreSQL, сохраняет исходный `completed_at` при повторном завершении и не меняет `updated_at` при completion-only запросе без перехода состояния.

**Проверка и критерии готовности:** unit- и HTTP-тесты проверяют `true`, явный `false`, отсутствие поля, `null`, совместное обновление и существующую защиту. Integration-тест проверяет оба перехода, сохранение временных меток при повторных запросах, совместное обновление и изоляцию владельцев. Требуются успешные integration-, race- и стандартные Go-проверки, Compose и ручные PATCH-запросы.

**Статус:** принят пользователем после ручной проверки завершения, повторного завершения без изменения `completedAt` и `updatedAt`, повторного открытия и совместного изменения статуса с другими полями.

### Task delete API

**Цель и зачем сейчас:** завершить основной CRUD задач после принятых create/get/list/update/completion use cases, сохранив серверную изоляцию владельцев.

**Результат и границы задачи:** добавлен `DELETE /api/v1/tasks/{id}` с физическим удалением и ответом `204 No Content` без тела. Пагинация и frontend не добавлялись; новые зависимости и миграции не потребовались.

**Файлы:** `internal/task/`; `internal/platform/postgres/task_repository.go` и integration-тест; `internal/httpapi/task.go`, router и HTTP-тесты; `README.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DEVELOPMENT_PLAN.md`.

**Архитектурные решения:** endpoint проходит Origin → session → CSRF, handler получает `user_id` только из session identity, service преобразует неверный UUID в `ErrNotFound` до обращения к БД, а repository выполняет один `DELETE ... WHERE user_id = $1 AND id = $2`. Ноль затронутых строк одинаково скрывает чужую, отсутствующую и повторно удалённую задачу.

**Проверка и критерии готовности:** unit-тесты проверяют доверенного владельца, UUID и ошибки repository; HTTP-тесты покрывают `204` без тела, Origin/session/CSRF, единый `404` и безопасный `500`; integration-тест проверяет физическое удаление, сохранность после чужой попытки и повторный `ErrNotFound`. Требуются успешные integration-, race- и стандартные Go-проверки, Compose и ручные DELETE-запросы.

**Статус:** принят пользователем после ручной проверки `204 No Content` без тела, последующего и повторного `404 task_not_found` и отказа при неверном CSRF-токене.

### Frontend foundation

**Цель и зачем сейчас:** создать первый браузерный слой поверх принятого backend CRUD и проверить безопасное восстановление cookie-сессии до реализации экранов аутентификации, календаря и задач.

**Результат и границы задачи:** в `web/` добавлен каркас React + TypeScript + Vite с базовым Tailwind CSS, типизированным client на стандартном `fetch`, `SessionProvider` и минимальным экраном состояний loading/authenticated/anonymous/error с повторной попыткой. shadcn/ui, маршрутизация, формы аутентификации, календарь, задачи и пагинация не добавлялись; backend API не изменялся.

**Файлы:** `web/`; `.gitignore`; `README.md`; `docs/ARCHITECTURE.md`; `docs/DEVELOPMENT_PLAN.md`.

**Архитектурные решения:** Vite proxy направляет относительный `/api` на Go API. Client использует `credentials: "include"`, а `user` и `csrfToken` живут только в памяти provider и не записываются в web storage. `401` преобразуется в нормальное анонимное состояние; остальные ошибки позволяют повторить запрос. Модули разделены на сборку приложения, session feature и общий API transport; Axios, глобальный state manager и router не нужны на этом этапе.

**Проверка и критерии готовности:** unit-тесты покрывают загрузку, успешное восстановление пользователя, `401` и сетевую ошибку с retry. Должны проходить frontend lint/test/build и стандартные Go-проверки. Для приёмки пользователь проверяет состояния в браузере на `http://localhost:5173`; до этого инкремент не считается принятым.

**Статус:** принят пользователем после ручной браузерной проверки анонимного состояния, восстановления действующей сессии и ошибки с повторной попыткой.

### Frontend login/logout

**Цель и зачем сейчас:** дать пользователю возможность начать и завершить сессию из браузерного интерфейса поверх принятого Frontend foundation до реализации регистрации и продуктовых экранов.

**Результат и границы задачи:** добавлены доступная форма входа, отображение `invalid_credentials`, полевых `validation_failed` и сетевых ошибок, защита от повторной отправки, показ/скрытие пароля и безопасный logout. Регистрация, shadcn/ui, маршрутизация, календарь, задачи, пагинация и полноценный дизайн не добавлялись; backend API и зависимости не менялись.

**Файлы:** `.env.example`; `web/src/shared/api/client.ts`; `web/src/features/session/`; `web/src/app/App.tsx`; frontend-тесты; `README.md`; `docs/ARCHITECTURE.md`; `docs/DEVELOPMENT_PLAN.md`.

**Архитектурные решения:** `SessionProvider` остаётся единственным источником auth-состояния. Login передаёт credentials только в `POST /api/v1/auth/login` и сразу сохраняет auth-envelope в памяти. Logout отправляет session-cookie через `credentials: "include"`, CSRF из provider в `X-CSRF-Token`, а browser добавляет `Origin`; `204` и истёкшая серверная сессия переводят UI в anonymous, тогда как сетевая ошибка сохраняет authenticated-состояние. Общий client поддерживает JSON и пустой `204`; web storage не используется.

**Проверка и критерии готовности:** тесты покрывают login без перезагрузки, credentials и validation errors, сетевую ошибку, повторную отправку, переключение видимости пароля, CSRF logout, `204`, истёкшую сессию и сохранение пользователя при ошибке logout. Требуются успешные frontend lint/test/build, стандартные Go-проверки, Compose и ручная браузерная приёмка.

**Статус:** принят пользователем после ручной браузерной проверки неверных и правильных credentials, восстановления сессии после перезагрузки, безопасного logout и сетевой ошибки.

### Frontend registration

**Цель и зачем сейчас:** завершить минимальный браузерный auth-сценарий после принятого login/logout, чтобы новый пользователь мог создать аккаунт и сразу получить действующую сессию без ручного API-запроса или перезагрузки страницы.

**Результат и границы задачи:** добавлена форма регистрации с email, паролем и IANA-таймзоной, переключение между регистрацией и входом без router, обработка `validation_failed`, `email_already_registered` и сетевых ошибок, управление фокусом и защита от повторной отправки. Календарь, задачи, маршрутизация, пагинация, shadcn/ui и полноценный дизайн не добавлялись; backend API и зависимости не менялись. Последующий инкремент убрал ручной ввод зоны из этой формы.

**Файлы:** `web/src/features/session/RegistrationForm.tsx`; существующие session types/API/context/provider и тесты; `web/src/app/App.tsx`; `README.md`; `docs/ARCHITECTURE.md`; `docs/DEVELOPMENT_PLAN.md`.

**Архитектурные решения:** `SessionProvider` вызывает существующий `POST /api/v1/auth/register` и после `201` сохраняет `user` и `csrfToken` только в памяти, используя тот же authenticated-state, что и login. `credentials: "include"` позволяет браузеру принять HttpOnly session-cookie, а browser `Origin` проверяется backend. В исходной версии часовая зона предзаполнялась через `Intl.DateTimeFormat().resolvedOptions().timeZone`; последующий инкремент заменил это на невидимый платформенный adapter. Пароль и токены не записываются в web storage.

**Проверка и критерии готовности:** тесты покрывают переключение форм, browser time zone, точный registration payload, `201` без перезагрузки, хранение auth-envelope только в памяти, полевые validation errors и фокус, конфликт email, сетевую ошибку и повторную отправку. Требуются успешные frontend lint/test/build, стандартные Go-проверки, Compose и ручная браузерная приёмка регистрации и восстановления сессии.

**Статус:** принят пользователем после ручной браузерной проверки регистрации, серверной валидации, конфликта email, восстановления сессии после перезагрузки и сетевой ошибки.

### Frontend automatic time zone

**Цель и зачем сейчас:** убрать технический выбор часовой зоны из регистрации и authenticated-интерфейса, сохранив существующий backend-контракт и простое кроссплатформенное правило.

**Результат и границы задачи:** регистрация незаметно отправляет IANA-зону из browser `Intl`; при невозможности определения используется `Europe/Moscow`. Пользователь не видит, не вводит и не изменяет зону. Frontend не вызывает существующий `PATCH /api/v1/me` и не синхронизирует значение при каждом запуске. Backend API, зависимости, календарь, задачи в UI, router, пагинация, shadcn/ui и полноценный дизайн не менялись.

**Файлы:** `web/src/features/session/time-zone.ts`; `RegistrationForm.tsx`; существующие session types/API/context/provider и тесты; `web/src/app/App.tsx`; `AGENTS.md`; `README.md`; `docs/PROJECT.md`; `docs/ARCHITECTURE.md`; `docs/DEVELOPMENT_PLAN.md`.

**Архитектурные решения:** browser adapter изолирует платформенный API от формы и вычисляет зону только в момент регистрации. Будущие Android/iOS-клиенты получат IANA-зону через системный API устройства и применят тот же fallback `Europe/Moscow`. Backend продолжает хранить и валидировать IANA-зону, а `PATCH /api/v1/me` сохраняется для будущих клиентов, хотя текущий frontend его не использует. Рекомендация `ui-ux-pro-max` применена как progressive disclosure в предельной форме: полностью скрыть автоматически определяемый технический параметр и не перегружать регистрацию.

**Проверка и критерии готовности:** frontend-тесты проверяют определённую browser-зону в registration payload, fallback `Europe/Moscow`, отсутствие элементов зоны в registration/authenticated UI и сохранение прежних auth-сценариев. Требуются успешные frontend lint/test/build, стандартные Go-проверки, Compose и ручная браузерная приёмка на `http://localhost:5173`.

**Статус:** принят пользователем после ручной браузерной проверки регистрации без видимых полей и настроек часовой зоны.

### Frontend task creation UI

**Цель и зачем сейчас:** добавить первый продуктовый write-flow во frontend поверх принятого защищённого `POST /api/v1/tasks`, чтобы пользователь мог создавать задачи до появления списка и календарной сетки.

**Результат и границы задачи:** authenticated-интерфейс получил форму с title, необязательным description, выбором timed/all-day и соответствующим `datetime-local` или `date`. После `201` форма показывает публичную созданную Task, очищается и возвращает фокус в title. Список, изменение, завершение и удаление задач, календарная сетка, router, пагинация, shadcn/ui и полноценный дизайн не добавлялись; backend API, зависимости и БД не менялись.

**Файлы:** `web/src/features/tasks/types.ts`, `api.ts`, `date-time.ts`, `TaskCreateForm.tsx` и тесты; `web/src/app/App.tsx`; `README.md`; `docs/ARCHITECTURE.md`; `docs/DEVELOPMENT_PLAN.md`.

**Архитектурные решения:** task feature использует общий `fetch` client с `credentials: "include"`; browser формирует Origin, а `X-CSRF-Token` передаётся только из authenticated-состояния. Клиентский payload не содержит `userId`, поэтому backend по-прежнему получает владельца только из session identity. `datetime-local` проверяется обратным сравнением календарных частей и преобразуется из локального времени устройства в UTC RFC 3339, а all-day дата не проходит через UTC. `validation_failed` отображается рядом с полями; `401` запускает существующую повторную проверку сессии, `403` и network errors сохраняют введённые значения. Рекомендации `ui-ux-pro-max` применены к labels, focus states, touch targets и явным loading/success/error состояниям без редизайна приложения.

**Проверка и критерии готовности:** frontend-тесты покрывают timed/all-day payload, cookie/CSRF, отсутствие `userId`, локальную и серверную валидацию, focus management, `401`, `403`, network retry, блокировку повторной отправки и преобразование дат. Требуются успешные frontend lint/test/build, стандартные Go-проверки, Compose и ручная браузерная приёмка на `http://localhost:5173`.

**Статус:** принят пользователем после ручной браузерной проверки timed/all-day задач, подтверждения успеха, очистки формы, клиентской валидации и отсутствия `userId` в payload.

### Frontend task list foundation

**Цель и зачем сейчас:** связать принятый task API с первым read-only представлением задач до календарной сетки и изменяющих действий во frontend.

**Результат и границы задачи:** authenticated-интерфейс загружает задачи текущего календарного месяца через типизированный `GET /api/v1/tasks?from=&to=` и показывает отдельные loading, empty, error с retry и loaded состояния. После успешного создания список перечитывается. Изменение, завершение, удаление, календарная сетка, router, пагинация и полноценный дизайн не добавлялись; backend API и зависимости не менялись.

**Файлы:** `web/src/features/tasks/types.ts`, `api.ts`, `calendar-range.ts`, `date-time.ts`, `TaskList.tsx`, `TaskCreateForm.tsx` и тесты; `web/src/app/App.tsx`; session integration-тест; `README.md`; `docs/ARCHITECTURE.md`; `docs/DEVELOPMENT_PLAN.md`.

**Архитектурные решения:** frontend вычисляет включительную границу `from` и исключительную `to` по текущему месяцу в `User.timeZone`, но не передаёт в API ни зону, ни `userId`: backend повторно получает их из session identity. GET использует только session-cookie без Origin и CSRF. `AbortController` прекращает устаревший запрос; `401` запускает существующую проверку сессии. Timed-значения форматируются в зоне пользователя, all-day даты не преобразуются через UTC, а порядок элементов остаётся серверным. Локальный revision после создания заменяет преждевременный глобальный task-store.

**Проверка и критерии готовности:** unit-тесты покрывают IANA-границы месяца и переход года; component-тесты — точный URL, cookie без CSRF, loading/empty/error/retry/loaded, `401`, abort, серверный порядок, явный статус, timed/all-day форматирование и перечитывание по revision. Требуются успешные frontend lint/test/build, стандартные Go-проверки, Compose и ручная браузерная приёмка.

**Статус:** принят как техническая основа следующего календарного интерфейса; загрузка диапазона, состояния списка и обновление после создания сохраняются при переходе к dashboard.

### Frontend calendar dashboard and task rescheduling

**Цель и зачем сейчас:** превратить принятый read-only список в основной календарный интерфейс Planly и сразу сделать перенос задач полезным как мышью/touch, так и с клавиатуры.

**Результат и границы задачи:** authenticated-интерфейс перестроен в адаптивный bento-dashboard с навигацией, календарём, быстрым созданием и agenda. FullCalendar поддерживает месяц/неделю/день, русский locale, понедельник как начало недели и IANA-зону пользователя. Задачи загружаются по видимому диапазону; активные задачи переносятся через drag-and-drop или доступную форму, завершённые остаются неподвижными. Backend, БД, миграции и REST-контракты не изменены; duration/resize, title/description edit, completion/delete UI, pagination и router не добавлялись.

**Файлы:** `web/src/app/App.tsx`; `web/src/index.css`; `web/src/shared/ui/icons.tsx`; `web/src/features/tasks/TaskCalendarDashboard.tsx`, `TaskAgenda.tsx`, `TaskRescheduleForm.tsx`, `calendar-events.ts`, `calendar-range.ts`, `date-time.ts`, `api.ts`, `types.ts`, формы и тесты; `web/package.json`; `README.md`; `docs/PROJECT.md`; `docs/ARCHITECTURE.md`; `docs/DEVELOPMENT_PLAN.md`.

**Архитектурные решения:** FullCalendar Standard v7 предоставляет бесплатные MIT month/week/day, touch и event drop; `temporal-polyfill` отвечает за явные IANA/DST-преобразования. Dashboard загружается lazy import только после аутентификации. Видимый полуинтервал преобразуется в `from/to` без передачи `userId` или `timeZone`; all-day дата никогда не становится UTC-моментом. Drop формирует полный `schedule`, использует существующий защищённый PATCH и вызывает `revert()` при ошибке. `eventDurationEditable=false`, завершённые события не редактируются. CSS использует семантические зелёные токены, единые SVG-иконки, переходы 150–250 мс и `prefers-reduced-motion`.

**Проверка и критерии готовности:** unit-тесты покрывают Task → event, DST/переход года, all-day без UTC, формирование PATCH и отсутствие `userId`/duration; component-тесты — loading/empty/error/retry/loaded, обновление после создания, mobile day, `401`, drop/revert и доступную форму. Требуются успешные `npm run lint`, `npm test`, `npm run build`, стандартные Go-проверки, Compose и ручная приёмка на 375/768/1024/1440 px.

**Риски / вопросы:** native drag-and-drop и `datetime-local` различаются между browser и touch-устройствами, поэтому их необходимо проверить вручную; форма переноса остаётся обязательной доступной альтернативой.

**Статус:** принят пользователем после ручной проверки адаптивности на 375/768/1024/1440 px, создания timed/all-day задач, переключения видов и сохранения переноса после перезагрузки.

### Password policy 8–128

**Цель и зачем сейчас:** снизить минимальную длину пароля регистрации с 15 до 8 символов по согласованному продуктовому решению, сохранив единое правило во всех слоях.

**Результат и границы задачи:** backend принимает пароль длиной от 8 до 128 Unicode-символов; обязательные классы символов не добавлены. Подсказка registration UI, API-документация и сообщения тестов синхронизированы. Argon2id, login, существующие хеши и сессии не изменены; миграция не требуется.

**Файлы:** `internal/auth/service.go`, `service_test.go`; `web/src/features/session/RegistrationForm.tsx`, `SessionProvider.test.tsx`; `docs/API.md`; `docs/DEVELOPMENT_PLAN.md`.

**Проверка и критерии готовности:** unit-тест проверяет границы 7/8/128/129; frontend-тест подтверждает обновлённую серверную ошибку и подсказку. Требуются полные Go/frontend-проверки и ручная регистрация с восьмисимвольным паролем.

**Статус:** принят пользователем после ручной регистрации с восьмисимвольным паролем.

### Frontend task completion UI

**Цель и зачем сейчас:** дать пользователю завершать и повторно открывать задачи из agenda без отдельного экрана и без изменения backend-контракта.

**Результат и границы задачи:** каждая agenda-задача получила отдельное от переноса действие «Завершить» или «Открыть повторно». Запрос ждёт подтверждённую сервером Task, после чего dashboard одновременно обновляет agenda и календарь. Завершённое событие приглушается и остаётся недоступным для переноса. Delete, изменение title/description, пагинация и router не добавлялись; backend, БД, миграции и зависимости не менялись.

**Файлы:** `web/src/features/tasks/TaskCompletionControl.tsx`, `TaskAgenda.tsx`, `TaskCalendarDashboard.tsx` и тесты; `web/src/shared/ui/icons.tsx`; `README.md`; `docs/ARCHITECTURE.md`; `docs/DEVELOPMENT_PLAN.md`.

**Архитектурные решения:** completion control использует существующий типизированный `updateTask` и отправляет только `completed`, session-cookie и CSRF из памяти; `userId` отсутствует. Локальное ожидание блокирует двойное нажатие. `401` запускает восстановление сессии, `403` и network error показываются через доступный alert и не меняют прежний статус. Отдельная кнопка статуса не конфликтует с действием переноса; текст и SVG-иконка не полагаются только на цвет.

**Проверка и критерии готовности:** тесты покрывают completion/reopen payload, CSRF, отсутствие `userId`, блокировку повторной отправки, `401`, `403`, network error, синхронное обновление agenda/календаря и сохранение блокировки drag для завершённого события. Требуются полные frontend/Go/Compose-проверки и ручная браузерная приёмка.

**Статус:** принят пользователем после ручной проверки завершения, сохранения статуса после перезагрузки, повторного открытия и поведения при сетевой ошибке.

### Frontend task delete UI

**Цель и зачем сейчас:** завершить основной task CRUD во frontend, дав пользователю безопасно удалять активные и завершённые задачи из agenda через уже принятый backend endpoint.

**Результат и границы задачи:** agenda получила действие удаления и доступный modal с названием задачи, явным необратимым действием и отменой. После `204 No Content` dashboard удаляет задачу из общего локального списка, поэтому она одновременно исчезает из agenda и FullCalendar. Изменение title/description, пагинация и router не добавлялись; backend API, БД, миграции и зависимости не менялись.

**Файлы:** `web/src/features/tasks/api.ts`, `TaskDeleteDialog.tsx`, `TaskAgenda.tsx`, `TaskCalendarDashboard.tsx` и тесты; `web/src/shared/ui/icons.tsx`; `web/src/index.css`; `README.md`; `docs/ARCHITECTURE.md`; `docs/DEVELOPMENT_PLAN.md`.

**Архитектурные решения:** dialog находится на уровне dashboard и получает выбранную Task из agenda. Он фокусирует безопасную отмену, удерживает Tab внутри modal, поддерживает Escape и возвращает фокус после закрытия. Client отправляет session-cookie и CSRF из памяти без тела и `userId`. Удаление не оптимистическое: локальное состояние меняется только после `204`; `401` запускает восстановление сессии, а `403`, единый `task_not_found` и network error показываются внутри dialog и сохраняют задачу. Семантические destructive-токены и SVG-иконка дополняют текст, не используя цвет как единственный сигнал.

**Проверка и критерии готовности:** component-тесты покрывают подтверждение и отмену, focus management и Escape, точный DELETE/CSRF без `userId`, блокировку повторной отправки, `401`, `403`, `404`, network error и синхронное обновление agenda/календаря только после `204`. Требуются успешные frontend lint/test/build, race- и стандартные Go-проверки, Compose и ручная браузерная приёмка.

**Статус:** принят пользователем после ручной проверки отмены, успешного удаления, сохранения результата после перезагрузки и поведения при сетевой ошибке; подтверждающая кнопка по обратной связи сокращена до «Удалить».

### Frontend task content editing UI

**Цель и зачем сейчас:** завершить основной frontend CRUD после принятых создания, календарного переноса, completion и удаления, переиспользуя существующий защищённый PATCH без расширения backend-контракта.

**Результат и границы задачи:** прежняя форма переноса заменена единым `TaskEditForm` для частичного изменения `title`, `description` и существующих timed/all-day вариантов `schedule`. Форма заполнена текущими значениями, блокирует сохранение без изменений и после успешного ответа синхронно обновляет agenda и FullCalendar. Завершённым задачам разрешено менять содержимое, но не расписание. Новые возможности schedule, пагинация и router не добавлялись; backend, БД, миграции и зависимости не менялись.

**Файлы:** `web/src/features/tasks/TaskEditForm.tsx`, `TaskAgenda.tsx`, `TaskCalendarDashboard.tsx` и тесты; удалён заменённый `TaskRescheduleForm`; `README.md`; `docs/ARCHITECTURE.md`; `docs/DEVELOPMENT_PLAN.md`.

**Архитектурные решения:** форма сравнивает draft с подтверждённой Task и формирует минимальный PATCH: нормализованный title, description с допустимой пустой строкой и/или целостный schedule. Session-cookie добавляет общий client, browser формирует Origin, CSRF поступает только из памяти `SessionProvider`; `userId` и `completed` форма не отправляет. Полевые `validation_failed` показываются рядом с соответствующим контролом и переводят туда фокус. При `401`, `403`, `task_not_found` или network error локальная Task не заменяется, а введённые значения остаются в форме. Рекомендации `ui-ux-pro-max` применены к явным labels, focus management, заблокированному submit без изменений и доступной обратной связи без изменения принятой bento-дизайн-системы.

**Проверка и критерии готовности:** component-тесты покрывают начальные значения, минимальный payload, очистку description, оба вида schedule, запрет изменения schedule завершённой задачи, cookie/CSRF, отсутствие `userId`/`completed`, полевые ошибки и фокус, двойную отправку, `401`, `403`, `404`, network error и синхронное обновление agenda/календаря. Требуются успешные frontend lint/test/build, race- и стандартные Go-проверки, Compose и ручная браузерная приёмка.

**Статус:** принят пользователем после ручной проверки редактирования содержимого и расписания, очистки description, синхронного обновления agenda и календаря, блокировки schedule завершённой задачи и сохранения draft при сетевой ошибке.

### Containerized API foundation

**Цель и зачем сейчас:** стандартизировать локальный запуск готового backend после принятого основного CRUD, чтобы PostgreSQL, миграции и API поднимались одной Compose-командой без зависимости от локального Go runtime.

**Результат и границы задачи:** добавлен multi-stage образ с отдельными бинарниками API и миграций, а Compose расширен одноразовым `migrate` и долгоживущим `api`. Сохранены существующий PostgreSQL service, именованный volume и host-based `go run` workflow. Frontend-контейнер, reverse proxy, HTTPS, Docker secrets, CI/CD и публикация не добавлялись; REST API, Go-код и схема БД не менялись.

**Файлы:** `Dockerfile`; `.dockerignore`; `compose.yaml`; `.env.example`; `README.md`; `docs/ARCHITECTURE.md`; `docs/DEVELOPMENT_PLAN.md`.

**Архитектурные решения:** builder на Go 1.26 создаёт статические бинарники с `CGO_ENABLED=0`, а Alpine runtime добавляет только `ca-certificates`, `tzdata` и непривилегированного пользователя. Отдельный миграционный процесс сохраняет границу ответственности и завершает работу до старта API. Контейнерный `DATABASE_URL` использует Compose DNS `postgres:5432`, тогда как host DSN остаётся прежним. API доступен только через loopback, readiness проверяет БД; application services используют read-only root filesystem, временный `/tmp`, `cap_drop: ALL` и `no-new-privileges`.

**Проверка и критерии готовности:** должны проходить Go test/race/vet/build, `docker compose config --quiet` и реальная сборка образа. Smoke-тест подтверждает `migrate` с кодом `0`, healthy PostgreSQL/API, ответы `200` от `/health` и `/ready`, uid непривилегированного пользователя, наличие tzdata/CA, read-only runtime и корректные логи graceful shutdown после `docker compose stop api`.

**Статус:** принят пользователем после ручной проверки сборки, `migrate` с кодом `0`, healthy PostgreSQL/API, `/health`, `/ready`, работы frontend с контейнерным API и graceful shutdown.

### Frontend container and local reverse proxy foundation

**Цель и границы:** запускать production-сборку Vite вместе с backend одной Compose-командой. Frontend-контейнер раздаёт статические файлы и проксирует `/api` на существующий сервис API; backend, БД, HTTPS, secrets, публикация и CI/CD не меняются.

**Архитектурные решения:** multi-stage `web/Dockerfile` собирает `dist` в Node 22, после чего непривилегированный Nginx слушает внутренний порт `8080`. Compose публикует web только на `127.0.0.1:5173`, запускает его после healthy API и применяет read-only filesystem, `/tmp`, `cap_drop: ALL` и `no-new-privileges`. Относительный `/api` сохраняет единый browser origin, session-cookie, исходный `Origin` и существующую CSRF-защиту. Vite proxy остаётся режимом разработки; одновременно с web-контейнером он не запускается из-за общего host-порта.

**Проверка и критерии готовности:** frontend lint/test/build, стандартные Go-проверки, Compose validation и сборка образов должны пройти. Smoke-тест подтверждает healthy web, `200` для `/`, `401` JSON для анонимного `/api/v1/me` через proxy, прямой `/health`, непривилегированный read-only runtime и передачу session-cookie/Origin. Инкремент считается принятым после браузерной проверки регистрации, входа, восстановления сессии и операций с задачами через `http://localhost:5173`.

**Статус:** принят пользователем после ручной проверки запуска через Docker Compose, регистрации, входа, восстановления сессии и полного набора операций с задачами через единый origin `http://localhost:5173`.

### Container stack smoke-test foundation

**Цель и границы:** заменить повторяемый набор ручных Docker- и HTTP-проверок одной воспроизводимой командой без добавления CI/CD, браузерных E2E-тестов и новых зависимостей.

**Архитектурные решения:** POSIX shell-скрипт валидирует Compose-конфигурацию, собирает и запускает существующий стек, ожидает healthy-состояний и проверяет frontend, прямые API health/readiness, путь `/api` через Nginx, сохранение разрешённого Origin, успешные миграции, непривилегированных пользователей и read-only root filesystem. Порты определяются из Compose, пустой registration payload не создаёт пользователя, а контейнеры и постоянный PostgreSQL volume после проверки остаются на месте.

**Проверка и критерии готовности:** `sh -n scripts/smoke-compose.sh`, `git diff --check`, `docker compose config --quiet` и реальный запуск скрипта должны завершаться успешно. Ошибка любого обязательного сервиса или HTTP-контракта должна давать ненулевой exit code и короткое диагностическое сообщение.

**Статус:** принят пользователем после успешного ручного запуска и сообщения `all container stack smoke checks passed`.
