import { startMcpServer } from "./mcp.js";
import { antigravityDoctor, antigravitySetup } from "./tools/doctor.js";
import { TOOL_DEFINITIONS } from "./schemas/tools.js";
import { redactSecrets } from "./core/safety.js";
async function main() {
    if (process.argv.includes("--doctor")) {
        const payload = await antigravityDoctor({ includeHelp: process.argv.includes("--include-help"), includeAuthStatus: true });
        process.stdout.write(redactSecrets(JSON.stringify(payload, null, 2)) + "\n");
        return;
    }
    if (process.argv.includes("--setup")) {
        const payload = await antigravitySetup({ includeHelp: process.argv.includes("--include-help") });
        process.stdout.write(redactSecrets(JSON.stringify(payload, null, 2)) + "\n");
        return;
    }
    if (process.argv.includes("--list-tools")) {
        process.stdout.write(JSON.stringify(TOOL_DEFINITIONS.map((t) => t.name), null, 2) + "\n");
        return;
    }
    startMcpServer();
}
main().catch((err) => {
    process.stderr.write(redactSecrets(err?.stack || err?.message || String(err)) + "\n");
    process.exitCode = 1;
});
