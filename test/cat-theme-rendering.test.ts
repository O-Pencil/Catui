/**
 * [WHO]: Cat theme rendering and update progress regression tests
 * [FROM]: Depends on real interactive components, TUI and VirtualTerminal
 * [TO]: Consumed by node:test
 * [HERE]: test/cat-theme-rendering.test.ts — width, cursor and estimated-progress acceptance
 */
import assert from "node:assert/strict";
import test from "node:test";
import { CURSOR_MARKER, TUI, visibleWidth } from "@catui/tui";
import { VirtualTerminal } from "../core/lib/tui/test/virtual-terminal.js";
import { KeybindingsManager } from "../core/platform/keybindings.js";
import { CustomEditor } from "../modes/interactive/components/custom-editor.js";
import { UserMessageComponent } from "../modes/interactive/components/user-message.js";
import { UpdateProgressComponent } from "../modes/interactive/components/update-progress.js";
import { StartupWordmarkComponent, renderStartupWordmark } from "../modes/interactive/components/startup-wordmark.js";
import { renderSelectedRows } from "../modes/interactive/components/selected-row.js";
import { getEditorTheme, initTheme } from "../modes/interactive/theme/theme.js";

initTheme("catui");
const plain = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");

test("startup preserves width and rotates the cat grid into A", () => {
  const startup = new StartupWordmarkComponent("1.2.33", "model");
  assert.ok(startup.render(80).length > startup.render(40).length);
  assert.ok(plain(startup.render(40)[0]).includes("CATUI"));
  for (const width of [12, 40, 64, 80, 120]) {
    for (const line of renderStartupWordmark(width, "1.2.33", "long-model-name")) assert.ok(visibleWidth(line) <= width);
  }
  const lines = renderStartupWordmark(80, "1.2.33", "model").slice(0, 5).map(plain);
  const decode = (chars: string[]) => chars.flatMap(row => Array.from({length:4},(_,y) => [...row].flatMap(char => {
    const mask=char===' '?0:char.codePointAt(0)!-0x2800;
    return [[0,1,2,6],[3,4,5,7]].map(bits => (mask>>bits[y])&1);
  })));
  const a=decode(lines.map(line=>line.slice(15,25)));
  const cat=decode(lines.map(line=>line.slice(41,51)));
  assert.deepEqual(a,cat.slice().reverse());
});

test("framed composer preserves cursor markers and narrow multiline widths", () => {
  const terminal = new VirtualTerminal(40, 12);
  const editor = new CustomEditor(new TUI(terminal),getEditorTheme(),KeybindingsManager.create(),{paddingX:1});
  editor.focused=true;
  for (const width of [4,10,20,40,80]) {
    for (const text of ["", "你好 world", "a".repeat(120)+"\nsecond line", "─".repeat(20)]) {
      editor.setText(text);
      const lines=editor.render(width);
      assert.equal(lines.filter(line=>line.includes(CURSOR_MARKER)).length,1);
      for(const line of lines) assert.ok(visibleWidth(line)<=width, `${width}: ${JSON.stringify(line)}`);
      if(width>=10) assert.ok(plain(lines[0]).startsWith("┌"));
    }
  }
});

test("framed composer keeps typing in the same terminal input region", async () => {
  const terminal=new VirtualTerminal(40,8);
  const tui=new TUI(terminal);
  const editor=new CustomEditor(tui,getEditorTheme(),KeybindingsManager.create());
  tui.addChild(editor);tui.setFocus(editor);tui.start();
  try {
    await terminal.flush();
    for(const input of ["a","b","中"]) { editor.handleInput(input);tui.requestRender();await terminal.flush(); }
    assert.equal(editor.getText(),"ab中");
    assert.equal(terminal.getViewport().filter(line=>line.includes("ab中")).length,1);
  } finally { tui.stop(); }
});

test("framed composer leaves autocomplete below the box and accepts completion", () => {
  const editor = new CustomEditor(new TUI(new VirtualTerminal(40, 12)), getEditorTheme(), KeybindingsManager.create());
  editor.focused = true;
  editor.setAutocompleteProvider({
    getSuggestions: () => ({ items: [{ value: "dist/", label: "dist/" }], prefix: "di" }),
    applyCompletion: () => ({ lines: ["dist/"], cursorLine: 0, cursorCol: 5 }),
  });
  editor.handleInput("d"); editor.handleInput("i"); editor.handleInput("\t");
  assert.equal(editor.isShowingAutocomplete(), true);
  for (const width of [20, 40, 80]) {
    const lines = editor.render(width).map(plain);
    const bottom = lines.findIndex(line => line.startsWith("└"));
    assert.ok(bottom > 0);
    assert.ok(lines.slice(bottom + 1).some(line => line.includes("dist/")));
    for (const line of lines) assert.ok(visibleWidth(line) <= width);
    assert.ok(lines.slice(bottom + 1).every(line => !line.includes("│")));
  }
  editor.handleInput("\t");
  assert.equal(editor.getText(), "dist/");
  assert.equal(editor.isShowingAutocomplete(), false);
});

test("composer box shares the message background's first and last columns", () => {
  const editor = new CustomEditor(new TUI(new VirtualTerminal(120, 12)), getEditorTheme(), KeybindingsManager.create());
  editor.focused = true;
  for (const width of [10, 20, 40, 80, 100, 120]) {
    const message = new UserMessageComponent("x".repeat(width));
    const messageRows = message.render(width).filter(line => /\x1b\[48;/.test(line));
    assert.ok(messageRows.length > 0);
    assert.ok(messageRows.every(line => visibleWidth(line) === width));
    for (const text of ["", "中".repeat(width), "x".repeat(width * 2)]) {
      editor.setText(text);
      const lines = editor.render(width).map(plain);
      assert.equal(lines[0][0], "┌");
      assert.equal(lines[0][width - 1], "┐");
      assert.equal(lines.at(-1)![0], "└");
      assert.equal(lines.at(-1)![width - 1], "┘");
      for (const line of lines.slice(1, -1)) {
        assert.ok(line.startsWith("│"));
        assert.ok(line.endsWith("│"));
        assert.equal(visibleWidth(line), width);
      }
    }
  }
});

test("selected rows fit terminal width without rewriting other arrows", () => {
  const lines=renderSelectedRows(["→ Setting true","v1 → v2"],20).map(plain);
  assert.equal(visibleWidth(lines[0]),20);
  assert.ok(lines[0].startsWith("› "));
  assert.equal(lines[1],"v1 → v2");
});

test("estimated update holds at 90 until success and stops its timer", context => {
  context.mock.timers.enable({apis:["Date","setInterval"],now:0});
  let renders=0;
  const progress=new UpdateProgressComponent("1.2.32","1.2.33",()=>{renders++;});
  context.mock.timers.tick(25000);
  assert.ok(progress.render(80).map(plain).some(line=>line.includes("90%")));
  context.mock.timers.tick(60000);
  assert.ok(progress.render(80).map(plain).some(line=>line.includes("90%")));
  progress.finish(true);
  assert.ok(progress.render(80).map(plain).some(line=>line.includes("100%")));
  const stopped=renders;context.mock.timers.tick(1000);assert.equal(renders,stopped);
  context.mock.timers.reset();
});

test("failed update never claims completion and disposal stops refreshes", context => {
  context.mock.timers.enable({apis:["Date","setInterval"],now:0});
  let renders=0;
  const progress=new UpdateProgressComponent("1.2.32","1.2.33",()=>{renders++;});
  context.mock.timers.tick(21000);progress.finish(false);
  for(const width of [8,20,80]) for(const line of progress.render(width)) assert.ok(visibleWidth(line)<=width);
  const lines=progress.render(80).map(plain);
  assert.ok(lines.some(line=>line.includes("× Update failed")));
  assert.ok(!lines.some(line=>line.includes("100%")));
  const stopped=renders;context.mock.timers.tick(1000);assert.equal(renders,stopped);
  assert.deepEqual(progress.render(80).map(plain), lines);
  context.mock.timers.reset();
});
