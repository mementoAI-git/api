import { NextFunction, Response } from "express";
import { StatusCodes } from "http-status-codes"
import { getPagination, responsHandler, validateRequest } from "../../../utils/helpers"
import * as service from "./service"
import { IRequest } from "../../../utils/interface";

export async function memoryStats(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.memoryStats(req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function bookmark(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.bookmark(req.params.id, req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function createMemory(req: IRequest, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = await service.createMemory(req.body, req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function getMemories(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.getMemories(getPagination(req), req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function getMemory(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.getMemory(req.params.id, req.auth?.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function updateMemory(req: IRequest, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = await service.updateMemory(req.params.id, req.body, req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function deleteMemory(req: IRequest, res: Response, next: NextFunction) {
  try {
    console.log("Delete memories")
    const { message, data } = await service.deleteMemory(req.params.id, req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function unbookmark(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.unbookmark(req.params.id, req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}