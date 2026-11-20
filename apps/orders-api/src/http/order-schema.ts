/** JSON Schema for the Order response (B4/B5); mirrors components.schemas.Order in openapi.yaml. */
export const orderSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    no: { type: 'integer', minimum: 1 },
    name: { type: 'string' },
    qty: { type: 'integer', minimum: 1 },
    message: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    serviceDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    delivered: { type: 'boolean' },
  },
  required: ['id', 'no', 'name', 'qty', 'message', 'createdAt', 'serviceDate', 'delivered'],
  additionalProperties: false,
} as const;
