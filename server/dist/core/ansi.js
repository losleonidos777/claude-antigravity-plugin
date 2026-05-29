// Strip ANSI escape sequences and TUI control bytes from PTY-captured output.
// Covers CSI (e.g. \x1b[2J), OSC (e.g. \x1b]0;title\x07), single-char SS3,
// shift-out/shift-in charset escapes, ST-terminated string-control sequences
// (DCS \x1bP… APC \x1b_… PM \x1b^… SOS \x1bX…), and bare C0 control bytes.
const CSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
// DCS / APC / PM / SOS — payload terminated by ST (ESC \) or BEL.
// Pattern is intentionally non-greedy to avoid swallowing later legitimate text.
const STRING_CTRL_RE = /\x1b[P_^X][\s\S]*?(?:\x1b\\|\x07)/g;
const SS3_RE = /\x1b[NO][@-~]/g;
const SINGLE_ESC_RE = /\x1b[()][AB012]/g;
const C1_CONTROL_RE = /[\x00-\x08\x0b-\x1f\x7f]/g;
export function stripAnsi(input) {
    if (!input)
        return "";
    let out = input;
    out = out.replace(STRING_CTRL_RE, "");
    out = out.replace(OSC_RE, "");
    out = out.replace(CSI_RE, "");
    out = out.replace(SS3_RE, "");
    out = out.replace(SINGLE_ESC_RE, "");
    out = out.replace(/\r\n/g, "\n");
    out = out.replace(/\r/g, "\n");
    out = out.replace(C1_CONTROL_RE, "");
    return out;
}
// Slicing heuristic for "what is the final frame of agy's TUI render".
// agy normally emits a full-screen reset (CSI[2J then CSI[H) before its final
// answer. We slice from the LAST occurrence of that combo. If we don't see a
// full reset, fall back to slicing from the last cursor-home. If the resulting
// tail is suspiciously empty (the answer might have come BEFORE a trailing
// status repaint), fall back to the full stripped output.
const FULL_RESET_RE = /\x1b\[2J(?:\x1b\[[\?0-9;]*[Hf])?/g;
const CURSOR_HOME_RE = /\x1b\[(?:[01;]+)?[Hf]/g;
export function extractFinalTuiFrame(rawPtyOutput) {
    if (!rawPtyOutput)
        return "";
    const lastResetIdx = lastMatchIndex(rawPtyOutput, FULL_RESET_RE);
    let sliceStart = lastResetIdx >= 0 ? lastResetIdx : lastMatchIndex(rawPtyOutput, CURSOR_HOME_RE);
    if (sliceStart < 0)
        sliceStart = 0;
    const tail = stripAnsi(rawPtyOutput.slice(sliceStart)).trim();
    const full = stripAnsi(rawPtyOutput).trim();
    // If the tail looks empty or trivially short while the full output is much larger,
    // assume agy emitted a final status-line repaint after the real answer; fall back
    // to the full stripped output rather than dropping content.
    const FALLBACK_TAIL_MIN = 8;
    if (tail.length < FALLBACK_TAIL_MIN && full.length > tail.length * 4) {
        return full;
    }
    return tail;
}
function lastMatchIndex(s, re) {
    // Clone regex with /g and scan; RegExp state is per-instance, so don't share.
    const clone = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let last = -1;
    let m;
    while ((m = clone.exec(s)) !== null) {
        last = m.index;
        if (m.index === clone.lastIndex)
            clone.lastIndex++;
    }
    return last;
}
