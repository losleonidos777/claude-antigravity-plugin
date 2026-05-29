import test from 'node:test';
import assert from 'node:assert/strict';
import { stripAnsi, extractFinalTuiFrame } from '../../dist/core/ansi.js';

test('stripAnsi removes CSI sequences', () => {
  const input = '\x1b[2J\x1b[H\x1b[mPONG\x1b[?25h';
  assert.equal(stripAnsi(input), 'PONG');
});

test('stripAnsi removes OSC sequences (BEL terminated)', () => {
  const input = '\x1b]0;Window Title\x07PONG';
  assert.equal(stripAnsi(input), 'PONG');
});

test('stripAnsi normalizes CR/LF', () => {
  assert.equal(stripAnsi('line1\r\nline2\rline3'), 'line1\nline2\nline3');
});

test('stripAnsi handles real agy PONG capture verbatim', () => {
  const raw =
    '\x1b[?9001h\x1b[?1004h' +
    '\x1b[?25l\x1b[2J\x1b[m\x1b[HPONG' +
    '\x1b]0;C:\\Users\\user\\AppData\\Local\\agy\\bin\\agy.EXE\x07' +
    '\x1b[?25h\r\n';
  assert.equal(stripAnsi(raw).trim(), 'PONG');
});

test('extractFinalTuiFrame returns content after last screen-clear', () => {
  const raw = 'intermediate\x1b[2Jstillrepainting\x1b[2J\x1b[H FINAL ANSWER \x1b[?25h\r\n';
  assert.equal(extractFinalTuiFrame(raw), 'FINAL ANSWER');
});

test('extractFinalTuiFrame falls back to whole input when no clear-screen present', () => {
  assert.equal(extractFinalTuiFrame('plain output\r\n'), 'plain output');
});

test('extractFinalTuiFrame: tail empty after trailing status-line repaint → fall back to full', () => {
  // agy could emit the real answer, then a status-line cursor-home repaint that erases it.
  // Tail after the final \x1b[H is empty / trivial; we should return the full output.
  const raw = '\x1b[2J\x1b[HReal answer that matters\x1b[H ';
  assert.equal(extractFinalTuiFrame(raw), 'Real answer that matters');
});

test('extractFinalTuiFrame: stronger full-reset (CSI[2J + cursor home) is preferred over bare cursor-home', () => {
  // The bare \x1b[H BEFORE the full reset shouldn't fool the slicer.
  const raw = '\x1b[Hjunk\x1b[2J\x1b[HFINAL\r\n';
  assert.equal(extractFinalTuiFrame(raw), 'FINAL');
});

test('stripAnsi removes DCS (ESC P … ESC\\)', () => {
  const input = 'before\x1bP1$rfoo bar\x1b\\after';
  assert.equal(stripAnsi(input), 'beforeafter');
});

test('stripAnsi removes APC (ESC _ … ESC\\)', () => {
  const input = 'before\x1b_apc payload here\x1b\\after';
  assert.equal(stripAnsi(input), 'beforeafter');
});

test('stripAnsi removes PM (ESC ^ … ESC\\) and SOS (ESC X … ESC\\)', () => {
  assert.equal(stripAnsi('a\x1b^private message\x1b\\b'), 'ab');
  assert.equal(stripAnsi('a\x1bXstring of chars\x1b\\b'), 'ab');
});
