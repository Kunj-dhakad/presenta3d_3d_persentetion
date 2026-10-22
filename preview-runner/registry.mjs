// Allowlisted packages that generated projects may import.
//
// Generated code never triggers `npm install`. Instead these packages are
// bundled once from this app's own node_modules (pinned by package-lock.json)
// into a local ESM "preview runtime", and generated projects resolve bare
// imports to it through an import map. Anything not listed is a validation
// error that the repair stage asks the model to fix.
//
// This file is plain ESM so both the Next.js server and the isolated build
// worker process can import it.

/** @typedef {{ spec: string, file: string, kind: "cjs" | "esm", defaultExport?: boolean, aliasOf?: string }} RuntimePackage */

/** @type {Record<string, RuntimePackage>} */
export const RUNTIME_PACKAGES = {
  react: { spec: "react", file: "react.js", kind: "cjs" },
  "react-dom": { spec: "react-dom", file: "react-dom.js", kind: "cjs" },
  "react-dom/client": { spec: "react-dom/client", file: "react-dom-client.js", kind: "cjs" },
  "react/jsx-runtime": { spec: "react/jsx-runtime", file: "react-jsx-runtime.js", kind: "cjs" },
  three: { spec: "three", file: "three.js", kind: "esm" },
  "@react-three/fiber": { spec: "@react-three/fiber", file: "r3f-fiber.js", kind: "esm" },
  "@react-three/drei": { spec: "@react-three/drei", file: "r3f-drei.js", kind: "esm" },
  gsap: { spec: "gsap", file: "gsap.js", kind: "esm", defaultExport: true },
  "gsap/ScrollTrigger": { spec: "gsap/ScrollTrigger", file: "gsap-scrolltrigger.js", kind: "esm", defaultExport: true },
  "motion/react": { spec: "motion/react", file: "motion-react.js", kind: "esm" },
  "framer-motion": { spec: "motion/react", file: "motion-react.js", kind: "esm", aliasOf: "motion/react" },
  motion: { spec: "motion", file: "motion.js", kind: "esm" },
  zustand: { spec: "zustand", file: "zustand.js", kind: "esm" },
  "lucide-react": { spec: "lucide-react", file: "lucide-react.js", kind: "esm" },
  d3: { spec: "d3", file: "d3.js", kind: "esm" },
};

/** three.js addons exposed under both `three/addons/` and `three/examples/jsm/`. */
export const THREE_ADDONS = [
  "controls/OrbitControls.js",
  "controls/PointerLockControls.js",
  "controls/TransformControls.js",
  "controls/MapControls.js",
  "loaders/GLTFLoader.js",
  "loaders/RGBELoader.js",
  "geometries/RoundedBoxGeometry.js",
  "postprocessing/EffectComposer.js",
  "postprocessing/RenderPass.js",
  "postprocessing/UnrealBloomPass.js",
  "postprocessing/ShaderPass.js",
  "postprocessing/OutputPass.js",
  "math/SimplexNoise.js",
  "math/ImprovedNoise.js",
  "environments/RoomEnvironment.js",
  "objects/Sky.js",
  "utils/BufferGeometryUtils.js",
];

export const RUNTIME_VERSION = "1";

/** Is a bare import specifier available in the preview runtime? */
export function isAllowedSpecifier(spec) {
  if (Object.prototype.hasOwnProperty.call(RUNTIME_PACKAGES, spec)) return true;
  for (const prefix of ["three/addons/", "three/examples/jsm/"]) {
    if (spec.startsWith(prefix)) return THREE_ADDONS.includes(spec.slice(prefix.length));
  }
  return false;
}

/** Package name portion of a bare specifier ("@a/b/c" -> "@a/b", "x/y" -> "x"). */
export function packageName(spec) {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/** Import map for a runtime served from `base` (e.g. "/preview-runtime/abc123"). */
export function importMap(base) {
  const imports = {};
  for (const [spec, pkg] of Object.entries(RUNTIME_PACKAGES)) imports[spec] = `${base}/${pkg.file}`;
  imports["three/addons/"] = `${base}/three-addons/`;
  imports["three/examples/jsm/"] = `${base}/three-addons/`;
  return { imports };
}

export function allowedSpecifierList() {
  return [...Object.keys(RUNTIME_PACKAGES), ...THREE_ADDONS.map((a) => `three/addons/${a}`)];
}
