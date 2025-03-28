import { NextFunction, Request, Response } from "express";
import * as service from "./service"
import { responsHandler, validateRequest } from "../../utils/helpers";
import { StatusCodes } from "http-status-codes";

export function generateOauthUrl(req: Request, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = service.generateOauthUrl(req.params.provider)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function authorization(req: Request, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = await service.oauthAuthorization(req.body, req.params.provider)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = await service.login(req.body)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = await service.register(req.body)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function sendAuthCode(req: Request, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = await service.sendAuthCode(req.body)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}

export async function verifyCode(req: Request, res: Response, next: NextFunction) {
  try {
    validateRequest(req)
    const { message, data } = await service.verifyCode(req.body)
    return responsHandler(res, StatusCodes.OK, message, data)
  } catch (error) {
    next(error)
  }
}