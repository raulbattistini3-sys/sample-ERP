import { gunzipSync } from "node:zlib";
import { Request, Response, NextFunction } from "express";
import BaseController from "./base.controller";
import LoggerInterface from "../interfaces/logger_interfaces/logger_interface.interface";
import ProductSnapshotService from "../services/product_snapshot.service";
import { isAdminRole } from "../utils/helpers/permissoes.util";

// the TCC1 columnar format of pkg/tablecore; the web checks it before opening the body
export const SNAPSHOT_CONTENT_TYPE = "application/vnd.sample-erp.columnar";

class ProductSnapshotController extends BaseController {
   constructor(
      private readonly snapshots: ProductSnapshotService,
      logger: LoggerInterface,
   ) {
      super(logger);
   }

   // GET /products/snapshot: the visible products as one binary file, gzipped. The ETag lets the browser
   // revalidate (no-cache) and get a 304 instead of the whole file again while nothing changed.
   get = async (req: Request, res: Response, next: NextFunction) => {
      const result = await this.snapshots.get(isAdminRole(req.user?.permissoes));
      if (result.isLeft()) {
         return this.fail(req, next, result.value);
      }
      const s = result.value;
      res.setHeader("ETag", s.etag);
      // private: per role; no-cache: kept by the browser but checked against the ETag every time
      res.setHeader("Cache-Control", "private, no-cache");
      res.setHeader("Vary", "Authorization, Accept-Encoding");
      res.setHeader("X-Snapshot-Rows", String(s.rows));
      res.setHeader("X-Snapshot-Bytes", String(s.bytes));
      if (req.headers["if-none-match"] === s.etag) {
         return res.status(304).end();
      }
      res.type(SNAPSHOT_CONTENT_TYPE);
      if (req.acceptsEncodings("gzip")) {
         res.setHeader("Content-Encoding", "gzip");
         return res.status(200).send(s.gzip);
      }
      // a client without gzip (rare): inflate this once for it, the cache keeps only the gzip
      return res.status(200).send(gunzipSync(s.gzip));
   };
}

export default ProductSnapshotController;
