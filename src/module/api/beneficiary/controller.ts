import { NextFunction, Response } from "express";
import { StatusCodes } from "http-status-codes"
import { getPagination, responsHandler, validateRequest } from "../../../utils/helpers"
import * as service from "./service"
import { IRequest } from "../../../utils/interface";

export async function create(req: IRequest, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = await service.create(req.body, req.auth.id)
    return responsHandler(res, StatusCodes.CREATED, message, data)
  } catch (error) {
    next(error)
  }
}

export async function list(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.list(getPagination(req), req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function del(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.del(req.params.id, req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function update(req: IRequest, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = await service.update(req.params.id, req.body, req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function resendInvite(req: IRequest, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = await service.resendInvite(req.body, req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function acceptInvite(req: IRequest, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = await service.acceptInvite(req.body)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function getInvite(req: IRequest, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = await service.getInvite(req.params.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}