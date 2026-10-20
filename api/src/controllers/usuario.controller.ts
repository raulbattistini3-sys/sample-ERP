import { Request, Response, NextFunction } from "express";
import BaseController from "./base.controller";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import IUsuarioService from "../interfaces/usuario_interfaces/usuario_service.interface";

class UsuarioController extends BaseController {
  constructor(
    private usuarioService: IUsuarioService,
    logger: LoggerInterface,
  ) {
    super(logger);
  }

  create = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.usuarioService.createUsuario(req.body);
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(201).json(result.value);
  };

  getById = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.usuarioService.findUserById(req.params.id as string);
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(200).json(result.value);
  };

  getAll = async (req: Request, res: Response, next: NextFunction) => {
    const page = Number(req.query.page ?? 1);
    const amount = Number(req.query.amount ?? 20);
    const result = await this.usuarioService.getUsers(page, amount);
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(200).json(result.value);
  };

  update = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.usuarioService.updateUser(req.params.id as string, req.body);
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(204).send();
  };

  delete = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.usuarioService.deleteUser(req.params.id as string);
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(204).send();
  };

  archive = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.usuarioService.archiveUser(req.params.id as string);
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(200).json(result.value);
  };

  // behind AuthMiddleware.authenticate, so req.user is the freshly loaded, active usuario
  refreshToken = (req: Request, res: Response) => {
    return res.status(200).json(this.usuarioService.refreshToken(req.user!));
  };

  login = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.usuarioService.loginUsuario(req.body);
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(200).json(result.value);
  };

  register = async (req: Request, res: Response, next: NextFunction) => {
    const result = await this.usuarioService.registerUsuario(req.body);
    if (result.isLeft()) {
      return this.fail(req, next, result.value);
    }
    return res.status(201).json(result.value);
  };
}

export default UsuarioController;
