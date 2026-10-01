// Fallback for browsers without the File System Access API: everything lives
// in memory; the user loads/saves the data file and uploads CODA files by hand.
export class ManualStore {
  constructor() {
    this.mode = 'manual';
    this.text = null;
    this.dirty = false;
    this.name = 'handmatige modus';
  }
  async init() {}
  async readData() {
    return this.text;
  }
  async writeData(text) {
    this.text = text;
    this.dirty = true;
  }
  loadText(text) {
    this.text = text;
    this.dirty = false;
  }
  markSaved() {
    this.dirty = false;
  }
  async listInbox() {
    return [];
  }
  async keepUpload() {
    return null;
  }
  async backup() {
    return null;
  }
  async listBackups() {
    return [];
  }
}
