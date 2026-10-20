import { UsuarioResponseDto } from "../dtos/usuario_dtos/usuario_response.dto";

declare global {
   namespace Express {
      interface Request {
         // set by AuthMiddleware.authenticate for every route behind it
         user?: UsuarioResponseDto;
         // the usuario's current session version, already checked against the token
         sessaoVersao?: number;
      }
   }
}

export {};
