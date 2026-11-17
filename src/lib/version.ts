// The running app's version — single source of truth is package.json
// (resolveJsonModule is enabled). Bump package.json's version when
// cutting a release in the Developer Panel; instances report this value
// in their heartbeat and compare it against the latest release.
import { version } from '../../package.json'

export const APP_VERSION = version
