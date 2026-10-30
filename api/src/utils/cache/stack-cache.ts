export type DataType = "string" | "number" | "boolean" | "json";

export class StackMemoryCache {
  private buffer: Uint8Array;
  private view: DataView;
  private stackPointer: number = 0;

  constructor(sizeInBytes: number = 1024) {
    this.buffer = new Uint8Array(sizeInBytes);
    this.view = new DataView(this.buffer.buffer);
  }

  private serialize(value: unknown, type: DataType): Uint8Array {
    const encoder = new TextEncoder();
    let payload: Uint8Array;
    let typeId: number;

    switch (type) {
      case "number":
        typeId = 1;
        payload = new Uint8Array(8);
        new DataView(payload.buffer).setFloat64(0, value as number, true); // Little-endian
        break;
      case "boolean":
        typeId = 2;
        payload = new Uint8Array([(value as boolean) ? 1 : 0]);
        break;
      case "string":
        typeId = 3;
        payload = encoder.encode(value as string);
        break;
      case "json":
        typeId = 4;
        payload = encoder.encode(JSON.stringify(value));
        break;
      default:
        throw new Error(`Unsupported type: ${type}`);
    }

    // Header: 1 byte for Type ID + 4 bytes for Length
    const result = new Uint8Array(1 + 4 + payload.length);
    const resultView = new DataView(result.buffer);

    resultView.setUint8(0, typeId);
    resultView.setUint32(1, payload.length, true);
    result.set(payload, 5);

    return result;
  }

  private deserialize(data: Uint8Array): { value: unknown; type: DataType } {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const typeId = view.getUint8(0);
    const length = view.getUint32(1, true);
    const payload = data.subarray(5, 5 + length);

    const decoder = new TextDecoder();

    switch (typeId) {
      case 1: // number
        return { value: view.getFloat64(5, true), type: "number" };
      case 2: // boolean
        return { value: view.getUint8(5) === 1, type: "boolean" };
      case 3: // string
        return { value: decoder.decode(payload), type: "string" };
      case 4: // json
        return { value: JSON.parse(decoder.decode(payload)), type: "json" };
      default:
        throw new Error(`Unknown type ID: ${typeId}`);
    }
  }

  push(value: unknown, type: DataType): number {
    const serialized = this.serialize(value, type);

    if (this.stackPointer + serialized.length > this.buffer.length) {
      throw new Error("Stack overflow: Out of memory buffer space.");
    }

    const startOffset = this.stackPointer;

    // Write encoded bytes directly into the memory buffer
    this.buffer.set(serialized, startOffset);
    this.stackPointer += serialized.length;

    return startOffset;
  }

  /**
   * Reads and parses a value from a specific memory offset without changing stack pointer.
   */
  peekAt(offset: number): { value: unknown; type: DataType } {
    const length = this.view.getUint32(offset + 1, true);
    const totalBytes = 1 + 4 + length;
    const slice = this.buffer.subarray(offset, offset + totalBytes);

    return this.deserialize(slice);
  }

  get bytesUsed(): number {
    return this.stackPointer;
  }

  clear(): void {
    this.stackPointer = 0;
  }
}
