import * as demoKeysModule from "../../apps/web/lib/try/demo-keys.js";

// apps/web has no "type": "module", so Node loads its files as CommonJS. Node 22 does not always
// detect their named exports from an ES import; the CommonJS `default` (module.exports) always has them.
// Root scripts import apps/web/lib/try/demo-keys through this file so they run on Node 20 and 22.
const demoKeys = ((demoKeysModule as { default?: typeof demoKeysModule }).default ?? demoKeysModule) as typeof demoKeysModule;

export const { DEMO_CLIENT, DEMO_VENDOR, DEMO_WARNING, bytesOf, demoBundle, demoBundleHash, demoSecrets, parseDemoFixture } =
  demoKeys;
export type { DemoClient, DemoFixture, DemoVendor } from "../../apps/web/lib/try/demo-keys.js";
