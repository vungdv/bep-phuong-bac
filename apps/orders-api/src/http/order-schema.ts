/** JSON Schema for the Order response (B4/B5); shared by every route that returns an order. */
export const orderSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    no: { type: 'integer' },
    name: { type: 'string' },
    qty: { type: 'integer' },
    message: { type: 'string' },
    createdAt: { type: 'string' },
    serviceDate: { type: 'string' },
    delivered: { type: 'boolean' },
  },
  required: ['id', 'no', 'name', 'qty', 'message', 'createdAt', 'serviceDate', 'delivered'],
  additionalProperties: false,
} as const;
