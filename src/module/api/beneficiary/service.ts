import mail from '../../mail';
import {
  compareStrings,
  filterGenerator,
  generateDefaultAvatarUrl,
  isEmpty,
} from '../../../utils/helpers';
import {IPagination} from '../../../utils/interface';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '../../../utils/service-error';
import Beneficiary, {IBeneficiary} from '../../database/model/beneficiary';
import Group from '../../database/model/group';
import {track} from '../activity/service';
import dayjs from 'dayjs';
import {IAcceptInivite} from './interface';
import User from '../../database/model/user';
import {v4 as uuid} from 'uuid';
import AuthCode from '../../database/model/auth-code';
import {CreateBeneficiaryBody} from './dto';
import otp from '../../../services/otp';
import {acquireUsageSlot, applyUsageDelta} from '../billing/usage-accounting';
import mongoose from 'mongoose';

export async function create(payload: CreateBeneficiaryBody, user_id: string) {
  const {
    email,
    name = '',
    about = '',
    relationship = 'friend',
    avatar_file_id = null,
  } = payload;
  const groups =
    payload.groups && payload.groups.length > 0
      ? payload.groups
      : payload.group_ids || [];

  const benefactor = await User.findOne({_id: user_id});
  if (!benefactor) {
    throw new UnauthorizedException('benefactor not found');
  }

  if (compareStrings(benefactor.email, email)) {
    throw new BadRequestException("Can't add self as a beneficiary");
  }

  const beneficiary = await Beneficiary.findOne({benefactor: user_id, email});
  if (beneficiary) {
    throw new BadRequestException('Beneficiary has already been invited');
  }

  const user = await User.findOne({email});

  let data;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await acquireUsageSlot(
        user_id,
        'beneficiary_count',
        2,
        'beneficiaries',
        session,
      );
      [data] = await Beneficiary.create(
        [
          {
            email,
            name,
            about,
            avatar_file_id,
            relationship,
            due_at: dayjs().add(3, 'days').toDate(),
            user: user?.id || null,
            benefactor: user_id,
          },
        ],
        {session},
      );
    });
  } finally {
    await session.endSession();
  }

  if (data && groups.length > 0) {
    const userGroups = await Group.find({_id: {$in: groups}, user: user_id});
    if (userGroups.length > 0) {
      const groupIds = userGroups.map(g => g.id);
      await Group.updateMany(
        {_id: {$in: groupIds}},
        {$addToSet: {members: data.id}},
      );
    }
  }

  if (data) {
    await mail.sendBeneficiaryInvite(data);
    await track(
      {
        title: 'Beneficiary Invited',
        description: `Invited beneficiary: "${name}"`,
        type: 'beneficiary',
        action: 'created',
        reference: data.id,
      },
      user_id,
    );
  }

  return {message: 'Beneficiary added successfully', data};
}

export async function list(
  {page, limit, ...query}: IPagination,
  user_id: string,
) {
  const filters = filterGenerator(query, ['name', 'email', 'relationship']);
  filters.push({benefactor: user_id});

  const data = await Beneficiary.paginate(
    {$and: filters},
    {
      page,
      limit,
      sort: {created_at: -1},
      populate: {
        path: 'user',
        select: 'email first_name last_name picture picture_url',
      },
      lean: true,
    },
  );

  const docs = (data.docs || []) as Array<IBeneficiary & {_id: unknown}>;
  const beneficiaryIds = docs.map(d => String(d._id));
  const beneficiaryIdSet = new Set(beneficiaryIds);
  const groupsByBeneficiaryId: Record<
    string,
    Array<{_id: string; name: string}>
  > = {};

  if (beneficiaryIds.length > 0) {
    const groups = await Group.find({
      user: user_id,
      members: {$in: beneficiaryIds},
    })
      .select('_id name members')
      .lean();

    for (const g of groups) {
      const groupInfo = {_id: String(g._id), name: g.name};
      for (const memberId of g.members || []) {
        const id = String(memberId);
        if (beneficiaryIdSet.has(id)) {
          if (!groupsByBeneficiaryId[id]) groupsByBeneficiaryId[id] = [];
          groupsByBeneficiaryId[id].push(groupInfo);
        }
      }
    }
  }

  const docsWithGroups = docs.map(doc => ({
    ...doc,
    groups: groupsByBeneficiaryId[String(doc._id)] || [],
  }));

  return {
    message: 'Beneficiary retrieved successfully',
    data: {...data, docs: docsWithGroups},
  };
}

export async function del(id: string, user_id: string) {
  const session = await mongoose.startSession();
  let beneficiary;
  try {
    await session.withTransaction(async () => {
      beneficiary = await Beneficiary.findOneAndDelete(
        {_id: id, benefactor: user_id},
        {session},
      );
      if (!beneficiary) {
        throw new NotFoundException('Beneficiary not found');
      }
      await applyUsageDelta(user_id, 'beneficiary_count', -1, session);
    });
  } finally {
    await session.endSession();
  }

  await track(
    {
      title: 'Beneficiary Deleted',
      description: `Deleted beneficiary: "${beneficiary!.name}"`,
      type: 'beneficiary',
      action: 'deleted',
      reference: beneficiary!.id,
    },
    user_id,
  );

  return {message: 'Beneficiary deleted successfully', data: beneficiary!};
}

export async function update(
  id: string,
  payload: Partial<IBeneficiary>,
  user_id: string,
) {
  const user = await User.findOne({_id: user_id});
  if (!user) {
    throw new UnauthorizedException('User not found');
  }

  if (!isEmpty(payload?.email)) {
    if (compareStrings(user.email, payload.email)) {
      throw new BadRequestException("Can't add self as a beneficiary");
    }
  }

  const beneficiary = await Beneficiary.findOne({_id: id, benefactor: user_id});
  if (!beneficiary) {
    throw new NotFoundException('Beneficiary not found');
  }
  if (beneficiary.status !== 'pending') {
    throw new BadRequestException(`Invite has been ${beneficiary.status}`);
  }

  const data = await Beneficiary.findByIdAndUpdate(
    id,
    {
      email: payload?.email || beneficiary?.email,
      level: payload?.level || beneficiary?.level,
      relationship: payload?.relationship || beneficiary?.relationship,
    },
    {new: true},
  );

  await track(
    {
      title: 'Beneficiary Updated',
      description: `Updated beneficiary: "${beneficiary.name}"`,
      type: 'beneficiary',
      action: 'updated',
      reference: beneficiary.id,
    },
    user_id,
  );

  return {message: 'Beneficiary updated successfully', data};
}

export async function resendInvite(
  payload: Pick<IBeneficiary, 'email'>,
  user_id: string,
) {
  const {email} = payload;

  const beneficiary = await Beneficiary.findOne({email, benefactor: user_id});
  if (!beneficiary) {
    throw new NotFoundException('Beneficiary not found');
  }
  if (beneficiary.status === 'accepted') {
    throw new BadRequestException('Beneficiary already accepted');
  }

  await beneficiary.updateOne({due_at: dayjs().add(3, 'days').toDate()});

  await mail.sendBeneficiaryInvite(beneficiary);
  return {message: 'Invite sent successfully', data: beneficiary};
}

export async function getInvite(id: string) {
  const beneficiary = await Beneficiary.findById(id).populate(
    'benefactor',
    'first_name last_name email picture picture_url',
  );
  if (beneficiary.status !== 'pending') {
    throw new BadRequestException(`Invite has been ${beneficiary.status}`);
  }
  if (dayjs(beneficiary.due_at).isBefore(dayjs())) {
    throw new BadRequestException('Invite has exipred');
  }

  return {message: 'Invite retrieved successfully', data: beneficiary};
}

export async function acceptInvite(payload: IAcceptInivite) {
  const {invite_id, first_name, last_name, dob} = payload;

  const beneficiary = await Beneficiary.findById(invite_id);
  if (beneficiary.status !== 'pending') {
    throw new BadRequestException(`Invite has been ${beneficiary.status}`);
  }

  const {email} = beneficiary;
  let token: string | null = null;

  let user = await User.findOne({email});
  if (isEmpty(user)) {
    const picture = generateDefaultAvatarUrl(email);
    user = await User.create({
      first_name,
      last_name,
      dob,
      email,
      picture,
    });

    // Generate reset token using Redis OTP service
    token = await otp.create(email, 'reset');
  }

  beneficiary.user = user.id;
  beneficiary.status = 'accepted';
  beneficiary.accepted_at = dayjs().toISOString();
  await beneficiary.save();

  return {message: 'Invite retrieved successfully', data: {token}};
}
