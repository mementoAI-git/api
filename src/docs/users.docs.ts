const usersDocs = {
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
  '/users/context': {
    put: {
      tags: ['Users'],
      summary: 'Update User Context',
      description:
        'Update user context information including preferences, notes, and goals',
      security: [{bearerAuth: []}],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                important_notes: {
                  type: 'array',
                  items: {type: 'string'},
                  description: 'Array of important notes',
                  example: ['Note 1', 'Note 2'],
                },
                key_preferences: {
                  type: 'array',
                  items: {type: 'string'},
                  description: 'Array of key preferences',
                  example: ['Preference 1'],
                },
                conversation_history_summary: {
                  type: 'string',
                  description: 'Summary of conversation history',
                  example: 'User prefers detailed explanations',
                },
                emotional_state_trends: {
                  type: 'array',
                  items: {type: 'string'},
                  description: 'Array of emotional state trends',
                  example: ['positive', 'calm'],
                },
                goals_and_aspirations: {
                  type: 'array',
                  items: {type: 'string'},
                  description: 'Array of goals and aspirations',
                  example: ['Learn new skills', 'Travel more'],
                },
                self_description: {
                  type: 'string',
                  maxLength: 500,
                  description: 'User self-description',
                  example:
                    'I am a software developer passionate about technology',
                },
                current_priority: {
                  type: 'string',
                  maxLength: 200,
                  description: 'Current priority',
                  example: 'Completing project deadline',
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
          description: 'Context updated successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Context updated successfully',
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
  '/users/update-streak': {
    post: {
      tags: ['Users'],
      summary: 'Update User Streak',
      description: 'Update user daily streak counter',
      security: [{bearerAuth: []}],
      responses: {
        200: {
          description: 'Streak updated successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Streak updated successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      streak: {type: 'number', example: 6},
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
                  maxLength: 500,
                  description: 'User self-description',
                  example: 'I am a software developer',
                },
                current_priority: {
                  type: 'string',
                  maxLength: 200,
                  description: 'Current priority',
                  example: 'Learning new technologies',
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
  // TODO: Remove this endpoint after migration is complete
  '/users/migrate-context-to-persona': {
    post: {
      tags: ['Users'],
      summary: 'Migrate User Context to Persona',
      description:
        'Migrate existing user context data from User model to Persona model. This is a one-time migration endpoint that should be removed after migration is complete.',
      security: [{bearerAuth: []}],
      responses: {
        200: {
          description: 'Migration completed successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {type: 'string', example: 'Migration completed'},
                  data: {
                    type: 'object',
                    properties: {
                      totalUsersWithContext: {type: 'number', example: 100},
                      migrated: {type: 'number', example: 95},
                      skipped: {type: 'number', example: 5},
                      errors: {type: 'number', example: 0},
                      errorDetails: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            user_id: {type: 'string'},
                            error: {type: 'string'},
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
};

export default usersDocs;
