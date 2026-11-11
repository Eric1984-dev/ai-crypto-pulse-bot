import bcrypt from "bcryptjs";
import { stdin, stdout } from "node:process";

if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
  throw new Error("Run this command from an interactive terminal.");
}

stdout.write("Enter dashboard password (input hidden): ");
stdin.setRawMode(true);
stdin.setEncoding("utf8");
stdin.resume();

let password = "";
let finished = false;
stdin.on("data", async (chunk) => {
  if (finished) {
    return;
  }
  for (const character of chunk) {
    if (character === "\u0003") {
      finish(new Error("Password hashing cancelled."));
      return;
    }
    if (character === "\r" || character === "\n") {
      finished = true;
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      if (!password || Buffer.byteLength(password, "utf8") > 72) {
        password = "";
        stdout.write("Password must contain 1 to 72 UTF-8 bytes.\n");
        process.exitCode = 1;
        return;
      }
      try {
        const hash = await bcrypt.hash(password, 12);
        password = "";
        stdout.write(`${hash}\n`);
      } catch {
        password = "";
        stdout.write("Password hashing failed.\n");
        process.exitCode = 1;
      }
      return;
    }
    if (character === "\u007f" || character === "\b") {
      password = Array.from(password).slice(0, -1).join("");
    } else {
      password += character;
    }
  }
});

function finish(error) {
  if (finished) {
    return;
  }
  finished = true;
  password = "";
  stdin.setRawMode(false);
  stdin.pause();
  stdout.write(`\n${error.message}\n`);
  process.exitCode = 1;
}
