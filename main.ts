import { init } from "@axhxrx/ops";
import { App } from "./App.ts";
import { SSHitRootOp } from "./SSHitRootOp.ts";
import process from "node:process";

export async function main() {
  const { args, opsMain } = init(process.argv.slice(2));
  App.init(args);

  // Create and run your root op
  const outcome = await opsMain(new SSHitRootOp());

  if (!outcome.ok) {
    console.error(`Failed: ${outcome}`);
    process.exit(1);
  }
}
