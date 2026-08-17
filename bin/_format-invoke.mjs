/**
 * Format `eve invoke` JSON result into something human-friendly on stdout.
 * Pass the JSON on stdin (or as argv[2]).
 */
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const raw = input.trim();
  try {
    const r = JSON.parse(raw);
    if (r?.status === "ready" && r?.outcome?.status === "completed" && typeof r.outcome.message === "string") {
      process.stdout.write(r.outcome.message.replace(/\s+$/, "") + "\n");
      process.exit(0);
    }
    if (typeof r?.message === "string") {
      process.stdout.write(r.message.replace(/\s+$/, "") + "\n");
    } else {
      process.stdout.write(raw + "\n");
    }
  } catch {
    process.stdout.write(raw + "\n");
  }
});
