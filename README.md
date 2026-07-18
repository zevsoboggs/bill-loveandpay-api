# bill-loveandpay-api

Backend биллинга **Love&Pay** — реселлинг платёжных услуг: **СБП (оплата через USDT)** и **PromptPay (тайские QR)**. Депозиты в USDT через CryptoOffice, распределение депозита между системами, релей-API для клиентов, Swagger.

## Стек
Node.js · Express · Prisma · PostgreSQL · node-cron

## Локальный запуск
```bash
cp .env.example .env      # заполни значения
npm install
npm run db:push           # синхронизировать схему
npm run seed              # создать супер-админа
npm start                 # http://localhost:4000
```

## Основные разделы API
- `GET /health` — проверка
- `GET /docs` — Swagger (публичный релей-API `/v1`)
- `POST /api/admin/auth/login` — вход админа (JWT)
- `/api/admin/*` — CRUD для админ-панели (клиенты, депозиты, распределение, транзакции, заявки на карты, ledger)
- `/api/client/*` — кабинет клиента (JWT type=client)
- `/v1/*` — релей для реселлеров: `X-API-Key` + `X-API-Secret` + белый список IP
  - `GET /v1/balance`, `POST /v1/sbp/pay`, `POST /v1/promptpay/pay`, …

## Учёт
Депозит USDT → распределение по системам (SBP / PromptPay) → каждый платёж
списывает `стоимость × (1 + наценка клиента)` с нужного баланса. Полный аудит
в ledger, авто-возврат при ошибке провайдера.

## Деплой
Railway (root = этот репозиторий). Переменные — из `.env.example`, задать в дашборде. Подробности — во внутренней инструкции `DEPLOY.md`.
