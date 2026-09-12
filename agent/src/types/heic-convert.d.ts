declare module "heic-convert" {
  function convert(options: {
    buffer: Buffer;
    format: "JPEG" | "PNG";
    quality?: number;
  }): Promise<Buffer>;
  export default convert;
}
