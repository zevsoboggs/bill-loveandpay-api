import config from './config.js';

// OpenAPI 3.0 spec for the public reseller relay API (/v1/*).
export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Love&Pay Billing — Reseller API',
    version: '1.0.0',
    description:
      'Реселлинг платёжных услуг: СБП (оплата через USDT) и PromptPay (тайские QR).\n\n' +
      'Депозит вносится в USDT, распределяется администратором между системами СБП и PromptPay. ' +
      'Каждый запрос списывает стоимость услуги + вашу наценку с соответствующего баланса.\n\n' +
      '**Авторизация:** заголовки `X-API-Key` и `X-API-Secret`. Вызовы разрешены только с IP из белого списка.',
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
  },
  tags: [
    { name: 'Account', description: 'Баланс и настройки клиента' },
    { name: 'SBP', description: 'СБП — оплата через USDT' },
    { name: 'PromptPay', description: 'Тайские QR коды' },
  ],
};

export default openapiSpec;
