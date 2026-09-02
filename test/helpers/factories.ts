import {HydratedDocument} from 'mongoose';
import User, {IUser} from '../../src/module/database/model/user';
import {createAccessToken} from '../../src/utils/helpers';

let userSequence = 0;

export async function createUserFixture(
  overrides: Partial<IUser> = {},
): Promise<HydratedDocument<IUser>> {
  userSequence += 1;

  return User.create({
    email: `user-${userSequence}@example.com`,
    first_name: 'Test',
    last_name: `User ${userSequence}`,
    nickname: `tester-${userSequence}`,
    password: 'not-a-real-password-hash',
    providers: ['password'],
    verified: true,
    deleted: false,
    ...overrides,
  });
}

export function issueLegacyAccessToken(user: HydratedDocument<IUser>): string {
  return createAccessToken(String(user._id)).access_token;
}
