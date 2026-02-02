import e, { NextFunction, Response } from "express";
import { IRequest } from "../../../utils/interface";
import { getPagination, responsHandler, validateRequest } from "../../../utils/helpers";
import * as service from "./service"
import { StatusCodes } from "http-status-codes";

export async function createCapsule(req: IRequest, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = await service.createCapsule(req.body, req.auth.id)
    return responsHandler(res, StatusCodes.CREATED, message, data)
  } catch (error) {
    next(error)
  }
}

export async function updateCapsule(req: IRequest, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = await service.updateCapsule(req.params.id, req.body, req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}
export async function getCapsules(req: IRequest, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = await service.getCapsules(getPagination(req), req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}
export async function getCapsule(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.getCapsule(req.params?.id, req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}
export async function deleteCapsule(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.deleteCapsule(req.params?.id, req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function getCapsuleStats(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.getCapsuleStats(req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}