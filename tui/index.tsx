#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./App";

const renderer = await createCliRenderer();

// Copy selected text to clipboard (OSC52 fallback)
renderer.on("selection", (selection) => {
  const text = selection.getSelectedText();
  if (!text?.trim()) return;
  void (async () => {
    try {
      const nav = globalThis.navigator as { clipboard?: { writeText: (t: string) => Promise<void> } } | undefined;
      if (nav?.clipboard?.writeText) {
        await nav.clipboard.writeText(text);
      } else {
        renderer.copyToClipboardOSC52(text);
      }
    } catch {
      try {
        renderer.copyToClipboardOSC52(text);
      } catch {
        /* OSC52 may be unsupported */
      }
    } finally {
      renderer.clearSelection();
      renderer.requestRender();
    }
  })();
});

createRoot(renderer).render(<App />);
