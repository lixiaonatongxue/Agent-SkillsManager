import { ConventionAdapter } from './base.js';

/** ZCode: ~/.zcode/skills + <repo>/.zcode/skills */
export class ZCodeAdapter extends ConventionAdapter {
  constructor() {
    super('zcode', 'ZCode', '.zcode');
  }
}
