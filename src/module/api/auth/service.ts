import bcrypt from 'bcryptjs';
import speakeasy from 'speakeasy';
import {v4 as uuid} from 'uuid';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

import {
  ILogin,
  IOAuthAuthorization,
  IPasskeyLoginBegin,
  IPasskeyLoginComplete,
  IPasskeyRegisterComplete,
  IRefreshToken,
  IRegister,
  ISendLink,
  ISetPassword,
  IVerifyEmail,
  IVerify2FALogin,
} from './interface';
import {OAUTH_PROVIDERS} from '../../../utils/constant';
import {
  compareStrings,
  generateKeys,
  hashPassword,
  isEmpty,
  verifyRefreshToken,
} from '../../../utils/helpers';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '../../../utils/service-error';
import axios from 'axios';
import mail from '../../mail';
import User from '../../database/model/user';
import otp from '../../../services/otp';
import redis from '../../../services/redis';
import {
  FRONTEND_URL,
  WEBAUTHN_RP_ID,
  WEBAUTHN_RP_NAME,
  WEBAUTHN_ORIGINS,
} from '../../../utils/config';
import type {RequestContext} from '../../../contracts/response';
import type {SessionPayload} from '../../../contracts/session';
import {
  createSession,
  revokeAllSessions,
  revokeOtherSessions,
  revokeSession,
  rotateSession,
} from './session-service';
import {verifyAppleIdentity} from './providers/apple';
import {invalidateSecurityState} from './security-state';
import {recordCompatibilityUse} from '../../../services/compatibility-telemetry';

// ---------------------------------------------------------------------------
// 2FA pending session helpers (Redis, 5-min TTL)
// ---------------------------------------------------------------------------
const TWO_FA_PREFIX = '2fa:pending:';
const TWO_FA_TTL = 5 * 60;

async function create2FAPendingToken(
  userId: string,
  remember_for_30_days: boolean,
): Promise<string> {
  const token = uuid();
  await redis.set(
    `${TWO_FA_PREFIX}${token}`,
    JSON.stringify({userId, remember_for_30_days}),
    {EX: TWO_FA_TTL},
  );
  return token;
}

async function consume2FAPendingToken(token: string) {
  const raw = await redis.get(`${TWO_FA_PREFIX}${token}`);
  if (!raw) return null;
  await redis.del(`${TWO_FA_PREFIX}${token}`);
  return JSON.parse(raw.toString()) as {
    userId: string;
    remember_for_30_days: boolean;
  };
}

type AuthClientContext = Pick<RequestContext, 'client'> &
  Partial<Pick<RequestContext, 'version' | 'build'>>;

const LEGACY_CLIENT: AuthClientContext = {
  client: 'legacy-unknown',
};

function assertCanAuthenticate(user: {
  deleted?: boolean;
  disabled?: boolean;
  purge_status?: string;
}): void {
  if (
    user.deleted ||
    user.disabled ||
    (user.purge_status && user.purge_status !== 'active')
  ) {
    throw new BadRequestException('Account is not active');
  }
}

function withLegacySession(
  session: SessionPayload,
  context: AuthClientContext,
) {
  void recordCompatibilityUse('compat.auth.legacy_session_shape', context);
  return {
    ...session,
    onboarded: session.onboarding_status === 'completed',
    session,
  };
}

// ---------------------------------------------------------------------------
// WebAuthn challenge helpers (Redis, 5-min TTL)
// ---------------------------------------------------------------------------
const WA_PREFIX = 'webauthn:challenge:';
const WA_TTL = 5 * 60;

export function generateOauthUrl(provider: string) {
  const {authoriation_url, redirect_uri} =
    OAUTH_PROVIDERS[provider || 'google'];
  const params = new URLSearchParams({
    response_type: 'code',
    redirect_uri,
  }).toString();

  const url = `${authoriation_url}&${params}`;

  return {data: {url}, message: 'OAuth url generated successfully'};
}

export async function oauthAuthorization(
  {code, user: appleUser}: IOAuthAuthorization,
  provider: string,
  context: AuthClientContext = LEGACY_CLIENT,
) {
  const {token_url, userinfo_url, client_id, client_secret, redirect_uri} =
    OAUTH_PROVIDERS[provider || 'google'];

  const payload = {
    code,
    client_id,
    client_secret,
    redirect_uri,
    grant_type: 'authorization_code',
  };
  const appleTokenPayload = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string') appleTokenPayload.append(key, value);
  }
  const tokenPayload = compareStrings(provider, 'apple')
    ? appleTokenPayload
    : payload;
  const {data: result} = await axios.post(
    token_url,
    tokenPayload,
    compareStrings(provider, 'apple')
      ? {headers: {'Content-Type': 'application/x-www-form-urlencoded'}}
      : undefined,
  );

  const userinfo = await getOauthUser(
    userinfo_url,
    result,
    provider,
    appleUser,
  );
  if (!userinfo) {
    throw new UnauthorizedException();
  }

  let user = await User.findOne({email: userinfo.email});
  if (!user) {
    const keys = generateKeys();

    user = await User.create({
      email: userinfo.email,
      first_name: userinfo.first_name,
      last_name: userinfo.last_name,
      verified: true,
      providers: [userinfo.provider],
      ...keys,
    });
  }

  assertCanAuthenticate(user);

  if (!user.providers.includes(userinfo.provider)) {
    user.providers.push(userinfo.provider);
    await user.save();
  }

  const session = await createSession(user, context);
  const data = withLegacySession(session, context);

  return {data, message: 'User signin is successful'};
}

export async function login(
  payload: ILogin,
  context: AuthClientContext = LEGACY_CLIENT,
) {
  const {email, password, remember_for_30_days = false} = payload;
  const user = await User.findOne({email});
  if (!user) {
    throw new NotFoundException('User not found');
  }
  assertCanAuthenticate(user);
  if (isEmpty(user.password)) {
    throw new NotFoundException('Please set your password');
  }

  const is_match = await bcrypt.compare(password, `${user?.password}`);
  if (!is_match) {
    throw new BadRequestException('Incorrect password');
  }
  if (!user.verified) {
    await mail.sendLink(email, user.first_name, 'verify');
    throw new BadRequestException('Please verify your email address', {
      requires_verification: true,
      email,
    });
  }
  // If 2FA is enabled, issue a short-lived pending token instead of full tokens
  if (user.two_factor?.enabled) {
    const two_fa_token = await create2FAPendingToken(
      user.id,
      remember_for_30_days,
    );
    return {
      data: {requires_2fa: true, two_fa_token},
      message: '2FA verification required',
    };
  }

  const expires_in = remember_for_30_days ? 30 : 7;
  const access_token_expires_in = expires_in * 24 * 60 * 60 * 1000;
  const refresh_token_expires_in = 30 * 24 * 60 * 60 * 1000;
  const session = await createSession(user, context, {
    accessExpiresIn: access_token_expires_in,
    refreshExpiresIn: refresh_token_expires_in,
  });
  const data = withLegacySession(session, context);

  return {data, message: 'User login is successful'};
}

export async function verify2FALogin(
  payload: IVerify2FALogin,
  context: AuthClientContext = LEGACY_CLIENT,
) {
  const {two_fa_token, code} = payload;

  const pending = await consume2FAPendingToken(two_fa_token);
  if (!pending) {
    throw new BadRequestException(
      'Invalid or expired 2FA session. Please log in again.',
    );
  }

  const user = await User.findById(pending.userId);
  if (!user) throw new NotFoundException('User not found');
  assertCanAuthenticate(user);
  if (!user.two_factor?.enabled || !user.two_factor.secret) {
    throw new BadRequestException('2FA is not enabled on this account');
  }

  const isValid = speakeasy.totp.verify({
    secret: user.two_factor.secret,
    encoding: 'base32',
    token: code,
    window: 1,
  });
  if (!isValid) throw new BadRequestException('Invalid 2FA code');

  const expires_in = pending.remember_for_30_days ? 30 : 7;
  const session = await createSession(user, context, {
    accessExpiresIn: expires_in * 24 * 60 * 60 * 1000,
    refreshExpiresIn: 30 * 24 * 60 * 60 * 1000,
  });

  return {
    data: withLegacySession(session, context),
    message: 'Login successful',
  };
}

// ---------------------------------------------------------------------------
// Passkey registration (requires authenticated user)
// ---------------------------------------------------------------------------

export async function beginPasskeyRegistration(userId: string) {
  const user = await User.findById(userId);
  if (!user) throw new NotFoundException('User not found');

  const options = await generateRegistrationOptions({
    rpName: WEBAUTHN_RP_NAME,
    rpID: WEBAUTHN_RP_ID,
    userName: user.email,
    userDisplayName: user.first_name || user.email,
    attestationType: 'none',
    excludeCredentials: (user.passkeys || []).map(pk => ({
      id: pk.credential_id,
    })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
  });

  await redis.set(`${WA_PREFIX}reg:${userId}`, options.challenge, {EX: WA_TTL});

  return {data: options, message: 'Registration options generated'};
}

export async function completePasskeyRegistration(
  userId: string,
  payload: IPasskeyRegisterComplete,
) {
  const {response, device_name = 'Unknown device'} = payload;

  const user = await User.findById(userId);
  if (!user) throw new NotFoundException('User not found');

  const expectedChallenge = await redis.get(`${WA_PREFIX}reg:${userId}`);
  if (!expectedChallenge)
    throw new BadRequestException(
      'Registration session expired. Please try again.',
    );

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: response as unknown as Parameters<
        typeof verifyRegistrationResponse
      >[0]['response'],
      expectedChallenge: expectedChallenge.toString(),
      expectedOrigin: WEBAUTHN_ORIGINS,
      expectedRPID: WEBAUTHN_RP_ID,
    });
  } catch {
    throw new BadRequestException(
      'Passkey registration failed. Please try again.',
    );
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw new BadRequestException('Passkey registration failed.');
  }

  await redis.del(`${WA_PREFIX}reg:${userId}`);

  const {credential} = verification.registrationInfo;

  const newPasskey = {
    credential_id: credential.id,
    public_key: Buffer.from(credential.publicKey).toString('base64'),
    counter: credential.counter,
    device_name,
    created_at: new Date(),
  };

  await User.findByIdAndUpdate(userId, {$push: {passkeys: newPasskey}});

  return {
    data: {credential_id: credential.id, device_name},
    message: 'Passkey registered successfully',
  };
}

// ---------------------------------------------------------------------------
// Passkey authentication (public — no existing session required)
// ---------------------------------------------------------------------------

export async function beginPasskeyLogin(payload: IPasskeyLoginBegin) {
  const {email} = payload;

  let allowCredentials: {id: string}[] = [];
  if (email) {
    const user = await User.findOne({email}).select('passkeys');
    if (user?.passkeys?.length) {
      allowCredentials = user.passkeys.map(pk => ({id: pk.credential_id}));
    }
  }

  const options = await generateAuthenticationOptions({
    rpID: WEBAUTHN_RP_ID,
    allowCredentials,
    userVerification: 'required',
  });

  const challengeId = uuid();
  await redis.set(`${WA_PREFIX}auth:${challengeId}`, options.challenge, {
    EX: WA_TTL,
  });

  return {
    data: {...options, challenge_id: challengeId},
    message: 'Authentication options generated',
  };
}

export async function completePasskeyLogin(
  payload: IPasskeyLoginComplete,
  context: AuthClientContext = LEGACY_CLIENT,
) {
  const {challenge_id, response} = payload;

  const expectedChallenge = await redis.get(`${WA_PREFIX}auth:${challenge_id}`);
  if (!expectedChallenge)
    throw new BadRequestException(
      'Authentication session expired. Please try again.',
    );

  const credentialId = (response as {id?: string}).id;
  if (!credentialId) throw new BadRequestException('Invalid response');

  const user = await User.findOne({'passkeys.credential_id': credentialId});
  if (!user) throw new NotFoundException('Passkey not recognised');
  assertCanAuthenticate(user);

  const passkey = user.passkeys?.find(pk => pk.credential_id === credentialId);
  if (!passkey) throw new NotFoundException('Passkey not found');

  let verification;
  try {
    const pubKeyBuf = Buffer.from(passkey.public_key, 'base64');
    const publicKey = new Uint8Array(
      pubKeyBuf.buffer,
      pubKeyBuf.byteOffset,
      pubKeyBuf.byteLength,
    );
    verification = await verifyAuthenticationResponse({
      response: response as unknown as Parameters<
        typeof verifyAuthenticationResponse
      >[0]['response'],
      expectedChallenge: expectedChallenge.toString(),
      expectedOrigin: WEBAUTHN_ORIGINS,
      expectedRPID: WEBAUTHN_RP_ID,
      credential: {
        id: passkey.credential_id,
        publicKey,
        counter: passkey.counter,
      },
    });
  } catch {
    throw new BadRequestException('Passkey authentication failed.');
  }

  if (!verification.verified)
    throw new BadRequestException('Passkey authentication failed.');

  await redis.del(`${WA_PREFIX}auth:${challenge_id}`);

  // Update replay-attack counter
  await User.updateOne(
    {_id: user.id, 'passkeys.credential_id': credentialId},
    {$set: {'passkeys.$.counter': verification.authenticationInfo.newCounter}},
  );

  const session = await createSession(user, context);

  return {
    data: withLegacySession(session, context),
    message: 'Login successful',
  };
}

export async function register(payload: IRegister, context: AuthClientContext = LEGACY_CLIENT) {
  const {email, first_name, last_name} = payload;
  const user = await User.findOne({email});
  if (user) {
    throw new NotFoundException('User with this email address already exists');
  }

  const password = await hashPassword(payload.password);
  const keys = generateKeys();

  await User.create({last_name, first_name, password, email, ...keys});
  const deliveryMode =
    (payload as any).delivery === 'code' ||
    context.client === 'ios' ||
    context.client === 'android'
      ? 'code'
      : 'link';
  await mail.sendLink(email, first_name || last_name || '', 'verify', deliveryMode);

  const data = {requires_verification: true, email};

  return {data, message: 'User registration successful'};
}

export async function sendLink(
  payload: ISendLink & { delivery?: 'link' | 'code' },
  context: AuthClientContext = LEGACY_CLIENT,
) {
  const {email, type = 'reset'} = payload;
  const user = await User.findOne({email});
  if (!user) {
    throw new NotFoundException('User not found');
  }

  const deliveryMode =
    payload.delivery === 'code' ||
    context.client === 'ios' ||
    context.client === 'android'
      ? 'code'
      : 'link';

  await mail.sendLink(email, user.first_name, type, deliveryMode);

  return {
    message: `${type === 'reset' ? (deliveryMode === 'code' ? 'Password reset code' : 'Reset link') : (deliveryMode === 'code' ? 'Verification code' : 'Verification link')} has been sent successfully`,
    data: {email, delivery: deliveryMode},
  };
}

export async function verifyEmail(
  payload: IVerifyEmail,
  context: AuthClientContext = LEGACY_CLIENT,
) {
  const {token} = payload;
  const email = (payload as any).email;
  const type = (payload as any).type || 'verify';

  if (type === 'reset') {
    const result = await otp.verify(token, 'reset', email);
    if (!result.valid) {
      throw new BadRequestException('Invalid or expired code');
    }
    const user = await User.findOne({email: result.email});
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return {
      data: {valid: true, email: user.email},
      message: 'Reset code is valid',
    };
  }

  const result = await otp.verify(token, 'verify', email);
  if (!result.valid) {
    throw new BadRequestException('Invalid or expired link');
  }

  const user = await User.findOne({email: result.email});
  if (!user) {
    throw new NotFoundException('User not found');
  }

  if (result.alreadyUsed) {
    if (user.verified) {
      return {
        data: {email: user.email},
        message: 'Email already verified. Please login.',
      };
    }
    throw new BadRequestException('Invalid or already used link');
  }

  await otp.markUsed(token, 'verify');

  assertCanAuthenticate(user);
  user.verified = true;
  await user.save();
  const session = await createSession(user, context, {
    accessExpiresIn: 1 * 60 * 60 * 1000,
    refreshExpiresIn: 30 * 24 * 60 * 60 * 1000,
  });

  return {
    data: {...withLegacySession(session, context), email: user.email},
    message: 'Verification successful',
  };
}

export async function setPassword(payload: ISetPassword) {
  const {token} = payload;

  // Verify the OTP using the centralized service
  const result = await otp.verify(token, 'reset');
  if (!result.valid) {
    throw new BadRequestException('Invalid or expired link');
  }

  await otp.delete(token, 'reset');

  const password = await hashPassword(payload.password);

  const user = await User.findOneAndUpdate(
    {email: result.email},
    {
      $set: {password, refresh_token: null, refresh_tokens: []},
      $inc: {session_version: 1},
    },
    {new: true},
  );
  if (!user) throw new NotFoundException('User not found');
  await revokeAllSessions(user.id);
  await invalidateSecurityState(user.id);

  return {data: null, message: 'Password reset successful'};
}

async function getOauthUser(
  userinfo_url: string,
  tokenResult: {access_token?: string; id_token?: string},
  provider: string,
  appleUser?: IOAuthAuthorization['user'],
) {
  if (compareStrings(provider, 'google')) {
    const {data} = await axios.get(userinfo_url, {
      headers: {Authorization: `Bearer ${tokenResult.access_token}`},
    });

    return {
      provider: `google:${data?.id}`,
      email: data?.email,
      first_name: data?.given_name,
      last_name: data?.family_name,
    };
  }
  if (compareStrings(provider, 'facebook')) {
    const {data} = await axios.get(userinfo_url, {
      params: {access_token: tokenResult.access_token},
    });

    const [first_name, last_name] = (data?.name ?? '').split(' ');
    return {
      provider: `facebook:${data?.id}`,
      email: data?.email,
      first_name,
      last_name,
    };
  }

  if (compareStrings(provider, 'apple')) {
    if (!tokenResult.id_token) throw new UnauthorizedException();
    const identity = await verifyAppleIdentity(tokenResult.id_token);
    let first_name: string | undefined;
    let last_name: string | undefined;
    let parsedUser = typeof appleUser === 'object' ? appleUser : undefined;
    if (typeof appleUser === 'string') {
      try {
        parsedUser = JSON.parse(appleUser) as Exclude<
          IOAuthAuthorization['user'],
          string
        >;
      } catch {
        throw new BadRequestException('Invalid Apple user data');
      }
    }
    if (parsedUser && typeof parsedUser === 'object') {
      first_name = parsedUser.name?.firstName;
      last_name = parsedUser.name?.lastName;
    }
    return {
      provider: `apple:${identity.providerId}`,
      email: identity.email,
      first_name,
      last_name,
    };
  }
  return null;
}

export async function refreshToken(
  payload: IRefreshToken,
  context: AuthClientContext = LEGACY_CLIENT,
) {
  const {refresh_token} = payload;

  const decoded = verifyRefreshToken(refresh_token);
  if (decoded.sid) {
    const session = await rotateSession(refresh_token);
    return {
      data: withLegacySession(session, context),
      message: 'Tokens refreshed successfully',
    };
  }

  const user = await User.findById(decoded.id);
  if (!user) {
    throw new NotFoundException('User not found');
  }
  assertCanAuthenticate(user);

  const consumed = await User.updateOne(
    {
      _id: user.id,
      $or: [{refresh_token}, {refresh_tokens: refresh_token}],
    },
    [
      {
        $set: {
          refresh_token: {
            $cond: [
              {$eq: ['$refresh_token', refresh_token]},
              null,
              '$refresh_token',
            ],
          },
          refresh_tokens: {
            $filter: {
              input: {$ifNull: ['$refresh_tokens', []]},
              as: 'storedToken',
              cond: {$ne: ['$$storedToken', refresh_token]},
            },
          },
        },
      },
    ],
  );
  if (consumed.modifiedCount !== 1) {
    throw new UnauthorizedException('Invalid refresh token');
  }

  void recordCompatibilityUse('compat.auth.legacy_refresh', context);

  const session = await createSession(user, context);

  return {
    data: withLegacySession(session, context),
    message: 'Tokens refreshed successfully',
  };
}

export async function logout(
  userId: string,
  sessionId?: string,
  refreshToken?: string,
) {
  if (sessionId) {
    if (refreshToken) {
      const claims = verifyRefreshToken(refreshToken);
      if (claims.id !== userId || claims.sid !== sessionId) {
        throw new UnauthorizedException('Refresh token does not match session');
      }
    }
    if (!(await revokeSession(userId, sessionId))) {
      throw new UnauthorizedException('Session is no longer active');
    }
  } else if (refreshToken) {
    const claims = verifyRefreshToken(refreshToken);
    if (claims.id !== userId || claims.sid) {
      throw new UnauthorizedException('Refresh token does not match session');
    }
    await User.updateOne({_id: userId}, [
      {
        $set: {
          refresh_token: {
            $cond: [
              {$eq: ['$refresh_token', refreshToken]},
              null,
              '$refresh_token',
            ],
          },
          refresh_tokens: {
            $filter: {
              input: {$ifNull: ['$refresh_tokens', []]},
              as: 'storedToken',
              cond: {$ne: ['$$storedToken', refreshToken]},
            },
          },
        },
      },
    ]);
  } else {
    await User.findByIdAndUpdate(userId, {
      refresh_token: null,
      refresh_tokens: [],
    });
  }

  return {
    data: null,
    message: 'Logout successful',
  };
}

export async function logoutOther(
  userId: string,
  currentSessionId?: string,
  currentRefreshToken?: string,
) {
  if (currentSessionId) {
    if (currentRefreshToken) {
      const claims = verifyRefreshToken(currentRefreshToken);
      if (claims.id !== userId || claims.sid !== currentSessionId) {
        throw new UnauthorizedException('Refresh token does not match session');
      }
    }
    await revokeOtherSessions(userId, currentSessionId);
  } else if (!currentRefreshToken) {
    throw new BadRequestException('Current refresh token is required');
  } else {
    const claims = verifyRefreshToken(currentRefreshToken);
    const user = await User.findOne({
      _id: userId,
      $or: [
        {refresh_token: currentRefreshToken},
        {refresh_tokens: currentRefreshToken},
      ],
    });
    if (!user || claims.id !== userId || claims.sid) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    await User.findByIdAndUpdate(userId, {
      refresh_token: currentRefreshToken,
      refresh_tokens: [currentRefreshToken],
    });
  }

  return {
    data: null,
    message: 'Other devices logged out successfully',
  };
}

export async function sendInviteCode(payload: {email?: string; name?: string}) {
  const {email = null, name = null} = payload;

  if (!isEmpty(email)) {
    const user = await User.findOne({email});
    if (user) {
      throw new BadRequestException('User already exists');
    }
  }

  const code = await otp.create(email || '', 'invite');
  const invite_code = `${FRONTEND_URL}/register?code=${code}`;

  if (!isEmpty(email)) {
    await mail.sendInviteCode({
      email: email!,
      code,
      invite_code,
      name,
    });
  }

  return {message: 'Invite code sent successfully', data: {email, invite_code}};
}
