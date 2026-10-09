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

Минимальные модели `User` и `Task`, правила времени, аутентификация и REST API согласованы. API предоставляет `GET /health` и `GET /ready`; локальный PostgreSQL и первая миграция `users` добавлены. Продуктовые endpoints ещё не реализованы.

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

## Документы

- [Требования](docs/PROJECT.md)
- [Архитектура](docs/ARCHITECTURE.md)
- [MVP-контракт данных и REST API](docs/API.md)
- [Правила для Codex](AGENTS.md)
- [План и журнал инкрементов](docs/DEVELOPMENT_PLAN.md)
