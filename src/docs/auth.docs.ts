const authDocs = {
  '/auth/recovery/send-code': {
    post: {
      tags: ['Auth'],
      summary: 'Send password recovery code',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email'],
              properties: {email: {type: 'string', format: 'email'}},
            },
          },
        },
      },
      responses: {
        '200': {
          description:
            'Generic send acknowledgement with email and resend_after (60 seconds)',
        },
        '400': {description: 'Invalid or expired code'},
        '422': {description: 'Invalid input'},
        '429': {description: 'Rate limited'},
      },
    },
  },
  '/auth/recovery/verify-code': {
    post: {
      tags: ['Auth'],
      summary: 'Exchange recovery code for a reset token',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email', 'code'],
              properties: {
                email: {type: 'string', format: 'email'},
                code: {type: 'string', pattern: '^[0-9]{6}$'},
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description:
            'Verified; data.token is a single-use reset UUID expiring in ten minutes',
        },
        '400': {description: 'Invalid or expired code'},
        '422': {description: 'Invalid input'},
        '429': {description: 'Rate limited'},
      },
    },
  },

  '/auth/oauth/{provider}': {
    get: {
      tags: ['Auth'],
      summary: 'Generate OAuth URL',
      description:
        'Generate OAuth authorization URL for the specified provider (google, facebook, apple)',
      parameters: [
        {
          name: 'provider',
          in: 'path',
          required: true,
          description: 'OAuth provider name',
          schema: {
            type: 'string',
            enum: ['google', 'facebook', 'apple'],
            example: 'google',
          },
        },
      ],
      responses: {
        200: {
          description: 'OAuth URL generated successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'OAuth url generated successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      url: {
                        type: 'string',
                        example:
                          'https://accounts.google.com/o/oauth2/auth?client_id=...',
                      },
                    },
                  },
                },
              },
            },
          },
        },
        400: {
          description: 'Invalid provider',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
      },
    },
    post: {
      tags: ['Auth'],
      summary: 'OAuth Authorization',
      description:
        'Complete OAuth authorization flow using the authorization code from the provider',
      parameters: [
        {
          name: 'provider',
          in: 'path',
          required: true,
          description: 'OAuth provider name',
          schema: {
            type: 'string',
            enum: ['google', 'facebook', 'apple'],
            example: 'google',
          },
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['code'],
              properties: {
                referral_code: {
                  type: 'string',
                  pattern: '^[a-f0-9]{32}$',
                  description:
                    'Optional personal invite code; new accounts only',
                },
                code: {
                  type: 'string',
                  description: 'Authorization code from OAuth provider',
                  example: '4/0AeanS...',
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'User authenticated successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'User signin is successful',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      access_token: {
                        type: 'string',
                        example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
                      },
                      refresh_token: {
                        type: 'string',
                        example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
                      },
                    },
                  },
                },
              },
            },
          },
        },
        400: {
          description: 'Invalid authorization code or account deleted',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
        401: {
          description: 'Unauthorized',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
      },
    },
  },
  '/auth/login': {
    post: {
      tags: ['Auth'],
      summary: 'User Login',
      description:
        'Authenticate user with email and password. Returns JWT tokens for accessing protected endpoints.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email', 'password'],
              properties: {
                email: {
                  type: 'string',
                  format: 'email',
                  description: 'User email address',
                  example: 'user@example.com',
                },
                password: {
                  type: 'string',
                  format: 'password',
                  description: 'User password',
                  example: 'SecurePassword123!',
                },
                remember_for_30_days: {
                  type: 'boolean',
                  description:
                    'If true, access token expires in 30 days instead of 7 days',
                  default: false,
                  example: false,
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Login successful',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {type: 'string', example: 'Login successful'},
                  data: {
                    type: 'object',
                    properties: {
                      access_token: {
                        type: 'string',
                        example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
                      },
                      refresh_token: {
                        type: 'string',
                        example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
                      },
                    },
                  },
                },
              },
            },
          },
        },
        400: {
          description:
            'Invalid credentials, account deleted, or email not verified',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  {$ref: '#/components/schemas/Error'},
                  {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          requires_verification: {
                            type: 'boolean',
                            example: true,
                          },
                          email: {
                            type: 'string',
                            example: 'user@example.com',
                          },
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
        404: {
          description: 'User not found',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
      },
    },
  },
  '/auth/register': {
    post: {
      tags: ['Auth'],
      summary: 'User Registration',
      description:
        'Register a new user account with optional personal invite attribution.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email', 'password', 'first_name', 'last_name'],
              properties: {
                referral_code: {
                  type: 'string',
                  pattern: '^[a-f0-9]{32}$',
                  description: 'Optional personal invite code',
                },
                email: {
                  type: 'string',
                  format: 'email',
                  description: 'User email address',
                  example: 'user@example.com',
                },
                password: {
                  type: 'string',
                  format: 'password',
                  description:
                    'Strong password (must meet strength requirements)',
                  example: 'SecurePassword123!',
                },
                first_name: {
                  type: 'string',
                  description: 'User first name',
                  example: 'John',
                },
                last_name: {
                  type: 'string',
                  description: 'User last name',
                  example: 'Doe',
                },
                invite_code: {
                  type: 'string',
                  description: '6-digit numeric invite code',
                  pattern: '^[0-9]{6}$',
                  example: '123456',
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Registration successful',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {type: 'string', example: 'Registration successful'},
                  data: {
                    type: 'object',
                    properties: {
                      access_token: {
                        type: 'string',
                        example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
                      },
                      refresh_token: {
                        type: 'string',
                        example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
                      },
                    },
                  },
                },
              },
            },
          },
        },
        400: {
          description: 'Validation error or invalid invite code',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
      },
    },
  },
  '/auth/send-link': {
    post: {
      tags: ['Auth'],
      summary: 'Send Verification/Reset Link',
      description:
        'Send email verification or password reset link to user email address',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email', 'type'],
              properties: {
                email: {
                  type: 'string',
                  format: 'email',
                  description: 'User email address',
                  example: 'user@example.com',
                },
                type: {
                  type: 'string',
                  enum: ['reset', 'verify'],
                  description: 'Type of link to send',
                  default: 'reset',
                  example: 'reset',
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Link sent successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {type: 'string', example: 'Link sent successfully'},
                  data: {
                    type: 'object',
                    properties: {
                      code: {
                        type: 'string',
                        format: 'uuid',
                        example: '550e8400-e29b-41d4-a716-446655440000',
                      },
                      expires_at: {
                        type: 'string',
                        format: 'date-time',
                        example: '2024-01-01T12:00:00.000Z',
                      },
                    },
                  },
                },
              },
            },
          },
        },
        400: {
          description: 'Validation error',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
      },
    },
  },
  '/auth/verify-email': {
    post: {
      tags: ['Auth'],
      summary: 'Verify Email Address',
      description:
        'Verify user email address using the verification token sent via email',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['token'],
              properties: {
                token: {
                  type: 'string',
                  format: 'uuid',
                  description: 'Verification token from email',
                  example: '550e8400-e29b-41d4-a716-446655440000',
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Email verified successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Email verified successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      verified: {
                        type: 'boolean',
                        example: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        400: {
          description: 'Invalid or expired token',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
      },
    },
  },
  '/auth/set-password': {
    post: {
      tags: ['Auth'],
      summary: 'Set Password',
      description: 'Set or reset user password using the token from email',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['token', 'password'],
              properties: {
                token: {
                  type: 'string',
                  format: 'uuid',
                  description: 'Password reset token from email',
                  example: '550e8400-e29b-41d4-a716-446655440000',
                },
                password: {
                  type: 'string',
                  format: 'password',
                  description: 'New strong password',
                  example: 'SecurePassword123!',
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Password set successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Password set successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      success: {
                        type: 'boolean',
                        example: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        400: {
          description: 'Invalid token or weak password',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
      },
    },
  },
  '/auth/refresh-token': {
    post: {
      tags: ['Auth'],
      summary: 'Refresh Access Token',
      description: 'Generate a new access token using a valid refresh token',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['refresh_token'],
              properties: {
                refresh_token: {
                  type: 'string',
                  description: 'Valid refresh token',
                  example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Token refreshed successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Token refreshed successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      access_token: {
                        type: 'string',
                        example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
                      },
                      refresh_token: {
                        type: 'string',
                        example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
                      },
                    },
                  },
                },
              },
            },
          },
        },
        401: {
          description: 'Invalid or expired refresh token',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
      },
    },
  },
  '/auth/logout': {
    delete: {
      tags: ['Auth'],
      summary: 'User Logout',
      description: 'Logout user and invalidate refresh token',
      security: [{bearerAuth: []}],
      responses: {
        200: {
          description: 'Logout successful',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {type: 'string', example: 'Logout successful'},
                  data: {
                    type: 'object',
                    properties: {
                      success: {
                        type: 'boolean',
                        example: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        401: {
          description: 'Unauthorized',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
      },
    },
  },
  '/auth/send-invite-code': {
    post: {
      tags: ['Auth'],
      summary: 'Send Invite Code',
      description: 'Send a 6-digit invite code to the specified email address',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email'],
              properties: {
                email: {
                  type: 'string',
                  format: 'email',
                  description: 'Email address to send invite code to',
                  example: 'user@example.com',
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Invite code sent successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Invite code sent successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      code: {
                        type: 'string',
                        example: '123456',
                      },
                    },
                  },
                },
              },
            },
          },
        },
        400: {
          description: 'Validation error',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
      },
    },
  },
  '/auth/2fa/verify': {
    post: {
      tags: ['Auth'],
      summary: 'Verify 2FA Login',
      description: 'Complete login by verifying TOTP code.',
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email', 'code'],
              properties: {
                email: {type: 'string'},
                code: {type: 'string'},
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: '2FA verified',
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
  '/auth/passkey/register/begin': {
    post: {
      tags: ['Auth'],
      summary: 'Begin Passkey Registration',
      security: [{bearerAuth: []}],
      responses: {200: {description: 'Options for registration'}},
    },
  },
  '/auth/passkey/register/complete': {
    post: {
      tags: ['Auth'],
      summary: 'Complete Passkey Registration',
      security: [{bearerAuth: []}],
      requestBody: {content: {'application/json': {schema: {type: 'object'}}}},
      responses: {200: {description: 'Registration complete'}},
    },
  },
  '/auth/passkey/login/begin': {
    post: {
      tags: ['Auth'],
      summary: 'Begin Passkey Login',
      responses: {200: {description: 'Options for login'}},
    },
  },
  '/auth/passkey/login/complete': {
    post: {
      tags: ['Auth'],
      summary: 'Complete Passkey Login',
      requestBody: {content: {'application/json': {schema: {type: 'object'}}}},
      responses: {200: {description: 'Login successful'}},
    },
  },
};

export default authDocs;
