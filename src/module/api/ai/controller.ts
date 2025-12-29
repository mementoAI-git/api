import { NextFunction, Response } from "express";
import { getPagination, responsHandler, validateRequest } from "../../../utils/helpers"
import * as service from "./service";
import { IRequest } from "../../../utils/interface";
import { StatusCodes } from "http-status-codes";

export async function prompt(req: IRequest, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const response = await service.prompt(req.body, req.auth.id)
    return await service.handleStreaming(
      req.auth.id,
      req.body.memory,
      response,
      res
    )
  } catch (error) {
    console.log(error)
    next(error)
  }
}

export async function getUserMessages(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.getUserMessages(getPagination(req), req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function getUserMessagesByConversation(req: IRequest, res: Response, next: NextFunction) {
  try {
    validateRequest(req)

    const { message, data } = await service.getUserMessagesByConversation(
      req.params.id,
      getPagination(req),
      req.auth.id
    )

    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function startConversation(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.startConversation(req.body, req.auth.id)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function transcribeAudio(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.transcribeAudio(req.body)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function getEphemeralToken(req: IRequest, res: Response, next: NextFunction) {
  try {
    const { message, data } = await service.createEphemeralToken()
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}