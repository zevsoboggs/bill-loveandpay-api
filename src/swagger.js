import config from './config.js';

// OpenAPI 3.0 spec for the public reseller relay API (/v1/*).
export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Love&Pay — Payments API for Partners',
    version: '1.0.0',
    description:
      'Платёжная инфраструктура для бизнеса. Единый API для приёма и проведения платежей через ' +
      '**СБП** (расчёты в USDT) и **PromptPay** (QR-платежи Таиланда) — без прямых интеграций с каждым провайдером.\n\n' +
      '### Модель работы\n' +
      '- **Единый депозит в USDT** — партнёр пополняет баланс в стейблкоине.\n' +
      '- **Распределение по направлениям** — средства аллоцируются между СБП и PromptPay.\n' +
      '- **Прозрачное ценообразование** — каждая операция списывает себестоимость + вашу партнёрскую ставку с баланса соответствующего направления.\n' +
      '- **Полный учёт** — все операции фиксируются в леджере и доступны в личном кабинете партнёра.\n\n' +
      '### Аутентификация и безопасность\n' +
      'Доступ по ключам `X-API-Key` и `X-API-Secret`, передаваемым в заголовках запроса. ' +
      'Запросы принимаются только с IP-адресов из белого списка партнёра (IP allowlist).\n\n' +
      '### Идемпотентность\n' +
      'Для платёжных запросов (`/*/pay`, `/esim/issue`, `/esim/topup`, `/vpn/buy`) передавайте заголовок ' +
      '`Idempotency-Key` (уникальную строку). Повторный запрос с тем же ключом и телом вернёт **тот же результат** ' +
      '(ответ придёт с заголовком `Idempotency-Replayed: true`) — защита от двойного списания при ретраях.\n\n' +
      '### Sandbox (тестовый режим)\n' +
      'У каждого партнёра есть **отдельная пара sandbox-ключей** (см. кабинет → API-доступ). ' +
      'Запросы с sandbox-ключами **симулируются**: реального списания и провижининга нет, IP-ограничение не применяется. ' +
      'Ответы помечены `"sandbox": true`. Идеально для интеграции без трат.\n\n' +
      '### Подключение\n' +
      'Выпуск ключей, лимиты, ставки и индивидуальные условия — через вашего менеджера Love&Pay.',
    contact: { name: 'Love&Pay Partners', url: 'https://bill.loveandpay.io' },
  },
  servers: [{ url: `${config.publicBaseUrl}/v1`, description: 'Relay API' }],
  security: [{ ApiKeyAuth: [], ApiSecretAuth: [] }],
  components: {
    securitySchemes: {
      ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      ApiSecretAuth: { type: 'apiKey', in: 'header', name: 'X-API-Secret' },
    },
    schemas: {
      Balance: {
        type: 'object',
        properties: {
          clientId: { type: 'string' }, name: { type: 'string' }, currency: { type: 'string', example: 'USDT' },
          balances: { type: 'object', properties: { deposit: { type: 'number' }, sbp: { type: 'number' }, promptpay: { type: 'number' } } },
          margins: { type: 'object', properties: { sbp: { type: 'number' }, promptpay: { type: 'number' } } },
          depositAddress: { type: 'string', nullable: true }, depositNetwork: { type: 'string', nullable: true },
        },
      },
      Error: { type: 'object', properties: { error: { type: 'string' }, code: { type: 'string' } } },
    },
  },
  paths: {
    '/balance': {
      get: {
        tags: ['Account'], summary: 'Текущие балансы и наценки клиента',
        responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Balance' } } } }, 401: { description: 'Не авторизован' } },
      },
    },
    '/sbp/rate': { get: { tags: ['SBP'], summary: 'Курс USDT/RUB', responses: { 200: { description: 'OK' } } } },
    '/sbp/quote': {
      post: {
        tags: ['SBP'], summary: 'Расчёт стоимости по QR (без списания)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['qrData'], properties: { qrData: { type: 'string', description: 'Ссылка/данные СБП QR' } } } } } },
        responses: { 200: { description: 'Сумма в USDT с наценкой' }, 400: { description: 'Bad request' } },
      },
    },
    '/sbp/pay': {
      post: {
        tags: ['SBP'], summary: 'Оплатить СБП QR (списание с SBP-баланса)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['qrData'], properties: { qrData: { type: 'string' } } } } } },
        responses: {
          200: { description: 'Оплачено' },
          402: { description: 'Недостаточно средств', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          502: { description: 'Ошибка провайдера, средства возвращены' },
        },
      },
    },
    '/sbp/payment/{id}': {
      get: { tags: ['SBP'], summary: 'Статус СБП-транзакции', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'OK' }, 404: { description: 'Not found' } } },
    },
    '/promptpay/rate': { get: { tags: ['PromptPay'], summary: 'Курс USDT/THB', responses: { 200: { description: 'OK' } } } },
    '/promptpay/calculate': {
      post: {
        tags: ['PromptPay'], summary: 'Расчёт стоимости (без списания)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['amountThb'], properties: { amountThb: { type: 'number' } } } } } },
        responses: { 200: { description: 'Сумма в USDT с наценкой' } },
      },
    },
    '/promptpay/scan': {
      post: {
        tags: ['PromptPay'], summary: 'Разбор тайского QR',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['qrData'], properties: { qrData: { type: 'string' } } } } } },
        responses: { 200: { description: 'OK' } },
      },
    },
    '/promptpay/pay': {
      post: {
        tags: ['PromptPay'], summary: 'Оплатить тайский QR (списание с PromptPay-баланса)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['qrData'], properties: { qrData: { type: 'string' }, amountThb: { type: 'number', description: 'Обязательно для статических QR' } } } } } },
        responses: { 200: { description: 'Оплачено / в обработке' }, 402: { description: 'Недостаточно средств' }, 502: { description: 'Ошибка провайдера, средства возвращены' } },
      },
    },
    '/promptpay/receipt/{ppTxId}': {
      get: { tags: ['PromptPay'], summary: 'Получить чек/слип', parameters: [{ name: 'ppTxId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'OK' }, 409: { description: 'Чек ещё не готов' } } },
    },
    '/promptpay/slip/{ppTxId}': {
      get: { tags: ['PromptPay'], summary: 'Изображение слипа (jpeg)', parameters: [{ name: 'ppTxId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'image/jpeg' } } },
    },
    '/esim/plans': {
      get: {
        tags: ['eSIM'], summary: 'Каталог тарифов eSIM с ценой в USDT',
        parameters: [
          { name: 'country', in: 'query', schema: { type: 'string' }, description: 'ISO2 или название страны' },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { 200: { description: 'Список тарифов (priceUsdt = цена с вашей ставкой)' } },
      },
    },
    '/esim/plans/{id}': {
      get: { tags: ['eSIM'], summary: 'Тариф по id (с ценой USDT)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'OK' }, 404: { description: 'Not found' } } },
    },
    '/esim/issue': {
      post: {
        tags: ['eSIM'], summary: 'Выпустить eSIM (списание с eSIM-баланса)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['planId'], properties: { planId: { type: 'string' }, count: { type: 'integer', default: 1 } } } } } },
        responses: { 200: { description: 'eSIM(ы) с ICCID и QR' }, 402: { description: 'Недостаточно средств' }, 502: { description: 'Ошибка провайдера, средства возвращены' } },
      },
    },
    '/esim/topup': {
      post: {
        tags: ['eSIM'], summary: 'Пополнить существующий eSIM тарифом',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['iccid', 'planId'], properties: { iccid: { type: 'string' }, planId: { type: 'string' } } } } } },
        responses: { 200: { description: 'OK' }, 402: { description: 'Недостаточно средств' } },
      },
    },
    '/esim/my': { get: { tags: ['eSIM'], summary: 'Мои выпущенные eSIM', responses: { 200: { description: 'OK' } } } },
    '/esim/sim/{iccid}': { get: { tags: ['eSIM'], summary: 'Статус eSIM (sim_info)', parameters: [{ name: 'iccid', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'OK' } } } },
    '/esim/orders': { get: { tags: ['eSIM'], summary: 'Заказы eSIM', responses: { 200: { description: 'OK' } } } },
    '/esim/supported-devices': { get: { tags: ['eSIM'], summary: 'Поддерживаемые устройства', responses: { 200: { description: 'OK' } } } },
    '/esim/cancel': {
      post: { tags: ['eSIM'], summary: 'Отменить тариф eSIM', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['iccid'], properties: { iccid: { type: 'string' } } } } } }, responses: { 200: { description: 'OK' } } },
    },
    '/vpn/locations': { get: { tags: ['VPN'], summary: 'Локации VPN + цена', responses: { 200: { description: 'rf[], ru[], world[], priceUsdt, durationDays' } } } },
    '/vpn/buy': {
      post: {
        tags: ['VPN'], summary: 'Купить VPN-ключ (списание с VPN-баланса)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { locationId: { type: 'integer', description: 'ID локации (VLESS)' }, rfHost: { type: 'string', description: 'Хост RF-сервера (Shadowsocks, для РФ)' } } } } } },
        responses: { 200: { description: 'Ключ (config + QR) + срок' }, 402: { description: 'Недостаточно средств' }, 502: { description: 'Ошибка провайдера, средства возвращены' } },
      },
    },
    '/vpn/my': { get: { tags: ['VPN'], summary: 'Мои VPN-ключи', responses: { 200: { description: 'OK' } } } },
    '/vpn/{id}/ovpn': { get: { tags: ['VPN'], summary: 'OpenVPN-конфиг ключа', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'proto', in: 'query', schema: { type: 'string', enum: ['tcp', 'udp', 'udp_ru'] } }], responses: { 200: { description: 'OK' } } } },
    '/aml/price': { get: { tags: ['AML'], summary: 'Цена одной проверки', responses: { 200: { description: '{ pricePerCheck, currency, networks[] }' } } } },
    '/aml/check': {
      post: {
        tags: ['AML'], summary: 'Проверить адрес (списание с AML-баланса, 0.5 USDT)',
        description: 'Проверяет адрес TRON / Ethereum / Bitcoin (сеть определяется автоматически) и возвращает риск-отчёт. PDF доступен по ссылке `reportUrl`. При сбое провайдера средства возвращаются.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['address'], properties: { address: { type: 'string', example: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' } } } } } },
        responses: { 200: { description: '{ check, result:{score,riskLevel,verdict,flags,recommendations}, reportUrl }' }, 400: { description: 'Некорректный адрес' }, 402: { description: 'Недостаточно средств на AML-балансе' }, 502: { description: 'AML-сервис недоступен, средства возвращены' } },
      },
    },
    '/aml/checks': { get: { tags: ['AML'], summary: 'История проверок', parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }], responses: { 200: { description: 'OK' } } } },
    '/aml/checks/{id}': { get: { tags: ['AML'], summary: 'Одна проверка', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'OK' }, 404: { description: 'Not found' } } } },
    '/aml/checks/{id}/report': { get: { tags: ['AML'], summary: 'PDF-отчёт по проверке (без списания)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'application/pdf' }, 404: { description: 'Not found' } } } },
    '/transit/networks': { get: { tags: ['Transit'], summary: 'Доступные сети/монеты', responses: { 200: { description: 'TRON/BSC/ETH/BTC + id монет' } } } },
    '/transit/wallets': {
      get: { tags: ['Transit'], summary: 'Мои транзитные кошельки', parameters: [{ name: 'balances', in: 'query', schema: { type: 'integer' }, description: '1 — с балансами' }], responses: { 200: { description: 'OK' } } },
      post: {
        tags: ['Transit'], summary: 'Выпустить транзитный кошелёк',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['network'], properties: { network: { type: 'string', enum: ['tron', 'bsc', 'eth', 'btc'] }, label: { type: 'string' } } } } } },
        responses: { 200: { description: 'Кошелёк (id, address, network)' } },
      },
    },
    '/transit/wallets/{id}': { get: { tags: ['Transit'], summary: 'Кошелёк + баланс', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'OK' }, 404: { description: 'Not found' } } } },
    '/transit/wallets/{id}/balance': { get: { tags: ['Transit'], summary: 'Только баланс', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'OK' } } } },
    '/transit/wallets/{id}/transfer': {
      post: {
        tags: ['Transit'], summary: 'Перевод наружу с кошелька',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['toAddress', 'amount'], properties: { coin: { type: 'integer', description: '1 = USDT-TRC20' }, toAddress: { type: 'string' }, amount: { type: 'number' } } } } } },
        responses: { 200: { description: 'OK' } },
      },
    },
    '/transit/wallets/{id}/rename': { post: { tags: ['Transit'], summary: 'Переименовать кошелёк', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { label: { type: 'string' } } } } } }, responses: { 200: { description: 'OK' } } } },
    '/webhook': {
      get: { tags: ['Webhooks'], summary: 'Текущая конфигурация вебхука', responses: { 200: { description: 'url, enabled, secret, events[]' } } },
      put: {
        tags: ['Webhooks'], summary: 'Задать URL, события и включить/выключить вебхук',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { url: { type: 'string', example: 'https://your-app.com/webhooks/loveandpay' }, enabled: { type: 'boolean' }, events: { type: 'array', items: { type: 'string' }, description: 'Подписка на события. Пустой массив = все события.', example: ['payment.completed', 'deposit.credited'] } } } } } },
        responses: { 200: { description: 'Обновлено (url, enabled, secret, events[], subscribedEvents[])' }, 400: { description: 'Некорректный URL' } },
      },
    },
    '/webhook/test': {
      post: { tags: ['Webhooks'], summary: 'Отправить тестовое событие на ваш URL', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { event: { type: 'string', description: 'Опционально: конкретное событие с реалистичным примером payload', example: 'payment.completed' } } } } } }, responses: { 200: { description: 'Доставлено (httpStatus вашего эндпоинта)' }, 400: { description: 'URL не задан или недоступен' } } },
    },
    '/webhook/rotate-secret': {
      post: { tags: ['Webhooks'], summary: 'Перевыпустить секрет подписи', responses: { 200: { description: '{ secret }' } } },
    },
    '/webhook/deliveries': {
      get: { tags: ['Webhooks'], summary: 'Журнал доставок вебхуков', responses: { 200: { description: 'Последние доставки со статусами' } } },
    },
  },
  tags: [
    { name: 'Account', description: 'Баланс и настройки клиента' },
    { name: 'SBP', description: 'СБП — оплата через USDT' },
    { name: 'PromptPay', description: 'Тайские QR коды' },
    { name: 'eSIM', description: 'eSIM — тарифы, выпуск, пополнение' },
    { name: 'VPN', description: 'VPN — локации, покупка ключей (VLESS/Shadowsocks), OpenVPN' },
    { name: 'AML', description: 'AML — проверка адресов (TRON/ETH/BTC) на риски + PDF-отчёт. 0.5 USDT за проверку.' },
    { name: 'Transit', description: 'Транзитные крипто-кошельки — выпуск, балансы, переводы (TRON/BSC/ETH/BTC)' },
    {
      name: 'Webhooks',
      description:
        'Уведомления о событиях на ваш эндпоинт (HTTP POST, JSON).\n\n' +
        '**События:** `deposit.credited` (зачислен депозит), `payment.completed` / `payment.failed` (оплата СБП/PromptPay/eSIM/VPN), `esim.issued` (выпущена eSIM), `vpn.issued` (выпущен VPN-ключ), `aml.checked` (выполнена AML-проверка), `webhook.test` (тест).\n\n' +
        '**Подписка на события:** по умолчанию приходят все события. Через `PUT /webhook` можно передать `events: [...]` — тогда придут только выбранные. Конструктор с чекбоксами и отправкой тестов по каждому событию доступен в кабинете (раздел «API-доступ»).\n\n' +
        '**Формат тела:**\n```json\n{\n  "id": "evt_…",\n  "event": "payment.completed",\n  "created": "2026-07-19T12:00:00.000Z",\n  "data": { "system": "SBP", "transactionId": "…", "amountUsdt": 12.34, "sourceAmount": 1000, "sourceCurrency": "RUB" }\n}\n```\n\n' +
        '**Заголовки:** `X-LnP-Event` — тип события; `X-LnP-Signature` — подпись вида `sha256=<hex>`.\n\n' +
        '**Проверка подписи:** `HMAC-SHA256(secret, rawBody)` должно совпасть с `X-LnP-Signature`. Секрет — в конфигурации вебхука (GET `/webhook`).\n\n' +
        'Отвечайте `2xx` для подтверждения. При ошибке — до 3 повторов. Настроить URL можно в кабинете (API-доступ) или через `PUT /webhook`.',
    },
  ],
};

export default openapiSpec;
