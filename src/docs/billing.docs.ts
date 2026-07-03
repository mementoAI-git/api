const billingDocs = {
  '/billing/subscription': {
    get: {
      tags: ['Billing'],
      summary: 'Get Subscription Summary',
      description:
        'Retrieve current subscription status, tier, and renewal information',
      security: [{bearerAuth: []}],
      responses: {
        200: {
          description: 'Subscription summary retrieved',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  data: {
                    type: 'object',
                    properties: {
                      tier: {type: 'string', example: 'pro'},
                      status: {type: 'string', example: 'active'},
                      current_period_end: {type: 'string', format: 'date-time'},
                      trial_ends_at: {
                        type: 'string',
                        format: 'date-time',
                        nullable: true,
                      },
                      provider: {type: 'string', example: 'polar'},
                      currency: {type: 'string', example: 'USD'},
                      usage: {
                        type: 'object',
                        properties: {
                          storage_used_bytes: {type: 'number'},
                          storage_limit_bytes: {type: 'number'},
                          beneficiary_count: {type: 'number'},
                          timed_message_count: {type: 'number'},
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  '/billing/usage': {
    get: {
      tags: ['Billing'],
      summary: 'Get Usage Statistics',
      description:
        'Retrieve resource usage against plan limits (e.g., storage, AI messages)',
      security: [{bearerAuth: []}],
      responses: {
        200: {
          description: 'Usage statistics retrieved',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  data: {type: 'object'},
                },
              },
            },
          },
        },
      },
    },
  },
  '/billing/checkout': {
    post: {
      tags: ['Billing'],
      summary: 'Create Checkout Session',
      description: 'Create a Polar checkout session for upgrading subscription',
      security: [{bearerAuth: []}],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['success_url', 'cancel_url'],
              properties: {
                success_url: {type: 'string', format: 'uri'},
                cancel_url: {type: 'string', format: 'uri'},
                tier: {type: 'string', enum: ['free', 'pro', 'legacy']},
                interval: {
                  type: 'string',
                  enum: ['monthly', 'annual', 'lifetime'],
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Checkout session created',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  data: {
                    type: 'object',
                    properties: {
                      checkout_url: {type: 'string', format: 'uri'},
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  '/billing/portal': {
    post: {
      tags: ['Billing'],
      summary: 'Create Customer Portal Session',
      description:
        'Create a Polar customer portal session for managing payments and subscriptions',
      security: [{bearerAuth: []}],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['return_url'],
              properties: {
                return_url: {type: 'string', format: 'uri'},
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Portal session created',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  data: {
                    type: 'object',
                    properties: {
                      portal_url: {type: 'string', format: 'uri'},
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  '/billing/promo/redeem': {
    post: {
      tags: ['Billing'],
      summary: 'Redeem Promo Code',
      description: 'Redeem a promotional or referral code',
      security: [{bearerAuth: []}],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['code'],
              properties: {
                code: {type: 'string', minLength: 1},
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Promo code redeemed',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {type: 'string'},
                },
              },
            },
          },
        },
      },
    },
  },
  '/billing/invoices': {
    get: {
      tags: ['Billing'],
      summary: 'List Invoices',
      description: 'Retrieve a list of past invoices/receipts',
      security: [{bearerAuth: []}],
      responses: {
        200: {
          description: 'Invoices retrieved',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  data: {type: 'array', items: {type: 'object'}},
                },
              },
            },
          },
        },
      },
    },
  },
  '/billing/cancel': {
    post: {
      tags: ['Billing'],
      summary: 'Cancel Subscription',
      description:
        'Cancel the active subscription at the end of the current period',
      security: [{bearerAuth: []}],
      responses: {
        200: {
          description: 'Subscription cancellation scheduled',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {type: 'string'},
                },
              },
            },
          },
        },
      },
    },
  },
  '/billing/resume': {
    post: {
      tags: ['Billing'],
      summary: 'Resume Subscription',
      description: 'Resume a subscription that was scheduled for cancellation',
      security: [{bearerAuth: []}],
      responses: {
        200: {
          description: 'Subscription resumed',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {type: 'string'},
                },
              },
            },
          },
        },
      },
    },
  },
};

export default billingDocs;
