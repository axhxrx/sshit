import { type Options, parseArgs } from "./parseArgs.ts";

export class App {
  private static _shared: App;

  static get shared(): App {
    if (!this._shared) {
      throw new Error("App is not initialized. Call App.init() first.");
    }
    return this._shared;
  }

  static init(args: string[]) {
    const options = parseArgs(args);
    this._shared = new this(options);
  }

  private constructor(readonly options: Options) {}
}
