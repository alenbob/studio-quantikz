#!/usr/bin/env node
"use strict";
const { readFileSync, writeFileSync } = require("fs");
const path = require("path");
const zlib = require("zlib");

function makeDataUri(filePath) {
  const buf = readFileSync(filePath);
  const compressed = zlib.gzipSync(buf, { level: 9 });
  return "data:application/gzip;base64," + compressed.toString("base64");
}

const TEX_FILES_DIR = path.join(__dirname, "../src/server/tex-files");
const injectedFiles = [
  "quantikz.sty",
  "tikzlibraryquantikz.code.tex",
  "tikzlibraryquantikz2.code.tex",
  "xargs.sty",
  "xkeyval.sty",
  "xkeyval.tex",
  "xkvutils.tex",
  "xkvtxhdr.tex",
  "xstring.sty",
  "xstring.tex",
  "mathtools.sty",
  "environ.sty",
  "trimspaces.sty",
  "calc.sty",
  "mhsetup.sty",
  "keyval.sty",
  "keyval.tex",
  "graphicx.sty",
  "graphics.sty",
  "graphics.cfg",
  "dvips.def",
  "trig.sty"
];

const bundlePath = __dirname + "/../public/tikzjax.js";
let bundle = readFileSync(bundlePath, "utf8");

const injection = injectedFiles
  .map((fileName) => {
    const filePath = path.join(TEX_FILES_DIR, fileName);
    return `"tex_files/${fileName}.gz":${JSON.stringify(makeDataUri(filePath))}`;
  })
  .join(",");

const markerPattern = /"tex_files\/umsb\.fd\.gz":q\(1643\),(?:"tex_files\/[^"]+?\.gz":"data:application\/gzip;base64,[^"]*",?)*(?=};)/;

if (!markerPattern.test(bundle)) {
  console.error("ERROR: Injection marker not found. Cannot patch.");
  process.exit(1);
}

const patched = bundle.replace(
  markerPattern,
  `"tex_files/umsb.fd.gz":q(1643),${injection}`
);
writeFileSync(bundlePath, patched, "utf8");

console.log("Patched! New size: " + (patched.length / 1024 / 1024).toFixed(2) + " MB");
for (const fileName of injectedFiles) {
  const dataUri = makeDataUri(path.join(TEX_FILES_DIR, fileName));
  console.log(`  ${fileName}.gz: ${Math.round(dataUri.length / 1024)} KB`);
}
