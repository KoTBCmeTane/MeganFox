# Мессенджер (мобильное приложение) — запуск и деплой

Это **мобильное приложение** (Expo React Native) + **сервер WebSocket** (Node.js) для:
- чата
- друзей (заявки по ID)
- сигналинга звонков (WebRTC — позже)

## Запуск локально (для разработки)

### 1) Сервер

```bash
cd messenger-server
npm install
npm run dev
```

Проверка: `http://localhost:8080/health` → `{"ok":true}`

### 2) Приложение

```bash
npm install
npm run start
```

Открой на телефоне через Expo Go.

В приложении: `Настройки → Сервер → WS адрес` и нажми **«Применить адрес»**.

## Онлайн без ПК (бесплатный старт): Fly.io

Это поднимет сервер в интернете, и приложение будет работать **без твоего компьютера**.

## Можно ли “бесплатно через GitHub”?

**GitHub — это место для хранения кода**, а не хостинг постоянно работающего WebSocket‑сервера.
- GitHub Pages — только статические сайты (без Node.js сервера и без WebSocket).
- GitHub Actions — это временные задачи (CI), они не предназначены держать сервер 24/7.

Поэтому схема такая:
- **GitHub**: хранить код/версии проекта
- **Хостинг**: держать сервер онлайн (WebSocket)

### 1) Подготовка
- зарегистрируйся в Fly.io
- поставь CLI `flyctl` (по инструкции Fly.io)
- залогинься:

```bash
fly auth login
```

### 2) Деплой сервера

Перейди в папку сервера:

```bash
cd messenger-server
```

Создай приложение (имя придумай любое уникальное):

```bash
fly launch
```

При создании Fly предложит имя. Потом **обязательно** открой `fly.toml` и замени:

```toml
app = "messenger-server-change-me"
```

на своё реальное имя приложения.

Деплой:

```bash
fly deploy
```

Проверка:
- `https://<app>.fly.dev/health` → `{"ok":true}`

### 3) Подключение приложения к онлайн-серверу

В телефоне поставь:
- `WS адрес`: `wss://<app>.fly.dev`
- нажми **«Применить адрес»**

## Альтернатива с бесплатным тарифом: Cloudflare Workers + Durable Objects

Если захочешь максимум “бесплатно” и без VM, то в 2026 году очень сильный вариант — **Cloudflare Workers**:
- WebSocket соединение поднимается на Worker
- состояние чата/комнат можно хранить в **Durable Objects**
- есть бесплатный тариф (лимиты зависят от плана Cloudflare)

Это требует отдельного сервера (не Node.js `ws`), поэтому я добавил готовую папку `messenger-worker/`.

### Деплой Cloudflare (обычно без карты)
В `messenger-mobile/messenger-worker`:

```bash
npm install
npm run deploy
```

Получишь адрес вида `https://<name>.workers.dev`.

В приложении укажи:
- `WS адрес`: `wss://<name>.workers.dev/ws`

### Если на твоём интернете деплой падает `fetch failed`
Тогда деплой можно делать **через GitHub Actions** (это обходит проблемы роутера/провайдера, потому что деплой идёт с серверов GitHub):
- workflow уже добавлен: `messenger-mobile/.github/workflows/deploy-worker.yml`
- secrets, которые нужно добавить в GitHub репозиторий:
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`

## Сборка APK (чтобы было “как приложение”, не Expo Go)

Это создаст установочный файл **.apk**.

### 1) Поставь EAS CLI

```bash
npm i -g eas-cli
```

### 2) Логин в Expo

```bash
eas login
```

### 3) Сборка APK

```bash
eas build -p android --profile preview
```

После сборки EAS даст ссылку на скачивание APK — установи на телефон.
