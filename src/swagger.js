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
    '/esim/allowed-operators': { get: { tags: ['eSIM'], summary: 'Доступные операторы', responses: { 200: { description: 'OK' } } } },
    '/esim/cancel': {
      post: { tags: ['eSIM'], summary: 'Отменить тариф eSIM', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['iccid'], properties: { iccid: { type: 'string' } } } } } }, responses: { 200: { description: 'OK' } } },
    },
  },
  tags: [
    { name: 'Account', description: 'Баланс и настройки клиента' },
    { name: 'SBP', description: 'СБП — оплата через USDT' },
    { name: 'PromptPay', description: 'Тайские QR коды' },
    { name: 'eSIM', description: 'eSIM (Yesim) — тарифы, выпуск, пополнение' },
  ],
};

export default openapiSpec;
