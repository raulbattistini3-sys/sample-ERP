import { DEFAULT_STATUS_CODE } from "../../globals/global_error.global";

// maps an error's statusCode to a valid HTTP error status; Express 5's res.status throws on anything else
const toHttpStatus = (statusCode: string) => {
   const status = Number(statusCode);
   return Number.isInteger(status) && status >= 400 && status <= 599
      ? status
      : DEFAULT_STATUS_CODE;
};

export default toHttpStatus;
