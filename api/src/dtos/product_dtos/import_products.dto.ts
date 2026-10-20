import { NewProductEntity } from "../../entities/product.entity";

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

export { ImportRowErrorDto, ImportProductsResultDto, ProductImportWrites };
