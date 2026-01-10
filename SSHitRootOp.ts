import { SelectFromListOp } from "@axhxrx/ops";
import type { IOContext } from "../ops/IOContext.ts";
import { Op } from "../ops/Op.ts";

class ExitOp extends Op {
  override name = "ExitOp";

  constructor(readonly exitCode: number) {
    super();
  }

  override async run(_io?: IOContext) {
    return await this.succeed(this.exitCode);
  }
}

export class SSHitRootOp extends Op {
  override name = "SSHitRootOp";

  override async run(_io?: IOContext) {
    const io = _io ?? this.getIO();
    await Promise.resolve();
    const menu = new SelectFromListOp(["Do not quit", "Quit"]);

    return this.handleOutcome(menu, (outcome) => {
      if (outcome.ok) {
        // console.log("Outcome:", outcome);
        return outcome.value === "Quit" ? new ExitOp(1) : this;
      } else {
        this.log(
          io,
          `Exiting due to Ctrl-C or menu failure. ${JSON.stringify(outcome)}`
        );
        return new ExitOp(1);
      }
    });
  }
}
