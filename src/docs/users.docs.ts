const usersDocs = {
  '/users/referrals': {
    get: {
      tags: ['Users'],
      summary: 'Get personal invite link and signup count',
      security: [{bearerAuth: []}],
      responses: {
        200: {
          description: 'Invite details retrieved',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: {type: 'boolean'},
                  data: {
                    type: 'object',
                    required: ['invite_url', 'signup_count'],
                    properties: {
                      invite_url: {type: 'string', format: 'uri'},
                      signup_count: {type: 'integer', minimum: 0},
                    },
                  },
                },
              },
            },
          },
        },
        401: {description: 'Authentication required'},
      },
    },
  },
  '/users/profile': {
    get: {
      tags: ['Users'],
      summary: 'Get User Profile',
      description: "Retrieve the authenticated user's profile information",
      security: [{bearerAuth: []}],
      responses: {
        200: {
          description: 'Profile retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Profile retrieved successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      _id: {
                        type: 'string',
                        example: '507f1f77bcf86cd799439011',
                      },
                      email: {type: 'string', example: 'user@example.com'},
                      first_name: {type: 'string', example: 'John'},
                      last_name: {type: 'string', example: 'Doe'},
                      nickname: {type: 'string', example: 'Johnny'},
                      gender: {type: 'string', example: 'male'},
                      phone_number: {type: 'string', example: '+1234567890'},
                      dob: {
                        type: 'string',
                        format: 'date',
                        example: '1990-01-01',
                      },
                      country: {type: 'string', example: 'USA'},
                      onbaorded: {type: 'boolean', example: true},
                      verified: {type: 'boolean', example: true},
                      picture: {type: 'string', example: 'profile.jpg'},
                      picture_url: {
                        type: 'string',
                        example: 'https://example.com/profile.jpg',
                      },
                      last_seen: {type: 'string', example: '2024-01-01'},
                      streak: {type: 'number', example: 5},
                      bg_music: {type: 'string', nullable: true, example: null},
                      chat_voice: {
                        type: 'string',
                        nullable: true,
                        example: null,
                      },
                      newsletter_subscriber: {type: 'boolean', example: false},
                      two_factor: {
                        type: 'object',
                        properties: {
                          enabled: {type: 'boolean', example: false},
                        },
                      },
                      preferences: {
                        type: 'object',
                        properties: {
                          communication_style: {
                            type: 'string',
                            enum: [
                              'formal',
                              'casual',
                              'friendly',
                              'professional',
                            ],
                            example: 'friendly',
                          },
                          topics_of_interest: {
                            type: 'array',
                            items: {type: 'string'},
                            example: ['technology', 'music'],
                          },
                          conversation_tone: {
                            type: 'string',
                            enum: [
                              'upbeat',
                              'warm',
                              'calm',
                              'analytical',
                              'creative',
                            ],
                            example: 'warm',
                          },
                          response_length: {
                            type: 'string',
                            enum: ['short', 'medium', 'long'],
                            example: 'medium',
                          },
                        },
                      },
                      created_at: {
                        type: 'string',
                        format: 'date-time',
                        example: '2024-01-01T00:00:00.000Z',
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
    put: {
      tags: ['Users'],
      summary: 'Update User Profile',
      description: "Update the authenticated user's profile information",
      security: [{bearerAuth: []}],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                first_name: {type: 'string', example: 'John'},
                last_name: {type: 'string', example: 'Doe'},
                nickname: {type: 'string', example: 'Johnny'},
                gender: {type: 'string', example: 'male'},
                phone_number: {type: 'string', example: '+1234567890'},
                dob: {type: 'string', format: 'date', example: '1990-01-01'},
                country: {type: 'string', example: 'USA'},
                bg_music: {type: 'string', nullable: true, example: null},
                chat_voice: {type: 'string', nullable: true, example: null},
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Profile updated successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Profile updated successfully',
                  },
                  data: {type: 'object'},
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
  '/users/change-password': {
    post: {
      tags: ['Users'],
      summary: 'Change Password',
      description:
        'Change user password. Requires old password for verification.',
      security: [{bearerAuth: []}],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['old_password', 'new_password'],
              properties: {
                old_password: {
                  type: 'string',
                  format: 'password',
                  description: 'Current password',
                  example: 'OldPassword123!',
                },
                new_password: {
                  type: 'string',
                  format: 'password',
                  description: 'New strong password',
                  example: 'NewSecurePassword123!',
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Password changed successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Password changed successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      success: {type: 'boolean', example: true},
                    },
                  },
                },
              },
            },
          },
        },
        400: {
          description: 'Invalid old password or weak new password',
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
  '/users/onboarding-details': {
    get: {
      tags: ['Users'],
      summary: 'Get Onboarding Details',
      description:
        'Retrieve the current onboarding state and details for the user',
      security: [{bearerAuth: []}],
      responses: {
        200: {
          description: 'Onboarding details retrieved successfully',
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
  '/users/onboarding': {
    post: {
      tags: ['Users'],
      summary: 'Update Onboarding Step',
      description: 'Update user progress through the onboarding steps',
      security: [{bearerAuth: []}],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                step: {type: 'number'},
                nickname: {type: 'string'},
                join_reasons: {type: 'array', items: {type: 'string'}},
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Onboarding updated',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Onboarding updated successfully',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  '/users/onboarding/skip': {
    post: {
      tags: ['Users'],
      summary: 'Skip Onboarding',
      description: 'Mark onboarding as skipped for the user',
      security: [{bearerAuth: []}],
      responses: {
        200: {
          description: 'Onboarding skipped',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                },
              },
            },
          },
        },
      },
    },
  },
  '/users/onboarding/chat/prompt': {
    post: {
      tags: ['Users'],
      summary: 'Stream Onboarding Chat',
      description:
        'Stream an AI chat response for the interactive onboarding experience',
      security: [{bearerAuth: []}],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                messages: {type: 'array', items: {type: 'object'}},
                nickname: {type: 'string'},
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Streaming response',
          content: {'text/plain': {schema: {type: 'string'}}},
        },
      },
    },
  },
  '/users/upload-picture': {
    post: {
      tags: ['Users'],
      summary: 'Upload Profile Picture',
      description: 'Upload a new profile picture for the user',
      security: [{bearerAuth: []}],
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['picture'],
              properties: {
                picture: {
                  type: 'string',
                  format: 'binary',
                  description: 'Profile picture image file',
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Picture uploaded successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Picture uploaded successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      picture: {type: 'string', example: 'profile.jpg'},
                      picture_url: {
                        type: 'string',
                        example: 'https://example.com/profile.jpg',
                      },
                    },
                  },
                },
              },
            },
          },
        },
        400: {
          description: 'Invalid file or validation error',
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
  '/users/2fa/setup': {
    get: {
      tags: ['Users'],
      summary: 'Setup 2FA',
      description:
        'Generate QR code and secret for two-factor authentication setup',
      security: [{bearerAuth: []}],
      responses: {
        200: {
          description: '2FA setup data generated successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: '2FA setup data generated successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      qr_code: {
                        type: 'string',
                        description: 'Base64 encoded QR code image',
                        example:
                          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...',
                      },
                      secret: {
                        type: 'string',
                        description: '2FA secret key',
                        example: 'JBSWY3DPEHPK3PXP',
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
  '/users/2fa/verify': {
    post: {
      tags: ['Users'],
      summary: 'Verify and Enable 2FA',
      description: 'Verify TOTP token and enable two-factor authentication',
      security: [{bearerAuth: []}],
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
                  description: 'TOTP token from authenticator app',
                  example: '123456',
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: '2FA enabled successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: '2FA enabled successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      enabled: {type: 'boolean', example: true},
                    },
                  },
                },
              },
            },
          },
        },
        400: {
          description: 'Invalid token',
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
  '/users/2fa/disable': {
    delete: {
      tags: ['Users'],
      summary: 'Disable 2FA',
      description: 'Disable two-factor authentication for the user',
      security: [{bearerAuth: []}],
      responses: {
        200: {
          description: '2FA disabled successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: '2FA disabled successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      enabled: {type: 'boolean', example: false},
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
  '/users/complete-onboarding': {
    post: {
      tags: ['Users'],
      summary: 'Complete Onboarding',
      description: 'Complete user onboarding process',
      security: [{bearerAuth: []}],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                self_description: {
                  type: 'string',
                  maxLength: 2000,
                  description: 'User self-description',
                  example: 'I am a software developer',
                },
                current_priority: {
                  type: 'array',
                  items: {type: 'string'},
                  description: 'Current priorities',
                  example: ['Learning new technologies', 'Writing memories'],
                },
                dob: {
                  type: 'string',
                  format: 'date',
                  description: 'Date of birth',
                  example: '1990-01-01',
                },
                join_reasons: {
                  type: 'array',
                  items: {type: 'string'},
                  description: 'Reasons for joining',
                  example: ['Memory preservation', 'Family connections'],
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Onboarding completed successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Onboarding completed successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      onbaorded: {type: 'boolean', example: true},
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
  '/users/account': {
    delete: {
      tags: ['Users'],
      summary: 'Delete User Account',
      description: 'Soft delete user account',
      security: [{bearerAuth: []}],
      responses: {
        200: {
          description: 'Account deleted successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Account deleted successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      deleted: {type: 'boolean', example: true},
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
  '/users/stats': {
    get: {
      tags: ['Users'],
      summary: 'Get User Statistics',
      description:
        'Retrieve user statistics including memories, conversations, and activity counts',
      security: [{bearerAuth: []}],
      responses: {
        200: {
          description: 'Statistics retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Statistics retrieved successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      total_memories: {type: 'number', example: 50},
                      total_conversations: {type: 'number', example: 30},
                      total_capsules: {type: 'number', example: 10},
                      streak: {type: 'number', example: 5},
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
  '/users/persona': {
    get: {
      tags: ['Users'],
      summary: 'Get Persona Profile',
      description:
        "Retrieve the user's AI-generated persona profile and traits",
      security: [{bearerAuth: []}],
      responses: {
        200: {
          description: 'Persona retrieved successfully',
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
    put: {
      tags: ['Users'],
      summary: 'Update Persona Profile',
      description: 'Manually update user persona traits and preferences',
      security: [{bearerAuth: []}],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                important_notes: {type: 'array', items: {type: 'string'}},
                key_preferences: {type: 'array', items: {type: 'string'}},
                conversation_history_summary: {type: 'string'},
                emotional_state_trends: {
                  type: 'array',
                  items: {type: 'string'},
                },
                goals_and_aspirations: {type: 'array', items: {type: 'string'}},
                self_description: {type: 'string', maxLength: 2000},
                current_priority: {type: 'array', items: {type: 'string'}},
                join_reasons: {type: 'array', items: {type: 'string'}},
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Persona updated successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                },
              },
            },
          },
        },
      },
    },
  },
  '/users/persona/memory-insights-summary': {
    get: {
      tags: ['Users'],
      summary: 'Get Memory Insights Summary',
      description: 'Get a summary of insights derived from user memories',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'refresh',
          in: 'query',
          schema: {type: 'boolean', default: false},
          description: 'Force a refresh of insights',
        },
      ],
      responses: {
        200: {
          description: 'Insights summary retrieved',
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
  '/users/insights': {
    get: {
      tags: ['Users'],
      summary: 'Get the current insights',
      description:
        "Returns up to 4 insights that connect the member's memories. The evidence is re-evaluated in the background every 3 to 5 days when there is new material, and an insight only appears once several memories across different dates support it, so this list may be empty. Poll while generating is true.",
      security: [{bearerAuth: []}],
      responses: {
        200: {
          description: 'Insights retrieved',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: {type: 'boolean'},
                  data: {
                    type: 'object',
                    required: ['insights', 'generating'],
                    properties: {
                      insights: {
                        type: 'array',
                        items: {
                          type: 'object',
                          required: [
                            'id',
                            'title',
                            'body',
                            'categories',
                            'source_count',
                            'status',
                          ],
                          properties: {
                            id: {type: 'string'},
                            title: {type: 'string'},
                            body: {type: 'string'},
                            categories: {
                              type: 'array',
                              items: {type: 'string'},
                            },
                            source_count: {type: 'integer', minimum: 0},
                            status: {
                              type: 'string',
                              enum: ['emerging', 'established'],
                            },
                          },
                        },
                      },
                      generated_at: {
                        type: 'string',
                        format: 'date-time',
                        nullable: true,
                      },
                      next_refresh_at: {
                        type: 'string',
                        format: 'date-time',
                        nullable: true,
                      },
                      generating: {type: 'boolean'},
                    },
                  },
                },
              },
            },
          },
        },
        401: {description: 'Authentication required'},
      },
    },
  },
  '/users/insights/sources': {
    get: {
      tags: ['Users'],
      summary: 'List the memories behind an insight or enrichment field',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'insight',
          in: 'query',
          schema: {type: 'string'},
          description: 'Insight id. Provide this or category.',
        },
        {
          name: 'category',
          in: 'query',
          schema: {type: 'string'},
          description: 'Enrichment field key. Provide this or insight.',
        },
      ],
      responses: {
        200: {
          description: 'Insight sources retrieved',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: {type: 'boolean'},
                  data: {
                    type: 'object',
                    required: ['sources'],
                    properties: {
                      sources: {
                        type: 'array',
                        items: {
                          type: 'object',
                          required: ['id', 'title', 'type'],
                          properties: {
                            id: {type: 'string'},
                            title: {type: 'string'},
                            type: {
                              type: 'string',
                              enum: ['story', 'conversation'],
                            },
                            created_at: {
                              type: 'string',
                              format: 'date-time',
                              nullable: true,
                            },
                            thumbnail: {type: 'string', nullable: true},
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
        401: {description: 'Authentication required'},
        404: {description: 'Insight not found'},
      },
    },
  },
  '/users/passkeys': {
    get: {
      tags: ['Users'],
      summary: 'List Passkeys',
      description: 'Retrieve a list of passkeys registered to the user',
      security: [{bearerAuth: []}],
      responses: {
        200: {
          description: 'Passkeys retrieved',
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
  '/users/passkeys/{credential_id}': {
    delete: {
      tags: ['Users'],
      summary: 'Delete Passkey',
      description: 'Unregister a passkey',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'credential_id',
          in: 'path',
          required: true,
          description: 'Credential ID of the passkey',
          schema: {type: 'string'},
        },
      ],
      responses: {
        200: {
          description: 'Passkey deleted',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                },
              },
            },
          },
        },
      },
    },
  },
};

export default usersDocs;
