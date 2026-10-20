import { BaseAppError } from "../../errors/global_error.error";
import { Either } from "../../globals/errors/left_right_either.error";

interface IPasswordResetRepository {
   // whether usuarioId got a link in the last `seconds` (throttles repeated requests)
   hasRecentToken(usuarioId: string, seconds: number): Promise<Either<BaseAppError, boolean>>;
   // stores a new link (by hash), invalidating the usuario's earlier unused ones
   createToken(usuarioId: string, tokenHash: string, ttlMinutes: number): Promise<Either<BaseAppError, null>>;
   // single use: marks the token used and sets the new senha hash in one transaction;
   // 400 when the token is unknown, used, expired, or its usuario is inactive
   consumeToken(tokenHash: string, senhaHash: string): Promise<Either<BaseAppError, null>>;
}

export default IPasswordResetRepository;
