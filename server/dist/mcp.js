import * as readline from "node:readline";
import { TOOL_DEFINITIONS } from "./schemas/tools.js";
import { antigravityDoctor, antigravitySetup } from "./tools/doctor.js";
import { antigravityReview, antigravityAdversarialReview } from "./tools/review.js";
import { antigravityDelegate } from "./tools/delegate.js";
import { antigravityExecuteTasks, antigravityVerifyPlan } from "./tools/tasks.js";
import { antigravityStatus } from "./tools/status.js";
import { antigravityResult } from "./tools/result.js";
import { antigravityCancel } from "./tools/cancel.js";
import { redactSecrets } from "./core/safety.js";
const handlers = {
    antigravity_doctor: antigravityDoctor,
    antigravity_setup: antigravitySetup,
    antigravity_review: antigravityReview,
    antigravity_adversarial_review: antigravityAdversarialReview,
    antigravity_delegate: antigravityDelegate,
    antigravity_execute_tasks: antigravityExecuteTasks,
    antigravity_verify_plan: antigravityVerifyPlan,
    antigravity_status: antigravityStatus,
    antigravity_result: antigravityResult,
    antigravity_cancel: antigravityCancel
};
function writeMessage(message) {
    process.stdout.write(JSON.stringify(message) + "\n");
}
function result(id, payload) {
    writeMessage({ jsonrpc: "2.0", id, result: payload });
}
function error(id, code, message, data) {
    writeMessage({ jsonrpc: "2.0", id, error: { code, message, data } });
}
async function handle(request) {
    const id = request.id;
    const method = request.method || "";
    if (method.startsWith("notifications/"))
        return;
    try {
        if (method === "initialize") {
            result(id, {
                protocolVersion: request.params?.protocolVersion || "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "antigravity-plugin-cc", version: "0.1.0" }
            });
            return;
        }
        if (method === "ping") {
            result(id, {});
            return;
        }
        if (method === "tools/list") {
            result(id, { tools: TOOL_DEFINITIONS });
            return;
        }
        if (method === "tools/call") {
            const name = String(request.params?.name || "");
            const args = request.params?.arguments || {};
            const fn = handlers[name];
            if (!fn) {
                error(id, -32602, `Unknown Antigravity tool: ${name}`);
                return;
            }
            const payload = await fn(args);
            result(id, {
                content: [{ type: "text", text: redactSecrets(JSON.stringify(payload, null, 2)) }],
                structuredContent: payload
            });
            return;
        }
        error(id, -32601, `Method not found: ${method}`);
    }
    catch (err) {
        result(id, {
            isError: true,
            content: [
                {
                    type: "text",
                    text: redactSecrets(err?.stack || err?.message || String(err))
                }
            ]
        });
    }
}
export function startMcpServer() {
    const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    rl.on("line", (line) => {
        const trimmed = line.trim();
        if (!trimmed)
            return;
        let request;
        try {
            request = JSON.parse(trimmed);
        }
        catch (err) {
            error(null, -32700, `Parse error: ${err?.message || err}`);
            return;
        }
        handle(request).catch((err) => error(request.id, -32603, redactSecrets(err?.message || String(err))));
    });
}
