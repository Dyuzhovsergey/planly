### 1. Получить `csrfToken`

Если cookie уже сохранена в `/tmp/planly-cookie.txt`:

```
curl -s -b /tmp/planly-cookie.txt \
  http://localhost:8080/api/v1/me
```


Если cookie ещё нет, выполните вход:

```
curl -s -c /tmp/planly-cookie.txt \
  -H 'Origin: http://localhost:8080' \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com","password":"ваш-пароль"}' \
  http://localhost:8080/api/v1/auth/login
```



### 2. Получить `taskId`

Запросите список своих задач:

```
curl -s -b /tmp/planly-cookie.txt \
  'http://localhost:8080/api/v1/tasks?from=2026-01-01&to=2027-01-01'
```
