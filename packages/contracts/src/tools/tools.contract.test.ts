import assert from 'node:assert/strict';
import test from 'node:test';
import type { ToolDescriptor, ToolResult } from '../index.js';

test('ToolDescriptor survives JSON round-trip', () => {
  const tool: ToolDescriptor = {
    name: 'read_skill',
    toolset: 'skills',
    schema: { type: 'object', properties: { name: { type: 'string' } } },
  };

  const serialized = JSON.stringify(tool);
  const deserialized: ToolDescriptor = JSON.parse(serialized);
  assert.deepEqual(deserialized, tool);
});

test('ToolResult survives JSON round-trip', () => {
  const result: ToolResult = {
    success: true,
    output: 'File contents here',
  };

  const serialized = JSON.stringify(result);
  const deserialized: ToolResult = JSON.parse(serialized);
  assert.deepEqual(deserialized, result);
});

test('ToolResult with error field', () => {
  const result: ToolResult = {
    success: false,
    output: '',
    error: 'Tool not found: unknown_tool',
  };

  const serialized = JSON.stringify(result);
  const deserialized: ToolResult = JSON.parse(serialized);
  assert.deepEqual(deserialized, result);
  assert.equal(deserialized.success, false);
});
