import { z } from "zod";
import { UpdateUserSchema } from "../../utils/schemas/user.schema";

// PUT /user/:id body; ativo and senha are optional
type PayloadUpdateUsuarioDto = z.input<typeof UpdateUserSchema>;

export { PayloadUpdateUsuarioDto };
