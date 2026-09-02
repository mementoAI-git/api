import User from '../../module/database/model/user';

export async function isActiveAccount(userId: string): Promise<boolean> {
  return Boolean(
    await User.exists({
      _id: userId,
      deleted: {$ne: true},
      disabled: {$ne: true},
      purge_status: {$nin: ['purge_pending', 'purged']},
    }),
  );
}
