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
                      cancel_at_period_end: {type: 'boolean'},
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
                          storage_reserved_bytes: {type: 'number'},
                          storage_limit_bytes: {type: 'number'},
                          remaining_bytes: {type: 'number'},
                          percent_used: {type: 'number'},
                          over_limit: {type: 'boolean'},
                          beneficiary_count: {type: 'number'},
                          timed_message_count: {type: 'number'},
                          time_capsule_count: {type: 'number'},
                          memory_integration_count: {type: 'number'},
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
                  data: {
                    type: 'object',
                    properties: {
                      storage_used_bytes: {type: 'number'},
                      storage_reserved_bytes: {type: 'number'},
                      storage_limit_bytes: {type: 'number'},
                      remaining_bytes: {type: 'number'},
                      percent_used: {type: 'number'},
                      over_limit: {type: 'boolean'},
                      beneficiary_count: {type: 'number'},
                      timed_message_count: {type: 'number'},
                      time_capsule_count: {type: 'number'},
                      memory_integration_count: {type: 'number'},
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
  '/billing/iap/verify': {
    post: {
      tags: ['Billing'],
      summary: 'Verify a native store subscription',
      description:
        'Cryptographically verifies an Apple StoreKit transaction or queries Google Play, atomically claims its subscription chain for the authenticated account, and projects the resulting entitlement. Replays by the same account are idempotent.',
      security: [{bearerAuth: []}],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['platform', 'productId', 'transactionId'],
              properties: {
                platform: {type: 'string', enum: ['ios', 'android']},
                productId: {type: 'string', minLength: 1},
                transactionId: {
                  type: 'string',
                  minLength: 1,
                  description:
                    'Client transaction identifier for diagnostics; the verified provider identifier is authoritative.',
                },
                receiptData: {
                  type: 'string',
                  description: 'StoreKit signed transaction or legacy receipt.',
                },
                purchaseToken: {
                  type: 'string',
                  description:
                    'Google Play purchase token or StoreKit signed transaction.',
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Store entitlement verified and durably applied',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {type: 'string'},
                  data: {
                    type: 'object',
                    properties: {
                      success: {type: 'boolean'},
                      tier: {type: 'string', enum: ['free', 'pro', 'legacy']},
                      status: {
                        type: 'string',
                        enum: [
                          'active',
                          'trialing',
                          'past_due',
                          'cancelled',
                          'paused',
                        ],
                      },
                      expiresAt: {type: 'string', format: 'date-time'},
                    },
                  },
                },
              },
            },
          },
        },
        400: {
          description:
            'Invalid product, receipt, or subscription ownership conflict',
        },
        401: {description: 'Store verification failed'},
        503: {description: 'Store verification provider unavailable'},
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
                  data: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: {type: 'string'},
                        url: {type: 'string', format: 'uri'},
                        label: {type: 'string'},
                        created_at: {type: 'string', format: 'date-time'},
                        amount: {type: 'number'},
                        currency: {type: 'string'},
                        status: {type: 'string'},
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
