# Planly

Planly — многопользовательское веб-приложение для планирования задач в календаре.

## Концепция

Основной интерфейс — календарь с представлениями **месяц / неделя / день**. Пользователь может вручную создавать, изменять, просматривать и завершать задачи, привязанные к дате и времени. В перспективе — управление через навык Яндекс Алисы.

## Выбранный стек

- Backend: Go, REST API.
- Database: PostgreSQL.
- Frontend: React, TypeScript, Vite, Tailwind CSS, shadcn/ui.
- Calendar: специализированную библиотеку выберем после сравнения вариантов.
- Локальная разработка и развёртывание: Docker Compose.
- Продакшен: веб-доступ через HTTPS; конкретный хостинг и прокси ещё не выбраны.

**Важно:** Planly — веб-приложение. Отдельный Linux desktop-клиент и Tauri не планируются.

## Статус

Минимальные модели `User` и `Task`, правила времени, аутентификация и REST API согласованы. API предоставляет диагностику, регистрацию, вход, получение и изменение часовой зоны текущего пользователя через `/api/v1/me`, выход, защищённое создание timed/all-day задач через `POST /api/v1/tasks`, получение одной своей задачи через `GET /api/v1/tasks/{id}`, список задач календарного диапазона через `GET /api/v1/tasks?from=&to=` и изменение `title`, `description`, `schedule` или статуса завершения через `PATCH /api/v1/tasks/{id}`. Удаление задач и frontend ещё не реализованы.

## Локальный запуск

Требуются Go 1.26 или новее и Docker с Docker Compose.

```bash
cp .env.example .env
docker compose up -d postgres
set -a; source .env; set +a
go run ./cmd/migrate up
go run ./cmd/api
```

PostgreSQL использует именованный Docker volume, поэтому данные сохраняются после остановки контейнера. Команда миграции идемпотентна: повторный запуск не применяет уже выполненные миграции заново.

По умолчанию API слушает `:8080`. Адрес можно изменить переменной окружения `HTTP_ADDR`.

Проверка процесса и готовности PostgreSQL:

```bash
curl -i http://localhost:8080/health
curl -i http://localhost:8080/ready
```

Оба запроса возвращают `200 OK` и:

```json
{"status":"ok"}
```

Если PostgreSQL недоступен, `/health` остаётся успешным, а `/ready` возвращает `503 Service Unavailable` в формате `application/problem+json`.

### Проверка аутентификации

`APP_ORIGIN` определяет единственный разрешённый browser origin. Для локальной проверки он равен `http://localhost:8080`.

Регистрация с сохранением cookie в файл:

```bash
curl -i -c /tmp/planly-cookie.txt \
  -H 'Origin: http://localhost:8080' \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com","password":"correct horse battery staple","timeZone":"Europe/Moscow"}' \
  http://localhost:8080/api/v1/auth/register
```

Ответ содержит публичного пользователя и `csrfToken`.

Проверка текущей сессии и получение актуального CSRF-токена:

```bash
curl -i -b /tmp/planly-cookie.txt http://localhost:8080/api/v1/me
```

`GET /api/v1/me` возвращает публичного пользователя и детерминированный для текущей сессии `csrfToken`.

Изменение часовой зоны текущего пользователя:

```bash
curl -i -b /tmp/planly-cookie.txt \
  -H 'Origin: http://localhost:8080' \
  -H 'X-CSRF-Token: <csrfToken>' \
  -H 'Content-Type: application/json' \
  -X PATCH \
  -d '{"timeZone":"Asia/Tokyo"}' \
  http://localhost:8080/api/v1/me
```

Успешный ответ содержит обновлённого пользователя и тот же `csrfToken`.

Создание timed-задачи с `csrfToken` из ответа регистрации, входа или `GET /api/v1/me`:

```bash
curl -i -b /tmp/planly-cookie.txt \
  -H 'Origin: http://localhost:8080' \
  -H 'X-CSRF-Token: <csrfToken>' \
  -H 'Content-Type: application/json' \
  -d '{"title":"Позвонить врачу","schedule":{"type":"timed","at":"2026-10-14T18:30:00+03:00"}}' \
  http://localhost:8080/api/v1/tasks
```

Успешный ответ имеет статус `201 Created`, не содержит `userId` и возвращает точный момент в UTC.

Получение созданной задачи по её `id` требует только session-cookie:

```bash
curl -i -b /tmp/planly-cookie.txt \
  http://localhost:8080/api/v1/tasks/<taskId>
```

Своя задача возвращается с `200 OK`. Отсутствующая, чужая задача и идентификатор не в UUID-формате возвращают одинаковый `404 task_not_found`; `Origin` и CSRF для безопасного `GET` не требуются.

Получение своих задач за календарный диапазон также требует только session-cookie:

```bash
curl -i -b /tmp/planly-cookie.txt \
  'http://localhost:8080/api/v1/tasks?from=2026-10-01&to=2026-11-01'
```

`from` включается, `to` не включается. Обе границы задаются как `YYYY-MM-DD` в текущей IANA-таймзоне пользователя; максимальная длина диапазона — 366 дней. Ответ имеет вид `{"items":[]}` и не содержит `userId`.

Частичное изменение задачи требует допустимые Origin, session-cookie и CSRF-токен:

```bash
curl -i -b /tmp/planly-cookie.txt \
  -H 'Origin: http://localhost:8080' \
  -H 'X-CSRF-Token: <csrfToken>' \
  -H 'Content-Type: application/json' \
  -X PATCH \
  -d '{"title":"Обновлённая задача","description":""}' \
  http://localhost:8080/api/v1/tasks/<taskId>
```

Можно передать одно или несколько полей `title`, `description`, `schedule` и `completed`; пустая строка очищает описание, а `schedule` заменяется целиком. `completed: true` завершает задачу, `completed: false` открывает её повторно. Повторное применение того же статуса не изменяет `completedAt` и `updatedAt`. Успешный ответ `200 OK` содержит обновлённую публичную Task без `userId`.

Для выхода подставьте текущий `csrfToken`:

```bash
curl -i -b /tmp/planly-cookie.txt \
  -H 'Origin: http://localhost:8080' \
  -H 'X-CSRF-Token: <csrfToken>' \
  -X POST http://localhost:8080/api/v1/auth/logout
```

В локальном HTTP-режиме используется cookie `planly_session`. При `COOKIE_SECURE=true` API использует production-cookie `__Host-planly_session` с атрибутом `Secure`.

Остановка локальных сервисов без удаления данных:

```bash
docker compose stop
```

Автоматические проверки:

```bash
go test ./...
go vet ./...
go build ./...
docker compose config --quiet
```

Интеграционные repository-тесты после запуска PostgreSQL и миграций:

```bash
PLANLY_TEST_DATABASE_URL="$DATABASE_URL" go test ./internal/platform/postgres -run Integration
```

## Документы

- [Требования](docs/PROJECT.md)
- [Архитектура](docs/ARCHITECTURE.md)
- [MVP-контракт данных и REST API](docs/API.md)
- [Правила для Codex](AGENTS.md)
- [План и журнал инкрементов](docs/DEVELOPMENT_PLAN.md)
