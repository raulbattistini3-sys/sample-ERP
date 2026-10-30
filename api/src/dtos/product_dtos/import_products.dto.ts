import { DrizzleDB } from "../../db/client";
import { NewProductEntity } from "../../entities/product.entity";
import { CreateProductDto } from "./create_product.dto";

// one error entry per spreadsheet line (the line number the user sees in Excel)
type ImportRowErrorDto = { linha: number; mensagens: string[] };

// nothing is saved when errors is non-empty
type ImportProductsResultDto = {
   created: number;
   updated: number;
   errors: ImportRowErrorDto[];
};

type ProductImportWrites = {
   creates: NewProductEntity[];
   updates: { id: string; values: Partial<NewProductEntity> }[];
};

// a row as read from the spreadsheet: validated on its own, so its fields are still unknown
type ImportRowPayload = { linha: number } & Record<string, unknown>;

type ValidatedImportRow = { linha: number; dto: CreateProductDto };

type ImportRowsOptions = {
   // lines already refused while reading the file; they count as errors of this import
   rowErrors?: ImportRowErrorDto[];
   // runs on the transaction that writes the products, so its work commits or rolls back with them
   onSaved?: (tx: DrizzleDB, counts: { created: number; updated: number }) => Promise<void>;
};

export { ImportRowErrorDto, ImportProductsResultDto, ImportRowPayload, ImportRowsOptions, ProductImportWrites, ValidatedImportRow };
