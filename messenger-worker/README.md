## messenger-worker (Cloudflare Workers + Durable Objects)

Это версия сервера для **онлайн‑работы без твоего ПК** на Cloudflare Workers.

### Что умеет
- WebSocket + протокол как в `messenger-server/index.js`:
  - `hello`, `join`, `chat:message`
  - `friends:list`, `friends:request`, `friends:accept`
  - `call:invite|accept|reject|hangup`
  - `signal` (offer/answer/ice)

### Быстрый старт
1) Установи Wrangler:

```bash
npm i -g wrangler
```

2) Войти в Cloudflare (обычно без карты):

```bash
wrangler login
```

3) Запуск локально:

```bash
cd messenger-worker
npm install
npm run dev
```

4) Деплой:

```bash
npm run deploy
```

После деплоя ты получишь адрес вида:
- `https://<project>.workers.dev`

В приложении укажи:
- `WS адрес`: `wss://<project>.workers.dev/ws`

## Если у тебя `fetch failed` (ECONNRESET) при деплое

Это значит, что твоё соединение с `api.cloudflare.com` **обрывается** (провайдер/роутер/антивирус/фильтрация).
В таком случае самый простой обход — **деплоить через GitHub Actions** (деплой пойдёт с серверов GitHub, а не с твоего интернета).

### Деплой через GitHub Actions (без карты)
1) Создай репозиторий на GitHub и запушь туда проект.
2) В репозитории открой **Settings → Secrets and variables → Actions** и добавь secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
3) Команда для создания токена в Cloudflare: **My Profile → API Tokens → Create Token** (выдай права на Workers).
4) После пуша в ветку `main` workflow `Deploy messenger-worker` сам задеплоит воркер.

