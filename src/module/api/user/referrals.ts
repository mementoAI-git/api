import User from '../../database/model/user';
import {ReferralTracker} from '../../../services/referrals';
import {NotFoundException} from '../../../utils/service-error';

export const referrals = new ReferralTracker({
  async getCode(userId) {
    const user = await User.findOne({_id: userId, deleted: {$ne: true}}).select(
      '+referral_code',
    );
    if (!user) throw new NotFoundException('User not found');
    return user.referral_code || null;
  },
  async ensureCode(userId, code) {
    await User.updateOne(
      {_id: userId, referral_code: {$exists: false}},
      {$set: {referral_code: code}},
    );
    const user = await User.findById(userId).select('+referral_code');
    if (!user?.referral_code)
      throw new NotFoundException('Invite link unavailable');
    return user.referral_code;
  },
  async findInviter(code) {
    const user = await User.findOne({
      referral_code: code,
      deleted: {$ne: true},
    }).select('_id');
    return user?.id;
  },
  async countSignups(userId) {
    return User.countDocuments({referred_by: userId});
  },
});
