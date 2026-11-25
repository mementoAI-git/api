import {accountCreated} from '../../../services/growth-events';
import {referrals} from '../user/referrals';
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
  IVerifyRecoveryCode,
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
  generateDefaultAvatarUrl,
  generateKeys,
  hashPassword,
  isEmpty,
  verifyRefreshToken,
} from '../../../utils/helpers';
import {
  BadRequestException,
  NotFoundException,
  ServiceError,
  UnauthorizedException,
} from '../../../utils/service-error';
import axios from 'axios';
import mail, {notifyInBackground} from '../../mail';
import User from '../../database/model/user';
import logger from '../../../utils/logger';
import otp from '../../../services/otp';
import redis from '../../../services/redis';
import {PasswordRecoveryCodes} from '../../../services/password-recovery';
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
import {exchangeAppleAuthorizationCode} from './providers/apple-tokens';
import {encryptStoreSecret} from '../billing/providers/token-vault';
import {invalidateSecurityState} from './security-state';
import {
  isWithinDeletionGrace,
  reactivateAccount,
} from '../../../services/account-purge/account-state';
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

function emailDelivery(
  context: AuthClientContext,
  requested?: 'link' | 'code',
): 'link' | 'code' {
  if (requested) return requested;
  return ['web', 'ios', 'android'].includes(context.client) ? 'code' : 'link';
}

const LEGACY_CLIENT: AuthClientContext = {
  client: 'legacy-unknown',
};

type AuthenticatingUser = {
  _id?: unknown;
  deleted?: boolean;
  disabled?: boolean;
  purge_status?: string;
  deletion_scheduled_for?: Date | null;
};

/**
 * Blocks inactive accounts. Sign-in paths pass `allowDeactivated` so an account
 * inside its deletion grace period can continue to credential checks; it is
 * only restored by restoreIfDeactivated once those checks pass.
 */
function assertCanAuthenticate(
  user: AuthenticatingUser,
  {allowDeactivated = false}: {allowDeactivated?: boolean} = {},
): void {
  if (allowDeactivated && isWithinDeletionGrace(user)) return;
  if (
    user.deleted ||
    user.disabled ||
    (user.purge_status && user.purge_status !== 'active')
  ) {
    throw new BadRequestException('Account is not active');
  }
}

/** Call after the credential is verified, just before creating a session. */
async function restoreIfDeactivated(user: AuthenticatingUser): Promise<void> {
  if (!user.deleted && (user.purge_status ?? 'active') === 'active') return;
  const userId = String(user._id);
  if (!(await reactivateAccount(userId))) {
    throw new BadRequestException('Account is not active');
  }
  user.deleted = false;
  user.purge_status = 'active';
  user.deletion_scheduled_for = null;
  await invalidateSecurityState(userId);
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

/**
 * The apps' own Google OAuth clients. Always accepted, so a server setting can
 * only add clients. Replacing them is what broke native sign-in: a phone's
 * token has the web client as its audience and the iOS or Android client as
 * its authorized party, and both must be ours.
 *
 * Project 246773083886 is Memento's (its consent screen says Memento) and is
 * built into the mobile app. Project 680261459129 ("SSO Test") was built into
 * earlier app builds, so it stays until those builds are gone.
 */
const MEMENTO_GOOGLE_CLIENT_IDS = [
  '246773083886-bu35mshe7kbnhe329rka30k50t120vde.apps.googleusercontent.com', // web
  '246773083886-nkljj6mafpodch7a8mv1g5khn91sv8a4.apps.googleusercontent.com', // iOS
  '246773083886-r71s166vm87ldt4g59pvnlma706jaurd.apps.googleusercontent.com', // Android: EAS upload key (APKs installed directly)
  '246773083886-b8001nmd44ved77u7he8kelkv7c9m405.apps.googleusercontent.com', // Android: Play app signing key (installs from Google Play)
  '246773083886-uies9o8pv3lv82h5ftdso9ljen1n9p0v.apps.googleusercontent.com', // Android: Play's newer quantum-ready signing key
  '680261459129-g1l36cheppg1e29slepth6dpvngjqjj1.apps.googleusercontent.com', // earlier builds: web
  '680261459129-nupaa1nhgpkolmiicmcho7ffipl939lf.apps.googleusercontent.com', // earlier builds: iOS
];

/** Google clients whose ID tokens may sign in: ours plus any the server names. */
export function googleClientIds(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const configured = [
    env.GOOGLE_ID,
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_WEB_CLIENT_ID,
    env.GOOGLE_IOS_CLIENT_ID,
    env.GOOGLE_ANDROID_CLIENT_ID,
  ]
    .map(id => id?.trim())
    .filter((id): id is string => Boolean(id));
  return [...new Set([...MEMENTO_GOOGLE_CLIENT_IDS, ...configured])];
}

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
  {code, id_token, user: appleUser, referral_code}: IOAuthAuthorization,
  provider: string,
  context: AuthClientContext = LEGACY_CLIENT,
) {
  let userinfo:
    | {
        provider: string;
        email: string;
        first_name?: string;
        last_name?: string;
        picture?: string;
      }
    | undefined;

  if (id_token) {
    if (compareStrings(provider, 'google')) {
      try {
        const {data} = await axios.get(
          'https://oauth2.googleapis.com/tokeninfo',
          {
            params: {id_token},
          },
        );
        if (!data?.email || !data?.sub) {
          throw new UnauthorizedException('Invalid Google ID token');
        }

        // 1. Issuer verification
        const validIssuers = [
          'https://accounts.google.com',
          'accounts.google.com',
        ];
        if (!data.iss || !validIssuers.includes(data.iss)) {
          throw new UnauthorizedException('Invalid Google token issuer');
        }

        // 2. Expiration verification
        const expSeconds = Number(data.exp);
        if (!expSeconds || expSeconds * 1000 <= Date.now()) {
          throw new UnauthorizedException('Google ID token has expired');
        }

        // 3. Email verified verification
        const emailVerified =
          data.email_verified === true || data.email_verified === 'true';
        if (!emailVerified) {
          throw new UnauthorizedException(
            'Google account email is not verified',
          );
        }

        // 4. Strict Audience (aud) and Authorized Party (azp) validation
        const allowedClientIds = googleClientIds();

        // aud MUST match an authorized client ID
        if (!data.aud || !allowedClientIds.includes(data.aud)) {
          throw new UnauthorizedException('Google ID token audience mismatch');
        }

        // If azp is present, azp MUST also match an authorized client ID
        if (data.azp && !allowedClientIds.includes(data.azp)) {
          throw new UnauthorizedException(
            'Google ID token authorized party mismatch',
          );
        }
        const firstName =
          data.given_name || (data.name ? data.name.split(' ')[0] : 'User');
        const lastName =
          data.family_name ||
          (data.name ? data.name.split(' ').slice(1).join(' ') : '');
        userinfo = {
          provider: `google:${data.sub}`,
          email: data.email.toLowerCase(),
          first_name: firstName,
          last_name: lastName,
        };
      } catch (err: any) {
        if (err instanceof ServiceError) throw err;
        throw new UnauthorizedException('Invalid Google ID token');
      }
    } else if (compareStrings(provider, 'apple')) {
      userinfo = await getOauthUser('', {id_token}, provider, appleUser);
    } else {
      throw new BadRequestException(
        `Provider ${provider} does not support id_token authorization`,
      );
    }
  } else {
    if (!code) {
      throw new BadRequestException(
        'Authorization code or id_token is required',
      );
    }
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

    userinfo = await getOauthUser(userinfo_url, result, provider, appleUser);
  }

  if (!userinfo) {
    throw new UnauthorizedException();
  }

  let user = await User.findOne({email: userinfo.email});
  if (!user) {
    const keys = generateKeys();

    const picture =
      userinfo.picture || generateDefaultAvatarUrl(userinfo.email);
    user = await User.create({
      referred_by: await referrals.inviter(referral_code),
      email: userinfo.email,
      first_name: userinfo.first_name,
      last_name: userinfo.last_name,
      verified: true,
      providers: [userinfo.provider],
      picture,
      ...keys,
    });
    await accountCreated(user, 'oauth');
  }

  assertCanAuthenticate(user, {allowDeactivated: true});

  if (!user.providers.includes(userinfo.provider)) {
    user.providers.push(userinfo.provider);
    await user.save();
  }

  // The app sends Apple's one-time code with the identity token. Its refresh
  // token is what Apple needs to revoke the sign-in when the account is deleted.
  if (id_token && code && compareStrings(provider, 'apple')) {
    await rememberAppleToken(user.id, code);
  }

  // Google or Apple proves the email, not the second factor: an account with
  // two-factor authentication needs its code here too, as with a password.
  // A deactivated account is then restored in verify2FALogin, after the code.
  if (user.two_factor?.enabled) {
    const two_fa_token = await create2FAPendingToken(user.id, false);
    return {
      data: {requires_2fa: true, two_fa_token},
      message: '2FA verification required',
    };
  }

  await restoreIfDeactivated(user);
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
  assertCanAuthenticate(user, {allowDeactivated: true});
  if (isEmpty(user.password)) {
    throw new NotFoundException('Please set your password');
  }

  const is_match = await bcrypt.compare(password, `${user?.password}`);
  if (!is_match) {
    throw new BadRequestException('Incorrect password');
  }
  if (!user.verified) {
    const delivery = emailDelivery(context);
    await mail.sendLink(email, user.first_name, 'verify', delivery);
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

  await restoreIfDeactivated(user);
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
  assertCanAuthenticate(user, {allowDeactivated: true});
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
  await restoreIfDeactivated(user);

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
  notifyInBackground('security.passkey_added', () =>
    mail.sendSecurityAlert({
      email: user.email,
      name: user.first_name,
      event: 'passkey_added',
      device: device_name,
    }),
  );

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
  assertCanAuthenticate(user, {allowDeactivated: true});

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

  await restoreIfDeactivated(user);
  const session = await createSession(user, context);

  return {
    data: withLegacySession(session, context),
    message: 'Login successful',
  };
}

export async function register(
  payload: IRegister,
  context: AuthClientContext = LEGACY_CLIENT,
) {
  const {email, first_name, last_name} = payload;
  const user = await User.findOne({email});
  if (user) {
    throw new NotFoundException('User with this email address already exists');
  }

  const password = await hashPassword(payload.password);
  const keys = generateKeys();

  const picture = generateDefaultAvatarUrl(email);
  const createdUser = await User.create({
    last_name,
    first_name,
    password,
    email,
    picture,
    referred_by: await referrals.inviter(payload.referral_code),
    ...keys,
  });
  await accountCreated(createdUser, 'email');
  const deliveryMode = emailDelivery(context, payload.delivery);
  await mail.sendLink(
    email,
    first_name || last_name || '',
    'verify',
    deliveryMode,
  );

  const data = {requires_verification: true, email};

  return {data, message: 'User registration successful'};
}

const recoveryCodes = new PasswordRecoveryCodes(redis);

export async function sendRecoveryCode(payload: {email: string}) {
  const email = payload.email.trim().toLowerCase();
  // Use the same response for unknown accounts and throttled requests.
  const code = await recoveryCodes.issue(email);
  const user = await User.findOne({email});
  if (user && code) await mail.sendRecoveryCode(email, user.first_name, code);
  return {
    message:
      'If an account exists for this email, a recovery code has been sent.',
    data: {email, resend_after: 60},
  };
}

export async function verifyRecoveryCode(payload: IVerifyRecoveryCode) {
  const email = payload.email.trim().toLowerCase();
  const token = await recoveryCodes.verify(email, payload.code);
  if (!token)
    throw new BadRequestException(
      'Invalid or expired code. Request a new code if needed.',
    );
  return {message: 'Code verified', data: {token}};
}

export async function sendLink(
  payload: ISendLink & {delivery?: 'link' | 'code'},
  context: AuthClientContext = LEGACY_CLIENT,
) {
  const {email, type = 'reset'} = payload;
  const user = await User.findOne({email});
  if (!user) {
    throw new NotFoundException('User not found');
  }

  const deliveryMode = emailDelivery(context, payload.delivery);

  await mail.sendLink(email, user.first_name, type, deliveryMode);

  return {
    message: `${type === 'reset' ? (deliveryMode === 'code' ? 'Password reset code' : 'Reset link') : deliveryMode === 'code' ? 'Verification code' : 'Verification link'} has been sent successfully`,
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
    // Lets older apps send this code to set-password without the address.
    await otp.markChecked(token, 'reset');
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

  assertCanAuthenticate(user, {allowDeactivated: true});
  await restoreIfDeactivated(user);
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
  const email = (payload as {email?: string}).email;

  // Verify the OTP using the centralized service
  const result = await otp.consume(token, 'reset', email);
  if (!result.valid) {
    throw new BadRequestException('Invalid or expired link');
  }

  const password = await hashPassword(payload.password);

  // Read the previous document: a first password set through an invitation
  // is not a change worth alerting about.
  const user = await User.findOneAndUpdate(
    {email: result.email},
    {
      $set: {password, refresh_token: null, refresh_tokens: []},
      $inc: {session_version: 1},
    },
    {new: false},
  );
  if (!user) throw new NotFoundException('User not found');
  await revokeAllSessions(user.id);
  await invalidateSecurityState(user.id);
  if (user.password) {
    notifyInBackground('security.password_reset', () =>
      mail.sendSecurityAlert({
        email: user.email,
        name: user.first_name,
        event: 'password_reset',
      }),
    );
  }

  return {data: null, message: 'Password reset successful'};
}

async function rememberAppleToken(userId: string, code: string) {
  try {
    const refreshToken = await exchangeAppleAuthorizationCode(code);
    if (!refreshToken) return;
    await User.updateOne(
      {_id: userId},
      {$set: {apple_refresh_token: encryptStoreSecret(refreshToken)}},
    );
  } catch (error) {
    logger.warn(
      {userId, errorCode: error instanceof Error ? error.name : 'unknown'},
      'Could not store the Sign in with Apple token',
    );
  }
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
