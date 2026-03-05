import Group, { IGroup } from "../../database/model/group";
import Beneficiary from "../../database/model/beneficiary";
import { filterGenerator, isEmpty } from "../../../utils/helpers";
import { IPagination } from "../../../utils/interface";
import { BadRequestException, NotFoundException } from "../../../utils/service-error";
import { CreateGroupBody, UpdateGroupBody } from "./dto";

export async function create(
  payload: CreateGroupBody,
  user_id: string
) {
  const data = await Group.create({
    name: payload.name.trim(),
    description: payload.description?.trim() ?? "",
    user: user_id,
    members: [],
  });
  return { message: "Group created successfully", data };
}

export async function list(
  { page, limit, ...query }: IPagination,
  user_id: string
) {
  const filters = filterGenerator(query, ["name"]);

  filters.push({ user: user_id });

  const data = await Group.paginate(
    { $and: filters },
    {
      page,
      limit,
      sort: { created_at: -1 },
      populate: { path: "members", select: "name email relationship status" },
    }
  );
  return { message: "Groups retrieved successfully", data };
}

export async function getOne(id: string, user_id: string) {
  const group = await Group
    .findOne({ _id: id, user: user_id })
    .populate(
      "members",
      "name email relationship status"
    );
  if (!group) {
    throw new NotFoundException("Group not found");
  }
  return { message: "Group retrieved successfully", data: group };
}

export async function update(
  id: string,
  payload: UpdateGroupBody,
  user_id: string
) {
  const group = await Group.findOne({ _id: id, user: user_id });
  if (!group) {
    throw new NotFoundException("Group not found");
  }

  if (payload.name !== undefined) {
    group.name = payload.name.trim();
  }
  if (payload.description !== undefined) {
    group.description = payload.description.trim();
  }

  await group.save();

  return { message: "Group updated successfully", data: group };
}

export async function del(id: string, user_id: string) {
  const group = await Group.findOne({ _id: id, user: user_id });
  if (!group) {
    throw new NotFoundException("Group not found");
  }
  await group.deleteOne();
  return { message: "Group deleted successfully", data: group };
}

export async function addMembers(
  id: string,
  beneficiaryIds: string[],
  user_id: string
) {
  const group = await Group.findOne({ _id: id, user: user_id });
  if (!group) {
    throw new NotFoundException("Group not found");
  }
  const beneficiaries = await Beneficiary.find({
    _id: { $in: beneficiaryIds },
    benefactor: user_id,
  });
  if (isEmpty(beneficiaries)) {
    throw new NotFoundException("Beneficiaries not found");
  }

  await Group.updateOne(
    { _id: id },
    { $addToSet: { members: { $each: beneficiaries.map((b) => b.id) } } },
  );

  return {
    message: "Members added successfully",
    data: null,
  };
}

export async function removeMember(
  id: string,
  beneficiaryId: string,
  user_id: string
) {
  const group = await Group.findOne({ _id: id, user: user_id });
  if (!group) {
    throw new NotFoundException("Group not found");
  }
  const beneficiary = await Beneficiary.findOne({
    _id: beneficiaryId,
    benefactor: user_id,
  });
  if (!beneficiary) {
    throw new NotFoundException("Beneficiary not found");
  }

  await Group.updateOne(
    { _id: id },
    { $pull: { members: beneficiaryId } },
  );

  return {
    message: "Member removed successfully",
    data: null,
  };
}

export async function search(query: string, user_id: string) {
  const SEARCH_LIMIT = 20;
  const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

  const [groups, beneficiaries] = await Promise.all([
    Group.find({
      user: user_id,
      name: regex,
    })
      .select("name")
      .limit(SEARCH_LIMIT)
      .lean(),
    Beneficiary.find({
      benefactor: user_id,
      $or: [{ name: regex }, { email: regex }],
    })
      .select("name email")
      .limit(SEARCH_LIMIT)
      .lean(),
  ]);

  const searchResults = groups
    .map((group) => ({
      name: group.name,
      id: group.id,
      source: "group"
    })).concat(beneficiaries.map((beneficiary) => ({
      name: beneficiary.name,
      id: beneficiary.id,
      source: "beneficiary"
    })));

  return {
    message: "Search completed successfully",
    data: searchResults,
  };
}
