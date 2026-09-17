import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function niaSourcePlugin({ types: t }: { types: any }) {
  return {
    visitor: {
      JSXOpeningElement(nodePath: any, state: any) {
        const name = nodePath.node.name;
        if (!t.isJSXIdentifier(name)) return;
        if (!name.name || name.name[0] !== name.name[0].toLowerCase()) return;

        const loc = nodePath.node.loc?.start;
        const filename = state.file?.opts?.filename as string | undefined;
        if (!loc || !filename) return;

        const normalized = filename.replace(/\\/g, "/");
        const sampleMarker = "/sample/";
        const sampleIndex = normalized.lastIndexOf(sampleMarker);
        const sourceFile = sampleIndex >= 0
          ? `sample/${normalized.slice(sampleIndex + sampleMarker.length)}`
          : normalized;

        const attributes = nodePath.node.attributes;
        const existing = new Set(
          attributes
            .filter((attr: any) => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name))
            .map((attr: any) => attr.name.name),
        );

        const add = (attrName: string, value: string) => {
          if (existing.has(attrName)) return;
          nodePath.node.attributes.push(
            t.jsxAttribute(t.jsxIdentifier(attrName), t.stringLiteral(value)),
          );
        };

        add("data-nia-source-file", sourceFile);
        add("data-nia-source-line", String(loc.line));
        add("data-nia-source-column", String(loc.column + 1));

        const classNameAttr = attributes.find(
          (attr: any) =>
            t.isJSXAttribute(attr)
            && t.isJSXIdentifier(attr.name, { name: "className" })
            && t.isStringLiteral(attr.value),
        );

        if (classNameAttr && t.isStringLiteral(classNameAttr.value)) {
          const classLoc = classNameAttr.loc?.start ?? loc;
          add("data-nia-class-file", sourceFile);
          add("data-nia-class-line", String(classLoc.line));
          add("data-nia-class-column", String(classLoc.column + 1));
          add("data-nia-class-value", classNameAttr.value.value);
        }
      },
    },
  };
}

// Serves the tiny sample app that Nia loads inside its central canvas.
// The Babel transform injects source locations into rendered DOM automatically
// so app code does not need Nia-specific source metadata.
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [niaSourcePlugin as any],
      },
    }),
  ],
  clearScreen: false,
  root: "sample",
  server: { host: "127.0.0.1", port: 1421, strictPort: true },
});
