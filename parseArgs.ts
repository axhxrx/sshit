export type Options = {
  version?: boolean;
};

/**
 Parse CLI args.
 */
export function parseArgs(args: string[]): Readonly<Options> {
  const result: Options = {};
  for (const arg of args) {
    const [key, _value] = arg.split("=");
    if (key === "--version") {
      result.version = true;
    }
  }
  return result as Readonly<Options>;
}
