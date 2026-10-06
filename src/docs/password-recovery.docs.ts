/**
 * @openapi
 * /auth/recovery/send-code:
 *   post:
 *     tags: [Auth]
 *     summary: Send or resend a six-digit password recovery code
 *     description: Generic response for unknown accounts. Codes expire in ten minutes. Resending is limited to once per minute and does not reset the five-attempt verification budget.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       '200':
 *         description: Request accepted. Data contains email and resend_after (60 seconds). No code is returned.
 *       '429':
 *         description: Too many requests from this IP address
 * /auth/recovery/verify-code:
 *   post:
 *     tags: [Auth]
 *     summary: Exchange an email recovery code for a single-use password reset token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, code]
 *             properties:
 *               email: { type: string, format: email }
 *               code: { type: string, pattern: '^[0-9]{6}$' }
 *     responses:
 *       '200':
 *         description: Data contains token (UUID). Submit it with a strong password to /auth/set-password within ten minutes. The code cannot be reused.
 *       '400':
 *         description: Invalid, expired, already consumed code, or exhausted verification attempts
 *       '429':
 *         description: Too many requests from this IP address
 */
export {};
