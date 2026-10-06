/**
 * Offline mockup renderer: loads each HTML in an offscreen Electron window,
 * measures the full artboard, then writes a PNG next to the source file.
 * Usage: electron.exe shoot-main.js <file.html> [<file2.html> ...]
 * (design-only helper — not part of the widget runtime)
 */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

app.disableHardwareAcceleration();

const VIEWPORT_WIDTH = 1500;

async function shoot(htmlPath) {
  const win = new BrowserWindow({
    show: false,
    width: VIEWPORT_WIDTH,
    height: 1000,
    webPreferences: { offscreen: true, backgroundThrottling: false }
  });
  const measure = () => win.webContents.executeJavaScript(`(() => {
    const el = document.documentElement;
    const b = document.body;
    return {
      width: Math.ceil(Math.max(el.scrollWidth, b.scrollWidth, b.offsetWidth)),
      height: Math.ceil(Math.max(el.scrollHeight, b.scrollHeight, b.offsetHeight))
    };
  })()`);
  const fit = async () => {
    const size = await measure();
    win.setContentSize(
      VIEWPORT_WIDTH,
      Math.min(size.height + 48, 8000)
    );
    await new Promise((resolve) => setTimeout(resolve, 350));
    return size;
  };
  await win.loadFile(htmlPath);
  await fit();
  await fit(); // reflow after the first resize can grow the artboard
  const image = await win.webContents.capturePage();
  const out = htmlPath.replace(/\.html$/, ".png");
  fs.writeFileSync(out, image.toPNG());
  win.close();
  return out;
}

app.whenReady().then(async () => {
  const targets = process.argv.slice(2).filter((arg) => arg.toLowerCase().endsWith(".html"));
  if (targets.length === 0) console.log("NO_TARGETS " + JSON.stringify(process.argv));
  for (const arg of targets) {
    const target = path.resolve(arg);
    try {
      const out = await shoot(target);
      console.log("OK " + out);
    } catch (error) {
      console.log("FAIL " + target + " " + (error && error.message));
    }
  }
  app.quit();
});
