// `libheif-js/wasm-bundle` 只提供 emscripten 打包的产物，自带的 .d.ts 描述的是底层 Runtime，
// 不含高层 `HeifDecoder` 接口，这里按实际运行时 API 补一份最小声明。
declare module 'libheif-js/wasm-bundle' {
  export interface HeifImageHandle {
    get_width(): number;
    get_height(): number;
    /** 把解码结果写入 target（尺寸必须与 get_width/get_height 一致），异步回调返回同一对象或 null。 */
    display(target: ImageData, callback: (result: ImageData | null) => void): void;
    /** 释放 wasm 堆上的解码句柄，不释放会持续占用内存。 */
    free?(): void;
  }

  export class HeifDecoder {
    constructor();
    decode(data: Uint8Array | ArrayBuffer): HeifImageHandle[];
  }
}
