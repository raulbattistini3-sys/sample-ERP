import { v4 as uuid } from "uuid";
import { z } from "zod";
import { ValidationError } from "../errors/client_errors/four_xx.error";
import { Either, left, right } from "../globals/errors/left_right_either.error";
import { IBaseValidator } from "../interfaces/general_interfaces/base_validator.interface";

class BaseValidator implements IBaseValidator {
   constructor() {}
   private isValidUUID(uuid: string): boolean {
      const uuidRegex =
         /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      return uuidRegex.test(uuid);
   }
   private isValidUUIDv4(uuid: string): boolean {
      const uuidv4Regex =
         /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{8}-[0-9a-f]{4}-[1][0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
      return uuidv4Regex.test(uuid);
   }
   private validateNumber(value: number): Either<ValidationError, null> {
      if (isNaN(value)) {
         return left(new ValidationError("400", "Invalid number format"));
      }
      return right(null);
   }
   validatePageAndAmount(
      page: number,
      amount: number,
   ): Either<ValidationError, null> {
      if (
         this.validateNumber(page).isLeft() ||
         this.validateNumber(amount).isLeft()
      ) {
         return left(new ValidationError("400", "Invalid page or amount"));
      }
      // pages are 1-based; page 0 or amount 0 would slice out an empty list
      if (page < 1 || amount < 1) {
         return left(new ValidationError("400", "Invalid page or amount"));
      }
      return right(null);
   }
   validateString(value: string): Either<ValidationError, null> {
      if (typeof value !== "string") {
         return left(new ValidationError("400", "Invalid string format"));
      }
      return right(null);
   }
   validateUUID(uuid: string): Either<ValidationError, null> {
      if (!this.isValidUUID(uuid)) {
         return left(new ValidationError("400", "Invalid UUID format"));
      }
      return right(null);
   }

   validateUUIDv4(uuid: string): Either<ValidationError, null> {
      if (!this.isValidUUIDv4(uuid)) {
         return left(new ValidationError("400", "Invalid UUIDv4 format"));
      }
      return right(null);
   }
}

export default BaseValidator;
