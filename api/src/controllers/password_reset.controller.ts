import { Request, Response, NextFunction } from "express";
import BaseController from "./base.controller";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import PasswordResetService from "../services/password_reset.service";

class PasswordResetController extends BaseController {
  constructor(
    private passwordResetService: PasswordResetService,
    logger: LoggerInterface,
  ) {
    super(logger);
  }

  // 202 with the same message whether or not the email exists
  forgotPassword = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.passwordResetService.requestReset(req.body);
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(202).json(result.value);
  };

  resetPassword = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.passwordResetService.resetPassword(req.body);
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(204).send();
  };
}

export default PasswordResetController;
